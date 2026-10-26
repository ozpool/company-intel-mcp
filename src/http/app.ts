import { randomUUID } from 'node:crypto';
import express, { type ErrorRequestHandler } from 'express';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { hostHeaderValidation } from '@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js';
import { getOAuthProtectedResourceMetadataUrl, mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SCOPES, SqliteOAuthProvider } from '../auth/oauthProvider.js';
import type { Config } from '../config.js';
import type { Db } from '../db/database.js';
import type { Logger } from '../logger.js';
import { createMcpServer } from '../mcp/server.js';
import type { EnrichmentProvider } from '../services/enrichment.js';
import { readExport } from '../services/exports.js';
import { rateLimit } from './rateLimit.js';

export type AppDeps = { config: Config; db: Db; logger: Logger; enrichment: EnrichmentProvider };

export function createApp({ config, db, logger, enrichment }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  const provider = new SqliteOAuthProvider(db, config.mcpUrl);

  // Access log: one line per request, with the account once auth has run.
  app.use((req, res, next) => {
    const started = performance.now();
    const requestId = randomUUID();
    res.set('X-Request-Id', requestId);
    res.on('finish', () => {
      const line = {
        requestId,
        method: req.method,
        path: req.originalUrl.split('?')[0], // never log the query: export links carry their signature there
        status: res.statusCode,
        ms: Math.round(performance.now() - started),
        account: req.auth?.extra?.accountId,
        rpc: (req.body as { method?: string } | undefined)?.method,
      };
      if (res.statusCode >= 500) logger.error(line, 'request');
      else if (res.statusCode >= 400) logger.warn(line, 'request');
      else logger.info(line, 'request');
    });
    next();
  });

  // DNS-rebinding guard: a web page that points its own domain at this server sends a foreign Host header.
  app.use(hostHeaderValidation(config.allowedHosts));
  // The SDK limits /authorize, /token, /register and /revoke itself; this covers the other unauthenticated routes.
  app.use(['/oauth/consent', '/exports'], rateLimit(config.rateLimitPerMinute));

  app.get('/healthz', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok' });
  });

  // OAuth 2.1: discovery metadata, dynamic client registration, /authorize, /token, /revoke.
  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: config.publicUrl,
      resourceServerUrl: config.mcpUrl,
      scopesSupported: SCOPES,
      resourceName: 'Company Intelligence MCP',
    }),
  );

  app.post('/oauth/consent', express.urlencoded({ extended: false, limit: '10kb' }), (req, res) => {
    const body = req.body as Record<string, string | undefined>;
    const outcome = provider.completeConsent({
      pendingId: body.pending_id ?? '',
      apiKey: body.api_key ?? '',
      approve: body.action === 'approve',
    });
    if (!outcome) {
      res.status(400).type('text').send('This authorization request has expired. Start the connection again from your MCP client.');
    } else if ('redirect' in outcome) {
      res.redirect(302, outcome.redirect);
    } else {
      res.status(401).type('html').set('Cache-Control', 'no-store').set('Content-Security-Policy', outcome.csp).send(outcome.html);
    }
  });

  // Signed, expiring export links. The signature is the credential, so no bearer token here.
  app.get('/exports/:file', (req, res) => {
    const exportId = req.params.file.replace(/\.csv$/, '');
    const q = req.query as Record<string, string | undefined>;
    const outcome = readExport(db, config.exportSigningSecret, exportId, q.exp ?? '', q.sig ?? '');
    if (!outcome.ok) {
      res.status(outcome.status).json({ error: outcome.reason });
      return;
    }
    res
      .type('text/csv; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="contacts-${exportId}.csv"`)
      .set('Cache-Control', 'private, no-store')
      .send(outcome.csv);
  });

  const mcpPath = config.mcpUrl.pathname;
  // Browser-based clients (e.g. MCP Inspector in direct mode) call from another origin.
  // Credentials travel in the Authorization header, never cookies, so any origin is safe.
  app.use(mcpPath, (req, res, next) => {
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id',
      'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id, Retry-After, X-Request-Id',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    });
    if (req.method === 'OPTIONS') res.sendStatus(204);
    else next();
  });
  app.post(
    mcpPath,
    requireBearerAuth({
      verifier: provider,
      requiredScopes: SCOPES,
      expectedResource: config.mcpUrl, // reject tokens minted for some other server (audience check)
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(config.mcpUrl),
    }),
    rateLimit(config.rateLimitPerMinute),
    express.json({ limit: '1mb' }),
    async (req, res) => {
      // Stateless: a fresh server + transport per request, so any instance can serve any request.
      const server = createMcpServer({
        db,
        logger,
        enrichment,
        exports: { baseUrl: config.publicUrl, secret: config.exportSigningSecret, ttlMinutes: config.exportTtlMinutes },
      });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    },
  );
  // No sessions, so there is no SSE stream to open (GET) or session to end (DELETE).
  app.all(mcpPath, (_req, res) => {
    res.status(405).set('Allow', 'POST').json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. This server is stateless; use POST.' },
      id: null,
    });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    const status = typeof err?.status === 'number' && err.status < 500 ? err.status : 500;
    if (status === 500) logger.error({ err }, 'unhandled error');
    if (res.headersSent) return;
    // Body-parser failures (bad JSON, too large) are client errors; answer in JSON-RPC shape.
    res.status(status).json({
      jsonrpc: '2.0',
      error: { code: status === 500 ? -32603 : -32700, message: status === 500 ? 'Internal server error' : String(err.message) },
      id: null,
    });
  };
  app.use(onError);

  return app;
}

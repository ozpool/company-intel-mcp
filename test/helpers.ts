import { createHash, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { generateSeedData } from '../scripts/seed-data.js';
import { createAccount } from '../src/auth/accounts.js';
import { loadConfig } from '../src/config.js';
import { openDatabase, type Db } from '../src/db/database.js';
import { createApp } from '../src/http/app.js';
import { createLogger } from '../src/logger.js';
import { simulatedProvider } from '../src/services/enrichment.js';

export const TEST_EMAIL = 'test@example.com';
export const TEST_PASSWORD = 'correct horse battery';
export const REDIRECT_URI = 'http://localhost:7777/callback';

export type TestServer = { baseUrl: string; mcpUrl: URL; db: Db; accountId: string; accessToken: string; close: () => Promise<void> };

/** Starts the real app on a random port with a seeded in-memory database and a signed-in test account. */
export async function startTestServer(env: Record<string, string> = {}): Promise<TestServer> {
  const db = openDatabase(':memory:');
  const { companies, contacts } = generateSeedData();
  const insertCompany = db.prepare(
    `INSERT INTO companies VALUES (:id, :name, :domain, :website, :industry, :country, :city, :employees, :founded_year, :description, :tags)`,
  );
  const insertContact = db.prepare(
    `INSERT INTO contacts VALUES (:id, :company_id, :first_name, :last_name, :title, :department, :seniority, :location)`,
  );
  companies.forEach((c) => insertCompany.run(c));
  contacts.forEach((c) => insertContact.run(c));
  const account = createAccount(db, TEST_EMAIL, TEST_PASSWORD);

  // Bind first so PUBLIC_URL can carry the real port.
  const { createServer } = await import('node:http');
  const http = createServer();
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const port = (http.address() as AddressInfo).port;
  const baseUrl = `http://localhost:${port}`;

  const config = loadConfig({ PUBLIC_URL: baseUrl, EXPORT_SIGNING_SECRET: 'test-secret', LOG_LEVEL: 'silent', ...env });
  const app = createApp({ config, db, logger: createLogger('silent'), enrichment: simulatedProvider });
  http.on('request', app);

  return {
    baseUrl,
    mcpUrl: config.mcpUrl,
    db,
    accountId: account.id,
    accessToken: await signIn(baseUrl, TEST_EMAIL, TEST_PASSWORD),
    close: () => new Promise((resolve) => http.close(() => resolve())),
  };
}

export async function connectClient(server: TestServer, token = server.accessToken): Promise<Client> {
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(server.mcpUrl, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }),
  );
  return client;
}

export const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

/** Dynamic client registration for a public client (PKCE, no secret). Returns the client id. */
export async function registerClient(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Test Client',
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  });
  if (res.status !== 201) throw new Error(`client registration failed with HTTP ${res.status}`);
  return ((await res.json()) as { client_id: string }).client_id;
}

export const pendingIdOf = (consentPageHtml: string) => /name="pending_id" value="([^"]+)"/.exec(consentPageHtml)![1]!;

/** Submits the consent form the way a browser would. */
export const consent = (baseUrl: string, pendingId: string, fields: Record<string, string>) =>
  fetch(`${baseUrl}/oauth/consent`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ pending_id: pendingId, ...fields }),
  });

/** The whole OAuth flow over HTTP: register, authorize with PKCE, sign in (or sign up), exchange the code. */
export async function signIn(baseUrl: string, email: string, password: string, action: 'signin' | 'signup' = 'signin'): Promise<string> {
  const clientId = await registerClient(baseUrl);
  const { verifier, challenge } = pkce();
  const authorizeUrl = new URL('/authorize', baseUrl);
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  const pendingId = pendingIdOf(await (await fetch(authorizeUrl)).text());
  const res = await consent(baseUrl, pendingId, { action, email, password });
  const location = res.headers.get('location');
  const code = location && new URL(location).searchParams.get('code');
  if (!code) throw new Error(`sign-in failed with HTTP ${res.status}`);

  const tokenRes = await fetch(`${baseUrl}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT_URI }),
  });
  return ((await tokenRes.json()) as { access_token: string }).access_token;
}

/** Parses the {"error": {...}} body of a failed tool call. */
export function toolError(result: unknown) {
  const [first] = (result as { content: { text: string }[] }).content;
  return (JSON.parse(first!.text) as { error: { code: string; message: string; details?: Record<string, unknown> } }).error;
}

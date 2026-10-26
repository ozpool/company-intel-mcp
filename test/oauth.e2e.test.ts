import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashSecret } from '../src/auth/oauthProvider.js';
import {
  REDIRECT_URI as redirectUri,
  TEST_EMAIL,
  TEST_PASSWORD,
  connectClient,
  consent as submitConsent,
  pendingIdOf,
  pkce,
  registerClient,
  startTestServer,
  type TestServer,
} from './helpers.js';

let server: TestServer;
let clientId: string;

beforeAll(async () => {
  server = await startTestServer();
  clientId = await registerClient(server.baseUrl);
});
afterAll(() => server.close());

/** Opens the consent page and returns its pending request id. `undefined` in `overrides` drops a parameter. */
async function startAuthorization(challenge: string, overrides: Record<string, string | undefined> = {}) {
  const url = new URL('/authorize', server.baseUrl);
  const params: Record<string, string | undefined> = {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'state-123',
    resource: server.mcpUrl.href,
    ...overrides,
  };
  url.search = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined)).toString();
  const res = await fetch(url, { redirect: 'manual' });
  expect(res.status).toBe(200);
  // Chrome checks form-action against the redirect after the POST, so the client's origin must be allowed.
  expect(res.headers.get('content-security-policy')).toContain(`form-action 'self' ${new URL(redirectUri).origin}`);
  const html = await res.text();
  expect(html).toContain('Test Client');
  return pendingIdOf(html);
}

const consent = (pendingId: string, fields: Record<string, string>) => submitConsent(server.baseUrl, pendingId, fields);
const signInFields = { action: 'signin', email: TEST_EMAIL, password: TEST_PASSWORD };

const token = (params: Record<string, string>) =>
  fetch(`${server.baseUrl}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, ...params }),
  });

async function authorize(overrides: Record<string, string | undefined> = {}) {
  const { verifier, challenge } = pkce();
  const res = await consent(await startAuthorization(challenge, overrides), signInFields);
  expect(res.status).toBe(302);
  const location = new URL(res.headers.get('location')!);
  expect(location.searchParams.get('state')).toBe('state-123');
  return { code: location.searchParams.get('code')!, verifier };
}

describe('OAuth 2.1 authorization code + PKCE', () => {
  it('publishes discovery metadata', async () => {
    const meta = (await (await fetch(`${server.baseUrl}/.well-known/oauth-authorization-server`)).json()) as Record<string, unknown>;
    expect(meta.code_challenge_methods_supported).toEqual(['S256']);
    const prm = (await (await fetch(`${server.baseUrl}/.well-known/oauth-protected-resource/mcp`)).json()) as Record<string, unknown>;
    expect(prm.resource).toBe(server.mcpUrl.href);
  });

  it('issues tokens that work on the MCP endpoint', async () => {
    const { code, verifier } = await authorize();
    const res = await token({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri });
    expect(res.status).toBe(200);
    const tokens = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
    expect(tokens.expires_in).toBe(3600);

    const client = await connectClient(server, tokens.access_token);
    expect((await client.listTools()).tools).toHaveLength(5);
    await client.close();
  });

  it('shows the consent page again, email kept, for a wrong password', async () => {
    const res = await consent(await startAuthorization(pkce().challenge), { ...signInFields, password: 'wrong password' });
    expect(res.status).toBe(401);
    expect(res.headers.get('content-security-policy')).toContain(`form-action 'self' ${new URL(redirectUri).origin}`);
    const html = await res.text();
    expect(html).toContain('Email or password is incorrect');
    expect(html).toContain(`value="${TEST_EMAIL}"`);
    expect(html).not.toContain('wrong password');
  });

  it('creates an account on the consent page, once per email', async () => {
    const signup = { action: 'signup', email: 'new@example.com', password: 'a new password' };
    const created = await consent(await startAuthorization(pkce().challenge), signup);
    expect(created.status).toBe(302);
    expect(new URL(created.headers.get('location')!).searchParams.get('code')).toBeTruthy();

    const again = await consent(await startAuthorization(pkce().challenge), signup);
    expect(again.status).toBe(400);
    expect(await again.text()).toContain('already exists');
  });

  it('sends access_denied back to the client when the user denies', async () => {
    const res = await consent(await startAuthorization(pkce().challenge), { action: 'deny' });
    expect(new URL(res.headers.get('location')!).searchParams.get('error')).toBe('access_denied');
  });

  it('rejects a wrong PKCE verifier', async () => {
    const { code } = await authorize();
    const res = await token({ grant_type: 'authorization_code', code, code_verifier: pkce().verifier, redirect_uri: redirectUri });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_grant');
  });

  it('accepts each authorization code only once', async () => {
    const { code, verifier } = await authorize();
    const exchange = () => token({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri });
    expect((await exchange()).status).toBe(200);
    expect((await exchange()).status).toBe(400);
  });

  it('rotates refresh tokens', async () => {
    const { code, verifier } = await authorize();
    const first = (await (await token({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri })).json()) as {
      refresh_token: string;
    };
    const refreshed = await token({ grant_type: 'refresh_token', refresh_token: first.refresh_token });
    expect(refreshed.status).toBe(200);
    const reused = await token({ grant_type: 'refresh_token', refresh_token: first.refresh_token });
    expect(reused.status).toBe(400);
  });

  it('grants only known scopes and binds tokens to this server when resource is omitted', async () => {
    const { code, verifier } = await authorize({ scope: 'admin', resource: undefined });
    const res = await token({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri });
    const tokens = (await res.json()) as { access_token: string; scope: string };
    expect(tokens.scope).toBe('mcp');
    const client = await connectClient(server, tokens.access_token);
    await client.close();
  });

  it('rejects tokens issued for another resource or without the mcp scope', async () => {
    const plant = (scopes: string, resource: string) => {
      const raw = randomBytes(32).toString('base64url');
      server.db
        .prepare(
          `INSERT INTO oauth_tokens (token_hash, kind, client_id, account_id, scopes, resource, expires_at)
           VALUES (?, 'access', ?, ?, ?, ?, ?)`,
        )
        .run(hashSecret(raw), clientId, server.accountId, scopes, resource, Math.floor(Date.now() / 1000) + 600);
      return raw;
    };
    const call = (raw: string) =>
      fetch(server.mcpUrl, {
        method: 'POST',
        headers: { authorization: `Bearer ${raw}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
    expect((await call(plant('mcp', 'https://other.example/mcp'))).status).toBe(401);
    expect((await call(plant('admin', server.mcpUrl.href))).status).toBe(403);
  });

  it('stops accepting an access token once it is revoked', async () => {
    const { code, verifier } = await authorize();
    const { access_token } = (await (await token({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri })).json()) as {
      access_token: string;
    };
    const revoked = await fetch(`${server.baseUrl}/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, token: access_token }),
    });
    expect(revoked.status).toBe(200);
    await expect(connectClient(server, access_token)).rejects.toThrow();
  });
});

describe('MCP SDK client OAuth (what MCP clients and mcp-remote run)', () => {
  it('discovers the server, registers, signs in and calls a tool', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const { UnauthorizedError } = await import('@modelcontextprotocol/sdk/client/auth.js');
    const fresh = await startTestServer();

    // Stands in for the browser: open the consent page, sign in, catch the redirect.
    let code = '';
    const state: Record<string, unknown> = {};
    const provider = {
      redirectUrl: redirectUri,
      clientMetadata: { client_name: 'SDK Client', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none' },
      clientInformation: () => state.client as never,
      saveClientInformation: (c: unknown) => void (state.client = c),
      tokens: () => state.tokens as never,
      saveTokens: (t: unknown) => void (state.tokens = t),
      saveCodeVerifier: (v: string) => void (state.verifier = v),
      codeVerifier: () => state.verifier as string,
      redirectToAuthorization: async (url: URL) => {
        const pendingId = pendingIdOf(await (await fetch(url)).text());
        const res = await submitConsent(fresh.baseUrl, pendingId, signInFields);
        code = new URL(res.headers.get('location')!).searchParams.get('code')!;
      },
    };

    const transport = new StreamableHTTPClientTransport(fresh.mcpUrl, { authProvider: provider });
    const client = new Client({ name: 'sdk-oauth', version: '1.0.0' });
    await expect(client.connect(transport)).rejects.toBeInstanceOf(UnauthorizedError);
    await transport.finishAuth(code);

    const retry = new Client({ name: 'sdk-oauth', version: '1.0.0' });
    await retry.connect(new StreamableHTTPClientTransport(fresh.mcpUrl, { authProvider: provider }));
    const r = await retry.callTool({ name: 'get_company', arguments: { companyId: 'cmp_1' } });
    expect(r.isError).toBeFalsy();
    await retry.close();
    await fresh.close();
  });
});

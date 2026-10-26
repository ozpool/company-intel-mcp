import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import { InvalidGrantError, InvalidTargetError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { transaction, type Db } from '../db/database.js';
import { AppError } from '../errors.js';
import { createAccount, findAccountByCredentials, type Account } from './accounts.js';
import { findAccountByApiKey, hashSecret } from './apiKeys.js';
import { renderConsentPage } from './consentPage.js';

export const SCOPES = ['mcp'];
const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_S = 30 * 24 * 60 * 60;
const CODE_TTL_S = 5 * 60;
const PENDING_TTL_S = 10 * 60;
// API keys never expire on their own (they are revoked instead); the SDK still wants a number.
const API_KEY_EXPIRES_AT = Number.MAX_SAFE_INTEGER;

const nowS = () => Math.floor(Date.now() / 1000);
const newSecret = () => randomBytes(32).toString('base64url');

type PendingParams = Omit<AuthorizationParams, 'resource'> & { resource?: string };
type TokenRow = { client_id: string; account_id: string; scopes: string; resource: string | null; expires_at: number; email: string };
export type ConsentAction = 'signin' | 'signup' | 'show-signin' | 'show-signup' | 'deny';

/**
 * OAuth 2.1 authorization server backed by SQLite. The SDK's handlers do request
 * parsing, client authentication and PKCE verification; this class stores state
 * and decides who gets a token.
 *
 * The person approving a client signs in to (or creates) an account with email and
 * password, so OAuth tokens act as that account. API keys belong to accounts too, so
 * a script with a key and an app signed in through OAuth see the same data.
 */
export class SqliteOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: OAuthRegisteredClientsStore;

  constructor(
    private readonly db: Db,
    private readonly resourceUrl: URL,
  ) {
    this.clientsStore = {
      getClient: (clientId) => {
        const row = db.prepare('SELECT metadata FROM oauth_clients WHERE client_id = ?').get(clientId) as
          | { metadata: string }
          | undefined;
        return row ? (JSON.parse(row.metadata) as OAuthClientInformationFull) : undefined;
      },
      registerClient: (client) => {
        const full = client as OAuthClientInformationFull;
        db.prepare('INSERT INTO oauth_clients (client_id, metadata, created_at) VALUES (?, ?, ?)').run(
          full.client_id,
          JSON.stringify(full),
          new Date().toISOString(),
        );
        return full;
      },
    };
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    if (params.resource && !sameResource(params.resource, this.resourceUrl)) {
      throw new InvalidTargetError(`This server only issues tokens for ${this.resourceUrl.href}`);
    }
    const pendingId = newSecret();
    // Tokens are always bound to this server, even when the client did not send `resource`.
    const stored: PendingParams = { ...params, scopes: grantableScopes(params.scopes), resource: (params.resource ?? this.resourceUrl).href };
    this.db.prepare('DELETE FROM oauth_pending WHERE expires_at < ?').run(nowS());
    this.db
      .prepare('INSERT INTO oauth_pending (id, client_id, params, expires_at) VALUES (?, ?, ?, ?)')
      .run(pendingId, client.client_id, JSON.stringify(stored), nowS() + PENDING_TTL_S);

    res
      .type('html')
      .set('Cache-Control', 'no-store')
      .set('Content-Security-Policy', consentPageCsp(params.redirectUri))
      .send(renderConsentPage({ pendingId, clientName: clientLabel(client), redirectHost: new URL(params.redirectUri).host }));
  }

  /**
   * Handles the consent form. Returns where to send the browser, or the page to show
   * again (with its status and CSP) when sign-in or sign-up failed.
   */
  completeConsent(input: {
    pendingId: string;
    action: ConsentAction;
    email: string;
    password: string;
  }): { redirect: string } | { html: string; csp: string; status: number } | null {
    const pending = this.db
      .prepare('SELECT client_id, params FROM oauth_pending WHERE id = ? AND expires_at >= ?')
      .get(input.pendingId, nowS()) as { client_id: string; params: string } | undefined;
    if (!pending) return null;
    const params = JSON.parse(pending.params) as PendingParams;
    const redirect = new URL(params.redirectUri);
    if (params.state !== undefined) redirect.searchParams.set('state', params.state);

    if (input.action === 'deny') {
      this.db.prepare('DELETE FROM oauth_pending WHERE id = ?').run(input.pendingId);
      redirect.searchParams.set('error', 'access_denied');
      redirect.searchParams.set('error_description', 'The user denied the request');
      return { redirect: redirect.href };
    }

    const showPage = (mode: 'signin' | 'signup', status: number, error?: string) => {
      const client = this.clientsStore.getClient(pending.client_id) as OAuthClientInformationFull;
      return {
        html: renderConsentPage({ pendingId: input.pendingId, clientName: clientLabel(client), redirectHost: redirect.host, email: input.email, error, mode }),
        csp: consentPageCsp(params.redirectUri),
        status,
      };
    };
    // "Create an account" / "Sign in" links only switch the form; nothing is checked yet.
    if (input.action === 'show-signup') return showPage('signup', 200);
    if (input.action === 'show-signin') return showPage('signin', 200);

    let account: Account | undefined;
    let failure = { status: 401, error: 'Email or password is incorrect.' };
    if (input.action === 'signup') {
      try {
        account = createAccount(this.db, input.email, input.password);
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        failure = { status: 400, error: err.message };
      }
    } else {
      account = findAccountByCredentials(this.db, input.email, input.password);
    }
    if (!account) return showPage(input.action, failure.status, failure.error);

    const code = newSecret();
    transaction(this.db, () => {
      this.db.prepare('DELETE FROM oauth_pending WHERE id = ?').run(input.pendingId);
      this.db
        .prepare(
          `INSERT INTO oauth_codes (code_hash, client_id, account_id, code_challenge, redirect_uri, scopes, resource, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          hashSecret(code),
          pending.client_id,
          account.id,
          params.codeChallenge,
          params.redirectUri,
          grantableScopes(params.scopes).join(' '),
          params.resource ?? this.resourceUrl.href,
          nowS() + CODE_TTL_S,
        );
    });
    redirect.searchParams.set('code', code);
    return { redirect: redirect.href };
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string): Promise<string> {
    return this.findCode(client, code).code_challenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const row = this.findCode(client, code);
    // Codes are single use: delete before issuing so a replay finds nothing.
    this.db.prepare('DELETE FROM oauth_codes WHERE code_hash = ?').run(hashSecret(code));
    if (redirectUri !== undefined && redirectUri !== row.redirect_uri) {
      throw new InvalidGrantError('redirect_uri does not match the one used to get this code');
    }
    if (resource && row.resource && !sameResource(resource, new URL(row.resource))) {
      throw new InvalidTargetError('resource does not match the authorization request');
    }
    return this.issueTokens(client.client_id, row.account_id, row.scopes, row.resource);
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string, scopes?: string[]): Promise<OAuthTokens> {
    const row = this.findToken(refreshToken, 'refresh');
    if (!row || row.client_id !== client.client_id) throw new InvalidGrantError('Refresh token is invalid or expired');
    const granted = row.scopes.split(' ');
    if (scopes?.some((s) => !granted.includes(s))) throw new InvalidGrantError('Cannot widen scopes on refresh');
    // Rotation: every refresh token works once (OAuth 2.1 requirement for public clients).
    this.revoke(refreshToken);
    return this.issueTokens(client.client_id, row.account_id, (scopes?.length ? scopes : granted).join(' '), row.resource);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const account = findAccountByApiKey(this.db, token);
    if (account) {
      return {
        token,
        clientId: `api_key:${account.id}`,
        scopes: SCOPES,
        expiresAt: API_KEY_EXPIRES_AT,
        resource: this.resourceUrl,
        extra: { accountId: account.id, accountEmail: account.email, method: 'api_key' },
      };
    }
    const row = this.findToken(token, 'access');
    if (!row) throw new InvalidTokenError('Token is invalid, expired or revoked');
    return {
      token,
      clientId: row.client_id,
      scopes: row.scopes.split(' '),
      expiresAt: row.expires_at,
      resource: row.resource ? new URL(row.resource) : undefined,
      extra: { accountId: row.account_id, accountEmail: row.email, method: 'oauth' },
    };
  }

  async revokeToken(client: OAuthClientInformationFull, request: { token: string }): Promise<void> {
    this.db
      .prepare('UPDATE oauth_tokens SET revoked_at = ? WHERE token_hash = ? AND client_id = ?')
      .run(new Date().toISOString(), hashSecret(request.token), client.client_id);
  }

  private findCode(client: OAuthClientInformationFull, code: string) {
    const row = this.db
      .prepare('SELECT * FROM oauth_codes WHERE code_hash = ? AND expires_at >= ?')
      .get(hashSecret(code), nowS()) as
      | { client_id: string; account_id: string; code_challenge: string; redirect_uri: string; scopes: string; resource: string | null }
      | undefined;
    if (!row || row.client_id !== client.client_id) throw new InvalidGrantError('Authorization code is invalid or expired');
    return row;
  }

  private findToken(token: string, kind: 'access' | 'refresh'): TokenRow | undefined {
    return this.db
      .prepare(
        `SELECT t.client_id, t.account_id, t.scopes, t.resource, t.expires_at, a.email
         FROM oauth_tokens t JOIN accounts a ON a.id = t.account_id
         WHERE t.token_hash = ? AND t.kind = ? AND t.revoked_at IS NULL AND t.expires_at >= ?`,
      )
      .get(hashSecret(token), kind, nowS()) as TokenRow | undefined;
  }

  private revoke(token: string) {
    this.db.prepare('UPDATE oauth_tokens SET revoked_at = ? WHERE token_hash = ?').run(new Date().toISOString(), hashSecret(token));
  }

  private issueTokens(clientId: string, accountId: string, scopes: string, resource: string | null): OAuthTokens {
    const access = newSecret();
    const refresh = newSecret();
    const insert = this.db.prepare(
      `INSERT INTO oauth_tokens (token_hash, kind, client_id, account_id, scopes, resource, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    transaction(this.db, () => {
      insert.run(hashSecret(access), 'access', clientId, accountId, scopes, resource, nowS() + ACCESS_TTL_S);
      insert.run(hashSecret(refresh), 'refresh', clientId, accountId, scopes, resource, nowS() + REFRESH_TTL_S);
    });
    return { access_token: access, token_type: 'bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: scopes };
  }
}

const clientLabel = (c: OAuthClientInformationFull) => c.client_name || c.client_id;

/** Keeps only scopes this server knows. Unknown ones are dropped (RFC 6749 §3.3 lets the server grant less than asked). */
const grantableScopes = (requested?: string[]) => {
  const known = (requested ?? []).filter((s) => SCOPES.includes(s));
  return known.length ? known : SCOPES;
};

/**
 * The consent form posts to this server, which then redirects to the client. Chrome applies
 * `form-action` to that redirect too, so the client's redirect origin must be allowed as well.
 * Custom schemes (e.g. `cursor://`) have an opaque origin, so they are allowed by scheme.
 */
export function consentPageCsp(redirectUri: string): string {
  const target = new URL(redirectUri);
  const redirectSource = target.origin === 'null' ? target.protocol : target.origin;
  return `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${redirectSource}; frame-ancestors 'none'`;
}

const sameResource = (a: URL, b: URL) => a.href.replace(/#.*$/, '').replace(/\/$/, '') === b.href.replace(/#.*$/, '').replace(/\/$/, '');

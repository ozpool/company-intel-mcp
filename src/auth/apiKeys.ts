import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Db } from '../db/database.js';
import type { Account } from './accounts.js';

export const API_KEY_PREFIX = 'aik_';

/** Secrets (API keys, OAuth codes and tokens) are only ever stored as hashes. */
export const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('hex');

/** Creates a key for an account. The key itself is returned once and never stored. */
export function createApiKey(db: Db, accountId: string, name: string): { id: string; key: string } {
  const id = `key_${randomUUID()}`;
  const key = `${API_KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
  db.prepare(
    'INSERT INTO api_keys (id, account_id, name, key_hash, key_prefix, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, accountId, name, hashSecret(key), key.slice(0, 10), new Date().toISOString());
  return { id, key };
}

export function findAccountByApiKey(db: Db, key: string): Account | undefined {
  if (!key.startsWith(API_KEY_PREFIX)) return undefined;
  const row = db
    .prepare(
      `SELECT k.id AS key_id, a.id, a.email FROM api_keys k JOIN accounts a ON a.id = k.account_id
       WHERE k.key_hash = ? AND k.revoked_at IS NULL`,
    )
    .get(hashSecret(key)) as (Account & { key_id: string }) | undefined;
  if (!row) return undefined;
  db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), row.key_id);
  return { id: row.id, email: row.email };
}

export function revokeApiKey(db: Db, keyId: string): void {
  db.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ?').run(new Date().toISOString(), keyId);
}

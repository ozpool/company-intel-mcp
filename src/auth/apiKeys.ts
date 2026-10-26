import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Db } from '../db/database.js';

export const API_KEY_PREFIX = 'aik_';

export type Account = { id: string; name: string };

/** Secrets (API keys, OAuth codes and tokens) are only ever stored as hashes. */
export const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('hex');

export function createApiKey(db: Db, name: string): { account: Account; key: string } {
  const key = `${API_KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
  const account = { id: `acc_${randomUUID()}`, name };
  db.prepare(
    'INSERT INTO api_keys (id, name, key_hash, key_prefix, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(account.id, name, hashSecret(key), key.slice(0, 10), new Date().toISOString());
  return { account, key };
}

export function findAccountByApiKey(db: Db, key: string): Account | undefined {
  if (!key.startsWith(API_KEY_PREFIX)) return undefined;
  const row = db
    .prepare('SELECT id, name FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL')
    .get(hashSecret(key)) as Account | undefined;
  if (row) db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
  return row;
}

export function revokeApiKey(db: Db, accountId: string): void {
  db.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ?').run(new Date().toISOString(), accountId);
}

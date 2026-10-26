import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../db/database.js';
import { AppError } from '../errors.js';

export type Account = { id: string; email: string };

const credentials = z.object({
  email: z.email('Enter a valid email address.').max(254),
  password: z.string().min(8, 'Use a password of at least 8 characters.').max(200),
});

/** scrypt with a random salt per password; stored as `scrypt$<salt>$<hash>`. */
function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64url')}$${scryptSync(password, salt, 32).toString('base64url')}`;
}

function passwordMatches(password: string, stored: string): boolean {
  const [, salt = '', hash = ''] = stored.split('$');
  const expected = Buffer.from(hash, 'base64url');
  return timingSafeEqual(scryptSync(password, Buffer.from(salt, 'base64url'), expected.length), expected);
}

// Checked when the email is unknown, so a wrong email takes as long as a wrong password.
const UNKNOWN_EMAIL_HASH = hashPassword(randomBytes(16).toString('hex'));

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function createAccount(db: Db, email: string, password: string): Account {
  const parsed = credentials.safeParse({ email: normalizeEmail(email), password });
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', parsed.error.issues[0]!.message);
  if (db.prepare('SELECT 1 FROM accounts WHERE email = ?').get(parsed.data.email)) {
    throw new AppError('VALIDATION_ERROR', 'An account with this email already exists. Sign in instead.');
  }
  const account = { id: `acc_${randomUUID()}`, email: parsed.data.email };
  db.prepare('INSERT INTO accounts (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    account.id,
    account.email,
    hashPassword(password),
    new Date().toISOString(),
  );
  return account;
}

export function findAccountByCredentials(db: Db, email: string, password: string): Account | undefined {
  const row = db.prepare('SELECT id, email, password_hash FROM accounts WHERE email = ?').get(normalizeEmail(email)) as
    | (Account & { password_hash: string })
    | undefined;
  const matches = passwordMatches(password, row?.password_hash ?? UNKNOWN_EMAIL_HASH);
  return row && matches ? { id: row.id, email: row.email } : undefined;
}

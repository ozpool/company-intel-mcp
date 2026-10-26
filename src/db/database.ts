import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS companies (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  domain       TEXT NOT NULL UNIQUE,
  website      TEXT NOT NULL,
  industry     TEXT NOT NULL,
  country      TEXT NOT NULL,
  city         TEXT NOT NULL,
  employees    INTEGER NOT NULL CHECK (employees > 0),
  founded_year INTEGER NOT NULL,
  description  TEXT NOT NULL,
  tags         TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_companies_country ON companies(country COLLATE NOCASE);

-- Full-text index over the fields a free-text query like "AI companies" should match.
CREATE VIRTUAL TABLE IF NOT EXISTS companies_fts USING fts5(
  name, industry, description, tags,
  content='companies', content_rowid='rowid', tokenize='porter unicode61'
);
CREATE TRIGGER IF NOT EXISTS companies_ai AFTER INSERT ON companies BEGIN
  INSERT INTO companies_fts(rowid, name, industry, description, tags)
  VALUES (new.rowid, new.name, new.industry, new.description, new.tags);
END;
CREATE TRIGGER IF NOT EXISTS companies_ad AFTER DELETE ON companies BEGIN
  INSERT INTO companies_fts(companies_fts, rowid, name, industry, description, tags)
  VALUES ('delete', old.rowid, old.name, old.industry, old.description, old.tags);
END;
CREATE TRIGGER IF NOT EXISTS companies_au AFTER UPDATE ON companies BEGIN
  INSERT INTO companies_fts(companies_fts, rowid, name, industry, description, tags)
  VALUES ('delete', old.rowid, old.name, old.industry, old.description, old.tags);
  INSERT INTO companies_fts(rowid, name, industry, description, tags)
  VALUES (new.rowid, new.name, new.industry, new.description, new.tags);
END;

CREATE TABLE IF NOT EXISTS contacts (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  title       TEXT NOT NULL,
  department  TEXT NOT NULL,
  seniority   TEXT NOT NULL,
  location    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);

CREATE TABLE IF NOT EXISTS enrichments (
  contact_id  TEXT PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  linkedin    TEXT NOT NULL,
  source      TEXT NOT NULL,
  enriched_at TEXT NOT NULL
);

-- enrichments is a shared cache (one paid provider lookup per contact); this table records which
-- accounts have enriched which contacts, so an export only shows data the account asked for.
CREATE TABLE IF NOT EXISTS enrichment_unlocks (
  account_id  TEXT NOT NULL,
  contact_id  TEXT NOT NULL REFERENCES enrichments(contact_id) ON DELETE CASCADE,
  unlocked_at TEXT NOT NULL,
  PRIMARY KEY (account_id, contact_id)
);

CREATE TABLE IF NOT EXISTS exports (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL,
  row_count   INTEGER NOT NULL,
  csv         TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);

-- People who sign in on the OAuth consent page. Passwords are stored as salted scrypt hashes.
CREATE TABLE IF NOT EXISTS accounts (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id  TEXT PRIMARY KEY,
  metadata   TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- An authorization request waiting for the user to approve it on the consent page.
CREATE TABLE IF NOT EXISTS oauth_pending (
  id         TEXT PRIMARY KEY,
  client_id  TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  params     TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash      TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  code_challenge TEXT NOT NULL,
  redirect_uri   TEXT NOT NULL,
  scopes         TEXT NOT NULL,
  resource       TEXT,
  expires_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  token_hash TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
  client_id  TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  scopes     TEXT NOT NULL,
  resource   TEXT,
  expires_at INTEGER NOT NULL,
  revoked_at TEXT
);
`;

export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

/** Runs fn inside a transaction, rolling back if it throws. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

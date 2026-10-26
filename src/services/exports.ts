import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db/database.js';
import { getContactsByIds } from './contacts.js';
import { getEnrichments } from './enrichment.js';

export type ExportResult = {
  exportId: string;
  downloadUrl: string;
  expiresAt: string;
  rowCount: number;
  enrichedCount: number;
};

export type ExportSettings = { baseUrl: URL; secret: string; ttlMinutes: number };

const COLUMNS = [
  'contact_id', 'first_name', 'last_name', 'title', 'department', 'seniority', 'location',
  'company_id', 'company_name', 'company_website', 'email', 'linkedin',
] as const;

/**
 * Quotes a CSV cell. Cells that start with a formula character get a leading
 * apostrophe so a spreadsheet shows them as text instead of running them.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const sign = (secret: string, exportId: string, exp: number) =>
  createHmac('sha256', secret).update(`${exportId}.${exp}`).digest('base64url');

export function createExport(
  db: Db,
  settings: ExportSettings,
  input: { accountId: string; contactIds: string[] },
): ExportResult {
  const contacts = getContactsByIds(db, input.contactIds);
  const enrichments = getEnrichments(db, input.accountId, input.contactIds);

  const lines = [COLUMNS.join(',')];
  for (const c of contacts) {
    const e = enrichments.get(c.id);
    const row = [
      c.id, c.firstName, c.lastName, c.title, c.department, c.seniority, c.location,
      c.companyId, c.companyName, c.companyWebsite, e?.email ?? '', e?.linkedin ?? '',
    ];
    lines.push(row.map(csvCell).join(','));
  }

  const now = Date.now();
  const exp = Math.floor(now / 1000) + settings.ttlMinutes * 60;
  const exportId = `exp_${randomBytes(12).toString('base64url')}`;

  db.prepare('DELETE FROM exports WHERE expires_at < ?').run(Math.floor(now / 1000));
  db.prepare(
    `INSERT INTO exports (id, account_id, row_count, csv, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(exportId, input.accountId, contacts.length, `${lines.join('\r\n')}\r\n`, new Date(now).toISOString(), exp);

  const url = new URL(`/exports/${exportId}.csv`, settings.baseUrl);
  url.searchParams.set('exp', String(exp));
  url.searchParams.set('sig', sign(settings.secret, exportId, exp));

  return {
    exportId,
    downloadUrl: url.href,
    expiresAt: new Date(exp * 1000).toISOString(),
    rowCount: contacts.length,
    enrichedCount: enrichments.size,
  };
}

export type DownloadOutcome = { ok: true; csv: string } | { ok: false; status: 403 | 404 | 410; reason: string };

/** Checks a signed download link and returns the file. The link itself is the credential. */
export function readExport(db: Db, secret: string, exportId: string, exp: string, sig: string): DownloadOutcome {
  const expNum = Number(exp);
  if (!Number.isInteger(expNum) || !sig) return { ok: false, status: 403, reason: 'Missing or malformed signature' };

  const expected = Buffer.from(sign(secret, exportId, expNum));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, status: 403, reason: 'Invalid signature' };
  }
  if (expNum < Date.now() / 1000) return { ok: false, status: 410, reason: 'This download link has expired' };

  const row = db.prepare('SELECT csv FROM exports WHERE id = ?').get(exportId) as { csv: string } | undefined;
  if (!row) return { ok: false, status: 404, reason: 'Export not found' };
  return { ok: true, csv: row.csv };
}

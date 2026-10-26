import { createHash } from 'node:crypto';
import type { Db } from '../db/database.js';
import { getContact, type ContactRecord } from './contacts.js';

export type EnrichmentResult = {
  contactId: string;
  email: string;
  linkedin: string;
  source: string;
  enrichedAt: string;
  cached: boolean;
};

/** Looks a contact up in an external data source. Swap this for a real vendor (Apollo, Clearbit, ...). */
export type EnrichmentProvider = {
  name: string;
  lookup(contact: ContactRecord): Promise<{ email: string; linkedin: string }>;
};

const slug = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

/** Deterministic stand-in for a paid enrichment API: same contact, same answer. */
export const simulatedProvider: EnrichmentProvider = {
  name: 'simulated',
  async lookup(c) {
    const suffix = createHash('sha256').update(c.id).digest('hex').slice(0, 6);
    return {
      email: `${slug(c.firstName)}.${slug(c.lastName)}@${c.companyDomain}`,
      linkedin: `https://www.linkedin.com/in/${slug(c.firstName)}-${slug(c.lastName)}-${suffix}`,
    };
  },
};

type EnrichmentRow = { contact_id: string; email: string; linkedin: string; source: string; enriched_at: string };

/**
 * Returns enrichment data for a contact and records that this account has it.
 * Provider results are stored and shared, so repeat calls, from any account, are
 * free and stable instead of hitting the provider (and its bill) again.
 */
export async function enrichContact(
  db: Db,
  provider: EnrichmentProvider,
  input: { accountId: string; contactId: string },
): Promise<EnrichmentResult> {
  const { accountId, contactId } = input;
  const contact = getContact(db, contactId);
  const unlock = () =>
    db
      .prepare('INSERT OR IGNORE INTO enrichment_unlocks (account_id, contact_id, unlocked_at) VALUES (?, ?, ?)')
      .run(accountId, contactId, new Date().toISOString());

  const existing = db.prepare('SELECT * FROM enrichments WHERE contact_id = ?').get(contactId) as
    | EnrichmentRow
    | undefined;
  if (existing) {
    unlock();
    return toResult(existing, true);
  }

  const found = await provider.lookup(contact);
  const row: EnrichmentRow = {
    contact_id: contact.id,
    email: found.email,
    linkedin: found.linkedin,
    source: provider.name,
    enriched_at: new Date().toISOString(),
  };
  // OR IGNORE: if a concurrent call stored a result first, keep that one.
  db.prepare(
    `INSERT OR IGNORE INTO enrichments (contact_id, email, linkedin, source, enriched_at)
     VALUES (:contact_id, :email, :linkedin, :source, :enriched_at)`,
  ).run(row);
  unlock();
  const stored = db.prepare('SELECT * FROM enrichments WHERE contact_id = ?').get(contactId) as EnrichmentRow;
  return toResult(stored, false);
}

/** Enrichment data for the given contacts, limited to the ones this account has enriched. */
export function getEnrichments(db: Db, accountId: string, contactIds: string[]): Map<string, EnrichmentRow> {
  const rows = db
    .prepare(
      `SELECT e.* FROM enrichments e
       JOIN enrichment_unlocks u ON u.contact_id = e.contact_id AND u.account_id = ?
       WHERE e.contact_id IN (SELECT value FROM json_each(?))`,
    )
    .all(accountId, JSON.stringify(contactIds)) as EnrichmentRow[];
  return new Map(rows.map((r) => [r.contact_id, r]));
}

const toResult = (r: EnrichmentRow, cached: boolean): EnrichmentResult => ({
  contactId: r.contact_id,
  email: r.email,
  linkedin: r.linkedin,
  source: r.source,
  enrichedAt: r.enriched_at,
  cached,
});

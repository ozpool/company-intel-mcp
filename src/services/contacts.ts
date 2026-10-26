import type { Db } from '../db/database.js';
import { AppError, notFound } from '../errors.js';
import { companyExists } from './companies.js';

export type ContactSummary = {
  id: string;
  name: string;
  title: string;
  department: string;
  seniority: string;
  companyId: string;
  companyName: string;
};

export type ContactRecord = ContactSummary & {
  firstName: string;
  lastName: string;
  location: string;
  companyDomain: string;
  companyWebsite: string;
};

type ContactRow = {
  id: string;
  first_name: string;
  last_name: string;
  title: string;
  department: string;
  seniority: string;
  location: string;
  company_id: string;
  company_name: string;
  company_domain: string;
  company_website: string;
};

const SELECT = `
  SELECT ct.*, c.name AS company_name, c.domain AS company_domain, c.website AS company_website
  FROM contacts ct JOIN companies c ON c.id = ct.company_id`;

const toRecord = (r: ContactRow): ContactRecord => ({
  id: r.id,
  name: `${r.first_name} ${r.last_name}`,
  firstName: r.first_name,
  lastName: r.last_name,
  title: r.title,
  department: r.department,
  seniority: r.seniority,
  location: r.location,
  companyId: r.company_id,
  companyName: r.company_name,
  companyDomain: r.company_domain,
  companyWebsite: r.company_website,
});

const toSummary = ({ id, name, title, department, seniority, companyId, companyName }: ContactRecord): ContactSummary => ({
  id,
  name,
  title,
  department,
  seniority,
  companyId,
  companyName,
});

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export function searchContacts(
  db: Db,
  input: { companyId?: string; jobTitle?: string; limit: number },
): { contacts: ContactSummary[]; total: number } {
  if (input.companyId && !companyExists(db, input.companyId)) throw notFound('Company', input.companyId);

  const where = `WHERE (:companyId IS NULL OR ct.company_id = :companyId)
    AND (:title IS NULL OR ct.title LIKE :title ESCAPE '\\')`;
  const params = {
    companyId: input.companyId ?? null,
    title: input.jobTitle?.trim() ? `%${escapeLike(input.jobTitle.trim())}%` : null,
  };

  const rows = db
    .prepare(`${SELECT} ${where} ORDER BY c.name, ct.last_name, ct.first_name LIMIT :limit`)
    .all({ ...params, limit: input.limit }) as ContactRow[];
  const { total } = db
    .prepare(`SELECT COUNT(*) AS total FROM contacts ct ${where}`)
    .get(params) as { total: number };

  return { contacts: rows.map((r) => toSummary(toRecord(r))), total };
}

export function getContact(db: Db, contactId: string): ContactRecord {
  const row = db.prepare(`${SELECT} WHERE ct.id = ?`).get(contactId) as ContactRow | undefined;
  if (!row) throw notFound('Contact', contactId);
  return toRecord(row);
}

/** Returns contacts in the order requested, or throws listing every id that does not exist. */
export function getContactsByIds(db: Db, ids: string[]): ContactRecord[] {
  const rows = db
    .prepare(`${SELECT} WHERE ct.id IN (SELECT value FROM json_each(?))`)
    .all(JSON.stringify(ids)) as ContactRow[];
  const byId = new Map(rows.map((r) => [r.id, toRecord(r)]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new AppError('NOT_FOUND', `${missing.length} contact(s) do not exist: ${missing.join(', ')}`, { missing });
  }
  return ids.map((id) => byId.get(id)!);
}

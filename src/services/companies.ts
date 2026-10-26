import type { Db } from '../db/database.js';
import { AppError, notFound } from '../errors.js';

export type CompanySummary = {
  id: string;
  name: string;
  industry: string;
  employees: number;
  country: string;
};

export type Company = CompanySummary & {
  website: string;
  domain: string;
  city: string;
  foundedYear: number;
  description: string;
  tags: string[];
};

type CompanyRow = {
  id: string;
  name: string;
  domain: string;
  website: string;
  industry: string;
  country: string;
  city: string;
  employees: number;
  founded_year: number;
  description: string;
  tags: string;
};

// Words that describe the kind of thing being searched for rather than what it does.
// "AI companies" should match on "AI", not require the word "companies".
const STOPWORDS = new Set([
  'a', 'an', 'and', 'any', 'all', 'business', 'businesses', 'companies', 'company', 'corp', 'firm', 'firms',
  'for', 'in', 'of', 'on', 'or', 'organisation', 'organisations', 'organization', 'organizations',
  'show', 'me', 'find', 'list', 'that', 'the', 'with', 'based', 'startup', 'startups',
]);

// Abbreviations people type that the data spells out.
const SYNONYMS: Record<string, string[]> = {
  ai: ['artificial intelligence', 'machine learning'],
  ml: ['machine learning'],
  llm: ['llm', 'language model'],
  saas: ['software'],
};

/**
 * Turns free text into an FTS5 expression. Terms are OR'd so partial matches still
 * rank, and bm25 puts the best matches first. Short terms ("ai") match exactly;
 * longer ones match as prefixes so "fintech" finds "fintechs".
 * Returns null when nothing searchable is left.
 */
export function toFtsQuery(query: string): string | null {
  const terms = (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => !STOPWORDS.has(t));
  if (terms.length === 0) return null;
  const expanded = terms.flatMap((t) => [t.length >= 4 ? `"${t}"*` : `"${t}"`, ...(SYNONYMS[t] ?? []).map((p) => `"${p}"`)]);
  return [...new Set(expanded)].join(' OR ');
}

// Short forms people (and models) type for the countries in the data.
const COUNTRY_ALIASES: Record<string, string> = {
  au: 'Australia', aus: 'Australia',
  us: 'United States', usa: 'United States', america: 'United States', 'united states of america': 'United States',
  uk: 'United Kingdom', gb: 'United Kingdom', 'great britain': 'United Kingdom', britain: 'United Kingdom', england: 'United Kingdom',
  in: 'India', sg: 'Singapore', de: 'Germany', ca: 'Canada', nz: 'New Zealand',
};

/**
 * Maps user input to a country stored in the data: exact name (any case) or a common alias.
 * An unknown country is a VALIDATION_ERROR listing the valid ones, not a silent empty result,
 * so the client can correct itself.
 */
export function resolveCountry(input: string, known: string[]): string {
  const key = input.trim().toLowerCase().replace(/\./g, '');
  const match = known.find((c) => c.toLowerCase() === key) ?? known.find((c) => c === COUNTRY_ALIASES[key]);
  if (match) return match;
  throw new AppError('VALIDATION_ERROR', `Unknown country '${input}'. Use one of: ${known.join(', ')}`, { knownCountries: known });
}

const summary = (r: CompanyRow): CompanySummary => ({
  id: r.id,
  name: r.name,
  industry: r.industry,
  employees: r.employees,
  country: r.country,
});

export function searchCompanies(
  db: Db,
  input: { query?: string; country?: string; limit: number },
): { results: CompanySummary[]; total: number } {
  const fts = input.query ? toFtsQuery(input.query) : null;
  const country = input.country?.trim() ? resolveCountry(input.country, listCountries(db)) : null;

  const from = fts
    ? `FROM companies_fts JOIN companies c ON c.rowid = companies_fts.rowid
       WHERE companies_fts MATCH :fts AND (:country IS NULL OR c.country = :country)`
    : `FROM companies c WHERE (:country IS NULL OR c.country = :country)`;
  // Name and industry matches count more than a passing mention in the description.
  const order = fts ? 'bm25(companies_fts, 10.0, 6.0, 1.0, 6.0), c.employees DESC' : 'c.employees DESC, c.name';
  const params: Record<string, string | null> = fts ? { fts, country } : { country };

  const rows = db
    .prepare(`SELECT c.* ${from} ORDER BY ${order} LIMIT :limit`)
    .all({ ...params, limit: input.limit }) as CompanyRow[];
  const { total } = db.prepare(`SELECT COUNT(*) AS total ${from}`).get(params) as { total: number };

  return { results: rows.map(summary), total };
}

export function getCompany(db: Db, companyId: string): Company {
  const row = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId) as CompanyRow | undefined;
  if (!row) throw notFound('Company', companyId);
  return {
    ...summary(row),
    website: row.website,
    domain: row.domain,
    city: row.city,
    foundedYear: row.founded_year,
    description: row.description,
    tags: row.tags ? row.tags.split(',') : [],
  };
}

export function companyExists(db: Db, companyId: string): boolean {
  return db.prepare('SELECT 1 FROM companies WHERE id = ?').get(companyId) !== undefined;
}

export function listCountries(db: Db): string[] {
  return (db.prepare('SELECT DISTINCT country FROM companies ORDER BY country').all() as { country: string }[]).map(
    (r) => r.country,
  );
}

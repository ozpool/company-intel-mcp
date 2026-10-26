import { describe, expect, it } from 'vitest';
import { generateSeedData } from '../scripts/seed-data.js';
import { consentPageCsp } from '../src/auth/oauthProvider.js';
import { rateLimit } from '../src/http/rateLimit.js';
import { resolveCountry, toFtsQuery } from '../src/services/companies.js';
import { csvCell } from '../src/services/exports.js';

describe('toFtsQuery', () => {
  it('drops filler words and expands abbreviations', () => {
    expect(toFtsQuery('AI companies')).toBe('"ai" OR "artificial intelligence" OR "machine learning"');
  });
  it('prefix-matches longer words only', () => {
    expect(toFtsQuery('fintech api')).toBe('"fintech"* OR "api"');
  });
  it('strips FTS syntax so user text cannot inject operators', () => {
    expect(toFtsQuery('security" OR name:*')).toBe('"security"* OR "name"*');
  });
  it('returns null when nothing searchable is left', () => {
    expect(toFtsQuery('companies in the')).toBeNull();
  });
});

describe('resolveCountry', () => {
  const known = ['Australia', 'United Kingdom', 'United States'];
  it('matches names in any case and common short forms', () => {
    expect(resolveCountry('australia', known)).toBe('Australia');
    expect(resolveCountry('U.K.', known)).toBe('United Kingdom');
    expect(resolveCountry('USA', known)).toBe('United States');
  });
  it('throws VALIDATION_ERROR for an unknown country', () => {
    expect(() => resolveCountry('Narnia', known)).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });
});

describe('csvCell', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('Sydney, Australia')).toBe('"Sydney, Australia"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });
  it('neutralises spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+61')).toBe("'+61");
  });
});

describe('generateSeedData', () => {
  it('returns the same data on every call in one process', () => {
    expect(generateSeedData()).toEqual(generateSeedData());
  });
});

describe('consentPageCsp', () => {
  it('allows the redirect origin, including its port', () => {
    expect(consentPageCsp('http://localhost:51234/oauth/callback')).toContain("form-action 'self' http://localhost:51234;");
  });
  it('allows custom-scheme redirects by scheme', () => {
    expect(consentPageCsp('cursor://anysphere.cursor-retrieval/oauth/callback')).toContain("form-action 'self' cursor:;");
  });
});

describe('rateLimit', () => {
  it('allows a burst, rejects the next request, then refills', () => {
    let now = 0;
    const limiter = rateLimit(2, () => now);
    const call = () => {
      let status = 200;
      const res = { set: () => res, status: (s: number) => ((status = s), res), json: () => res };
      limiter({ auth: { extra: { accountId: 'a' } } } as never, res as never, () => {});
      return status;
    };
    expect([call(), call(), call()]).toEqual([200, 200, 429]);
    now += 30_000; // half a minute refills one of two tokens
    expect(call()).toBe(200);
  });
});

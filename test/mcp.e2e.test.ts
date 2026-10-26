import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { connectClient, signIn, startTestServer, toolError, type TestServer } from './helpers.js';

let server: TestServer;
let client: Client;

beforeAll(async () => {
  server = await startTestServer();
  client = await connectClient(server);
});
afterAll(async () => {
  await client.close();
  await server.close();
});

type Structured<T> = { structuredContent?: unknown } & T;
const data = <T>(r: Structured<object>) => r.structuredContent as T;

describe('authentication', () => {
  it('rejects requests without a token and points to the OAuth metadata', async () => {
    const res = await fetch(server.mcpUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain(
      `resource_metadata="${server.baseUrl}/.well-known/oauth-protected-resource/mcp"`,
    );
  });

  it('rejects an unknown token', async () => {
    await expect(connectClient(server, 'not-a-real-token')).rejects.toThrow();
  });
});

describe('tool discovery', () => {
  it('lists the five tools with input and output schemas', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'enrich_contact', 'export_contacts', 'get_company', 'search_companies', 'search_contacts',
    ]);
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.outputSchema).toBeDefined();
    }
    expect(tools.find((t) => t.name === 'search_companies')?.annotations?.readOnlyHint).toBe(true);
  });
});

describe('search_companies', () => {
  it('finds AI companies in Australia, best match first', async () => {
    const r = await client.callTool({ name: 'search_companies', arguments: { query: 'AI companies', country: 'Australia', limit: 10 } });
    const { results, total } = data<{ results: { country: string; industry: string }[]; total: number }>(r);
    expect(total).toBeGreaterThan(0);
    expect(results.every((c) => c.country === 'Australia')).toBe(true);
    expect(results[0]!.industry).toBe('Artificial Intelligence');
    expect(results.filter((c) => c.industry === 'Artificial Intelligence').length).toBeGreaterThanOrEqual(3);
  });

  it('accepts common country short forms', async () => {
    const r = await client.callTool({ name: 'search_companies', arguments: { country: 'AU', limit: 50 } });
    const { results } = data<{ results: { country: string }[] }>(r);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((c) => c.country === 'Australia')).toBe(true);
  });

  it('rejects an unknown country and lists the valid ones', async () => {
    const r = await client.callTool({ name: 'search_companies', arguments: { country: 'Narnia' } });
    expect(r.isError).toBe(true);
    const err = toolError(r);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.details?.knownCountries).toContain('Australia');
  });

  it('respects limit and reports the full total', async () => {
    const r = await client.callTool({ name: 'search_companies', arguments: { limit: 5 } });
    const { results, total } = data<{ results: unknown[]; total: number }>(r);
    expect(results).toHaveLength(5);
    expect(total).toBe(60);
  });

  it('rejects an out-of-range limit', async () => {
    const r = await client.callTool({ name: 'search_companies', arguments: { limit: 500 } });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.content)).toContain('Input validation error');
  });
});

describe('get_company', () => {
  it('returns the full profile', async () => {
    const r = await client.callTool({ name: 'get_company', arguments: { companyId: 'cmp_1' } });
    expect(data<{ id: string; website: string }>(r)).toMatchObject({ id: 'cmp_1', website: expect.stringMatching(/^https:\/\//) });
  });

  it('returns NOT_FOUND for an unknown id', async () => {
    const r = await client.callTool({ name: 'get_company', arguments: { companyId: 'cmp_9999' } });
    expect(r.isError).toBe(true);
    expect(toolError(r).code).toBe('NOT_FOUND');
  });
});

describe('search_contacts', () => {
  it('filters by company and job title', async () => {
    const r = await client.callTool({ name: 'search_contacts', arguments: { companyId: 'cmp_1', jobTitle: 'chief' } });
    const { contacts } = data<{ contacts: { title: string; companyId: string }[] }>(r);
    expect(contacts.length).toBeGreaterThan(0);
    expect(contacts.every((c) => c.companyId === 'cmp_1' && /chief/i.test(c.title))).toBe(true);
  });

  it('treats % and _ in a title literally', async () => {
    const r = await client.callTool({ name: 'search_contacts', arguments: { jobTitle: '%' } });
    expect(data<{ total: number }>(r).total).toBe(0);
  });

  it('returns NOT_FOUND for an unknown company', async () => {
    const r = await client.callTool({ name: 'search_contacts', arguments: { companyId: 'cmp_9999' } });
    expect(toolError(r).code).toBe('NOT_FOUND');
  });
});

describe('enrich_contact', () => {
  it('returns email and LinkedIn, and the same data again from cache', async () => {
    const first = data<{ email: string; linkedin: string; cached: boolean }>(
      await client.callTool({ name: 'enrich_contact', arguments: { contactId: 'cnt_1' } }),
    );
    expect(first.email).toMatch(/^[a-z]+\.[a-z]+@.+\.example$/);
    expect(first.linkedin).toMatch(/^https:\/\/www\.linkedin\.com\/in\//);
    expect(first.cached).toBe(false);

    const second = data<typeof first>(await client.callTool({ name: 'enrich_contact', arguments: { contactId: 'cnt_1' } }));
    expect(second).toEqual({ ...first, cached: true });
  });
});

describe('export_contacts', () => {
  it('returns a signed link that downloads a CSV', async () => {
    const r = await client.callTool({ name: 'export_contacts', arguments: { contactIds: ['cnt_1', 'cnt_2', 'cnt_2'] } });
    const out = data<{ downloadUrl: string; rowCount: number; enrichedCount: number }>(r);
    expect(out.rowCount).toBe(2);

    const res = await fetch(out.downloadUrl);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const lines = (await res.text()).trim().split('\r\n');
    expect(lines[0]).toMatch(/^contact_id,first_name/);
    expect(lines).toHaveLength(3);
  });

  it("includes only the contacts this account enriched", async () => {
    // cnt_1 was enriched by the main account above; a second account has not enriched anything.
    const mine = data<{ enrichedCount: number }>(await client.callTool({ name: 'export_contacts', arguments: { contactIds: ['cnt_1'] } }));
    expect(mine.enrichedCount).toBe(1);

    const other = await connectClient(server, await signIn(server.baseUrl, 'other@example.com', 'another password', 'signup'));
    const theirs = data<{ enrichedCount: number }>(await other.callTool({ name: 'export_contacts', arguments: { contactIds: ['cnt_1'] } }));
    expect(theirs.enrichedCount).toBe(0);
    await other.close();
  });

  it('refuses a tampered link', async () => {
    const r = await client.callTool({ name: 'export_contacts', arguments: { contactIds: ['cnt_1'] } });
    const url = new URL(data<{ downloadUrl: string }>(r).downloadUrl);
    url.searchParams.set('exp', String(Number(url.searchParams.get('exp')) + 3600));
    expect((await fetch(url)).status).toBe(403);
  });

  it('exports nothing when any id is missing, and names it', async () => {
    const r = await client.callTool({ name: 'export_contacts', arguments: { contactIds: ['cnt_1', 'cnt_99999'] } });
    expect(toolError(r)).toMatchObject({ code: 'NOT_FOUND', details: { missing: ['cnt_99999'] } });
  });
});

describe('expired export links', () => {
  it('return 410 once the TTL has passed', async () => {
    const short = await startTestServer({ EXPORT_TTL_MINUTES: '1' });
    const c = await connectClient(short);
    const r = await c.callTool({ name: 'export_contacts', arguments: { contactIds: ['cnt_1'] } });
    const url = data<{ downloadUrl: string }>(r).downloadUrl;
    const realNow = Date.now;
    Date.now = () => realNow() + 2 * 60_000;
    try {
      expect((await fetch(url)).status).toBe(410);
    } finally {
      Date.now = realNow;
      await c.close();
      await short.close();
    }
  });
});

describe('rate limiting', () => {
  it('answers 429 with Retry-After once the budget is spent', async () => {
    const limited = await startTestServer({ RATE_LIMIT_PER_MINUTE: '3' });
    const post = () =>
      fetch(limited.mcpUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${limited.accessToken}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await post()).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
    expect((await post()).headers.get('retry-after')).toMatch(/^\d+$/);
    await limited.close();
  });

  it('limits export downloads per client IP', async () => {
    // Signing in already spent one request of this IP's budget, which the consent form shares with downloads.
    const limited = await startTestServer({ RATE_LIMIT_PER_MINUTE: '3' });
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await fetch(`${limited.baseUrl}/exports/exp_x.csv`)).status);
    expect(statuses).toEqual([403, 403, 429]);
    await limited.close();
  });
});

describe('Host header check', () => {
  it('refuses requests addressed to a host other than this server (DNS rebinding)', async () => {
    // fetch() will not send a custom Host header, so use node:http directly.
    const status = await new Promise<number>((resolve, reject) => {
      const { port } = new URL(server.baseUrl);
      request({ host: '127.0.0.1', port, path: '/healthz', headers: { host: `attacker.example:${port}` } }, (res) => {
        res.resume();
        resolve(res.statusCode!);
      })
        .on('error', reject)
        .end();
    });
    expect(status).toBe(403);
    expect((await fetch(`${server.baseUrl}/healthz`)).status).toBe(200);
  });
});

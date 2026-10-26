/**
 * A scripted MCP client that walks through every feature, for the demo video
 * and as a quick end-to-end check against a running server.
 *
 *   MCP_API_KEY=aik_... npm run demo
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const MCP_URL = new URL(process.env.MCP_URL ?? 'http://localhost:3000/mcp');
const API_KEY = process.env.MCP_API_KEY;
if (!API_KEY) {
  console.error('Set MCP_API_KEY to a key from `npm run create-key -- <email>`.');
  process.exit(1);
}

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
let step = 0;
const heading = (title: string) => console.log(`\n${bold(`${++step}. ${title}`)}`);

type ToolResult = { isError?: boolean; structuredContent?: unknown; content?: unknown };
const text = (r: ToolResult) => (r.content as { text: string }[])[0]?.text ?? '';

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  console.log(dim(`→ ${name} ${JSON.stringify(args)}`));
  const r = (await client.callTool({ name, arguments: args })) as ToolResult;
  console.log(r.isError ? red(`✗ ${text(r)}`) : green('✓ ok'));
  return r;
}

// Fail fast with a clear message instead of hanging when something else holds the port.
const health = new URL('/healthz', MCP_URL);
const healthy = await fetch(health, { signal: AbortSignal.timeout(5000) })
  .then(async (r) => r.ok && ((await r.json()) as { status?: string }).status === 'ok')
  .catch(() => false);
if (!healthy) {
  console.error(
    red(`No Company Intelligence server answered at ${health.href} within 5s.\n`) +
      'Is `npm run dev` running? If it is, another program may hold the port: check with\n' +
      `  lsof -nP -iTCP:${MCP_URL.port || 80} -sTCP:LISTEN\n` +
      'and either stop that program or set PORT in .env and MCP_URL here to a free port.',
  );
  process.exit(1);
}

heading('Connect without credentials');
const res = await fetch(MCP_URL, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
});
console.log(red(`✗ HTTP ${res.status}`), dim(res.headers.get('www-authenticate') ?? ''));

heading('Connect with an API key');
const client = new Client({ name: 'demo-client', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(MCP_URL, { requestInit: { headers: { Authorization: `Bearer ${API_KEY}` } } }));
const info = client.getServerVersion();
console.log(green(`✓ connected to ${info?.name} v${info?.version}`));

heading('Discover tools');
const { tools } = await client.listTools();
for (const t of tools) console.log(`  ${bold(t.name.padEnd(17))} ${t.description?.split('. ')[0]}`);

heading('Search: AI companies in Australia');
const search = await call(client, 'search_companies', { query: 'AI companies', country: 'Australia', limit: 5 });
const { results } = search.structuredContent as { results: { id: string; name: string; industry: string; employees: number }[] };
console.table(results);

const company = results[0];
if (!company) throw new Error('No companies found. Did you run `npm run seed`?');
heading(`Company details: ${company.name}`);
const details = await call(client, 'get_company', { companyId: company.id });
console.log(details.structuredContent);

heading(`Contacts at ${company.name}`);
const contacts = await call(client, 'search_contacts', { companyId: company.id });
const people = (contacts.structuredContent as { contacts: { id: string; name: string; title: string }[] }).contacts;
console.table(people.map(({ id, name, title }) => ({ id, name, title })));

heading(`Enrich ${people[0]!.name} (twice: the second call is served from cache)`);
console.log((await call(client, 'enrich_contact', { contactId: people[0]!.id })).structuredContent);
console.log((await call(client, 'enrich_contact', { contactId: people[0]!.id })).structuredContent);

heading('Export contacts to CSV');
const exported = await call(client, 'export_contacts', { contactIds: people.map((p) => p.id) });
const { downloadUrl } = exported.structuredContent as { downloadUrl: string };
console.log(exported.structuredContent);
const csv = await (await fetch(downloadUrl)).text();
console.log(dim(csv.split('\r\n').slice(0, 3).join('\n')));

heading('Error handling');
await call(client, 'get_company', { companyId: 'cmp_9999' });
await call(client, 'get_company', { companyId: 'not-an-id' });
await call(client, 'export_contacts', { contactIds: [people[0]!.id, 'cnt_99999'] });
const tampered = new URL(downloadUrl);
tampered.searchParams.set('sig', 'forged');
console.log(dim(`→ GET export link with a forged signature`));
console.log(red(`✗ HTTP ${(await fetch(tampered)).status}`));

await client.close();
console.log(`\n${green('Done.')}`);

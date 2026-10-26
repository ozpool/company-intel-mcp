import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { generateSeedData } from '../scripts/seed-data.js';
import { createApiKey } from '../src/auth/apiKeys.js';
import { loadConfig } from '../src/config.js';
import { openDatabase, type Db } from '../src/db/database.js';
import { createApp } from '../src/http/app.js';
import { createLogger } from '../src/logger.js';
import { simulatedProvider } from '../src/services/enrichment.js';

export type TestServer = { baseUrl: string; mcpUrl: URL; db: Db; apiKey: string; accountId: string; close: () => Promise<void> };

/** Starts the real app on a random port with a seeded in-memory database. */
export async function startTestServer(env: Record<string, string> = {}): Promise<TestServer> {
  const db = openDatabase(':memory:');
  const { companies, contacts } = generateSeedData();
  const insertCompany = db.prepare(
    `INSERT INTO companies VALUES (:id, :name, :domain, :website, :industry, :country, :city, :employees, :founded_year, :description, :tags)`,
  );
  const insertContact = db.prepare(
    `INSERT INTO contacts VALUES (:id, :company_id, :first_name, :last_name, :title, :department, :seniority, :location)`,
  );
  companies.forEach((c) => insertCompany.run(c));
  contacts.forEach((c) => insertContact.run(c));
  const { key, account } = createApiKey(db, 'test');

  // Bind first so PUBLIC_URL can carry the real port.
  const { createServer } = await import('node:http');
  const http = createServer();
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const port = (http.address() as AddressInfo).port;
  const baseUrl = `http://localhost:${port}`;

  const config = loadConfig({ PUBLIC_URL: baseUrl, EXPORT_SIGNING_SECRET: 'test-secret', LOG_LEVEL: 'silent', ...env });
  const app = createApp({ config, db, logger: createLogger('silent'), enrichment: simulatedProvider });
  http.on('request', app);

  return {
    baseUrl,
    mcpUrl: config.mcpUrl,
    db,
    apiKey: key,
    accountId: account.id,
    close: () => new Promise((resolve) => http.close(() => resolve())),
  };
}

export async function connectClient(server: TestServer, token = server.apiKey): Promise<Client> {
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(server.mcpUrl, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }),
  );
  return client;
}

/** Parses the {"error": {...}} body of a failed tool call. */
export function toolError(result: unknown) {
  const [first] = (result as { content: { text: string }[] }).content;
  return (JSON.parse(first!.text) as { error: { code: string; message: string; details?: Record<string, unknown> } }).error;
}

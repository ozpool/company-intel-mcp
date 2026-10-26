import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { CallToolResult, ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Db } from '../db/database.js';
import { AppError } from '../errors.js';
import type { Logger } from '../logger.js';
import { getCompany, listCountries, searchCompanies } from '../services/companies.js';
import { searchContacts } from '../services/contacts.js';
import { enrichContact, type EnrichmentProvider } from '../services/enrichment.js';
import { createExport, type ExportSettings } from '../services/exports.js';

export type McpDeps = {
  db: Db;
  logger: Logger;
  enrichment: EnrichmentProvider;
  exports: ExportSettings;
};

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

const companyId = z.string().regex(/^cmp_\d+$/, 'Company ids look like "cmp_12"');
const contactId = z.string().regex(/^cnt_\d+$/, 'Contact ids look like "cnt_34"');

const companySummary = z.object({
  id: z.string(),
  name: z.string(),
  industry: z.string(),
  employees: z.number().int(),
  country: z.string(),
});

const contactSummary = z.object({
  id: z.string(),
  name: z.string(),
  title: z.string(),
  department: z.string(),
  seniority: z.string(),
  companyId: z.string(),
  companyName: z.string(),
});

const INSTRUCTIONS = `Company intelligence data: companies and the people who work at them.
Typical flow: search_companies -> get_company for details -> search_contacts at that company ->
enrich_contact to get an email and LinkedIn URL -> export_contacts to hand the user a CSV.
Ids are opaque: always take them from a previous result, never guess them.
Failed calls return isError. Arguments that break a tool's input schema get a plain-text message starting
"Input validation error"; fix the arguments and retry. Every other failure is JSON {"error":{"code","message","details"?}}:
NOT_FOUND means the id does not exist; VALIDATION_ERROR means a value is not allowed (details list the valid ones).`;

/**
 * Builds the MCP server for one request. Tool handlers stay thin: they map
 * arguments to a service call and let run() turn the outcome into a tool result.
 */
export function createMcpServer(deps: McpDeps): McpServer {
  const { db } = deps;
  const server = new McpServer({ name: 'company-intelligence', version: '1.0.0' }, { instructions: INSTRUCTIONS });
  const countries = listCountries(db);

  server.registerTool(
    'search_companies',
    {
      title: 'Search companies',
      description:
        'Find companies by what they do. `query` is free text matched against name, industry, description and tags ' +
        '(e.g. "AI", "payments fraud", "cybersecurity"); best matches come first. Leave it out to list the largest ' +
        'companies. Returns summaries; call get_company for full details.',
      inputSchema: {
        query: z.string().trim().max(200).optional().describe('What the companies do, e.g. "AI" or "logistics software"'),
        country: z
          .string()
          .trim()
          .min(2)
          .max(60)
          .optional()
          .describe(
            `Country name (case-insensitive) or a common short form such as "AU", "US", "UK". ` +
              `Known countries: ${countries.join(', ') || 'none (database not seeded)'}`,
          ),
        limit: z.number().int().min(1).max(50).default(10).describe('Max results, 1-50'),
      },
      outputSchema: {
        results: z.array(companySummary),
        total: z.number().int().describe('How many companies match in total, beyond this page'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args, extra) => run(deps, 'search_companies', extra, () => searchCompanies(db, args)),
  );

  server.registerTool(
    'get_company',
    {
      title: 'Get company details',
      description: 'Full profile of one company: website, industry, size, location, founding year, description and tags.',
      inputSchema: { companyId: companyId.describe('Id from search_companies, e.g. "cmp_1"') },
      outputSchema: {
        ...companySummary.shape,
        website: z.string(),
        domain: z.string(),
        city: z.string(),
        foundedYear: z.number().int(),
        description: z.string(),
        tags: z.array(z.string()),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args, extra) => run(deps, 'get_company', extra, () => getCompany(db, args.companyId)),
  );

  server.registerTool(
    'search_contacts',
    {
      title: 'Search contacts',
      description:
        'Find people, optionally at one company and/or with a job title containing the given text ' +
        '(case-insensitive, e.g. "engineer" matches "Senior Software Engineer"). Emails and LinkedIn URLs are not ' +
        'included; use enrich_contact for those.',
      inputSchema: {
        companyId: companyId.optional().describe('Only people at this company'),
        jobTitle: z.string().trim().min(1).max(100).optional().describe('Text the job title must contain, e.g. "Engineer"'),
        limit: z.number().int().min(1).max(100).default(25).describe('Max results, 1-100'),
      },
      outputSchema: {
        contacts: z.array(contactSummary),
        total: z.number().int().describe('How many contacts match in total, beyond this page'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args, extra) => run(deps, 'search_contacts', extra, () => searchContacts(db, args)),
  );

  server.registerTool(
    'enrich_contact',
    {
      title: 'Enrich contact',
      description:
        'Look up the work email and LinkedIn profile for a contact. The result is stored, so calling it again for the ' +
        'same contact returns the same data (cached: true) without another provider lookup. Enriching a contact also ' +
        'adds its email and LinkedIn to your later exports.',
      inputSchema: { contactId: contactId.describe('Id from search_contacts, e.g. "cnt_1"') },
      outputSchema: {
        contactId: z.string(),
        email: z.string(),
        linkedin: z.string(),
        source: z.string().describe('Which enrichment provider produced the data'),
        enrichedAt: z.string().describe('ISO-8601 time of the original lookup'),
        cached: z.boolean().describe('true when this came from a previous lookup'),
      },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    (args, extra) =>
      run(deps, 'enrich_contact', extra, () =>
        enrichContact(db, deps.enrichment, { accountId: accountOf(extra), contactId: args.contactId }),
      ),
  );

  server.registerTool(
    'export_contacts',
    {
      title: 'Export contacts to CSV',
      description:
        'Create a CSV of the given contacts and return a download link. Includes company details and, for contacts ' +
        'you have already enriched, email and LinkedIn. The link needs no login, so share it only with the user; it expires ' +
        'at expiresAt. If any id does not exist, nothing is exported and the error lists the missing ids.',
      inputSchema: {
        contactIds: z.array(contactId).min(1).max(500).describe('Contact ids to export (1-500)'),
      },
      outputSchema: {
        exportId: z.string(),
        downloadUrl: z.string(),
        expiresAt: z.string(),
        rowCount: z.number().int(),
        enrichedCount: z.number().int().describe('How many rows include email and LinkedIn'),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    (args, extra) =>
      run(deps, 'export_contacts', extra, () =>
        createExport(db, deps.exports, { accountId: accountOf(extra), contactIds: [...new Set(args.contactIds)] }),
      ),
  );

  return server;
}

const accountOf = (extra: Extra) => String(extra.authInfo?.extra?.accountId ?? 'unknown');

/** Runs a tool body, logs the outcome and converts it into an MCP tool result. */
async function run(deps: McpDeps, tool: string, extra: Extra, body: () => unknown): Promise<CallToolResult> {
  const started = performance.now();
  const log = deps.logger.child({ tool, account: accountOf(extra), rpcId: extra.requestId });
  try {
    const result = (await body()) as Record<string, unknown>;
    log.info({ ms: Math.round(performance.now() - started) }, 'tool ok');
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result };
  } catch (err) {
    const ms = Math.round(performance.now() - started);
    if (err instanceof AppError) {
      log.warn({ ms, code: err.code, error: err.message }, 'tool failed');
      return toolError(err.code, err.message, err.details);
    }
    log.error({ ms, err }, 'tool crashed');
    return toolError('INTERNAL_ERROR', 'Unexpected server error. It has been logged; try again later.');
  }
}

function toolError(code: string, message: string, details?: Record<string, unknown>): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ error: { code, message, ...(details && { details }) } }) }],
  };
}

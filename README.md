# Company Intelligence MCP Server

An MCP server to search companies, find contacts, enrich them with email and LinkedIn, and export them to CSV. Built with Node.js, TypeScript, Express and SQLite.

## Setup

Requires Node.js 22.13 or newer.

```bash
npm install
npm run seed                            # load sample data: 60 companies, 337 contacts
npm run create-key -- you@example.com   # create your account (asks for a password) and an API key
npm run dev                             # server at http://localhost:3000/mcp
```

Try every tool with the scripted client, in a second terminal:

```bash
MCP_API_KEY=aik_... npm run demo
```

Run the tests with `npm test`.

## Authentication

- **People** (Claude Desktop, VS Code): OAuth 2.1 + PKCE. The client opens a sign-in page in the browser, where you sign in with email and password or create an account.
- **Scripts and tests**: an API key, sent as `Authorization: Bearer aik_...`. Create one with `npm run create-key -- <email>`. It is shown once; only its hash is stored.

Both belong to the same account. Requests without a valid token get `401`.

## Connect a client

Example configs are in [`examples/`](examples):

- Claude Desktop: [`claude_desktop_config.json`](examples/claude_desktop_config.json) (OAuth through `mcp-remote`)
- Cursor: [`cursor-mcp.json`](examples/cursor-mcp.json) (API key)
- VS Code: [`vscode-mcp.json`](examples/vscode-mcp.json) (API key; remove `inputs` and `headers` to use OAuth)

## Tools

| Tool | Input |
|---|---|
| `search_companies` | `{ "query": "AI companies", "country": "Australia", "limit": 10 }` |
| `get_company` | `{ "companyId": "cmp_1" }` |
| `search_contacts` | `{ "companyId": "cmp_1", "jobTitle": "Engineer" }` |
| `enrich_contact` | `{ "contactId": "cnt_1" }` |
| `export_contacts` | `{ "contactIds": ["cnt_1", "cnt_2"] }` |

Errors come back as `isError: true` with a code: `NOT_FOUND`, `VALIDATION_ERROR` or `INTERNAL_ERROR`.

## Architecture

![Architecture](docs/architecture.png)

Request → Host check → auth → rate limit → MCP tools → services → SQLite.

- `src/http`: routes and rate limiting
- `src/auth`: API keys and OAuth
- `src/mcp`: the five tools
- `src/services`: business logic and SQL
- `src/db`: schema

Also covered: input validation (zod), structured logging (pino), per-account rate limiting, strict TypeScript.

## Configuration

All settings are in `.env.example` (port, database path, export link secret, rate limit, log level). The defaults work locally.

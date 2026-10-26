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

Start the server first (`npm run dev`). Example configs are in [`examples/`](examples).

### Claude Desktop

Needs Node.js, because it connects through [`mcp-remote`](https://www.npmjs.com/package/mcp-remote).

1. Quit Claude Desktop fully (Cmd+Q). It rewrites its config file while running, so edits made while it is open can be lost.
2. Open the config file: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows). On macOS:
   ```bash
   open -e ~/Library/Application\ Support/Claude/claude_desktop_config.json
   ```
3. Add the `mcpServers` block from one of the examples next to what is already in the file: [`claude_desktop_config.oauth.json`](examples/claude_desktop_config.oauth.json) signs in through the browser (OAuth), [`claude_desktop_config.api-key.json`](examples/claude_desktop_config.api-key.json) uses an API key (replace `aik_your_key_here`).
4. If Node.js is installed with nvm, Claude Desktop cannot find `npx`. Replace `"npx"` with the full path from `which npx`, and add `"env": { "PATH": "<that folder>:/usr/bin:/bin" }` to the entry.
5. Open Claude Desktop. With OAuth, a browser tab opens: sign in or create an account, then approve.

### Claude Code

```bash
claude mcp add --transport http company-intel http://localhost:3000/mcp
```

Then run `/mcp` in Claude Code, pick `company-intel` and sign in through the browser. To use an API key instead, add `--header "Authorization: Bearer aik_..."` to the command.

### Cursor

1. Copy [`cursor-mcp.json`](examples/cursor-mcp.json) to `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project).
2. The config reads the key from `COMPANY_INTEL_API_KEY`. Cursor only sees that variable when started from a terminal where it is set (`export COMPANY_INTEL_API_KEY=aik_...`, then `cursor .`). Otherwise, put the key in the file in place of `${env:COMPANY_INTEL_API_KEY}`.
3. Check **Cursor Settings → MCP**: `company-intel` should show 5 tools.

### VS Code

1. Copy [`vscode-mcp.json`](examples/vscode-mcp.json) to `.vscode/mcp.json` in your project.
2. Start the server from that file (the **Start** link above it). VS Code asks for your API key once and stores it.
3. To sign in through the browser (OAuth) instead, remove `inputs` and `headers`.

### Troubleshooting

- **Connection refused**: the server is not running, or runs on another port (`PORT` in `.env`).
- **`company-intel` missing in Claude Desktop**: the config was edited while the app was open, or `npx` was not found (see step 4 above). Quit the app, check the file still has the `mcpServers` block, then reopen it.
- **401 Unauthorized**: the API key is wrong, revoked or empty. Create a new one with `npm run create-key -- <email>`.
- **OAuth worked before, now fails** (for example after deleting `data/app.db`): clear the sign-in `mcp-remote` saved with `rm -rf ~/.mcp-auth`, then restart the client.

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

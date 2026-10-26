import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { z } from 'zod';

if (existsSync('.env')) process.loadEnvFile('.env');

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  // Loopback only by default (MCP transport guidance for local servers). Set 0.0.0.0 in a container.
  HOST: z.string().min(1).default('127.0.0.1'),
  PUBLIC_URL: z.url().optional(),
  DATABASE_PATH: z.string().min(1).default('data/app.db'),
  EXPORT_SIGNING_SECRET: z.string().optional(),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
  EXPORT_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'silent']).default('info'),
});

export type Config = {
  port: number;
  host: string;
  publicUrl: URL;
  /** Host header values accepted on every route; blocks DNS-rebinding attacks from web pages. */
  allowedHosts: string[];
  mcpUrl: URL;
  databasePath: string;
  exportSigningSecret: string;
  exportSigningSecretGenerated: boolean;
  rateLimitPerMinute: number;
  exportTtlMinutes: number;
  logLevel: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== '')));
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  const publicUrl = new URL(e.PUBLIC_URL ?? `http://localhost:${e.PORT}`);
  return {
    port: e.PORT,
    host: e.HOST,
    publicUrl,
    allowedHosts: [...new Set(['localhost', '127.0.0.1', '[::1]', publicUrl.hostname])],
    mcpUrl: new URL('/mcp', publicUrl),
    databasePath: e.DATABASE_PATH,
    // Without a configured secret, links still work but stop validating after a restart.
    exportSigningSecret: e.EXPORT_SIGNING_SECRET ?? randomBytes(32).toString('hex'),
    exportSigningSecretGenerated: !e.EXPORT_SIGNING_SECRET,
    rateLimitPerMinute: e.RATE_LIMIT_PER_MINUTE,
    exportTtlMinutes: e.EXPORT_TTL_MINUTES,
    logLevel: e.LOG_LEVEL,
  };
}

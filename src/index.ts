import { loadConfig } from './config.js';
import { openDatabase } from './db/database.js';
import { createApp } from './http/app.js';
import { createLogger } from './logger.js';
import { simulatedProvider } from './services/enrichment.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const db = openDatabase(config.databasePath);

const { n } = db.prepare('SELECT COUNT(*) AS n FROM companies').get() as { n: number };
if (n === 0) logger.warn('Database is empty. Run `npm run seed` to load sample data.');
if (config.exportSigningSecretGenerated) {
  logger.warn('EXPORT_SIGNING_SECRET is not set; using a random one, so export links stop working after a restart.');
}

// Express 5 passes a startup failure (e.g. port taken) to this callback instead of throwing.
const server = createApp({ config, db, logger, enrichment: simulatedProvider }).listen(
  config.port,
  config.host,
  (err?: NodeJS.ErrnoException) => {
    if (err) {
      logger.fatal(
        err.code === 'EADDRINUSE'
          ? `Port ${config.port} on ${config.host} is already in use by another program. Stop it, or set PORT in .env to a free port.`
          : `Server failed to start: ${err.message}`,
      );
      db.close();
      process.exit(1);
    }
    logger.info({ mcp: config.mcpUrl.href, bind: `${config.host}:${config.port}`, companies: n }, 'Company Intelligence MCP server listening');
  },
);

const shutdown = (signal: string) => {
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

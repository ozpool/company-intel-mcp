import { pino } from 'pino';

// pino-pretty is a dev dependency, so a production install (`npm ci --omit=dev`) does not have it.
const prettyInstalled = (() => {
  try {
    import.meta.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
})();

export type Logger = pino.Logger;

export function createLogger(level: string): Logger {
  return pino({
    level,
    redact: ['req.headers.authorization', '*.apiKey', '*.password', '*.token'],
    // Pretty output for a human at a terminal when available; JSON lines everywhere else.
    transport:
      process.stdout.isTTY && process.env.NODE_ENV !== 'production' && prettyInstalled
        ? { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } }
        : undefined,
  });
}

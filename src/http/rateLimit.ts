import type { RequestHandler } from 'express';

/**
 * Token bucket per account (per client IP on routes without auth): `perMinute` requests
 * of burst, refilling evenly.
 * ponytail: in-process memory, so limits are per instance and reset on restart.
 * Move the buckets to Redis when running more than one instance.
 */
export function rateLimit(perMinute: number, now: () => number = Date.now): RequestHandler {
  const buckets = new Map<string, { tokens: number; at: number }>();
  const refillPerMs = perMinute / 60_000;

  return (req, res, next) => {
    const key = String(req.auth?.extra?.accountId ?? req.ip);
    const t = now();
    const b = buckets.get(key) ?? { tokens: perMinute, at: t };
    b.tokens = Math.min(perMinute, b.tokens + (t - b.at) * refillPerMs);
    b.at = t;
    buckets.set(key, b);

    res.set('RateLimit-Limit', String(perMinute));
    if (b.tokens < 1) {
      const retryAfter = Math.ceil((1 - b.tokens) / refillPerMs / 1000);
      res.set('Retry-After', String(retryAfter)).status(429).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: `Rate limit exceeded (${perMinute}/min). Retry in ${retryAfter}s.` },
        id: null,
      });
      return;
    }
    b.tokens -= 1;
    res.set('RateLimit-Remaining', String(Math.floor(b.tokens)));
    next();
  };
}

import type { Context, Next } from "hono";

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 100;

const hits = new Map<string, { count: number; resetAt: number }>();

export function rateLimitMiddleware() {
  return async (c: Context, next: Next) => {
    const key = c.req.header("Authorization") || "anonymous";
    const now = Date.now();

    let entry = hits.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + WINDOW_MS };
      hits.set(key, entry);
    }

    entry.count++;

    if (entry.count > MAX_REQUESTS) {
      return c.json(
        { ok: false, error: { code: "RATE_LIMITED", message: "Too many requests" } },
        429
      );
    }

    c.header("X-RateLimit-Limit", String(MAX_REQUESTS));
    c.header("X-RateLimit-Remaining", String(MAX_REQUESTS - entry.count));
    c.header("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    return next();
  };
}

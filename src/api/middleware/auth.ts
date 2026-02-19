import type { Context, Next } from "hono";
import { verifyApiKey } from "../../security/auth.ts";

export function authMiddleware(apiKeyHash: string | null) {
  return async (c: Context, next: Next) => {
    // Skip auth for health check
    if (c.req.path === "/api/v1/system/status" && c.req.method === "GET") {
      return next();
    }

    // If no auth configured (dev/test mode), skip
    if (!apiKeyHash) return next();

    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json(
        { ok: false, error: { code: "UNAUTHORIZED", message: "Missing API key" } },
        401
      );
    }

    const key = authHeader.slice(7);
    const valid = await verifyApiKey(key, apiKeyHash);
    if (!valid) {
      return c.json(
        { ok: false, error: { code: "UNAUTHORIZED", message: "Invalid API key" } },
        401
      );
    }

    return next();
  };
}

import type { Context, Next } from "hono";
import type { AuditLog } from "../../security/audit.ts";

export function auditMiddleware(audit: AuditLog) {
  return async (c: Context, next: Next) => {
    await next();

    // Only audit mutating requests
    if (["POST", "PATCH", "PUT", "DELETE"].includes(c.req.method)) {
      audit.log({
        actor: "user",
        action: `api.${c.req.method.toLowerCase()}.${c.req.path}`,
        details: { status: c.res.status },
      });
    }
  };
}

import type { Context } from "hono";
import { createChildLogger } from "../../lib/logger.ts";

const log = createChildLogger("error-handler");

export function errorHandler(err: Error, c: Context) {
  log.error({ err: err.message, path: c.req.path }, "Unhandled error");
  return c.json(
    {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
      },
    },
    500
  );
}

import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { authMiddleware } from "./middleware/auth.ts";
import { rateLimitMiddleware } from "./middleware/rate-limit.ts";
import { auditMiddleware } from "./middleware/audit.ts";
import { AuditLog } from "../security/audit.ts";
import { tasksRoutes } from "./routes/tasks.ts";
import { entitiesRoutes } from "./routes/entities.ts";
import { workflowsRoutes } from "./routes/workflows.ts";
import { automationsRoutes } from "./routes/automations.ts";
import { filesRoutes } from "./routes/files.ts";
import { jobsRoutes } from "./routes/jobs.ts";

interface AppConfig {
  db: Database;
  apiKeyHash: string | null;
}

export function createApp(config: AppConfig) {
  const app = new Hono();
  const audit = new AuditLog(config.db);

  // Global middleware
  app.use("/api/*", rateLimitMiddleware());
  app.use("/api/*", authMiddleware(config.apiKeyHash));
  app.use("/api/*", auditMiddleware(audit));

  // Health check
  app.get("/api/v1/system/status", (c) => {
    return c.json({
      ok: true,
      data: {
        status: "running",
        uptime: process.uptime(),
        version: "0.1.0",
      },
    });
  });

  // Mount routes
  app.route("/api/v1/tasks", tasksRoutes(config.db));
  app.route("/api/v1/entities", entitiesRoutes(config.db));
  app.route("/api/v1/workflows", workflowsRoutes(config.db));
  app.route("/api/v1/automations", automationsRoutes(config.db));
  app.route("/api/v1/files", filesRoutes(config.db));
  app.route("/api/v1/jobs", jobsRoutes(config.db));

  // 404 fallback
  app.notFound((c) => {
    return c.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Route not found" } },
      404
    );
  });

  // Error handler
  app.onError((err, c) => {
    console.error("Unhandled error:", err);
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
  });

  return app;
}

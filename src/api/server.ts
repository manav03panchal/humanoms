import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
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
import { createChatRoutes } from "./routes/chat.ts";
import { dashboardRoutes } from "./routes/dashboard.ts";

import type { Scheduler } from "../scheduler/scheduler.ts";
import type { ChatProvider } from "../chat/providers/types.ts";

interface AppConfig {
  db: Database;
  apiKeyHash: string | null;
  chatProvider: ChatProvider;
  scheduler?: Scheduler;
}

export function createApp(config: AppConfig) {
  const app = new Hono();
  const audit = new AuditLog(config.db);

  // Global middleware
  app.use("/api/*", cors({ origin: "*" }));
  app.use("/api/*", rateLimitMiddleware());
  app.use("/api/*", authMiddleware(config.apiKeyHash));
  app.use("/api/*", auditMiddleware(audit));

  // Health check
  app.get("/api/v1/system/status", (c) => {
    return c.json({
      ok: true,
      data: {
        status: "running",
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
  app.route("/api/v1", createChatRoutes(config.db, config.chatProvider, config.scheduler));
  app.route("/api/v1/dashboard", dashboardRoutes(config.db));

  // Root redirect
  app.get("/", (c) => c.redirect("/index.html"));

  // Serve static frontend files
  app.use("/*", serveStatic({ root: "./web" }));

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

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Database, SQLQueryBindings } from "bun:sqlite";

const startTime = Date.now();

export function registerSystemTools(server: McpServer, db: Database): void {
  // system_status
  server.tool(
    "system_status",
    "Get system health information including uptime, version, and job counts",
    {},
    async () => {
      const uptimeMs = Date.now() - startTime;
      const uptimeSeconds = Math.floor(uptimeMs / 1000);

      const jobCounts = db
        .query(
          `SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued,
            SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
           FROM jobs`
        )
        .get() as Record<string, number> | null;

      const taskCount = db
        .query("SELECT COUNT(*) as count FROM tasks")
        .get() as { count: number } | null;

      const entityCount = db
        .query("SELECT COUNT(*) as count FROM entities")
        .get() as { count: number } | null;

      const workflowCount = db
        .query("SELECT COUNT(*) as count FROM workflows")
        .get() as { count: number } | null;

      const status = {
        version: "0.1.0",
        uptime_seconds: uptimeSeconds,
        counts: {
          tasks: taskCount?.count ?? 0,
          entities: entityCount?.count ?? 0,
          workflows: workflowCount?.count ?? 0,
          jobs: {
            total: jobCounts?.total ?? 0,
            queued: jobCounts?.queued ?? 0,
            running: jobCounts?.running ?? 0,
            completed: jobCounts?.completed ?? 0,
            failed: jobCounts?.failed ?? 0,
          },
        },
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(status) }],
      };
    }
  );

  // query_audit_log
  server.tool(
    "query_audit_log",
    "Query the audit log with optional filters",
    {
      actor: z.string().optional(),
      action: z.string().optional(),
      limit: z.number().int().min(1).max(1000).optional(),
    },
    async (params) => {
      let sql = "SELECT * FROM audit_log";
      const conditions: string[] = [];
      const sqlParams: SQLQueryBindings[] = [];

      if (params.actor) {
        conditions.push("actor = ?");
        sqlParams.push(params.actor);
      }
      if (params.action) {
        conditions.push("action = ?");
        sqlParams.push(params.action);
      }

      if (conditions.length > 0) {
        sql += " WHERE " + conditions.join(" AND ");
      }
      sql += " ORDER BY timestamp DESC";

      const limit = params.limit ?? 50;
      sql += " LIMIT ?";
      sqlParams.push(limit);

      const rows = db.query(sql).all(...sqlParams);
      const logs = (rows as Record<string, unknown>[]).map((r) => ({
        ...r,
        details: JSON.parse((r.details as string) || "{}"),
      }));

      return {
        content: [{ type: "text" as const, text: JSON.stringify(logs) }],
      };
    }
  );
}

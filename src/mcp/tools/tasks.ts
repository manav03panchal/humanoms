import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Database, SQLQueryBindings } from "bun:sqlite";
import { generateId } from "../../lib/ulid.ts";

function deserializeTask(row: unknown): Record<string, unknown> {
  const r = row as Record<string, unknown>;
  return {
    ...r,
    tags: JSON.parse((r.tags as string) || "[]"),
    metadata: JSON.parse((r.metadata as string) || "{}"),
  };
}

export function registerTaskTools(server: McpServer, db: Database): void {
  // create_task
  server.tool(
    "create_task",
    "Create a new task",
    {
      title: z.string().min(1).max(500),
      description: z.string().max(10000).optional(),
      status: z
        .enum(["pending", "in_progress", "completed", "cancelled"])
        .optional(),
      priority: z.number().int().min(0).max(4).optional(),
      due_date: z.string().optional(),
      recurrence: z.string().max(100).optional(),
      tags: z.array(z.string()).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    },
    async (params) => {
      const id = generateId();
      const now = new Date().toISOString();
      const status = params.status ?? "pending";
      const priority = params.priority ?? 0;
      const tags = params.tags ?? [];
      const metadata = params.metadata ?? {};

      db.run(
        `INSERT INTO tasks (id, title, description, status, priority, due_date, recurrence, tags, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          params.title,
          params.description ?? null,
          status,
          priority,
          params.due_date ?? null,
          params.recurrence ?? null,
          JSON.stringify(tags),
          JSON.stringify(metadata),
          now,
          now,
        ]
      );

      const created = db.query("SELECT * FROM tasks WHERE id = ?").get(id);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(deserializeTask(created)) },
        ],
      };
    }
  );

  // list_tasks
  server.tool(
    "list_tasks",
    "List tasks with optional filters",
    {
      status: z
        .enum(["pending", "in_progress", "completed", "cancelled"])
        .optional(),
      tags: z.string().optional(),
      due_before: z.string().optional(),
    },
    async (params) => {
      let sql = "SELECT * FROM tasks";
      const conditions: string[] = [];
      const sqlParams: SQLQueryBindings[] = [];

      if (params.status) {
        conditions.push("status = ?");
        sqlParams.push(params.status);
      }
      if (params.tags) {
        conditions.push("tags LIKE ?");
        sqlParams.push(`%"${params.tags}"%`);
      }
      if (params.due_before) {
        conditions.push("due_date <= ?");
        sqlParams.push(params.due_before);
      }

      if (conditions.length > 0) {
        sql += " WHERE " + conditions.join(" AND ");
      }
      sql += " ORDER BY created_at DESC";

      const rows = db.query(sql).all(...sqlParams);
      const tasks = (rows as Record<string, unknown>[]).map(deserializeTask);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(tasks) }],
      };
    }
  );

  // get_task
  server.tool(
    "get_task",
    "Get a task by ID",
    {
      id: z.string().min(1),
    },
    async (params) => {
      const row = db.query("SELECT * FROM tasks WHERE id = ?").get(params.id);
      if (!row) {
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ error: "Task not found" }) },
          ],
          isError: true,
        };
      }
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(deserializeTask(row)) },
        ],
      };
    }
  );

  // update_task
  server.tool(
    "update_task",
    "Update an existing task",
    {
      id: z.string().min(1),
      title: z.string().min(1).max(500).optional(),
      description: z.string().max(10000).optional(),
      status: z
        .enum(["pending", "in_progress", "completed", "cancelled"])
        .optional(),
      priority: z.number().int().min(0).max(4).optional(),
      due_date: z.string().optional(),
      tags: z.array(z.string()).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    },
    async (params) => {
      const existing = db
        .query("SELECT * FROM tasks WHERE id = ?")
        .get(params.id);
      if (!existing) {
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ error: "Task not found" }) },
          ],
          isError: true,
        };
      }

      const sets: string[] = ["updated_at = ?"];
      const values: SQLQueryBindings[] = [new Date().toISOString()];

      const { id, ...updates } = params;
      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) {
          sets.push(`${key} = ?`);
          values.push(
            key === "tags" || key === "metadata"
              ? JSON.stringify(value)
              : (value as SQLQueryBindings)
          );
        }
      }

      values.push(id);
      db.run(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, values);

      const updated = db.query("SELECT * FROM tasks WHERE id = ?").get(id);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(deserializeTask(updated)) },
        ],
      };
    }
  );

  // complete_task
  server.tool(
    "complete_task",
    "Mark a task as completed",
    {
      id: z.string().min(1),
    },
    async (params) => {
      const existing = db
        .query("SELECT * FROM tasks WHERE id = ?")
        .get(params.id);
      if (!existing) {
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ error: "Task not found" }) },
          ],
          isError: true,
        };
      }

      const now = new Date().toISOString();
      db.run(
        `UPDATE tasks SET status = 'completed', updated_at = ? WHERE id = ?`,
        [now, params.id]
      );

      const updated = db
        .query("SELECT * FROM tasks WHERE id = ?")
        .get(params.id);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(deserializeTask(updated)) },
        ],
      };
    }
  );
}

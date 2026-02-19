import { Hono } from "hono";
import type { Database, SQLQueryBindings } from "bun:sqlite";
import { generateId } from "../../lib/ulid.ts";
import { CreateTaskSchema, UpdateTaskSchema } from "../../lib/validation.ts";

export function tasksRoutes(db: Database) {
  const router = new Hono();

  router.post("/", async (c) => {
    const body = await c.req.json();
    const parsed = CreateTaskSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid input",
            details: parsed.error.flatten(),
          },
        },
        400
      );
    }

    const task = parsed.data;
    const id = generateId();
    const now = new Date().toISOString();

    db.run(
      `INSERT INTO tasks (id, title, description, status, priority, due_date, recurrence, tags, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        task.title,
        task.description ?? null,
        task.status,
        task.priority,
        task.due_date ?? null,
        task.recurrence ?? null,
        JSON.stringify(task.tags),
        JSON.stringify(task.metadata),
        now,
        now,
      ]
    );

    const created = db.query("SELECT * FROM tasks WHERE id = ?").get(id);
    return c.json({ ok: true, data: deserializeTask(created) }, 201);
  });

  router.get("/", (c) => {
    const status = c.req.query("status");
    const tag = c.req.query("tags");
    const dueBefore = c.req.query("due_before");

    let sql = "SELECT * FROM tasks";
    const conditions: string[] = [];
    const params: SQLQueryBindings[] = [];

    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }
    if (tag) {
      conditions.push("tags LIKE ?");
      params.push(`%"${tag}"%`);
    }
    if (dueBefore) {
      conditions.push("due_date <= ?");
      params.push(dueBefore);
    }

    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }
    sql += " ORDER BY created_at DESC";

    const rows = db.query(sql).all(...params);
    return c.json({
      ok: true,
      data: (rows as Record<string, unknown>[]).map(deserializeTask),
    });
  });

  router.get("/:id", (c) => {
    const row = db
      .query("SELECT * FROM tasks WHERE id = ?")
      .get(c.req.param("id"));
    if (!row) {
      return c.json(
        { ok: false, error: { code: "NOT_FOUND", message: "Task not found" } },
        404
      );
    }
    return c.json({ ok: true, data: deserializeTask(row) });
  });

  router.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const existing = db.query("SELECT * FROM tasks WHERE id = ?").get(id);
    if (!existing) {
      return c.json(
        { ok: false, error: { code: "NOT_FOUND", message: "Task not found" } },
        404
      );
    }

    const body = await c.req.json();
    const parsed = UpdateTaskSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid input",
            details: parsed.error.flatten(),
          },
        },
        400
      );
    }

    const updates = parsed.data;
    const sets: string[] = ["updated_at = ?"];
    const values: SQLQueryBindings[] = [new Date().toISOString()];

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
    return c.json({ ok: true, data: deserializeTask(updated) });
  });

  router.delete("/:id", (c) => {
    const id = c.req.param("id");
    const existing = db.query("SELECT * FROM tasks WHERE id = ?").get(id);
    if (!existing) {
      return c.json(
        { ok: false, error: { code: "NOT_FOUND", message: "Task not found" } },
        404
      );
    }
    db.run("DELETE FROM tasks WHERE id = ?", [id]);
    return c.json({ ok: true, data: { deleted: true } });
  });

  return router;
}

function deserializeTask(row: unknown): Record<string, unknown> {
  const r = row as Record<string, unknown>;
  return {
    ...r,
    tags: JSON.parse((r.tags as string) || "[]"),
    metadata: JSON.parse((r.metadata as string) || "{}"),
  };
}

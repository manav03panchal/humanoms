import { Hono } from "hono";
import type { Database, SQLQueryBindings } from "bun:sqlite";
import { generateId } from "../../lib/ulid.ts";
import {
  CreateAutomationSchema,
  UpdateAutomationSchema,
} from "../../lib/validation.ts";

export function automationsRoutes(db: Database) {
  const router = new Hono();

  router.post("/", async (c) => {
    const body = await c.req.json();
    const parsed = CreateAutomationSchema.safeParse(body);
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

    const automation = parsed.data;
    const id = generateId();
    const now = new Date().toISOString();

    db.run(
      `INSERT INTO automations (id, name, description, cron_expression, workflow_id, input, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        automation.name,
        automation.description,
        automation.cron_expression,
        automation.workflow_id,
        JSON.stringify(automation.input),
        automation.enabled ? 1 : 0,
        now,
      ]
    );

    const created = db
      .query("SELECT * FROM automations WHERE id = ?")
      .get(id);
    return c.json({ ok: true, data: deserializeAutomation(created) }, 201);
  });

  router.get("/", (c) => {
    const enabled = c.req.query("enabled");

    let sql = "SELECT * FROM automations";
    const conditions: string[] = [];
    const params: SQLQueryBindings[] = [];

    if (enabled !== undefined) {
      conditions.push("enabled = ?");
      params.push(enabled === "true" ? 1 : 0);
    }

    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }
    sql += " ORDER BY created_at DESC";

    const rows = db.query(sql).all(...params);
    return c.json({
      ok: true,
      data: (rows as Record<string, unknown>[]).map(deserializeAutomation),
    });
  });

  router.get("/:id", (c) => {
    const row = db
      .query("SELECT * FROM automations WHERE id = ?")
      .get(c.req.param("id"));
    if (!row) {
      return c.json(
        {
          ok: false,
          error: { code: "NOT_FOUND", message: "Automation not found" },
        },
        404
      );
    }
    return c.json({ ok: true, data: deserializeAutomation(row) });
  });

  router.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const existing = db
      .query("SELECT * FROM automations WHERE id = ?")
      .get(id);
    if (!existing) {
      return c.json(
        {
          ok: false,
          error: { code: "NOT_FOUND", message: "Automation not found" },
        },
        404
      );
    }

    const body = await c.req.json();
    const parsed = UpdateAutomationSchema.safeParse(body);
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
    const sets: string[] = [];
    const values: SQLQueryBindings[] = [];

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        sets.push(`${key} = ?`);
        if (key === "input") {
          values.push(JSON.stringify(value));
        } else if (key === "enabled") {
          values.push(value ? 1 : 0);
        } else {
          values.push(value as SQLQueryBindings);
        }
      }
    }

    if (sets.length === 0) {
      const current = db
        .query("SELECT * FROM automations WHERE id = ?")
        .get(id);
      return c.json({ ok: true, data: deserializeAutomation(current) });
    }

    values.push(id);
    db.run(
      `UPDATE automations SET ${sets.join(", ")} WHERE id = ?`,
      values
    );

    const updated = db
      .query("SELECT * FROM automations WHERE id = ?")
      .get(id);
    return c.json({ ok: true, data: deserializeAutomation(updated) });
  });

  router.delete("/:id", (c) => {
    const id = c.req.param("id");
    const existing = db
      .query("SELECT * FROM automations WHERE id = ?")
      .get(id);
    if (!existing) {
      return c.json(
        {
          ok: false,
          error: { code: "NOT_FOUND", message: "Automation not found" },
        },
        404
      );
    }
    db.run("DELETE FROM automations WHERE id = ?", [id]);
    return c.json({ ok: true, data: { deleted: true } });
  });

  return router;
}

function deserializeAutomation(row: unknown): Record<string, unknown> {
  const r = row as Record<string, unknown>;
  return {
    ...r,
    input: JSON.parse((r.input as string) || "{}"),
    enabled: r.enabled === 1,
  };
}

import { Hono } from "hono";
import type { Database, SQLQueryBindings } from "bun:sqlite";
import { generateId } from "../../lib/ulid.ts";
import {
  CreateWorkflowSchema,
  TriggerWorkflowSchema,
} from "../../lib/validation.ts";

export function workflowsRoutes(db: Database) {
  const router = new Hono();

  router.post("/", async (c) => {
    const body = await c.req.json();
    const parsed = CreateWorkflowSchema.safeParse(body);
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

    const workflow = parsed.data;
    const id = generateId();
    const now = new Date().toISOString();

    db.run(
      `INSERT INTO workflows (id, name, description, steps, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        workflow.name,
        workflow.description ?? null,
        JSON.stringify(workflow.steps),
        1,
        now,
        now,
      ]
    );

    const created = db.query("SELECT * FROM workflows WHERE id = ?").get(id);
    return c.json({ ok: true, data: deserializeWorkflow(created) }, 201);
  });

  router.get("/", (c) => {
    const enabled = c.req.query("enabled");

    let sql = "SELECT * FROM workflows";
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
      data: (rows as Record<string, unknown>[]).map(deserializeWorkflow),
    });
  });

  router.get("/:id", (c) => {
    const row = db
      .query("SELECT * FROM workflows WHERE id = ?")
      .get(c.req.param("id"));
    if (!row) {
      return c.json(
        {
          ok: false,
          error: { code: "NOT_FOUND", message: "Workflow not found" },
        },
        404
      );
    }
    return c.json({ ok: true, data: deserializeWorkflow(row) });
  });

  router.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const existing = db
      .query("SELECT * FROM workflows WHERE id = ?")
      .get(id);
    if (!existing) {
      return c.json(
        {
          ok: false,
          error: { code: "NOT_FOUND", message: "Workflow not found" },
        },
        404
      );
    }

    const body = await c.req.json();
    const parsed = CreateWorkflowSchema.partial().safeParse(body);
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
          key === "steps"
            ? JSON.stringify(value)
            : (value as SQLQueryBindings)
        );
      }
    }

    values.push(id);
    db.run(`UPDATE workflows SET ${sets.join(", ")} WHERE id = ?`, values);

    const updated = db
      .query("SELECT * FROM workflows WHERE id = ?")
      .get(id);
    return c.json({ ok: true, data: deserializeWorkflow(updated) });
  });

  router.delete("/:id", (c) => {
    const id = c.req.param("id");
    const existing = db
      .query("SELECT * FROM workflows WHERE id = ?")
      .get(id);
    if (!existing) {
      return c.json(
        {
          ok: false,
          error: { code: "NOT_FOUND", message: "Workflow not found" },
        },
        404
      );
    }
    // Cascade-delete dependent rows before removing the workflow
    db.run("DELETE FROM automations WHERE workflow_id = ?", [id]);
    db.run("DELETE FROM jobs WHERE workflow_id = ?", [id]);
    db.run("DELETE FROM workflows WHERE id = ?", [id]);
    return c.json({ ok: true, data: { deleted: true } });
  });

  router.post("/:id/trigger", async (c) => {
    const workflowId = c.req.param("id");
    const workflow = db
      .query("SELECT * FROM workflows WHERE id = ?")
      .get(workflowId);
    if (!workflow) {
      return c.json(
        {
          ok: false,
          error: { code: "NOT_FOUND", message: "Workflow not found" },
        },
        404
      );
    }

    const body = await c.req.json();
    const parsed = TriggerWorkflowSchema.safeParse(body);
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

    const jobId = generateId();
    const now = new Date().toISOString();

    db.run(
      `INSERT INTO jobs (id, workflow_id, status, current_step, input, context, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        jobId,
        workflowId,
        "queued",
        0,
        JSON.stringify(parsed.data.input),
        JSON.stringify({}),
        now,
      ]
    );

    const created = db.query("SELECT * FROM jobs WHERE id = ?").get(jobId);
    return c.json({ ok: true, data: deserializeJob(created) }, 201);
  });

  router.get("/:id/jobs", (c) => {
    const workflowId = c.req.param("id");
    const workflow = db
      .query("SELECT * FROM workflows WHERE id = ?")
      .get(workflowId);
    if (!workflow) {
      return c.json(
        {
          ok: false,
          error: { code: "NOT_FOUND", message: "Workflow not found" },
        },
        404
      );
    }

    const rows = db
      .query(
        "SELECT * FROM jobs WHERE workflow_id = ? ORDER BY created_at DESC"
      )
      .all(workflowId);
    return c.json({
      ok: true,
      data: (rows as Record<string, unknown>[]).map(deserializeJob),
    });
  });

  return router;
}

function deserializeWorkflow(row: unknown): Record<string, unknown> {
  const r = row as Record<string, unknown>;
  return {
    ...r,
    steps: JSON.parse((r.steps as string) || "[]"),
  };
}

function deserializeJob(row: unknown): Record<string, unknown> {
  const r = row as Record<string, unknown>;
  return {
    ...r,
    input: JSON.parse((r.input as string) || "{}"),
    context: JSON.parse((r.context as string) || "{}"),
    output: r.output ? JSON.parse(r.output as string) : null,
  };
}

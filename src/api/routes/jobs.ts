import { Hono } from "hono";
import type { Database, SQLQueryBindings } from "bun:sqlite";

export function jobsRoutes(db: Database) {
  const router = new Hono();

  router.get("/", (c) => {
    const status = c.req.query("status");
    const workflowId = c.req.query("workflow_id");

    let sql = "SELECT * FROM jobs";
    const conditions: string[] = [];
    const params: SQLQueryBindings[] = [];

    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }
    if (workflowId) {
      conditions.push("workflow_id = ?");
      params.push(workflowId);
    }

    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }
    sql += " ORDER BY created_at DESC";

    const rows = db.query(sql).all(...params);
    return c.json({
      ok: true,
      data: (rows as Record<string, unknown>[]).map(deserializeJob),
    });
  });

  router.get("/:id", (c) => {
    const row = db
      .query("SELECT * FROM jobs WHERE id = ?")
      .get(c.req.param("id"));
    if (!row) {
      return c.json(
        {
          ok: false,
          error: { code: "NOT_FOUND", message: "Job not found" },
        },
        404
      );
    }
    return c.json({ ok: true, data: deserializeJob(row) });
  });

  router.post("/:id/approve", async (c) => {
    const jobId = c.req.param("id");
    const job = db.query("SELECT * FROM jobs WHERE id = ?").get(jobId);
    if (!job) {
      return c.json(
        {
          ok: false,
          error: { code: "NOT_FOUND", message: "Job not found" },
        },
        404
      );
    }

    const body = await c.req.json();
    const token = body.token;
    if (!token || typeof token !== "string") {
      return c.json(
        {
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Token is required",
          },
        },
        400
      );
    }

    const approval = db
      .query(
        "SELECT * FROM approvals WHERE job_id = ? AND status = 'pending'"
      )
      .get(jobId) as Record<string, unknown> | null;

    if (!approval) {
      return c.json(
        {
          ok: false,
          error: {
            code: "NOT_FOUND",
            message: "No pending approval found for this job",
          },
        },
        404
      );
    }

    if (approval.token !== token) {
      return c.json(
        {
          ok: false,
          error: {
            code: "FORBIDDEN",
            message: "Invalid approval token",
          },
        },
        403
      );
    }

    const now = new Date().toISOString();

    db.run(
      "UPDATE approvals SET status = ?, responded_at = ? WHERE id = ?",
      ["approved", now, approval.id as string]
    );

    db.run(
      "UPDATE jobs SET status = ? WHERE id = ?",
      ["queued", jobId]
    );

    const updatedJob = db
      .query("SELECT * FROM jobs WHERE id = ?")
      .get(jobId);
    return c.json({ ok: true, data: deserializeJob(updatedJob) });
  });

  router.post("/:id/reject", async (c) => {
    const jobId = c.req.param("id");
    const job = db.query("SELECT * FROM jobs WHERE id = ?").get(jobId);
    if (!job) {
      return c.json(
        {
          ok: false,
          error: { code: "NOT_FOUND", message: "Job not found" },
        },
        404
      );
    }

    const body = await c.req.json();
    const token = body.token;
    if (!token || typeof token !== "string") {
      return c.json(
        {
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Token is required",
          },
        },
        400
      );
    }

    const approval = db
      .query(
        "SELECT * FROM approvals WHERE job_id = ? AND status = 'pending'"
      )
      .get(jobId) as Record<string, unknown> | null;

    if (!approval) {
      return c.json(
        {
          ok: false,
          error: {
            code: "NOT_FOUND",
            message: "No pending approval found for this job",
          },
        },
        404
      );
    }

    if (approval.token !== token) {
      return c.json(
        {
          ok: false,
          error: {
            code: "FORBIDDEN",
            message: "Invalid approval token",
          },
        },
        403
      );
    }

    const now = new Date().toISOString();

    db.run(
      "UPDATE approvals SET status = ?, responded_at = ? WHERE id = ?",
      ["rejected", now, approval.id as string]
    );

    db.run(
      "UPDATE jobs SET status = ? WHERE id = ?",
      ["rejected", jobId]
    );

    const updatedJob = db
      .query("SELECT * FROM jobs WHERE id = ?")
      .get(jobId);
    return c.json({ ok: true, data: deserializeJob(updatedJob) });
  });

  return router;
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

import { Hono } from "hono";
import type { Database, SQLQueryBindings } from "bun:sqlite";
import { generateId } from "../../lib/ulid.ts";
import { CreateEntitySchema, UpdateEntitySchema } from "../../lib/validation.ts";
import { ENTITY_COLUMN_ALLOWLIST } from "../../security/sandbox.ts";

export function entitiesRoutes(db: Database) {
  const router = new Hono();

  router.post("/", async (c) => {
    const body = await c.req.json();
    const parsed = CreateEntitySchema.safeParse(body);
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

    const entity = parsed.data;
    const id = generateId();
    const now = new Date().toISOString();

    db.run(
      `INSERT INTO entities (id, type, name, properties, tags, parent_id, source_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        entity.type,
        entity.name,
        JSON.stringify(entity.properties),
        JSON.stringify(entity.tags),
        entity.parent_id ?? null,
        entity.source_id ?? null,
        now,
        now,
      ]
    );

    const created = db.query("SELECT * FROM entities WHERE id = ?").get(id);
    return c.json({ ok: true, data: deserializeEntity(created) }, 201);
  });

  router.get("/", (c) => {
    const type = c.req.query("type");
    const tag = c.req.query("tags");
    const q = c.req.query("q"); // full-text search

    if (q) {
      // FTS5 search
      const rows = db
        .query(
          `SELECT e.* FROM entities e
           JOIN entities_fts fts ON e.rowid = fts.rowid
           WHERE entities_fts MATCH ?
           ORDER BY rank`
        )
        .all(q);
      return c.json({
        ok: true,
        data: (rows as Record<string, unknown>[]).map(deserializeEntity),
      });
    }

    let sql = "SELECT * FROM entities";
    const conditions: string[] = [];
    const params: SQLQueryBindings[] = [];

    if (type) {
      conditions.push("type = ?");
      params.push(type);
    }
    if (tag) {
      conditions.push("tags LIKE ?");
      params.push(`%"${tag}"%`);
    }

    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }
    sql += " ORDER BY created_at DESC";

    const rows = db.query(sql).all(...params);
    return c.json({
      ok: true,
      data: (rows as Record<string, unknown>[]).map(deserializeEntity),
    });
  });

  router.get("/:id", (c) => {
    const row = db
      .query("SELECT * FROM entities WHERE id = ?")
      .get(c.req.param("id"));
    if (!row) {
      return c.json(
        {
          ok: false,
          error: { code: "NOT_FOUND", message: "Entity not found" },
        },
        404
      );
    }
    return c.json({ ok: true, data: deserializeEntity(row) });
  });

  router.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const existing = db.query("SELECT * FROM entities WHERE id = ?").get(id);
    if (!existing) {
      return c.json(
        {
          ok: false,
          error: { code: "NOT_FOUND", message: "Entity not found" },
        },
        404
      );
    }

    const body = await c.req.json();
    const parsed = UpdateEntitySchema.safeParse(body);
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
      if (value !== undefined && ENTITY_COLUMN_ALLOWLIST.has(key)) {
        sets.push(`${key} = ?`);
        values.push(
          key === "tags" || key === "properties"
            ? JSON.stringify(value)
            : (value as SQLQueryBindings)
        );
      }
    }

    values.push(id);
    db.run(`UPDATE entities SET ${sets.join(", ")} WHERE id = ?`, values);

    const updated = db.query("SELECT * FROM entities WHERE id = ?").get(id);
    return c.json({ ok: true, data: deserializeEntity(updated) });
  });

  router.delete("/:id", (c) => {
    const id = c.req.param("id");
    const existing = db.query("SELECT * FROM entities WHERE id = ?").get(id);
    if (!existing) {
      return c.json(
        {
          ok: false,
          error: { code: "NOT_FOUND", message: "Entity not found" },
        },
        404
      );
    }
    db.run("DELETE FROM entities WHERE id = ?", [id]);
    return c.json({ ok: true, data: { deleted: true } });
  });

  return router;
}

function deserializeEntity(row: unknown): Record<string, unknown> {
  const r = row as Record<string, unknown>;
  return {
    ...r,
    properties: JSON.parse((r.properties as string) || "{}"),
    tags: JSON.parse((r.tags as string) || "[]"),
  };
}

import { Hono } from "hono";
import type { Database, SQLQueryBindings } from "bun:sqlite";
import { generateId } from "../../lib/ulid.ts";
import { RegisterFileSchema } from "../../lib/validation.ts";

export function filesRoutes(db: Database) {
  const router = new Hono();

  router.post("/", async (c) => {
    const body = await c.req.json();
    const parsed = RegisterFileSchema.safeParse(body);
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

    const file = parsed.data;
    const id = generateId();
    const now = new Date().toISOString();

    // Compute size and hash from the filesystem
    const bunFile = Bun.file(file.path);
    const size = bunFile.size;

    const hasher = new Bun.CryptoHasher("sha256");
    const content = await bunFile.arrayBuffer();
    hasher.update(content);
    const hash = hasher.digest("hex");

    db.run(
      `INSERT INTO files (id, name, path, mime_type, size, hash, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        file.name,
        file.path,
        file.mime_type ?? null,
        size,
        hash,
        JSON.stringify(file.metadata),
        now,
      ]
    );

    const created = db.query("SELECT * FROM files WHERE id = ?").get(id);
    return c.json({ ok: true, data: deserializeFile(created) }, 201);
  });

  router.get("/", (c) => {
    const mimeType = c.req.query("mime_type");

    let sql = "SELECT * FROM files";
    const conditions: string[] = [];
    const params: SQLQueryBindings[] = [];

    if (mimeType) {
      conditions.push("mime_type = ?");
      params.push(mimeType);
    }

    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }
    sql += " ORDER BY created_at DESC";

    const rows = db.query(sql).all(...params);
    return c.json({
      ok: true,
      data: (rows as Record<string, unknown>[]).map(deserializeFile),
    });
  });

  router.get("/:id", (c) => {
    const row = db
      .query("SELECT * FROM files WHERE id = ?")
      .get(c.req.param("id"));
    if (!row) {
      return c.json(
        {
          ok: false,
          error: { code: "NOT_FOUND", message: "File not found" },
        },
        404
      );
    }
    return c.json({ ok: true, data: deserializeFile(row) });
  });

  router.delete("/:id", (c) => {
    const id = c.req.param("id");
    const existing = db.query("SELECT * FROM files WHERE id = ?").get(id);
    if (!existing) {
      return c.json(
        {
          ok: false,
          error: { code: "NOT_FOUND", message: "File not found" },
        },
        404
      );
    }
    db.run("DELETE FROM files WHERE id = ?", [id]);
    return c.json({ ok: true, data: { deleted: true } });
  });

  return router;
}

function deserializeFile(row: unknown): Record<string, unknown> {
  const r = row as Record<string, unknown>;
  return {
    ...r,
    metadata: JSON.parse((r.metadata as string) || "{}"),
  };
}

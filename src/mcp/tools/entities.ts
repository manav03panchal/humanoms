import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Database, SQLQueryBindings } from "bun:sqlite";
import { generateId } from "../../lib/ulid.ts";

function deserializeEntity(row: unknown): Record<string, unknown> {
  const r = row as Record<string, unknown>;
  return {
    ...r,
    properties: JSON.parse((r.properties as string) || "{}"),
    tags: JSON.parse((r.tags as string) || "[]"),
  };
}

export function registerEntityTools(server: McpServer, db: Database): void {
  // create_entity
  server.tool(
    "create_entity",
    "Create a new entity",
    {
      type: z.string().min(1).max(100),
      name: z.string().min(1).max(500),
      properties: z.record(z.string(), z.unknown()).optional(),
      tags: z.array(z.string()).optional(),
      parent_id: z.string().optional(),
      source_id: z.string().optional(),
    },
    async (params) => {
      const id = generateId();
      const now = new Date().toISOString();
      const properties = params.properties ?? {};
      const tags = params.tags ?? [];

      db.run(
        `INSERT INTO entities (id, type, name, properties, tags, parent_id, source_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          params.type,
          params.name,
          JSON.stringify(properties),
          JSON.stringify(tags),
          params.parent_id ?? null,
          params.source_id ?? null,
          now,
          now,
        ]
      );

      const created = db
        .query("SELECT * FROM entities WHERE id = ?")
        .get(id);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(deserializeEntity(created)),
          },
        ],
      };
    }
  );

  // list_entities
  server.tool(
    "list_entities",
    "List entities with optional filters",
    {
      type: z.string().optional(),
      tags: z.string().optional(),
      q: z.string().optional(),
    },
    async (params) => {
      if (params.q) {
        const rows = db
          .query(
            `SELECT e.* FROM entities e
             JOIN entities_fts fts ON e.rowid = fts.rowid
             WHERE entities_fts MATCH ?
             ORDER BY rank`
          )
          .all(params.q);
        const entities = (rows as Record<string, unknown>[]).map(
          deserializeEntity
        );
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(entities) },
          ],
        };
      }

      let sql = "SELECT * FROM entities";
      const conditions: string[] = [];
      const sqlParams: SQLQueryBindings[] = [];

      if (params.type) {
        conditions.push("type = ?");
        sqlParams.push(params.type);
      }
      if (params.tags) {
        conditions.push("tags LIKE ?");
        sqlParams.push(`%"${params.tags}"%`);
      }

      if (conditions.length > 0) {
        sql += " WHERE " + conditions.join(" AND ");
      }
      sql += " ORDER BY created_at DESC";

      const rows = db.query(sql).all(...sqlParams);
      const entities = (rows as Record<string, unknown>[]).map(
        deserializeEntity
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(entities) }],
      };
    }
  );

  // get_entity
  server.tool(
    "get_entity",
    "Get an entity by ID",
    {
      id: z.string().min(1),
    },
    async (params) => {
      const row = db
        .query("SELECT * FROM entities WHERE id = ?")
        .get(params.id);
      if (!row) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Entity not found" }),
            },
          ],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(deserializeEntity(row)),
          },
        ],
      };
    }
  );

  // update_entity
  server.tool(
    "update_entity",
    "Update an existing entity",
    {
      id: z.string().min(1),
      type: z.string().min(1).max(100).optional(),
      name: z.string().min(1).max(500).optional(),
      properties: z.record(z.string(), z.unknown()).optional(),
      tags: z.array(z.string()).optional(),
      parent_id: z.string().optional(),
      source_id: z.string().optional(),
    },
    async (params) => {
      const existing = db
        .query("SELECT * FROM entities WHERE id = ?")
        .get(params.id);
      if (!existing) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Entity not found" }),
            },
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
            key === "tags" || key === "properties"
              ? JSON.stringify(value)
              : (value as SQLQueryBindings)
          );
        }
      }

      values.push(id);
      db.run(`UPDATE entities SET ${sets.join(", ")} WHERE id = ?`, values);

      const updated = db
        .query("SELECT * FROM entities WHERE id = ?")
        .get(id);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(deserializeEntity(updated)),
          },
        ],
      };
    }
  );

  // search_entities
  server.tool(
    "search_entities",
    "Full-text search entities using FTS5",
    {
      query: z.string().min(1),
    },
    async (params) => {
      const rows = db
        .query(
          `SELECT e.* FROM entities e
           JOIN entities_fts fts ON e.rowid = fts.rowid
           WHERE entities_fts MATCH ?
           ORDER BY rank`
        )
        .all(params.query);
      const entities = (rows as Record<string, unknown>[]).map(
        deserializeEntity
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(entities) }],
      };
    }
  );
}

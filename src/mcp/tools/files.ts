import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Database, SQLQueryBindings } from "bun:sqlite";
import { generateId } from "../../lib/ulid.ts";

function deserializeFile(row: unknown): Record<string, unknown> {
  const r = row as Record<string, unknown>;
  return {
    ...r,
    metadata: JSON.parse((r.metadata as string) || "{}"),
  };
}

export function registerFileTools(server: McpServer, db: Database): void {
  // register_file
  server.tool(
    "register_file",
    "Register a file with name, path, and optional mime_type/metadata. Computes SHA-256 hash.",
    {
      name: z.string().min(1),
      path: z.string().min(1),
      mime_type: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    },
    async (params) => {
      const id = generateId();
      const now = new Date().toISOString();
      const metadata = params.metadata ?? {};

      // Compute size and hash from the filesystem
      const bunFile = Bun.file(params.path);
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
          params.name,
          params.path,
          params.mime_type ?? null,
          size,
          hash,
          JSON.stringify(metadata),
          now,
        ]
      );

      const created = db.query("SELECT * FROM files WHERE id = ?").get(id);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(deserializeFile(created)) },
        ],
      };
    }
  );

  // list_files
  server.tool(
    "list_files",
    "List registered files with optional mime_type filter",
    {
      mime_type: z.string().optional(),
    },
    async (params) => {
      let sql = "SELECT * FROM files";
      const conditions: string[] = [];
      const sqlParams: SQLQueryBindings[] = [];

      if (params.mime_type) {
        conditions.push("mime_type = ?");
        sqlParams.push(params.mime_type);
      }

      if (conditions.length > 0) {
        sql += " WHERE " + conditions.join(" AND ");
      }
      sql += " ORDER BY created_at DESC";

      const rows = db.query(sql).all(...sqlParams);
      const files = (rows as Record<string, unknown>[]).map(deserializeFile);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(files) }],
      };
    }
  );

  // get_file_info
  server.tool(
    "get_file_info",
    "Get a registered file by ID",
    {
      id: z.string().min(1),
    },
    async (params) => {
      const row = db
        .query("SELECT * FROM files WHERE id = ?")
        .get(params.id);
      if (!row) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "File not found" }),
            },
          ],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(deserializeFile(row)),
          },
        ],
      };
    }
  );
}

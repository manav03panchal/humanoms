import type { Database } from "bun:sqlite";
import { generateId } from "../lib/ulid";

export interface AuditEntry {
  actor: string;
  action: string;
  resource_type?: string;
  resource_id?: string;
  details?: Record<string, unknown>;
}

export interface AuditRecord {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: Record<string, unknown>;
}

export interface AuditQueryParams {
  actor?: string;
  action?: string;
  resource_type?: string;
  limit?: number;
  offset?: number;
}

export class AuditLog {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Insert a new audit log entry.
   */
  log(entry: AuditEntry): void {
    const id = generateId();
    const details = entry.details ? JSON.stringify(entry.details) : "{}";

    this.db
      .query(
        "INSERT INTO audit_log (id, actor, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        id,
        entry.actor,
        entry.action,
        entry.resource_type ?? null,
        entry.resource_id ?? null,
        details
      );
  }

  /**
   * Query audit log entries with optional filters, in reverse chronological order.
   */
  query(params: AuditQueryParams = {}): AuditRecord[] {
    const conditions: string[] = [];
    const values: (string | number)[] = [];

    if (params.actor) {
      conditions.push("actor = ?");
      values.push(params.actor);
    }

    if (params.action) {
      conditions.push("action = ?");
      values.push(params.action);
    }

    if (params.resource_type) {
      conditions.push("resource_type = ?");
      values.push(params.resource_type);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "" ;
    const limit = params.limit ?? 100;
    const offset = params.offset ?? 0;

    const sql = `SELECT id, timestamp, actor, action, resource_type, resource_id, details FROM audit_log ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
    values.push(limit, offset);

    const rows = this.db
      .query<
        {
          id: string;
          timestamp: string;
          actor: string;
          action: string;
          resource_type: string | null;
          resource_id: string | null;
          details: string;
        },
        (string | number)[]
      >(sql)
      .all(...values);

    return rows.map((row) => ({
      ...row,
      details: JSON.parse(row.details) as Record<string, unknown>,
    }));
  }
}

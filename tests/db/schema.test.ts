import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../../src/db/schema.ts";

describe("applySchema", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  test("creates all expected tables", () => {
    applySchema(db);

    const tables = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("tasks");
    expect(tableNames).toContain("files");
    expect(tableNames).toContain("entities");
    expect(tableNames).toContain("workflows");
    expect(tableNames).toContain("jobs");
    expect(tableNames).toContain("automations");
    expect(tableNames).toContain("approvals");
    expect(tableNames).toContain("tool_registry");
    expect(tableNames).toContain("secrets");
    expect(tableNames).toContain("audit_log");
    expect(tableNames).toContain("notification_channels");
  });

  test("creates FTS5 virtual table", () => {
    applySchema(db);

    const fts = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='entities_fts'"
      )
      .get() as { name: string } | null;

    expect(fts).not.toBeNull();
    expect(fts!.name).toBe("entities_fts");
  });

  test("creates expected indexes", () => {
    applySchema(db);

    const indexes = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name"
      )
      .all() as { name: string }[];

    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain("idx_tasks_status");
    expect(indexNames).toContain("idx_tasks_due_date");
    expect(indexNames).toContain("idx_entities_type");
    expect(indexNames).toContain("idx_jobs_status");
    expect(indexNames).toContain("idx_jobs_workflow_id");
    expect(indexNames).toContain("idx_audit_log_timestamp");
    expect(indexNames).toContain("idx_audit_log_actor");
    expect(indexNames).toContain("idx_approvals_job_id");
    expect(indexNames).toContain("idx_approvals_token");
  });

  test("creates FTS sync triggers", () => {
    applySchema(db);

    const triggers = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name"
      )
      .all() as { name: string }[];

    const triggerNames = triggers.map((t) => t.name);

    expect(triggerNames).toContain("entities_ai");
    expect(triggerNames).toContain("entities_ad");
    expect(triggerNames).toContain("entities_au");
  });

  test("is idempotent (can be called twice)", () => {
    applySchema(db);
    expect(() => applySchema(db)).not.toThrow();
  });

  test("WAL mode pragma is set (no-op for :memory:)", () => {
    // WAL mode doesn't apply to in-memory databases (returns "memory"),
    // but the PRAGMA call should not throw
    expect(() => applySchema(db)).not.toThrow();
  });
});

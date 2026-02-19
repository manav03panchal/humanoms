import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../../src/db/schema.ts";
import { AuditLog } from "../../src/security/audit.ts";

describe("AuditLog", () => {
  let db: Database;
  let audit: AuditLog;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    audit = new AuditLog(db);
  });

  afterEach(() => {
    db.close();
  });

  test("log inserts an entry", () => {
    audit.log({ actor: "user", action: "task.create" });
    const entries = audit.query();
    expect(entries.length).toBe(1);
    expect(entries[0]!.actor).toBe("user");
    expect(entries[0]!.action).toBe("task.create");
  });

  test("log stores details as JSON", () => {
    audit.log({
      actor: "system",
      action: "job.complete",
      details: { job_id: "j1", duration_ms: 1200 },
    });
    const entries = audit.query();
    expect(entries[0]!.details).toEqual({ job_id: "j1", duration_ms: 1200 });
  });

  test("query filters by actor", () => {
    audit.log({ actor: "user", action: "a" });
    audit.log({ actor: "system", action: "b" });
    const results = audit.query({ actor: "system" });
    expect(results.length).toBe(1);
    expect(results[0]!.actor).toBe("system");
  });

  test("query filters by action", () => {
    audit.log({ actor: "user", action: "task.create" });
    audit.log({ actor: "user", action: "task.delete" });
    const results = audit.query({ action: "task.delete" });
    expect(results.length).toBe(1);
  });

  test("query respects limit and offset", () => {
    for (let i = 0; i < 5; i++) {
      audit.log({ actor: "user", action: `action_${i}` });
    }
    const page = audit.query({ limit: 2, offset: 1 });
    expect(page.length).toBe(2);
  });

  test("query returns entries in reverse chronological order", () => {
    audit.log({ actor: "user", action: "first" });
    audit.log({ actor: "user", action: "second" });
    const entries = audit.query();
    expect(entries[0]!.action).toBe("second");
    expect(entries[1]!.action).toBe("first");
  });
});

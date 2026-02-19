import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../../src/db/schema.ts";
import { Scheduler } from "../../src/scheduler/scheduler.ts";
import { generateId } from "../../src/lib/ulid.ts";

describe("Scheduler", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
  });

  afterEach(() => {
    db.close();
  });

  function insertWorkflow(name = "test-workflow"): string {
    const id = generateId();
    db.query(
      "INSERT INTO workflows (id, name, steps) VALUES (?, ?, ?)"
    ).run(id, name, "[]");
    return id;
  }

  function insertAutomation(
    workflowId: string,
    cron: string,
    enabled = 1
  ): string {
    const id = generateId();
    db.query(
      `INSERT INTO automations (id, name, cron_expression, workflow_id, input, enabled)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, "test-auto", cron, workflowId, "{}", enabled);
    return id;
  }

  test("starts with no automations", () => {
    const triggered: string[] = [];
    const scheduler = new Scheduler(db, (wfId) => triggered.push(wfId));
    scheduler.start();
    expect(scheduler.getScheduledCount()).toBe(0);
    scheduler.stop();
  });

  test("schedules enabled automations", () => {
    const wfId = insertWorkflow();
    insertAutomation(wfId, "0 0 * * *");
    insertAutomation(wfId, "0 12 * * *");

    const scheduler = new Scheduler(db, () => {});
    scheduler.start();
    expect(scheduler.getScheduledCount()).toBe(2);
    scheduler.stop();
  });

  test("skips disabled automations", () => {
    const wfId = insertWorkflow();
    insertAutomation(wfId, "0 0 * * *", 0);

    const scheduler = new Scheduler(db, () => {});
    scheduler.start();
    expect(scheduler.getScheduledCount()).toBe(0);
    scheduler.stop();
  });

  test("unschedule removes a specific automation", () => {
    const wfId = insertWorkflow();
    const autoId = insertAutomation(wfId, "0 0 * * *");

    const scheduler = new Scheduler(db, () => {});
    scheduler.start();
    expect(scheduler.getScheduledCount()).toBe(1);

    scheduler.unschedule(autoId);
    expect(scheduler.getScheduledCount()).toBe(0);
    scheduler.stop();
  });

  test("stop clears all scheduled jobs", () => {
    const wfId = insertWorkflow();
    insertAutomation(wfId, "0 0 * * *");
    insertAutomation(wfId, "0 6 * * *");

    const scheduler = new Scheduler(db, () => {});
    scheduler.start();
    expect(scheduler.getScheduledCount()).toBe(2);

    scheduler.stop();
    expect(scheduler.getScheduledCount()).toBe(0);
  });
});

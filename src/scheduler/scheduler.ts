import type { Database } from "bun:sqlite";
import { Cron } from "croner";
import { createChildLogger } from "../lib/logger.ts";
import { generateId } from "../lib/ulid.ts";

const log = createChildLogger("scheduler");

interface AutomationRow {
  id: string;
  name: string;
  cron_expression: string;
  workflow_id: string;
  input: string;
  enabled: number;
  last_run: string | null;
  next_run: string | null;
}

export class Scheduler {
  private db: Database;
  private jobs: Map<string, Cron> = new Map();
  private onTrigger: (workflowId: string, input: Record<string, unknown>) => void;

  constructor(
    db: Database,
    onTrigger: (workflowId: string, input: Record<string, unknown>) => void
  ) {
    this.db = db;
    this.onTrigger = onTrigger;
  }

  start(): void {
    const automations = this.db
      .query<AutomationRow, []>(
        "SELECT * FROM automations WHERE enabled = 1"
      )
      .all();

    for (const auto of automations) {
      this.schedule(auto);
    }

    log.info({ count: automations.length }, "Scheduler started");
  }

  stop(): void {
    for (const [id, cron] of this.jobs) {
      cron.stop();
      log.debug({ id }, "Stopped automation");
    }
    this.jobs.clear();
    log.info("Scheduler stopped");
  }

  schedule(auto: AutomationRow): void {
    if (this.jobs.has(auto.id)) {
      this.jobs.get(auto.id)!.stop();
    }

    const cron = new Cron(auto.cron_expression, () => {
      log.info({ id: auto.id, name: auto.name }, "Automation triggered");
      const input = JSON.parse(auto.input || "{}") as Record<string, unknown>;
      this.onTrigger(auto.workflow_id, input);

      this.db
        .query("UPDATE automations SET last_run = datetime('now') WHERE id = ?")
        .run(auto.id);
    });

    this.jobs.set(auto.id, cron);
    log.debug({ id: auto.id, cron: auto.cron_expression }, "Scheduled automation");
  }

  unschedule(automationId: string): void {
    const cron = this.jobs.get(automationId);
    if (cron) {
      cron.stop();
      this.jobs.delete(automationId);
    }
  }

  getScheduledCount(): number {
    return this.jobs.size;
  }
}

export class RecurringTaskScheduler {
  private db: Database;
  private jobs: Map<string, Cron> = new Map();

  constructor(db: Database) {
    this.db = db;
  }

  start(): void {
    const tasks = this.db
      .query<
        { id: string; title: string; recurrence: string; tags: string; metadata: string },
        []
      >("SELECT id, title, recurrence, tags, metadata FROM tasks WHERE recurrence IS NOT NULL AND status != 'cancelled'")
      .all();

    for (const task of tasks) {
      this.scheduleRecurring(task);
    }

    log.info({ count: tasks.length }, "Recurring task scheduler started");
  }

  stop(): void {
    for (const cron of this.jobs.values()) {
      cron.stop();
    }
    this.jobs.clear();
  }

  private scheduleRecurring(task: {
    id: string;
    title: string;
    recurrence: string;
    tags: string;
    metadata: string;
  }): void {
    const cron = new Cron(task.recurrence, () => {
      const newId = generateId();
      const now = new Date().toISOString();
      this.db
        .query(
          `INSERT INTO tasks (id, title, description, status, priority, tags, metadata, created_at, updated_at)
           SELECT ?, title, description, 'pending', priority, tags, metadata, ?, ?
           FROM tasks WHERE id = ?`
        )
        .run(newId, now, now, task.id);

      log.info(
        { templateId: task.id, newId, title: task.title },
        "Recurring task instance created"
      );
    });

    this.jobs.set(task.id, cron);
  }

  getScheduledCount(): number {
    return this.jobs.size;
  }
}

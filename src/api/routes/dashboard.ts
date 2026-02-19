import { Hono } from "hono";
import type { Database } from "bun:sqlite";

interface DashboardStats {
  tasks_total: number;
  tasks_pending: number;
  tasks_in_progress: number;
  tasks_completed: number;
  tasks_overdue: number;
  workflows_total: number;
  automations_enabled: number;
  automations_total: number;
  jobs_running: number;
  jobs_queued: number;
  jobs_completed: number;
  jobs_failed: number;
  approvals_pending: number;
  entities_total: number;
}

export function dashboardRoutes(db: Database) {
  const app = new Hono();

  app.get("/stats", (c) => {
    const stats = db
      .query(
        `SELECT
          (SELECT COUNT(*) FROM tasks) as tasks_total,
          (SELECT COUNT(*) FROM tasks WHERE status = 'pending') as tasks_pending,
          (SELECT COUNT(*) FROM tasks WHERE status = 'in_progress') as tasks_in_progress,
          (SELECT COUNT(*) FROM tasks WHERE status = 'completed') as tasks_completed,
          (SELECT COUNT(*) FROM tasks WHERE status = 'pending' AND due_date < datetime('now')) as tasks_overdue,
          (SELECT COUNT(*) FROM workflows) as workflows_total,
          (SELECT COUNT(*) FROM automations WHERE enabled = 1) as automations_enabled,
          (SELECT COUNT(*) FROM automations) as automations_total,
          (SELECT COUNT(*) FROM jobs WHERE status = 'running') as jobs_running,
          (SELECT COUNT(*) FROM jobs WHERE status = 'queued') as jobs_queued,
          (SELECT COUNT(*) FROM jobs WHERE status = 'completed') as jobs_completed,
          (SELECT COUNT(*) FROM jobs WHERE status = 'failed') as jobs_failed,
          (SELECT COUNT(*) FROM approvals WHERE status = 'pending') as approvals_pending,
          (SELECT COUNT(*) FROM entities) as entities_total`
      )
      .get() as DashboardStats;

    const recentJobs = db
      .query(
        `SELECT j.id, j.status, j.created_at, j.completed_at, w.name as workflow_name
         FROM jobs j LEFT JOIN workflows w ON j.workflow_id = w.id
         ORDER BY j.created_at DESC LIMIT 10`
      )
      .all() as Record<string, unknown>[];

    const recentTasks = db
      .query(
        `SELECT id, title, status, priority, due_date, updated_at
         FROM tasks ORDER BY updated_at DESC LIMIT 10`
      )
      .all() as Record<string, unknown>[];

    const automations = db
      .query(
        `SELECT a.id, a.name, a.cron_expression, a.enabled, w.name as workflow_name
         FROM automations a LEFT JOIN workflows w ON a.workflow_id = w.id
         ORDER BY a.created_at DESC`
      )
      .all() as Record<string, unknown>[];

    return c.json({
      ok: true,
      data: { stats, recentJobs, recentTasks, automations },
    });
  });

  return app;
}

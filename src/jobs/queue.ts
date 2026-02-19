import type { Database, SQLQueryBindings } from "bun:sqlite";
import { generateId } from "../lib/ulid.ts";

export interface Job {
  id: string;
  workflow_id: string;
  status: string;
  current_step: number;
  input: Record<string, unknown>;
  context: Record<string, unknown>;
  output: unknown;
  error: string | null;
  retries: number;
  max_retries: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface JobUpdate {
  current_step: number;
  context: Record<string, unknown>;
  output: unknown;
  error: string | null;
  retries: number;
  started_at: string | null;
  completed_at: string | null;
}

interface JobRow {
  id: string;
  workflow_id: string;
  status: string;
  current_step: number;
  input: string;
  context: string;
  output: string | null;
  error: string | null;
  retries: number;
  max_retries: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

function parseJobRow(row: JobRow): Job {
  return {
    ...row,
    input: JSON.parse(row.input) as Record<string, unknown>,
    context: JSON.parse(row.context) as Record<string, unknown>,
    output: row.output ? JSON.parse(row.output) : null,
  };
}

export class JobQueue {
  constructor(private db: Database) {}

  enqueue(workflowId: string, input: Record<string, unknown> = {}): string {
    const id = generateId();
    this.db
      .query(
        `INSERT INTO jobs (id, workflow_id, status, input) VALUES (?, ?, 'queued', ?)`
      )
      .run(id, workflowId, JSON.stringify(input));
    return id;
  }

  dequeue(): Job | null {
    const tx = this.db.transaction(() => {
      const row = this.db
        .query(
          `SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`
        )
        .get() as JobRow | null;

      if (!row) return null;

      this.db
        .query(
          `UPDATE jobs SET status = 'running', started_at = datetime('now') WHERE id = ?`
        )
        .run(row.id);

      // Re-fetch to get updated fields
      const updated = this.db
        .query(`SELECT * FROM jobs WHERE id = ?`)
        .get(row.id) as JobRow;

      return parseJobRow(updated);
    });

    return tx();
  }

  updateStatus(
    jobId: string,
    status: string,
    updates?: Partial<JobUpdate>
  ): void {
    const setClauses: string[] = ["status = ?"];
    const params: SQLQueryBindings[] = [status];

    if (updates) {
      if (updates.current_step !== undefined) {
        setClauses.push("current_step = ?");
        params.push(updates.current_step);
      }
      if (updates.context !== undefined) {
        setClauses.push("context = ?");
        params.push(JSON.stringify(updates.context));
      }
      if (updates.output !== undefined) {
        setClauses.push("output = ?");
        params.push(JSON.stringify(updates.output));
      }
      if (updates.error !== undefined) {
        setClauses.push("error = ?");
        params.push(updates.error);
      }
      if (updates.retries !== undefined) {
        setClauses.push("retries = ?");
        params.push(updates.retries);
      }
      if (updates.started_at !== undefined) {
        setClauses.push("started_at = ?");
        params.push(updates.started_at);
      }
      if (updates.completed_at !== undefined) {
        setClauses.push("completed_at = ?");
        params.push(updates.completed_at);
      }
    }

    params.push(jobId);
    this.db
      .query(`UPDATE jobs SET ${setClauses.join(", ")} WHERE id = ?`)
      .run(...params);
  }

  getJob(jobId: string): Job | null {
    const row = this.db
      .query(`SELECT * FROM jobs WHERE id = ?`)
      .get(jobId) as JobRow | null;

    if (!row) return null;
    return parseJobRow(row);
  }

  getJobsByStatus(status: string): Job[] {
    const rows = this.db
      .query(`SELECT * FROM jobs WHERE status = ? ORDER BY created_at ASC`)
      .all(status) as JobRow[];

    return rows.map(parseJobRow);
  }
}

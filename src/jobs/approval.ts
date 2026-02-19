import type { Database } from "bun:sqlite";
import { generateId } from "../lib/ulid.ts";
import {
  createApprovalToken,
  verifyApprovalToken,
} from "../security/tokens.ts";
import { createChildLogger } from "../lib/logger.ts";

const log = createChildLogger("approval");

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

interface ApprovalRow {
  id: string;
  job_id: string;
  step_index: number;
  status: string;
  context: string;
  token: string;
  expires_at: string;
  responded_at: string | null;
  responded_via: string | null;
  created_at: string;
}

export class ApprovalManager {
  constructor(
    private db: Database,
    private secret: string
  ) {}

  createApproval(
    jobId: string,
    stepIndex: number,
    context: Record<string, unknown>
  ): string {
    const id = generateId();
    const token = createApprovalToken(
      { job_id: jobId, step_index: stepIndex },
      this.secret,
      TWENTY_FOUR_HOURS_MS
    );

    const expiresAt = new Date(Date.now() + TWENTY_FOUR_HOURS_MS).toISOString();

    this.db
      .query(
        `INSERT INTO approvals (id, job_id, step_index, status, context, token, expires_at)
         VALUES (?, ?, ?, 'pending', ?, ?, ?)`
      )
      .run(id, jobId, stepIndex, JSON.stringify(context), token, expiresAt);

    log.info({ approvalId: id, jobId, stepIndex }, "Approval created");

    return token;
  }

  resolveApproval(
    token: string,
    decision: "approved" | "rejected"
  ): { jobId: string; stepIndex: number } | null {
    // Verify the token signature and expiry
    const payload = verifyApprovalToken(token, this.secret);
    if (!payload) {
      log.warn("Invalid or expired approval token");
      return null;
    }

    // Look up the approval record
    const row = this.db
      .query(
        `SELECT * FROM approvals WHERE token = ? AND status = 'pending'`
      )
      .get(token) as ApprovalRow | null;

    if (!row) {
      log.warn("Approval record not found or already resolved");
      return null;
    }

    // Update approval status
    this.db
      .query(
        `UPDATE approvals SET status = ?, responded_at = datetime('now'), responded_via = 'api' WHERE id = ?`
      )
      .run(decision, row.id);

    // Re-queue or fail the job based on the decision
    if (decision === "approved") {
      this.db
        .query(`UPDATE jobs SET status = 'queued' WHERE id = ? AND status = 'awaiting_approval'`)
        .run(row.job_id);
      log.info({ approvalId: row.id, jobId: row.job_id }, "Approval granted — job re-queued");
    } else {
      this.db
        .query(
          `UPDATE jobs SET status = 'failed', error = 'Rejected via approval', completed_at = datetime('now') WHERE id = ? AND status = 'awaiting_approval'`
        )
        .run(row.job_id);
      log.info({ approvalId: row.id, jobId: row.job_id }, "Approval rejected — job failed");
    }

    return { jobId: row.job_id, stepIndex: row.step_index };
  }

  expirePendingApprovals(): number {
    const result = this.db
      .query(
        `UPDATE approvals SET status = 'expired'
         WHERE status = 'pending' AND expires_at < datetime('now')`
      )
      .run();

    const count = result.changes;

    if (count > 0) {
      log.info({ count }, "Expired pending approvals");
    }

    return count;
  }
}

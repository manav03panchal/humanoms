import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../../src/db/schema.ts";
import { ApprovalManager } from "../../src/jobs/approval.ts";

describe("ApprovalManager", () => {
  let db: Database;
  let manager: ApprovalManager;
  const secret = "test-approval-secret";
  const testWorkflowId = "wf_test_001";
  const testJobId = "job_test_001";

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    manager = new ApprovalManager(db, secret);

    // Insert a test workflow and job so foreign key constraints are satisfied
    db.query(
      `INSERT INTO workflows (id, name, steps) VALUES (?, ?, ?)`
    ).run(testWorkflowId, "Test Workflow", "[]");

    db.query(
      `INSERT INTO jobs (id, workflow_id, status) VALUES (?, ?, 'running')`
    ).run(testJobId, testWorkflowId);
  });

  afterEach(() => {
    db.close();
  });

  test("create and resolve an approval", () => {
    const token = manager.createApproval(testJobId, 2, { key: "value" });
    expect(token).toBeTruthy();
    expect(typeof token).toBe("string");

    const result = manager.resolveApproval(token, "approved");
    expect(result).not.toBeNull();
    expect(result!.jobId).toBe(testJobId);
    expect(result!.stepIndex).toBe(2);

    // Verify the approval record was updated
    const row = db
      .query(`SELECT * FROM approvals WHERE token = ?`)
      .get(token) as { status: string; responded_at: string | null };
    expect(row.status).toBe("approved");
    expect(row.responded_at).not.toBeNull();
  });

  test("resolve with 'rejected' decision", () => {
    const token = manager.createApproval(testJobId, 0, {});
    const result = manager.resolveApproval(token, "rejected");

    expect(result).not.toBeNull();
    expect(result!.jobId).toBe(testJobId);

    const row = db
      .query(`SELECT * FROM approvals WHERE token = ?`)
      .get(token) as { status: string };
    expect(row.status).toBe("rejected");
  });

  test("resolve with wrong token returns null", () => {
    manager.createApproval(testJobId, 0, {});
    const result = manager.resolveApproval("completely-invalid-token", "approved");
    expect(result).toBeNull();
  });

  test("resolving the same token twice returns null the second time", () => {
    const token = manager.createApproval(testJobId, 1, {});

    const first = manager.resolveApproval(token, "approved");
    expect(first).not.toBeNull();

    const second = manager.resolveApproval(token, "approved");
    expect(second).toBeNull();
  });

  test("expirePendingApprovals marks old approvals", () => {
    // Create an approval, then manually backdate its expires_at
    const token = manager.createApproval(testJobId, 0, {});

    db.query(
      `UPDATE approvals SET expires_at = datetime('now', '-1 hour') WHERE token = ?`
    ).run(token);

    const count = manager.expirePendingApprovals();
    expect(count).toBe(1);

    const row = db
      .query(`SELECT status FROM approvals WHERE token = ?`)
      .get(token) as { status: string };
    expect(row.status).toBe("expired");
  });

  test("expirePendingApprovals does not touch non-pending approvals", () => {
    const token = manager.createApproval(testJobId, 0, {});

    // Resolve it first
    manager.resolveApproval(token, "approved");

    // Backdate it
    db.query(
      `UPDATE approvals SET expires_at = datetime('now', '-1 hour') WHERE token = ?`
    ).run(token);

    const count = manager.expirePendingApprovals();
    expect(count).toBe(0);
  });

  test("expirePendingApprovals returns 0 when nothing to expire", () => {
    const count = manager.expirePendingApprovals();
    expect(count).toBe(0);
  });
});

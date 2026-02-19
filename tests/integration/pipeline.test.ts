import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../../src/db/schema.ts";
import { JobQueue } from "../../src/jobs/queue.ts";
import { WorkflowExecutor } from "../../src/jobs/executor.ts";
import { PipelineContext } from "../../src/jobs/context.ts";
import { ApprovalManager } from "../../src/jobs/approval.ts";
import { generateId } from "../../src/lib/ulid.ts";

describe("Workflow Pipeline Integration", () => {
  let db: Database;
  let queue: JobQueue;
  let executor: WorkflowExecutor;
  const approvalSecret = "test-secret-key";

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    queue = new JobQueue(db);
    executor = new WorkflowExecutor(db, queue, approvalSecret);
  });

  afterEach(() => {
    db.close();
  });

  function insertWorkflow(
    name: string,
    steps: unknown[]
  ): string {
    const id = generateId();
    db.query(
      "INSERT INTO workflows (id, name, steps) VALUES (?, ?, ?)"
    ).run(id, name, JSON.stringify(steps));
    return id;
  }

  test("enqueue -> dequeue -> execute -> complete", async () => {
    const workflowId = insertWorkflow("simple", [
      { tool: "echo", input: { message: "hello" } },
    ]);

    // Enqueue
    const jobId = queue.enqueue(workflowId, { greeting: "hello" });
    expect(jobId).toBeDefined();

    // Verify queued
    const queued = queue.getJob(jobId);
    expect(queued?.status).toBe("queued");

    // Dequeue
    const job = queue.dequeue();
    expect(job).not.toBeNull();
    expect(job!.id).toBe(jobId);
    expect(job!.status).toBe("running");

    // Execute
    await executor.executeJob(job!);

    // Verify completed
    const completed = queue.getJob(jobId);
    expect(completed?.status).toBe("completed");
    expect(completed?.completed_at).not.toBeNull();
  });

  test("multi-step workflow progresses through all steps", async () => {
    const workflowId = insertWorkflow("multi", [
      { tool: "step1", input: { data: "a" } },
      { tool: "step2", input: { data: "b" } },
      { tool: "step3", input: { data: "c" } },
    ]);

    const jobId = queue.enqueue(workflowId);
    const job = queue.dequeue()!;

    await executor.executeJob(job);

    const result = queue.getJob(jobId);
    expect(result?.status).toBe("completed");
    expect(result?.current_step).toBe(3);
  });

  test("approval step pauses the job", async () => {
    const workflowId = insertWorkflow("with-approval", [
      { tool: "auto-step", input: {} },
      { tool: "dangerous-step", input: {}, trust_level: "approve" },
      { tool: "final-step", input: {} },
    ]);

    const jobId = queue.enqueue(workflowId);
    const job = queue.dequeue()!;

    await executor.executeJob(job);

    // Job should be paused at step 1 (the approval step)
    const paused = queue.getJob(jobId);
    expect(paused?.status).toBe("awaiting_approval");
    expect(paused?.current_step).toBe(1);

    // Verify an approval record was created
    const approval = db
      .query("SELECT * FROM approvals WHERE job_id = ?")
      .get(jobId) as { token: string; status: string } | null;
    expect(approval).not.toBeNull();
    expect(approval!.status).toBe("pending");
  });

  test("approval -> resume -> complete", async () => {
    const workflowId = insertWorkflow("approval-flow", [
      { tool: "step1", input: {} },
      { tool: "step2", input: {}, trust_level: "approve" },
      { tool: "step3", input: {} },
    ]);

    // First run — pauses at approval
    const jobId = queue.enqueue(workflowId);
    const job = queue.dequeue()!;
    await executor.executeJob(job);

    expect(queue.getJob(jobId)?.status).toBe("awaiting_approval");

    // Resolve the approval
    const approvalManager = new ApprovalManager(db, approvalSecret);
    const approval = db
      .query("SELECT token FROM approvals WHERE job_id = ? AND status = 'pending'")
      .get(jobId) as { token: string };

    const result = approvalManager.resolveApproval(approval.token, "approved");
    expect(result).not.toBeNull();
    expect(result!.jobId).toBe(jobId);

    // Re-queue the job at the step AFTER approval
    queue.updateStatus(jobId, "queued", {
      current_step: result!.stepIndex + 1,
    });

    // Dequeue and continue execution
    const resumed = queue.dequeue()!;
    expect(resumed.current_step).toBe(2);
    await executor.executeJob(resumed);

    // Should complete now
    const final = queue.getJob(jobId);
    expect(final?.status).toBe("completed");
    expect(final?.current_step).toBe(3);
  });

  test("rejected approval does not re-queue", async () => {
    const workflowId = insertWorkflow("reject-flow", [
      { tool: "step1", input: {}, trust_level: "approve" },
    ]);

    const jobId = queue.enqueue(workflowId);
    const job = queue.dequeue()!;
    await executor.executeJob(job);

    const approvalManager = new ApprovalManager(db, approvalSecret);
    const approval = db
      .query("SELECT token FROM approvals WHERE job_id = ? AND status = 'pending'")
      .get(jobId) as { token: string };

    const result = approvalManager.resolveApproval(approval.token, "rejected");
    expect(result).not.toBeNull();

    // Verify the approval is rejected
    const row = db
      .query("SELECT status FROM approvals WHERE job_id = ?")
      .get(jobId) as { status: string };
    expect(row.status).toBe("rejected");

    // Job remains in awaiting_approval (caller decides what to do)
    expect(queue.getJob(jobId)?.status).toBe("awaiting_approval");
  });

  test("skip failure policy continues to next step", async () => {
    // We can test the skip policy by checking that current_step advances
    // even though steps are stubs (they won't actually fail in this test,
    // but we verify the flow completes)
    const workflowId = insertWorkflow("skip-policy", [
      { tool: "step1", input: {}, on_failure: "skip" },
      { tool: "step2", input: {} },
    ]);

    const jobId = queue.enqueue(workflowId);
    const job = queue.dequeue()!;
    await executor.executeJob(job);

    const result = queue.getJob(jobId);
    expect(result?.status).toBe("completed");
  });

  test("workflow not found fails the job", async () => {
    // Temporarily disable FK checks to insert a job with a bogus workflow_id
    db.exec("PRAGMA foreign_keys = OFF");
    const jobId = queue.enqueue("nonexistent-workflow-id");
    db.exec("PRAGMA foreign_keys = ON");

    const job = queue.dequeue()!;
    await executor.executeJob(job);

    const result = queue.getJob(jobId);
    expect(result?.status).toBe("failed");
    expect(result?.error).toContain("Workflow not found");
  });

  test("pipeline context flows through steps", () => {
    const ctx = new PipelineContext({ name: "test" });
    expect(ctx.get("name")).toBe("test");

    ctx.set("result", "done");
    expect(ctx.get("result")).toBe("done");

    const json = ctx.toJSON();
    expect(json.name).toBe("test");
    expect(json.result).toBe("done");
  });

  test("output_mapping copies tool output to context", () => {
    const ctx = new PipelineContext({});
    const output = { url: "https://example.com", status: 200 };
    const mapping = { saved_url: "url", http_status: "status" };

    ctx.applyOutputMapping(mapping, output);
    expect(ctx.get("saved_url")).toBe("https://example.com");
    expect(ctx.get("http_status")).toBe(200);
  });

  test("job queue FIFO ordering", () => {
    const wfId = insertWorkflow("fifo", [{ tool: "echo", input: {} }]);

    const id1 = queue.enqueue(wfId, { order: 1 });
    const id2 = queue.enqueue(wfId, { order: 2 });
    const id3 = queue.enqueue(wfId, { order: 3 });

    expect(queue.dequeue()!.id).toBe(id1);
    expect(queue.dequeue()!.id).toBe(id2);
    expect(queue.dequeue()!.id).toBe(id3);
    expect(queue.dequeue()).toBeNull();
  });

  test("getJobsByStatus returns filtered list", () => {
    const wfId = insertWorkflow("status-test", [{ tool: "echo", input: {} }]);

    queue.enqueue(wfId);
    queue.enqueue(wfId);
    queue.dequeue(); // moves first to running

    const queued = queue.getJobsByStatus("queued");
    expect(queued.length).toBe(1);

    const running = queue.getJobsByStatus("running");
    expect(running.length).toBe(1);
  });

  test("approval expiration", () => {
    const approvalManager = new ApprovalManager(db, approvalSecret);

    // Need a real workflow + job for FK constraints
    const wfId = insertWorkflow("expire-wf", [{ tool: "t", input: {} }]);
    const jobId = queue.enqueue(wfId);

    // Create approval with very short TTL (already expired by manipulation)
    const token = approvalManager.createApproval(jobId, 0, {});

    // Manually set expires_at to past
    db.query("UPDATE approvals SET expires_at = datetime('now', '-1 hour')").run();

    const expired = approvalManager.expirePendingApprovals();
    expect(expired).toBe(1);

    // Token should no longer resolve (record is expired)
    const row = db
      .query("SELECT status FROM approvals WHERE token = ?")
      .get(token) as { status: string };
    expect(row.status).toBe("expired");
  });
});

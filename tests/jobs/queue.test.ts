import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../../src/db/schema.ts";
import { JobQueue } from "../../src/jobs/queue.ts";

describe("JobQueue", () => {
  let db: Database;
  let queue: JobQueue;
  const testWorkflowId = "wf_test_001";

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    queue = new JobQueue(db);

    // Insert a test workflow so foreign key constraints are satisfied
    db.query(
      `INSERT INTO workflows (id, name, steps) VALUES (?, ?, ?)`
    ).run(testWorkflowId, "Test Workflow", '[]');
  });

  afterEach(() => {
    db.close();
  });

  test("enqueue creates a job with 'queued' status", () => {
    const jobId = queue.enqueue(testWorkflowId, { file: "test.pdf" });
    expect(jobId).toBeTruthy();

    const job = queue.getJob(jobId);
    expect(job).not.toBeNull();
    expect(job!.status).toBe("queued");
    expect(job!.workflow_id).toBe(testWorkflowId);
    expect(job!.input).toEqual({ file: "test.pdf" });
    expect(job!.current_step).toBe(0);
    expect(job!.retries).toBe(0);
    expect(job!.max_retries).toBe(3);
  });

  test("enqueue defaults to empty input", () => {
    const jobId = queue.enqueue(testWorkflowId);
    const job = queue.getJob(jobId);
    expect(job!.input).toEqual({});
  });

  test("dequeue picks the oldest queued job and sets it to 'running'", () => {
    const id1 = queue.enqueue(testWorkflowId, { order: 1 });
    const _id2 = queue.enqueue(testWorkflowId, { order: 2 });

    const job = queue.dequeue();
    expect(job).not.toBeNull();
    expect(job!.id).toBe(id1);
    expect(job!.status).toBe("running");
    expect(job!.started_at).not.toBeNull();
  });

  test("dequeue returns null when queue is empty", () => {
    const job = queue.dequeue();
    expect(job).toBeNull();
  });

  test("dequeue returns null when all jobs are already running", () => {
    queue.enqueue(testWorkflowId);
    queue.dequeue(); // takes the only queued job

    const job = queue.dequeue();
    expect(job).toBeNull();
  });

  test("updateStatus changes job status", () => {
    const jobId = queue.enqueue(testWorkflowId);
    queue.updateStatus(jobId, "failed", { error: "Something went wrong" });

    const job = queue.getJob(jobId);
    expect(job!.status).toBe("failed");
    expect(job!.error).toBe("Something went wrong");
  });

  test("updateStatus can update multiple fields", () => {
    const jobId = queue.enqueue(testWorkflowId);
    queue.updateStatus(jobId, "running", {
      current_step: 2,
      context: { partial: "data" },
      retries: 1,
    });

    const job = queue.getJob(jobId);
    expect(job!.status).toBe("running");
    expect(job!.current_step).toBe(2);
    expect(job!.context).toEqual({ partial: "data" });
    expect(job!.retries).toBe(1);
  });

  test("getJob returns null for nonexistent ID", () => {
    const job = queue.getJob("nonexistent_id");
    expect(job).toBeNull();
  });

  test("getJob returns parsed JSON fields", () => {
    const jobId = queue.enqueue(testWorkflowId, { key: "value" });
    queue.updateStatus(jobId, "completed", {
      output: { result: "done" },
      context: { step1: "ok" },
    });

    const job = queue.getJob(jobId);
    expect(job!.input).toEqual({ key: "value" });
    expect(job!.context).toEqual({ step1: "ok" });
    expect(job!.output).toEqual({ result: "done" });
  });

  test("getJobsByStatus returns matching jobs", () => {
    queue.enqueue(testWorkflowId, { a: 1 });
    queue.enqueue(testWorkflowId, { a: 2 });
    queue.enqueue(testWorkflowId, { a: 3 });

    // Dequeue one (makes it "running")
    queue.dequeue();

    const queued = queue.getJobsByStatus("queued");
    expect(queued.length).toBe(2);

    const running = queue.getJobsByStatus("running");
    expect(running.length).toBe(1);

    const completed = queue.getJobsByStatus("completed");
    expect(completed.length).toBe(0);
  });
});

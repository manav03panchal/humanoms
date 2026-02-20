import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../../src/db/schema.ts";
import { createApp } from "../../src/api/server.ts";
import { stubProvider } from "../helpers/stub-provider.ts";
import { generateId } from "../../src/lib/ulid.ts";
import { JobQueue } from "../../src/jobs/queue.ts";

describe("Jobs API", () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;
  let workflowId: string;
  let queue: JobQueue;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    app = createApp({ db, apiKeyHash: null, chatProvider: stubProvider });
    queue = new JobQueue(db);

    // Insert a workflow to reference
    workflowId = generateId();
    db.query(
      "INSERT INTO workflows (id, name, steps) VALUES (?, ?, ?)"
    ).run(workflowId, "test-wf", JSON.stringify([{ tool: "echo", input: {} }]));
  });

  afterEach(() => {
    db.close();
  });

  const req = (path: string, init?: RequestInit) =>
    app.request(`http://localhost/api/v1/jobs${path}`, init);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Any = any;

  test("GET lists all jobs", async () => {
    queue.enqueue(workflowId, { a: 1 });
    queue.enqueue(workflowId, { b: 2 });

    const res = await req("");
    expect(res.status).toBe(200);
    const body: Any = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.length).toBe(2);
  });

  test("GET filters by status", async () => {
    queue.enqueue(workflowId);
    queue.enqueue(workflowId);
    queue.dequeue(); // moves one to running

    const res = await req("?status=queued");
    const body: Any = await res.json();
    expect(body.data.length).toBe(1);
  });

  test("GET filters by workflow_id", async () => {
    const otherWf = generateId();
    db.query("INSERT INTO workflows (id, name, steps) VALUES (?, ?, ?)").run(
      otherWf,
      "other-wf",
      "[]"
    );

    queue.enqueue(workflowId);
    queue.enqueue(otherWf);

    const res = await req(`?workflow_id=${workflowId}`);
    const body: Any = await res.json();
    expect(body.data.length).toBe(1);
  });

  test("GET /:id returns a job", async () => {
    const jobId = queue.enqueue(workflowId, { test: true });

    const res = await req(`/${jobId}`);
    expect(res.status).toBe(200);
    const body: Any = await res.json();
    expect(body.data.id).toBe(jobId);
    expect(body.data.input).toEqual({ test: true });
  });

  test("GET /:id returns 404 for missing job", async () => {
    const res = await req("/nonexistent");
    expect(res.status).toBe(404);
  });
});

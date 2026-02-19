import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../../src/db/schema.ts";
import { createApp } from "../../src/api/server.ts";

describe("Workflows API", () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    app = createApp({ db, apiKeyHash: null });
  });

  afterEach(() => {
    db.close();
  });

  const req = (path: string, init?: RequestInit) =>
    app.request(`http://localhost/api/v1/workflows${path}`, init);

  const post = (body: unknown) => ({
    method: "POST" as const,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Any = any;

  const sampleWorkflow = {
    name: "test-workflow",
    description: "A test workflow",
    steps: [
      {
        name: "Step 1",
        tool: "brave_search",
        server: "brave-search",
        input: { query: "test" },
        trust_level: "auto",
      },
    ],
  };

  test("POST creates a workflow", async () => {
    const res = await req("", post(sampleWorkflow));
    expect(res.status).toBe(201);
    const body: Any = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.name).toBe("test-workflow");
    expect(body.data.steps).toBeArray();
    expect(body.data.steps.length).toBe(1);
  });

  test("POST rejects missing name", async () => {
    const res = await req("", post({ steps: [] }));
    expect(res.status).toBe(400);
  });

  test("GET lists workflows", async () => {
    await req("", post(sampleWorkflow));
    await req("", post({ ...sampleWorkflow, name: "wf-2" }));

    const res = await req("");
    const body: Any = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.length).toBe(2);
  });

  test("GET /:id returns a workflow", async () => {
    const createRes = await req("", post(sampleWorkflow));
    const created: Any = await createRes.json();

    const res = await req(`/${created.data.id}`);
    expect(res.status).toBe(200);
    const body: Any = await res.json();
    expect(body.data.name).toBe("test-workflow");
    expect(body.data.steps[0].tool).toBe("brave_search");
  });

  test("GET /:id returns 404", async () => {
    const res = await req("/nonexistent");
    expect(res.status).toBe(404);
  });

  test("PATCH /:id updates a workflow", async () => {
    const createRes = await req("", post(sampleWorkflow));
    const created: Any = await createRes.json();

    const res = await req(`/${created.data.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "Updated desc" }),
    });
    expect(res.status).toBe(200);
    const body: Any = await res.json();
    expect(body.data.description).toBe("Updated desc");
  });

  test("DELETE /:id deletes a workflow", async () => {
    const createRes = await req("", post(sampleWorkflow));
    const created: Any = await createRes.json();

    const res = await req(`/${created.data.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);

    const getRes = await req(`/${created.data.id}`);
    expect(getRes.status).toBe(404);
  });

  test("POST /:id/trigger creates a job", async () => {
    const createRes = await req("", post(sampleWorkflow));
    const created: Any = await createRes.json();

    const triggerRes = await req(
      `/${created.data.id}/trigger`,
      post({ input: { key: "value" } })
    );
    expect(triggerRes.status).toBe(201);
    const body: Any = await triggerRes.json();
    expect(body.ok).toBe(true);
    expect(body.data.id).toBeDefined();
    expect(body.data.status).toBe("queued");
  });

  test("POST /:id/trigger returns 404 for missing workflow", async () => {
    const res = await req("/nonexistent/trigger", post({ input: {} }));
    expect(res.status).toBe(404);
  });

  test("GET /:id/jobs lists jobs for a workflow", async () => {
    const createRes = await req("", post(sampleWorkflow));
    const created: Any = await createRes.json();

    // Trigger twice
    await req(`/${created.data.id}/trigger`, post({ input: {} }));
    await req(`/${created.data.id}/trigger`, post({ input: {} }));

    const res = await req(`/${created.data.id}/jobs`);
    const body: Any = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.length).toBe(2);
  });
});

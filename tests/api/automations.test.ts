import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../../src/db/schema.ts";
import { createApp } from "../../src/api/server.ts";
import { generateId } from "../../src/lib/ulid.ts";

describe("Automations API", () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;
  let workflowId: string;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    app = createApp({ db, apiKeyHash: null });

    // Insert a workflow to reference
    workflowId = generateId();
    db.query(
      "INSERT INTO workflows (id, name, steps) VALUES (?, ?, ?)"
    ).run(workflowId, "test-wf", "[]");
  });

  afterEach(() => {
    db.close();
  });

  const req = (path: string, init?: RequestInit) =>
    app.request(`http://localhost/api/v1/automations${path}`, init);

  const post = (body: unknown) => ({
    method: "POST" as const,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Any = any;

  test("POST creates an automation", async () => {
    const res = await req(
      "",
      post({
        name: "daily-sync",
        description: "Sync every day",
        cron_expression: "0 9 * * *",
        workflow_id: workflowId,
      })
    );
    expect(res.status).toBe(201);
    const body: Any = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.name).toBe("daily-sync");
    expect(body.data.enabled).toBe(true);
  });

  test("GET lists automations", async () => {
    await req(
      "",
      post({
        name: "auto-1",
        description: "d",
        cron_expression: "* * * * *",
        workflow_id: workflowId,
      })
    );
    await req(
      "",
      post({
        name: "auto-2",
        description: "d",
        cron_expression: "* * * * *",
        workflow_id: workflowId,
      })
    );

    const res = await req("");
    const body: Any = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.length).toBe(2);
  });

  test("GET /:id returns an automation", async () => {
    const createRes = await req(
      "",
      post({
        name: "get-me",
        description: "d",
        cron_expression: "0 0 * * *",
        workflow_id: workflowId,
      })
    );
    const created: Any = await createRes.json();

    const res = await req(`/${created.data.id}`);
    expect(res.status).toBe(200);
    const body: Any = await res.json();
    expect(body.data.name).toBe("get-me");
  });

  test("PATCH /:id updates an automation", async () => {
    const createRes = await req(
      "",
      post({
        name: "update-me",
        description: "d",
        cron_expression: "0 0 * * *",
        workflow_id: workflowId,
      })
    );
    const created: Any = await createRes.json();

    const res = await req(`/${created.data.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);
    const body: Any = await res.json();
    expect(body.data.enabled).toBe(false);
  });

  test("DELETE /:id deletes an automation", async () => {
    const createRes = await req(
      "",
      post({
        name: "delete-me",
        description: "d",
        cron_expression: "0 0 * * *",
        workflow_id: workflowId,
      })
    );
    const created: Any = await createRes.json();

    const res = await req(`/${created.data.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);

    const getRes = await req(`/${created.data.id}`);
    expect(getRes.status).toBe(404);
  });
});

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../../src/db/schema.ts";
import { createApp } from "../../src/api/server.ts";
import { stubProvider } from "../helpers/stub-provider.ts";

describe("Tasks API", () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    app = createApp({ db, apiKeyHash: null, chatProvider: stubProvider });
  });

  afterEach(() => {
    db.close();
  });

  // No trailing slash — Hono treats /path and /path/ as different routes
  const req = (path: string, init?: RequestInit) =>
    app.request(`http://localhost/api/v1/tasks${path}`, init);

  const post = (body: unknown) => ({
    method: "POST" as const,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Any = any;

  test("POST creates a task", async () => {
    const res = await req("", post({ title: "Test task" }));
    expect(res.status).toBe(201);
    const body: Any = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.title).toBe("Test task");
    expect(body.data.status).toBe("pending");
    expect(body.data.id).toBeDefined();
  });

  test("POST rejects missing title", async () => {
    const res = await req("", post({}));
    expect(res.status).toBe(400);
    const body: Any = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  test("GET lists all tasks", async () => {
    await req("", post({ title: "Task 1" }));
    await req("", post({ title: "Task 2" }));

    const res = await req("");
    expect(res.status).toBe(200);
    const body: Any = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.length).toBe(2);
  });

  test("GET filters by status", async () => {
    await req("", post({ title: "Pending" }));
    await req("", post({ title: "Done", status: "completed" }));

    const res = await req("?status=completed");
    const body: Any = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].title).toBe("Done");
  });

  test("GET /:id returns a single task", async () => {
    const createRes = await req("", post({ title: "Specific" }));
    const created: Any = await createRes.json();
    const id = created.data.id;

    const res = await req(`/${id}`);
    expect(res.status).toBe(200);
    const body: Any = await res.json();
    expect(body.data.title).toBe("Specific");
  });

  test("GET /:id returns 404 for missing task", async () => {
    const res = await req("/nonexistent");
    expect(res.status).toBe(404);
  });

  test("PATCH /:id updates a task", async () => {
    const createRes = await req("", post({ title: "Original" }));
    const created: Any = await createRes.json();
    const id = created.data.id;

    const res = await req(`/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Updated" }),
    });
    expect(res.status).toBe(200);
    const body: Any = await res.json();
    expect(body.data.title).toBe("Updated");
  });

  test("PATCH /:id returns 404 for missing task", async () => {
    const res = await req("/nonexistent", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Nope" }),
    });
    expect(res.status).toBe(404);
  });

  test("DELETE /:id deletes a task", async () => {
    const createRes = await req("", post({ title: "To Delete" }));
    const created: Any = await createRes.json();
    const id = created.data.id;

    const res = await req(`/${id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const body: Any = await res.json();
    expect(body.data.deleted).toBe(true);

    const getRes = await req(`/${id}`);
    expect(getRes.status).toBe(404);
  });

  test("DELETE /:id returns 404 for missing task", async () => {
    const res = await req("/nonexistent", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  test("tags are stored and returned as arrays", async () => {
    const createRes = await req(
      "",
      post({ title: "Tagged", tags: ["work", "urgent"] })
    );
    const created: Any = await createRes.json();
    expect(created.data.tags).toEqual(["work", "urgent"]);

    const getRes = await req(`/${created.data.id}`);
    const body: Any = await getRes.json();
    expect(body.data.tags).toEqual(["work", "urgent"]);
  });

  test("metadata is stored and returned as object", async () => {
    const createRes = await req(
      "",
      post({ title: "Meta", metadata: { source: "email" } })
    );
    const created: Any = await createRes.json();
    expect(created.data.metadata).toEqual({ source: "email" });
  });
});

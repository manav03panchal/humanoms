import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../../src/db/schema.ts";
import { createApp } from "../../src/api/server.ts";
import { stubProvider } from "../helpers/stub-provider.ts";

describe("Entities API", () => {
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
    app.request(`http://localhost/api/v1/entities${path}`, init);

  const post = (body: unknown) => ({
    method: "POST" as const,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Any = any;

  test("POST creates an entity", async () => {
    const res = await req("", post({ type: "person", name: "Alice" }));
    expect(res.status).toBe(201);
    const body: Any = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.type).toBe("person");
    expect(body.data.name).toBe("Alice");
    expect(body.data.id).toBeDefined();
  });

  test("POST rejects missing type", async () => {
    const res = await req("", post({ name: "No Type" }));
    expect(res.status).toBe(400);
  });

  test("POST rejects missing name", async () => {
    const res = await req("", post({ type: "thing" }));
    expect(res.status).toBe(400);
  });

  test("GET lists all entities", async () => {
    await req("", post({ type: "person", name: "Alice" }));
    await req("", post({ type: "place", name: "NYC" }));

    const res = await req("");
    const body: Any = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.length).toBe(2);
  });

  test("GET filters by type", async () => {
    await req("", post({ type: "person", name: "Alice" }));
    await req("", post({ type: "place", name: "NYC" }));

    const res = await req("?type=person");
    const body: Any = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].name).toBe("Alice");
  });

  test("GET /:id returns a single entity", async () => {
    const createRes = await req("", post({ type: "person", name: "Bob" }));
    const created: Any = await createRes.json();

    const res = await req(`/${created.data.id}`);
    expect(res.status).toBe(200);
    const body: Any = await res.json();
    expect(body.data.name).toBe("Bob");
  });

  test("GET /:id returns 404 for missing entity", async () => {
    const res = await req("/nonexistent");
    expect(res.status).toBe(404);
  });

  test("PATCH /:id updates an entity", async () => {
    const createRes = await req(
      "",
      post({ type: "person", name: "Charlie" })
    );
    const created: Any = await createRes.json();

    const res = await req(`/${created.data.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Charles" }),
    });
    expect(res.status).toBe(200);
    const body: Any = await res.json();
    expect(body.data.name).toBe("Charles");
  });

  test("DELETE /:id deletes an entity", async () => {
    const createRes = await req(
      "",
      post({ type: "person", name: "To Delete" })
    );
    const created: Any = await createRes.json();

    const res = await req(`/${created.data.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const body: Any = await res.json();
    expect(body.data.deleted).toBe(true);

    const getRes = await req(`/${created.data.id}`);
    expect(getRes.status).toBe(404);
  });

  test("properties are stored and returned as objects", async () => {
    const createRes = await req(
      "",
      post({
        type: "person",
        name: "Eve",
        properties: { email: "eve@example.com", age: 30 },
      })
    );
    const body: Any = await createRes.json();
    expect(body.data.properties).toEqual({
      email: "eve@example.com",
      age: 30,
    });
  });

  test("tags filter works", async () => {
    await req(
      "",
      post({ type: "person", name: "Alice", tags: ["vip", "client"] })
    );
    await req("", post({ type: "person", name: "Bob", tags: ["staff"] }));

    const res = await req("?tags=vip");
    const body: Any = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].name).toBe("Alice");
  });

  test("FTS search works via ?q=", async () => {
    await req(
      "",
      post({
        type: "document",
        name: "Machine Learning Paper",
        properties: { abstract: "Neural networks and deep learning" },
      })
    );
    await req("", post({ type: "document", name: "Cooking Recipes" }));

    const res = await req("?q=machine+learning");
    const body: Any = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.length).toBe(1);
    expect(body.data[0].name).toBe("Machine Learning Paper");
  });
});

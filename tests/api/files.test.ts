import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../../src/db/schema.ts";
import { createApp } from "../../src/api/server.ts";
import { stubProvider } from "../helpers/stub-provider.ts";
import { join } from "path";
import { tmpdir } from "os";
import { unlinkSync, writeFileSync } from "fs";

describe("Files API", () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;
  let tmpFile: string;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    app = createApp({ db, apiKeyHash: null, chatProvider: stubProvider });

    // Create a temporary file for registration tests
    tmpFile = join(tmpdir(), `humanoms-test-${Date.now()}.txt`);
    writeFileSync(tmpFile, "hello world");
  });

  afterEach(() => {
    db.close();
    try {
      unlinkSync(tmpFile);
    } catch {
      // ignore if already removed
    }
  });

  const req = (path: string, init?: RequestInit) =>
    app.request(`http://localhost/api/v1/files${path}`, init);

  const post = (body: unknown) => ({
    method: "POST" as const,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Any = any;

  test("POST registers a file", async () => {
    const res = await req(
      "",
      post({ name: "test.txt", path: tmpFile, mime_type: "text/plain" })
    );
    expect(res.status).toBe(201);
    const body: Any = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.name).toBe("test.txt");
    expect(body.data.path).toBe(tmpFile);
    expect(body.data.mime_type).toBe("text/plain");
    expect(body.data.id).toBeDefined();
    expect(body.data.hash).toBeDefined();
    expect(body.data.size).toBeGreaterThan(0);
  });

  test("POST rejects missing name", async () => {
    const res = await req("", post({ path: tmpFile }));
    expect(res.status).toBe(400);
    const body: Any = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  test("POST rejects missing path", async () => {
    const res = await req("", post({ name: "test.txt" }));
    expect(res.status).toBe(400);
    const body: Any = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  test("GET lists all files", async () => {
    await req(
      "",
      post({ name: "file1.txt", path: tmpFile, mime_type: "text/plain" })
    );
    await req(
      "",
      post({ name: "file2.txt", path: tmpFile, mime_type: "text/plain" })
    );

    const res = await req("");
    expect(res.status).toBe(200);
    const body: Any = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.length).toBe(2);
  });

  test("GET filters by mime_type", async () => {
    await req(
      "",
      post({ name: "doc.txt", path: tmpFile, mime_type: "text/plain" })
    );
    await req(
      "",
      post({ name: "pic.png", path: tmpFile, mime_type: "image/png" })
    );

    const res = await req("?mime_type=text/plain");
    const body: Any = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].name).toBe("doc.txt");
  });

  test("GET /:id returns a single file", async () => {
    const createRes = await req(
      "",
      post({ name: "specific.txt", path: tmpFile })
    );
    const created: Any = await createRes.json();
    const id = created.data.id;

    const res = await req(`/${id}`);
    expect(res.status).toBe(200);
    const body: Any = await res.json();
    expect(body.data.name).toBe("specific.txt");
  });

  test("GET /:id returns 404 for missing file", async () => {
    const res = await req("/nonexistent");
    expect(res.status).toBe(404);
  });

  test("DELETE /:id deletes a file", async () => {
    const createRes = await req(
      "",
      post({ name: "to-delete.txt", path: tmpFile })
    );
    const created: Any = await createRes.json();
    const id = created.data.id;

    const res = await req(`/${id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const body: Any = await res.json();
    expect(body.data.deleted).toBe(true);

    const getRes = await req(`/${id}`);
    expect(getRes.status).toBe(404);
  });

  test("DELETE /:id returns 404 for missing file", async () => {
    const res = await req("/nonexistent", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  test("metadata is stored and returned as object", async () => {
    const createRes = await req(
      "",
      post({
        name: "meta.txt",
        path: tmpFile,
        metadata: { source: "upload" },
      })
    );
    const created: Any = await createRes.json();
    expect(created.data.metadata).toEqual({ source: "upload" });
  });
});

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../../src/db/schema.ts";
import { deriveKey } from "../../src/security/encryption.ts";
import { SecretStore } from "../../src/security/secrets.ts";

describe("SecretStore", () => {
  let db: Database;
  let store: SecretStore;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    const key = deriveKey("test-master-key", "test-salt");
    store = new SecretStore(db, key);
  });

  afterEach(() => {
    db.close();
  });

  test("set and get a secret", () => {
    store.set("api_key", "sk-12345");
    expect(store.get("api_key")).toBe("sk-12345");
  });

  test("get returns null for missing key", () => {
    expect(store.get("nonexistent")).toBeNull();
  });

  test("set overwrites existing key", () => {
    store.set("token", "old-value");
    store.set("token", "new-value");
    expect(store.get("token")).toBe("new-value");
  });

  test("delete removes a secret", () => {
    store.set("temp", "value");
    store.delete("temp");
    expect(store.get("temp")).toBeNull();
  });

  test("list returns all key names sorted", () => {
    store.set("zebra", "z");
    store.set("alpha", "a");
    store.set("middle", "m");
    expect(store.list()).toEqual(["alpha", "middle", "zebra"]);
  });

  test("list returns empty array when no secrets", () => {
    expect(store.list()).toEqual([]);
  });

  test("values are encrypted at rest", () => {
    store.set("secret", "plain-text-value");
    const row = db
      .query("SELECT encrypted_value FROM secrets WHERE key = ?")
      .get("secret") as { encrypted_value: string };
    expect(row.encrypted_value).not.toBe("plain-text-value");
    expect(row.encrypted_value).toContain(":"); // iv:authTag:ciphertext
  });
});

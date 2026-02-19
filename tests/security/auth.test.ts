import { describe, test, expect } from "bun:test";
import { generateApiKey, verifyApiKey } from "../../src/security/auth.ts";

describe("auth", () => {
  test("generateApiKey returns key with homs_ prefix", async () => {
    const { raw, hash } = await generateApiKey();
    expect(raw.startsWith("homs_")).toBe(true);
    expect(hash.length).toBeGreaterThan(0);
  });

  test("generateApiKey produces unique keys", async () => {
    const key1 = await generateApiKey();
    const key2 = await generateApiKey();
    expect(key1.raw).not.toBe(key2.raw);
    expect(key1.hash).not.toBe(key2.hash);
  });

  test("verifyApiKey returns true for correct key", async () => {
    const { raw, hash } = await generateApiKey();
    const valid = await verifyApiKey(raw, hash);
    expect(valid).toBe(true);
  });

  test("verifyApiKey returns false for wrong key", async () => {
    const { hash } = await generateApiKey();
    const valid = await verifyApiKey("homs_wrongkey", hash);
    expect(valid).toBe(false);
  });

  test("verifyApiKey returns false for invalid hash", async () => {
    const valid = await verifyApiKey("homs_anything", "not-a-hash");
    expect(valid).toBe(false);
  });
});

import { describe, test, expect } from "bun:test";
import { deriveKey, encrypt, decrypt } from "../../src/security/encryption.ts";

describe("encryption", () => {
  const key = deriveKey("test-passphrase", "fixed-salt");

  test("deriveKey produces consistent output with same salt", () => {
    const key1 = deriveKey("pass", "salt");
    const key2 = deriveKey("pass", "salt");
    expect(key1.equals(key2)).toBe(true);
  });

  test("deriveKey produces different output with different salts", () => {
    const key1 = deriveKey("pass", "salt1");
    const key2 = deriveKey("pass", "salt2");
    expect(key1.equals(key2)).toBe(false);
  });

  test("deriveKey returns 32-byte key", () => {
    expect(key.length).toBe(32);
  });

  test("encrypt returns iv:authTag:ciphertext format", () => {
    const result = encrypt("hello world", key);
    const parts = result.split(":");
    expect(parts.length).toBe(3);
    // IV is 16 bytes = 32 hex chars
    expect(parts[0]!.length).toBe(32);
    // Auth tag is 16 bytes = 32 hex chars
    expect(parts[1]!.length).toBe(32);
    // Ciphertext is non-empty
    expect(parts[2]!.length).toBeGreaterThan(0);
  });

  test("decrypt reverses encrypt", () => {
    const plaintext = "sensitive data 🔐";
    const encrypted = encrypt(plaintext, key);
    const decrypted = decrypt(encrypted, key);
    expect(decrypted).toBe(plaintext);
  });

  test("decrypt with wrong key throws", () => {
    const wrongKey = deriveKey("wrong-passphrase", "fixed-salt");
    const encrypted = encrypt("secret", key);
    expect(() => decrypt(encrypted, wrongKey)).toThrow();
  });

  test("decrypt with invalid format throws", () => {
    expect(() => decrypt("not-valid", key)).toThrow(
      "Invalid encrypted string format"
    );
  });

  test("each encryption produces unique ciphertext (random IV)", () => {
    const ct1 = encrypt("same input", key);
    const ct2 = encrypt("same input", key);
    expect(ct1).not.toBe(ct2);
  });
});

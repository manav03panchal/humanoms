import { randomBytes } from "crypto";
import { hash, verify } from "@node-rs/argon2";

const API_KEY_PREFIX = "homs_";
const API_KEY_RANDOM_BYTES = 24;

/**
 * Generate a new API key with the "homs_" prefix.
 * Returns the raw key (to give to the user once) and its argon2 hash (to store).
 */
export async function generateApiKey(): Promise<{ raw: string; hash: string }> {
  const randomPart = randomBytes(API_KEY_RANDOM_BYTES)
    .toString("base64url");

  const raw = `${API_KEY_PREFIX}${randomPart}`;
  const hashed = await hash(raw);

  return { raw, hash: hashed };
}

/**
 * Verify a raw API key against a stored argon2 hash.
 */
export async function verifyApiKey(raw: string, hashed: string): Promise<boolean> {
  try {
    return await verify(hashed, raw);
  } catch {
    return false;
  }
}

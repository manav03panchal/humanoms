import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "crypto";

const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const ALGORITHM = "aes-256-gcm";

/**
 * Derive a 256-bit encryption key from a passphrase using scrypt.
 * If no salt is provided, a random 16-byte salt is generated.
 */
export function deriveKey(passphrase: string, salt?: string): Buffer {
  const effectiveSalt = salt ?? randomBytes(16).toString("hex");
  return scryptSync(passphrase, effectiveSalt, KEY_LENGTH) as Buffer;
}

/**
 * Encrypt plaintext using AES-256-GCM.
 * Returns a string in the format "iv:authTag:ciphertext" (all hex-encoded).
 */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypt a string produced by `encrypt`.
 * Expects the format "iv:authTag:ciphertext" (all hex-encoded).
 */
export function decrypt(encryptedStr: string, key: Buffer): string {
  const parts = encryptedStr.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted string format. Expected 'iv:authTag:ciphertext'.");
  }

  const [ivHex, authTagHex, ciphertext] = parts as [string, string, string];

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid IV length: expected ${IV_LENGTH}, got ${iv.length}`);
  }
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error(`Invalid auth tag length: expected ${AUTH_TAG_LENGTH}, got ${authTag.length}`);
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

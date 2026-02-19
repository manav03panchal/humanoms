import { createHmac, timingSafeEqual } from "crypto";

interface ApprovalPayload {
  job_id: string;
  step_index: number;
}

interface TokenData {
  payload: ApprovalPayload;
  exp: number;
}

/**
 * Create an HMAC-SHA256 signed approval token with an expiry.
 * The token is base64url-encoded and contains the payload + expiry + signature.
 */
export function createApprovalToken(
  payload: ApprovalPayload,
  secret: string,
  ttlMs: number
): string {
  const exp = Date.now() + ttlMs;

  const tokenData: TokenData = {
    payload,
    exp,
  };

  const dataStr = JSON.stringify(tokenData);
  const dataB64 = Buffer.from(dataStr, "utf8").toString("base64url");

  const signature = createHmac("sha256", secret)
    .update(dataB64)
    .digest("base64url");

  return `${dataB64}.${signature}`;
}

/**
 * Verify an approval token's signature and expiry.
 * Returns the payload if valid, or null if the token is invalid or expired.
 * Uses timingSafeEqual to prevent timing attacks on signature comparison.
 */
export function verifyApprovalToken(
  token: string,
  secret: string
): ApprovalPayload | null {
  const dotIndex = token.indexOf(".");
  if (dotIndex === -1) return null;

  const dataB64 = token.slice(0, dotIndex);
  const providedSignature = token.slice(dotIndex + 1);

  // Recompute the expected signature
  const expectedSignature = createHmac("sha256", secret)
    .update(dataB64)
    .digest("base64url");

  // Constant-time comparison to prevent timing attacks
  const providedBuf = Buffer.from(providedSignature, "utf8");
  const expectedBuf = Buffer.from(expectedSignature, "utf8");

  if (providedBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(providedBuf, expectedBuf)) return null;

  // Decode and parse the token data
  let tokenData: TokenData;
  try {
    const decoded = Buffer.from(dataB64, "base64url").toString("utf8");
    tokenData = JSON.parse(decoded) as TokenData;
  } catch {
    return null;
  }

  // Check expiry
  if (Date.now() > tokenData.exp) return null;

  return tokenData.payload;
}

import { describe, test, expect } from "bun:test";
import {
  createApprovalToken,
  verifyApprovalToken,
} from "../../src/security/tokens.ts";

describe("approval tokens", () => {
  const secret = "test-secret-key";
  const payload = { job_id: "job_123", step_index: 2 };

  test("create and verify round-trips", () => {
    const token = createApprovalToken(payload, secret, 60_000);
    const result = verifyApprovalToken(token, secret);
    expect(result).toEqual(payload);
  });

  test("expired token returns null", () => {
    const token = createApprovalToken(payload, secret, -1);
    const result = verifyApprovalToken(token, secret);
    expect(result).toBeNull();
  });

  test("wrong secret returns null", () => {
    const token = createApprovalToken(payload, secret, 60_000);
    const result = verifyApprovalToken(token, "wrong-secret");
    expect(result).toBeNull();
  });

  test("tampered token returns null", () => {
    const token = createApprovalToken(payload, secret, 60_000);
    const tampered = token.slice(0, -1) + "X";
    const result = verifyApprovalToken(tampered, secret);
    expect(result).toBeNull();
  });

  test("missing dot separator returns null", () => {
    const result = verifyApprovalToken("nodothere", secret);
    expect(result).toBeNull();
  });

  test("invalid base64 data returns null", () => {
    const result = verifyApprovalToken("!!!.!!!", secret);
    expect(result).toBeNull();
  });
});

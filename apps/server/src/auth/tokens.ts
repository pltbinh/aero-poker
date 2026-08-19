import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function generateToken(byteLength: 16 | 32): string {
  return randomBytes(byteLength).toString("base64url");
}

export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export function safeTokenMatch(token: string, expectedHash: Buffer): boolean {
  const actual = hashToken(token);

  return actual.length === expectedHash.length && timingSafeEqual(actual, expectedHash);
}

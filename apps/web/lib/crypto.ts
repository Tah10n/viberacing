import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function deviceTokenFromPollToken(pollToken: string): string {
  return createHash("sha256")
    .update("viberacing-device-token\0", "utf8")
    .update(pollToken, "utf8")
    .digest("base64url");
}

export function secretEqual(left: string, right: string): boolean {
  const leftDigest = digest(left);
  const rightDigest = digest(right);
  return timingSafeEqual(leftDigest, rightDigest);
}

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function pairingCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export function normalizePairingCode(value: string): string {
  return value
    .toUpperCase()
    .replaceAll(/[^A-Z2-9]/g, "")
    .slice(0, 8);
}

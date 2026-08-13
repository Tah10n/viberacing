import { createHash, randomBytes } from "node:crypto";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
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

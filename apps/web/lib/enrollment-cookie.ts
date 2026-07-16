import "server-only";

import { Buffer } from "node:buffer";
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes as nodeRandomBytes,
} from "node:crypto";

const tokenVersion = "v1";
const maximumCookieValueLength = 4096;
const nonceBytes = 12;
const tagBytes = 16;
const segmentPattern = /^[A-Za-z0-9_-]+$/;

export type EnrollmentCookieKind = "oauth" | "passkey" | "session";
export type EnrollmentRandomBytes = (size: number) => Uint8Array;

export interface EnrollmentCookieCodec {
  open(kind: EnrollmentCookieKind, value: string): unknown;
  seal(kind: EnrollmentCookieKind, value: unknown): string;
}

function deriveKey(masterKey: Uint8Array, kind: EnrollmentCookieKind): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      masterKey,
      Buffer.from("viberacing-enrollment-cookie-v1", "utf8"),
      Buffer.from(kind, "utf8"),
      32,
    ),
  );
}

function canonicalBytes(value: string): Buffer | undefined {
  if (!segmentPattern.test(value)) {
    return undefined;
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    decoded.fill(0);
    return undefined;
  }
  return decoded;
}

export function createEnrollmentCookieCodec(
  masterKey: Uint8Array,
  randomBytes: EnrollmentRandomBytes = nodeRandomBytes,
): EnrollmentCookieCodec {
  if (masterKey.byteLength !== 32) {
    throw new Error("Enrollment cookie codec is unavailable.");
  }
  const keys = {
    oauth: deriveKey(masterKey, "oauth"),
    passkey: deriveKey(masterKey, "passkey"),
    session: deriveKey(masterKey, "session"),
  } as const;

  return Object.freeze({
    open(kind: EnrollmentCookieKind, value: string): unknown {
      if (value.length === 0 || value.length > maximumCookieValueLength) {
        return undefined;
      }
      const parts = value.split(".");
      if (parts.length !== 3 || parts[0] !== tokenVersion) {
        return undefined;
      }
      const nonce = canonicalBytes(parts[1] ?? "");
      const protectedBytes = canonicalBytes(parts[2] ?? "");
      if (
        nonce?.length !== nonceBytes ||
        protectedBytes === undefined ||
        protectedBytes.length <= tagBytes
      ) {
        nonce?.fill(0);
        protectedBytes?.fill(0);
        return undefined;
      }
      const ciphertext = protectedBytes.subarray(0, -tagBytes);
      const tag = protectedBytes.subarray(-tagBytes);
      let plaintext: Buffer | undefined;
      try {
        const decipher = createDecipheriv("aes-256-gcm", keys[kind], nonce, {
          authTagLength: tagBytes,
        });
        decipher.setAAD(Buffer.from(`viberacing:${kind}:${tokenVersion}`, "utf8"));
        decipher.setAuthTag(tag);
        plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return JSON.parse(plaintext.toString("utf8")) as unknown;
      } catch {
        return undefined;
      } finally {
        plaintext?.fill(0);
        nonce.fill(0);
        protectedBytes.fill(0);
      }
    },
    seal(kind: EnrollmentCookieKind, value: unknown): string {
      const plaintext = Buffer.from(JSON.stringify(value), "utf8");
      const nonce = Buffer.from(randomBytes(nonceBytes));
      if (nonce.length !== nonceBytes) {
        plaintext.fill(0);
        nonce.fill(0);
        throw new Error("Enrollment cookie codec is unavailable.");
      }
      try {
        const cipher = createCipheriv("aes-256-gcm", keys[kind], nonce, {
          authTagLength: tagBytes,
        });
        cipher.setAAD(Buffer.from(`viberacing:${kind}:${tokenVersion}`, "utf8"));
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        const protectedBytes = Buffer.concat([ciphertext, cipher.getAuthTag()]);
        try {
          const token = `${tokenVersion}.${nonce.toString("base64url")}.${protectedBytes.toString("base64url")}`;
          if (token.length > maximumCookieValueLength) {
            throw new Error("Enrollment cookie codec is unavailable.");
          }
          return token;
        } finally {
          ciphertext.fill(0);
          protectedBytes.fill(0);
        }
      } finally {
        plaintext.fill(0);
        nonce.fill(0);
      }
    },
  });
}

export function readCookie(cookieHeader: string | null, name: string): string | undefined {
  if (cookieHeader === null || cookieHeader.length > 8192) {
    return undefined;
  }
  let matched = false;
  let result: string | undefined;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) {
      continue;
    }
    if (part.slice(0, separator).trim() === name) {
      if (matched) {
        return undefined;
      }
      matched = true;
      const value = part.slice(separator + 1);
      result = value.length > 0 && value.trim() === value ? value : undefined;
    }
  }
  return result;
}

export function serializeEnrollmentCookie(
  name: string,
  value: string,
  maximumAgeSeconds: number,
  secure: boolean,
  path = "/",
): string {
  const attributes = [
    `${name}=${value}`,
    `Path=${path}`,
    `Max-Age=${String(maximumAgeSeconds)}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

export function clearEnrollmentCookie(name: string, secure: boolean, path = "/"): string {
  return serializeEnrollmentCookie(name, "", 0, secure, path);
}

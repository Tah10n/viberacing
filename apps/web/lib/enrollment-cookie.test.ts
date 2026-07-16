import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import {
  clearEnrollmentCookie,
  createEnrollmentCookieCodec,
  readCookie,
  serializeEnrollmentCookie,
} from "./enrollment-cookie";

describe("enrollment cookies", () => {
  it("round-trips each separated encrypted cookie purpose and rejects tampering", () => {
    let nonce = 0;
    const codec = createEnrollmentCookieCodec(Buffer.alloc(32, 0x21), (size) =>
      Buffer.alloc(size, (nonce += 1)),
    );
    const payload = { expiresAt: 1_800_000_000, privateValue: "not-plaintext" };
    const login = codec.seal("login", payload);
    const oauth = codec.seal("oauth", payload);
    const passkey = codec.seal("passkey", payload);
    const session = codec.seal("session", payload);

    expect(codec.open("login", login)).toEqual(payload);
    expect(codec.open("oauth", oauth)).toEqual(payload);
    expect(codec.open("passkey", passkey)).toEqual(payload);
    expect(codec.open("session", session)).toEqual(payload);
    expect(new Set([login, oauth, passkey, session])).toHaveLength(4);
    expect(oauth).not.toContain("not-plaintext");
    expect(codec.open("session", oauth)).toBeUndefined();
    expect(codec.open("login", passkey)).toBeUndefined();
    expect(codec.open("oauth", `${oauth.slice(0, -1)}A`)).toBeUndefined();
    expect(codec.open("oauth", "v1.bad.bad")).toBeUndefined();
    expect(Object.isFrozen(codec)).toBe(true);
  });

  it("rejects invalid key and nonce material", () => {
    expect(() => createEnrollmentCookieCodec(Buffer.alloc(31))).toThrow(
      "Enrollment cookie codec is unavailable.",
    );
    const codec = createEnrollmentCookieCodec(Buffer.alloc(32), () => Buffer.alloc(11));
    expect(() => codec.seal("session", {})).toThrow("Enrollment cookie codec is unavailable.");
  });

  it("parses only the requested bounded cookie and emits hardened attributes", () => {
    expect(readCookie("alpha=1; viberacing_session=opaque; beta=2", "viberacing_session")).toBe(
      "opaque",
    );
    expect(readCookie("alpha=1", "viberacing_session")).toBeUndefined();
    expect(readCookie("viberacing_session= opaque", "viberacing_session")).toBeUndefined();
    expect(
      readCookie("viberacing_session=first; viberacing_session=second", "viberacing_session"),
    ).toBeUndefined();
    expect(readCookie("x".repeat(8193), "x")).toBeUndefined();
    expect(serializeEnrollmentCookie("name", "value", 60, true)).toBe(
      "name=value; Path=/; Max-Age=60; HttpOnly; SameSite=Lax; Secure",
    );
    expect(clearEnrollmentCookie("name", false)).toBe(
      "name=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
    );
    expect(serializeEnrollmentCookie("name", "value", 60, true, "/auth/passkey")).toContain(
      "Path=/auth/passkey",
    );
    expect(clearEnrollmentCookie("name", true, "/auth/passkey")).toContain("Path=/auth/passkey");
  });
});

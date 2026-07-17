import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import { resolveEnrollmentConfig } from "./enrollment-config";
import type { EnrollmentConfigurationError } from "./enrollment-config";

const validEnvironment = {
  GITHUB_CLIENT_ID: "Ov23abcdefghijklmno",
  GITHUB_CLIENT_SECRET: "a".repeat(40),
  NODE_ENV: "development",
  SESSION_SECRET: Buffer.alloc(32, 0x31).toString("base64url"),
  VIBERACING_PUBLIC_ORIGIN: "http://localhost:3000",
  VIBERACING_RECOVERY_ARGON2_MEMORY_KIB: "19456",
  VIBERACING_RECOVERY_ARGON2_PARALLELISM: "2",
  VIBERACING_RECOVERY_ARGON2_PASSES: "2",
  VIBERACING_RECOVERY_PEPPER: Buffer.alloc(32, 0x32).toString("base64url"),
  WEBAUTHN_ORIGIN: "http://localhost:3000",
  WEBAUTHN_RP_ID: "localhost",
} as const;

describe("enrollment configuration", () => {
  it("resolves one exact public OAuth, cookie, and WebAuthn boundary", () => {
    const config = resolveEnrollmentConfig(validEnvironment);

    expect(config).toMatchObject({
      githubCallbackUrl: "http://localhost:3000/auth/github/callback",
      githubClientId: validEnvironment.GITHUB_CLIENT_ID,
      publicOrigin: "http://localhost:3000",
      recoveryArgon2: { memoryKib: 19_456, parallelism: 2, passes: 2 },
      secureCookies: false,
      webauthnOrigin: "http://localhost:3000",
      webauthnRpId: "localhost",
    });
    expect(config.cookieKey).toEqual(Buffer.alloc(32, 0x31));
    expect(config.recoveryPepper).toEqual(Buffer.alloc(32, 0x32));
    expect(Object.keys(config)).not.toContain("cookieKey");
    expect(Object.keys(config)).not.toContain("githubClientSecret");
    expect(Object.keys(config)).not.toContain("recoveryPepper");
    expect(JSON.stringify(config)).toBe('{"redacted":true}');
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("requires secure cookies for the exact hosted origin", () => {
    const config = resolveEnrollmentConfig({
      ...validEnvironment,
      NODE_ENV: "production",
      VIBERACING_PUBLIC_ORIGIN: "https://race.example.com",
      WEBAUTHN_ORIGIN: "https://race.example.com",
      WEBAUTHN_RP_ID: "race.example.com",
    });
    expect(config.secureCookies).toBe(true);
  });

  it.each([
    ["cookie_key_invalid", { SESSION_SECRET: "replace-me" }],
    ["github_client_id_invalid", { GITHUB_CLIENT_ID: "short" }],
    ["github_client_secret_invalid", { GITHUB_CLIENT_SECRET: "short" }],
    ["public_origin_invalid", { NODE_ENV: "preview" }],
    ["recovery_argon2_invalid", { VIBERACING_RECOVERY_ARGON2_MEMORY_KIB: "19455" }],
    ["recovery_argon2_invalid", { VIBERACING_RECOVERY_ARGON2_PARALLELISM: "1" }],
    ["recovery_argon2_invalid", { VIBERACING_RECOVERY_ARGON2_PASSES: "01" }],
    ["recovery_pepper_invalid", { VIBERACING_RECOVERY_PEPPER: "replace-me" }],
    ["recovery_pepper_invalid", { VIBERACING_RECOVERY_PEPPER: validEnvironment.SESSION_SECRET }],
    ["webauthn_origin_invalid", { WEBAUTHN_ORIGIN: "http://127.0.0.1:3000" }],
    [
      "webauthn_rp_id_invalid",
      {
        VIBERACING_PUBLIC_ORIGIN: "http://127.0.0.1:3000",
        WEBAUTHN_ORIGIN: "http://127.0.0.1:3000",
        WEBAUTHN_RP_ID: "127.0.0.1",
      },
    ],
  ] as const)("fails closed with %s", (code, override) => {
    expect(() => resolveEnrollmentConfig({ ...validEnvironment, ...override })).toThrow(
      expect.objectContaining<Partial<EnrollmentConfigurationError>>({ code }),
    );
  });
});

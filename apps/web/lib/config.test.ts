import { afterEach, describe, expect, it } from "vitest";
import {
  databaseSslEnabled,
  maximumDailyTokens,
  publicOrigin,
  secureCookies,
  validateRuntimeConfig,
} from "./config";

const originalOrigin = process.env.VIBERACING_PUBLIC_ORIGIN;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalDatabaseSsl = process.env.VIBERACING_DATABASE_SSL;
const originalClientId = process.env.GITHUB_CLIENT_ID;
const originalClientSecret = process.env.GITHUB_CLIENT_SECRET;
const originalMaximumDailyTokens = process.env.VIBERACING_MAX_DAILY_TOKENS;

afterEach(() => {
  if (originalOrigin === undefined) delete process.env.VIBERACING_PUBLIC_ORIGIN;
  else process.env.VIBERACING_PUBLIC_ORIGIN = originalOrigin;
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalDatabaseSsl === undefined) delete process.env.VIBERACING_DATABASE_SSL;
  else process.env.VIBERACING_DATABASE_SSL = originalDatabaseSsl;
  if (originalClientId === undefined) delete process.env.GITHUB_CLIENT_ID;
  else process.env.GITHUB_CLIENT_ID = originalClientId;
  if (originalClientSecret === undefined) delete process.env.GITHUB_CLIENT_SECRET;
  else process.env.GITHUB_CLIENT_SECRET = originalClientSecret;
  if (originalMaximumDailyTokens === undefined) delete process.env.VIBERACING_MAX_DAILY_TOKENS;
  else process.env.VIBERACING_MAX_DAILY_TOKENS = originalMaximumDailyTokens;
});

describe("public origin", () => {
  it("allows HTTP only for a local test server", () => {
    process.env.VIBERACING_PUBLIC_ORIGIN = "http://localhost:3000";
    expect(publicOrigin().origin).toBe("http://localhost:3000");
    expect(secureCookies()).toBe(false);
  });

  it("requires HTTPS for external hosts", () => {
    process.env.VIBERACING_PUBLIC_ORIGIN = "http://viberacing.example";
    expect(() => publicOrigin()).toThrow(/must use HTTPS/);
  });

  it("uses secure cookies over HTTPS", () => {
    process.env.VIBERACING_PUBLIC_ORIGIN = "https://viberacing.example";
    expect(secureCookies()).toBe(true);
  });

  it("fails startup validation when required production configuration is absent", () => {
    delete process.env.DATABASE_URL;
    process.env.VIBERACING_PUBLIC_ORIGIN = "https://viberacing.example";
    process.env.VIBERACING_DATABASE_SSL = "true";
    process.env.GITHUB_CLIENT_ID = "synthetic-client";
    process.env.GITHUB_CLIENT_SECRET = "synthetic-secret";
    expect(() => {
      validateRuntimeConfig();
    }).toThrow(/DATABASE_URL/);
  });

  it("accepts a complete, internally consistent runtime configuration", () => {
    process.env.DATABASE_URL = "postgresql://example.invalid/viberacing";
    process.env.VIBERACING_PUBLIC_ORIGIN = "https://viberacing.example";
    process.env.VIBERACING_DATABASE_SSL = "true";
    process.env.GITHUB_CLIENT_ID = "synthetic-client";
    process.env.GITHUB_CLIENT_SECRET = "synthetic-secret";
    expect(() => {
      validateRuntimeConfig();
    }).not.toThrow();
  });

  it("accepts only a canonical decimal maximum token limit", () => {
    process.env.VIBERACING_MAX_DAILY_TOKENS = "9999999999999999";
    expect(maximumDailyTokens()).toBe(9999999999999999n);
    for (const invalid of ["1E+16", " 999 ", "0999", "1.5"]) {
      process.env.VIBERACING_MAX_DAILY_TOKENS = invalid;
      expect(() => maximumDailyTokens()).toThrow(/canonical decimal string/);
    }
  });
});

describe("database TLS configuration", () => {
  it.each([
    ["false", false],
    ["true", true],
    [" true ", true],
  ])("normalizes %j consistently", (value, expected) => {
    process.env.VIBERACING_DATABASE_SSL = value;
    expect(databaseSslEnabled()).toBe(expected);
  });

  it.each([
    [undefined, "CONFIG_VIBERACING_DATABASE_SSL_MISSING"],
    ["", "CONFIG_VIBERACING_DATABASE_SSL_MISSING"],
    ["tru", "CONFIG_DATABASE_SSL_INVALID"],
    ["TRUE", "CONFIG_DATABASE_SSL_INVALID"],
  ])("rejects %j without falling back to plaintext", (value, expectedCode) => {
    if (value === undefined) delete process.env.VIBERACING_DATABASE_SSL;
    else process.env.VIBERACING_DATABASE_SSL = value;
    expect(() => databaseSslEnabled()).toThrow(expect.objectContaining({ code: expectedCode }));
  });
});

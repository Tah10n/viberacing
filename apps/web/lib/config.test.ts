import { afterEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  databaseClientConfig,
  databaseSslEnabled,
  maximumDailyTokens,
  publicOrigin,
  secureCookies,
  validateRuntimeConfig,
} from "./config";

const originalOrigin = process.env.VIBERACING_PUBLIC_ORIGIN;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalDatabaseSsl = process.env.VIBERACING_DATABASE_SSL;
const originalPgSslMode = process.env.PGSSLMODE;
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
  if (originalPgSslMode === undefined) delete process.env.PGSSLMODE;
  else process.env.PGSSLMODE = originalPgSslMode;
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

  it.each([
    ["true", "sslmode=disable"],
    ["true", "sslmode=no-verify"],
    ["false", "ssl=true"],
    ["true", "sslcert=%2Fprivate%2Fclient.crt"],
    ["true", "sslkey=%2Fprivate%2Fclient.key"],
    ["true", "SSLROOTCERT=%2Fprivate%2Froot.crt"],
    ["true", "sslnegotiation=direct"],
    ["true", "uselibpqcompat=true"],
  ])("rejects DATABASE_URL TLS override %s / %s", (tls, query) => {
    process.env.VIBERACING_DATABASE_SSL = tls;
    process.env.DATABASE_URL = `postgresql://private:private@example.invalid/viberacing?${query}`;
    expect(() => databaseClientConfig(process.env)).toThrow(
      expect.objectContaining({ code: "CONFIG_DATABASE_URL_SSL_CONFLICT" }),
    );
  });

  it("passes explicit ssl=false to pg regardless of PGSSLMODE", () => {
    process.env.VIBERACING_DATABASE_SSL = "false";
    process.env.PGSSLMODE = "require";
    process.env.DATABASE_URL =
      "postgresql://example.invalid/viberacing?application_name=viberacing";
    const config = databaseClientConfig(process.env);
    expect(config).toMatchObject({ ssl: false });
    const client = new Client(config);
    const parameters = client as unknown as { connectionParameters: { ssl: unknown } };
    expect(parameters.connectionParameters.ssl).toBe(false);
  });

  it("passes certificate-verifying TLS to pg and allows unrelated query parameters", () => {
    process.env.VIBERACING_DATABASE_SSL = "true";
    process.env.DATABASE_URL =
      "postgresql://example.invalid/viberacing?application_name=viberacing";
    const config = databaseClientConfig(process.env);
    const client = new Client(config);
    const parameters = client as unknown as { connectionParameters: { ssl: unknown } };
    expect(parameters.connectionParameters.ssl).toEqual({ rejectUnauthorized: true });
  });

  it.each(["not a URL", "https://example.invalid/viberacing"])(
    "rejects invalid PostgreSQL URL %j without exposing it as a code",
    (value) => {
      process.env.VIBERACING_DATABASE_SSL = "true";
      process.env.DATABASE_URL = value;
      expect(() => databaseClientConfig(process.env)).toThrow(
        expect.objectContaining({ code: "CONFIG_DATABASE_URL_INVALID" }),
      );
    },
  );
});

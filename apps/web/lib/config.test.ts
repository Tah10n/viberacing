import { afterEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  connectorDistribution,
  connectorProtocolVersion,
  databaseClientConfig,
  databaseSslEnabled,
  githubWebOrigin,
  installedConnectorUpdateRequired,
  isSupportedConnectorProtocolVersion,
  isSemanticVersion,
  maximumDailyTokens,
  publicOrigin,
  secureCookies,
  trustedProxyMode,
  validateRuntimeConfig,
  versionAtLeast,
} from "./config";

const originalOrigin = process.env.VIBERACING_PUBLIC_ORIGIN;
const originalTestGitHubOrigin = process.env.VIBERACING_TEST_GITHUB_ORIGIN;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalDatabaseSsl = process.env.VIBERACING_DATABASE_SSL;
const originalConnectorDistribution = process.env.VIBERACING_CONNECTOR_DISTRIBUTION;
const originalPgSslMode = process.env.PGSSLMODE;
const originalClientId = process.env.GITHUB_CLIENT_ID;
const originalClientSecret = process.env.GITHUB_CLIENT_SECRET;
const originalMaximumDailyTokens = process.env.VIBERACING_MAX_DAILY_TOKENS;
const originalTrustProxy = process.env.VIBERACING_TRUST_PROXY;
const originalNodeEnv = process.env.NODE_ENV;
const originalAllowInsecureLocal = process.env.VIBERACING_ALLOW_INSECURE_LOCAL;
const mutableEnv = process.env as Record<string, string | undefined>;

afterEach(() => {
  if (originalOrigin === undefined) delete process.env.VIBERACING_PUBLIC_ORIGIN;
  else process.env.VIBERACING_PUBLIC_ORIGIN = originalOrigin;
  if (originalTestGitHubOrigin === undefined) delete process.env.VIBERACING_TEST_GITHUB_ORIGIN;
  else process.env.VIBERACING_TEST_GITHUB_ORIGIN = originalTestGitHubOrigin;
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalDatabaseSsl === undefined) delete process.env.VIBERACING_DATABASE_SSL;
  else process.env.VIBERACING_DATABASE_SSL = originalDatabaseSsl;
  if (originalConnectorDistribution === undefined)
    delete process.env.VIBERACING_CONNECTOR_DISTRIBUTION;
  else process.env.VIBERACING_CONNECTOR_DISTRIBUTION = originalConnectorDistribution;
  if (originalPgSslMode === undefined) delete process.env.PGSSLMODE;
  else process.env.PGSSLMODE = originalPgSslMode;
  if (originalClientId === undefined) delete process.env.GITHUB_CLIENT_ID;
  else process.env.GITHUB_CLIENT_ID = originalClientId;
  if (originalClientSecret === undefined) delete process.env.GITHUB_CLIENT_SECRET;
  else process.env.GITHUB_CLIENT_SECRET = originalClientSecret;
  if (originalMaximumDailyTokens === undefined) delete process.env.VIBERACING_MAX_DAILY_TOKENS;
  else process.env.VIBERACING_MAX_DAILY_TOKENS = originalMaximumDailyTokens;
  if (originalTrustProxy === undefined) delete process.env.VIBERACING_TRUST_PROXY;
  else process.env.VIBERACING_TRUST_PROXY = originalTrustProxy;
  mutableEnv.NODE_ENV = originalNodeEnv;
  if (originalAllowInsecureLocal === undefined) delete process.env.VIBERACING_ALLOW_INSECURE_LOCAL;
  else process.env.VIBERACING_ALLOW_INSECURE_LOCAL = originalAllowInsecureLocal;
});

describe("connector protocol compatibility", () => {
  it("keeps legacy v2 and v3 available during the v4 rollout", () => {
    expect(connectorProtocolVersion).toBe(4);
    expect(isSupportedConnectorProtocolVersion(2)).toBe(true);
    expect(isSupportedConnectorProtocolVersion(3)).toBe(true);
    expect(isSupportedConnectorProtocolVersion(4)).toBe(true);
    expect(isSupportedConnectorProtocolVersion(1)).toBe(false);
    expect(isSupportedConnectorProtocolVersion(5)).toBe(false);
    expect(isSupportedConnectorProtocolVersion("3")).toBe(false);
  });
});

describe("installed connector compatibility", () => {
  it("never treats a newer one-off CLI as confirmed installed state", () => {
    expect(installedConnectorUpdateRequired("0.4.2", "0.4.3")).toBe(true);
    expect(installedConnectorUpdateRequired("0.4.3", "0.4.3")).toBe(false);
  });

  it("defers unknown legacy state until attestation is part of the configured floor", () => {
    expect(installedConnectorUpdateRequired(null, "0.2.0")).toBe(false);
    expect(installedConnectorUpdateRequired(null, "0.4.3")).toBe(true);
  });
});

describe("connector distribution", () => {
  it("defaults to the same-origin archive", () => {
    delete process.env.VIBERACING_CONNECTOR_DISTRIBUTION;
    expect(connectorDistribution()).toBe("archive");
  });

  it.each([
    ["npm", "npm"],
    [" archive ", "archive"],
  ] as const)("accepts %j", (configured, expected) => {
    process.env.VIBERACING_CONNECTOR_DISTRIBUTION = configured;
    expect(connectorDistribution()).toBe(expected);
  });

  it("fails closed with a stable safe code for every other value", () => {
    for (const configured of ["", "NPM", "npm@latest", "npm; echo secret-value"]) {
      process.env.VIBERACING_CONNECTOR_DISTRIBUTION = configured;
      try {
        connectorDistribution();
        throw new Error("invalid connector distribution was accepted");
      } catch (error) {
        expect(error).toMatchObject({ code: "CONFIG_CONNECTOR_DISTRIBUTION_INVALID" });
        expect(String(error)).not.toContain("secret-value");
      }
    }
  });

  it("is part of startup validation", () => {
    process.env.DATABASE_URL = "postgresql://example.invalid/viberacing";
    process.env.VIBERACING_PUBLIC_ORIGIN = "https://viberacing.example";
    process.env.VIBERACING_DATABASE_SSL = "true";
    process.env.GITHUB_CLIENT_ID = "synthetic-client";
    process.env.GITHUB_CLIENT_SECRET = "synthetic-secret";
    process.env.VIBERACING_TRUST_PROXY = "railway";
    process.env.VIBERACING_CONNECTOR_DISTRIBUTION = "registry";
    expect(() => {
      validateRuntimeConfig();
    }).toThrow(expect.objectContaining({ code: "CONFIG_CONNECTOR_DISTRIBUTION_INVALID" }));
  });
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

  it("rejects public origins with credentials without exposing them", () => {
    for (const value of [
      "https://user@example.com",
      "https://user:secret@example.com",
      "https://user%40mail:secret%2Fvalue@example.com",
      "http://user:secret@localhost:3000",
    ]) {
      process.env.VIBERACING_PUBLIC_ORIGIN = value;
      try {
        publicOrigin();
        throw new Error("credentialed origin was accepted");
      } catch (error) {
        expect(error).toMatchObject({ code: "CONFIG_PUBLIC_ORIGIN_CREDENTIALS" });
        expect(String(error)).not.toContain("secret");
        expect(String(error)).not.toContain("user%40mail");
      }
    }
    process.env.VIBERACING_PUBLIC_ORIGIN = "https://viberacing.example";
    expect(publicOrigin().origin).toBe("https://viberacing.example");
  });

  it("rejects credentials in the local GitHub test origin", () => {
    process.env.VIBERACING_PUBLIC_ORIGIN = "http://localhost:3000";
    process.env.VIBERACING_ALLOW_INSECURE_LOCAL = "true";
    process.env.VIBERACING_TEST_GITHUB_ORIGIN = "http://user:secret@localhost:4000";
    expect(() => githubWebOrigin()).toThrow(
      expect.objectContaining({ code: "CONFIG_TEST_GITHUB_ORIGIN_CREDENTIALS" }),
    );
    process.env.VIBERACING_TEST_GITHUB_ORIGIN = "http://localhost:4000";
    expect(githubWebOrigin().origin).toBe("http://localhost:4000");
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

  it("requires an explicit supported trusted-proxy mode", () => {
    delete process.env.VIBERACING_TRUST_PROXY;
    expect(trustedProxyMode()).toBe("none");
    process.env.VIBERACING_TRUST_PROXY = "railway";
    expect(trustedProxyMode()).toBe("railway");
    process.env.VIBERACING_TRUST_PROXY = "trusted-x-real-ip";
    expect(trustedProxyMode()).toBe("trusted-x-real-ip");
    process.env.VIBERACING_TRUST_PROXY = "true";
    expect(() => trustedProxyMode()).toThrow(/none, railway, or trusted-x-real-ip/);
  });

  it("rejects proxy-disabled public deployments while preserving local preview and tests", () => {
    mutableEnv.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://example.invalid/viberacing";
    process.env.VIBERACING_DATABASE_SSL = "true";
    process.env.GITHUB_CLIENT_ID = "synthetic-client";
    process.env.GITHUB_CLIENT_SECRET = "synthetic-secret";
    process.env.VIBERACING_TRUST_PROXY = "none";
    process.env.VIBERACING_PUBLIC_ORIGIN = "https://viberacing.example";
    expect(() => {
      validateRuntimeConfig();
    }).toThrow(expect.objectContaining({ code: "CONFIG_TRUST_PROXY_REQUIRED" }));

    mutableEnv.NODE_ENV = "development";
    expect(() => {
      validateRuntimeConfig();
    }).toThrow(expect.objectContaining({ code: "CONFIG_TRUST_PROXY_REQUIRED" }));

    mutableEnv.NODE_ENV = "production";
    process.env.VIBERACING_PUBLIC_ORIGIN = "http://localhost:3000";
    process.env.VIBERACING_ALLOW_INSECURE_LOCAL = "true";
    expect(() => {
      validateRuntimeConfig();
    }).not.toThrow();

    mutableEnv.NODE_ENV = "test";
    process.env.VIBERACING_PUBLIC_ORIGIN = "https://viberacing.example";
    delete process.env.VIBERACING_ALLOW_INSECURE_LOCAL;
    expect(() => {
      validateRuntimeConfig();
    }).not.toThrow();
  });

  it("orders stable and prerelease connector versions by SemVer precedence", () => {
    expect(versionAtLeast("0.2.0", "0.2.0")).toBe(true);
    expect(versionAtLeast("0.2.1", "0.2.0")).toBe(true);
    expect(versionAtLeast("0.2.0-alpha", "0.2.0")).toBe(false);
    expect(versionAtLeast("0.2.0-alpha.2", "0.2.0-alpha.10")).toBe(false);
    expect(versionAtLeast("0.2.0-beta", "0.2.0-alpha.10")).toBe(true);
    expect(versionAtLeast("0.2.0-01", "0.2.0-alpha")).toBe(false);
    expect(versionAtLeast("01.2.0", "0.2.0")).toBe(false);
    expect(isSemanticVersion("0.3.11")).toBe(true);
    expect(isSemanticVersion("0.3.11-beta.1")).toBe(true);
    expect(isSemanticVersion("0.3")).toBe(false);
    expect(isSemanticVersion("0.3.11+build")).toBe(false);
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

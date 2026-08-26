import { configuredLogLevel } from "./log";
import {
  databaseClientConfig,
  databaseSslEnabled as resolveDatabaseSslEnabled,
} from "../scripts/database-config.js";

const missing = (name: string): never => {
  throw Object.assign(new Error(`Missing required environment variable: ${name}`), {
    code: `CONFIG_${name}_MISSING`,
  });
};

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  return value === undefined || value === "" ? missing(name) : value;
}

export function publicOrigin(): URL {
  let url: URL;
  try {
    url = new URL(process.env.VIBERACING_PUBLIC_ORIGIN ?? "http://localhost:3000");
  } catch {
    throw Object.assign(new Error("VIBERACING_PUBLIC_ORIGIN must be a valid origin"), {
      code: "CONFIG_PUBLIC_ORIGIN_INVALID",
    });
  }
  if (url.username !== "" || url.password !== "") {
    throw Object.assign(new Error("VIBERACING_PUBLIC_ORIGIN must not include credentials"), {
      code: "CONFIG_PUBLIC_ORIGIN_CREDENTIALS",
    });
  }
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw Object.assign(new Error("VIBERACING_PUBLIC_ORIGIN must be an origin without a path"), {
      code: "CONFIG_PUBLIC_ORIGIN_PATH",
    });
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && (url.protocol !== "http:" || !loopback)) {
    throw Object.assign(new Error("VIBERACING_PUBLIC_ORIGIN must use HTTPS except on localhost"), {
      code: "CONFIG_PUBLIC_ORIGIN_HTTPS",
    });
  }
  return url;
}

export function secureCookies(): boolean {
  return publicOrigin().protocol === "https:";
}

function testGitHubOrigin(): URL | null {
  const value = process.env.VIBERACING_TEST_GITHUB_ORIGIN?.trim();
  if (!value) return null;
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw Object.assign(new Error("VIBERACING_TEST_GITHUB_ORIGIN must be a valid origin"), {
      code: "CONFIG_TEST_GITHUB_ORIGIN_INVALID",
    });
  }
  if (origin.username !== "" || origin.password !== "") {
    throw Object.assign(new Error("VIBERACING_TEST_GITHUB_ORIGIN must not include credentials"), {
      code: "CONFIG_TEST_GITHUB_ORIGIN_CREDENTIALS",
    });
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  const applicationOrigin = publicOrigin();
  const localPreview =
    process.env.VIBERACING_ALLOW_INSECURE_LOCAL === "true" &&
    applicationOrigin.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(applicationOrigin.hostname);
  if (
    !localPreview ||
    !loopback ||
    origin.protocol !== "http:" ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== ""
  ) {
    throw Object.assign(new Error("VIBERACING_TEST_GITHUB_ORIGIN requires a local preview"), {
      code: "CONFIG_TEST_GITHUB_ORIGIN_INVALID",
    });
  }
  return origin;
}

export function githubWebOrigin(): URL {
  return testGitHubOrigin() ?? new URL("https://github.com");
}

export function githubApiOrigin(): URL {
  return testGitHubOrigin() ?? new URL("https://api.github.com");
}

export function databaseSslEnabled(): boolean {
  return resolveDatabaseSslEnabled(process.env);
}

export { databaseClientConfig };

export const connectorProtocolVersion = 4;
export type SupportedConnectorProtocolVersion = 2 | 3 | typeof connectorProtocolVersion;

export function isSupportedConnectorProtocolVersion(
  value: unknown,
): value is SupportedConnectorProtocolVersion {
  return value === 2 || value === 3 || value === connectorProtocolVersion;
}
export const browserSyncInstallationScopeProtocol = 2;
export const maximumSourcesPerInstallation = 32;
export const installedStateAttestationMinimumVersion = "0.4.3";
export const expectedSchemaVersion = "005_browser_sync_protocol.sql";

export type ConnectorDistribution = "npm" | "archive";

export function connectorDistribution(): ConnectorDistribution {
  const configured = process.env.VIBERACING_CONNECTOR_DISTRIBUTION;
  if (configured === undefined) return "archive";
  const value = configured.trim();
  if (value !== "npm" && value !== "archive") {
    throw Object.assign(new Error("VIBERACING_CONNECTOR_DISTRIBUTION must be npm or archive"), {
      code: "CONFIG_CONNECTOR_DISTRIBUTION_INVALID",
    });
  }
  return value;
}

export type TrustedProxyMode = "none" | "railway" | "trusted-x-real-ip";

export function trustedProxyMode(): TrustedProxyMode {
  const value = process.env.VIBERACING_TRUST_PROXY?.trim() || "none";
  if (value !== "none" && value !== "railway" && value !== "trusted-x-real-ip") {
    throw Object.assign(
      new Error("VIBERACING_TRUST_PROXY must be none, railway, or trusted-x-real-ip"),
      {
        code: "CONFIG_TRUST_PROXY_INVALID",
      },
    );
  }
  return value;
}

export function maximumDailyTokens(): bigint {
  const value = process.env.VIBERACING_MAX_DAILY_TOKENS ?? "9999999999999999";
  if (!/^[1-9]\d{0,29}$/.test(value)) {
    throw Object.assign(
      new Error("VIBERACING_MAX_DAILY_TOKENS must be a positive canonical decimal string"),
      { code: "CONFIG_MAX_DAILY_TOKENS_INVALID" },
    );
  }
  return BigInt(value);
}

export function minimumConnectorVersion(): string {
  const value = process.env.VIBERACING_MIN_CONNECTOR_VERSION?.trim() || "0.2.0";
  if (parseSemver(value) === null) {
    throw Object.assign(new Error("VIBERACING_MIN_CONNECTOR_VERSION must be a semantic version"), {
      code: "CONFIG_MIN_CONNECTOR_VERSION_INVALID",
    });
  }
  return value;
}

export function installedConnectorUpdateRequired(
  installedVersion: string | null,
  minimumVersion: string,
): boolean {
  if (installedVersion === null) {
    return versionAtLeast(minimumVersion, installedStateAttestationMinimumVersion);
  }
  return !versionAtLeast(installedVersion, minimumVersion);
}

export function versionAtLeast(candidate: string, minimum: string): boolean {
  const left = parseSemver(candidate);
  const right = parseSemver(minimum);
  if (left === null || right === null) return false;
  for (let index = 0; index < 3; index += 1) {
    const leftPart = left.core[index] as bigint;
    const rightPart = right.core[index] as bigint;
    if (leftPart > rightPart) return true;
    if (leftPart < rightPart) return false;
  }
  if (left.prerelease.length === 0) return true;
  if (right.prerelease.length === 0) return false;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return false;
    if (rightPart === undefined) return true;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return BigInt(leftPart) > BigInt(rightPart);
    if (leftNumeric !== rightNumeric) return !leftNumeric;
    return leftPart > rightPart;
  }
  return true;
}

export function isSemanticVersion(value: string): boolean {
  return parseSemver(value) !== null;
}

function parseSemver(
  value: string,
): { core: readonly [bigint, bigint, bigint]; prerelease: readonly string[] } | null {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
      value,
    );
  if (match === null) return null;
  const prerelease = match[4]?.split(".") ?? [];
  if (prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"))) {
    return null;
  }
  return {
    core: [BigInt(match[1] as string), BigInt(match[2] as string), BigInt(match[3] as string)],
    prerelease,
  };
}

export function validateRuntimeConfig(): void {
  databaseClientConfig(process.env);
  const origin = publicOrigin();
  const localHttpAllowed =
    process.env.VIBERACING_ALLOW_INSECURE_LOCAL === "true" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (process.env.NODE_ENV === "production" && origin.protocol !== "https:" && !localHttpAllowed) {
    throw Object.assign(new Error("VIBERACING_PUBLIC_ORIGIN must use HTTPS in production"), {
      code: "CONFIG_PUBLIC_ORIGIN_PRODUCTION_HTTPS",
    });
  }
  requiredEnv("GITHUB_CLIENT_ID");
  requiredEnv("GITHUB_CLIENT_SECRET");
  connectorDistribution();
  minimumConnectorVersion();
  maximumDailyTokens();
  const proxyMode = trustedProxyMode();
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (process.env.NODE_ENV !== "test" && !loopback && proxyMode === "none") {
    throw Object.assign(
      new Error(
        "Public deployment requires VIBERACING_TRUST_PROXY=railway or trusted-x-real-ip behind a reverse proxy that overwrites X-Real-IP",
      ),
      { code: "CONFIG_TRUST_PROXY_REQUIRED" },
    );
  }
  githubWebOrigin();
  githubApiOrigin();
  configuredLogLevel();
}

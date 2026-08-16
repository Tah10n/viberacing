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

export function databaseSslEnabled(): boolean {
  return resolveDatabaseSslEnabled(process.env);
}

export { databaseClientConfig };

export const connectorProtocolVersion = 2;
export const expectedSchemaVersion = "003_pairing_superseded_sources.sql";

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
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(value)) {
    throw Object.assign(new Error("VIBERACING_MIN_CONNECTOR_VERSION must be a semantic version"), {
      code: "CONFIG_MIN_CONNECTOR_VERSION_INVALID",
    });
  }
  return value;
}

export function versionAtLeast(candidate: string, minimum: string): boolean {
  const parse = (value: string) => (value.split("-", 1)[0] ?? "").split(".").map(Number);
  const left = parse(candidate);
  const right = parse(minimum);
  if (left.length !== 3 || right.length !== 3 || [...left, ...right].some(Number.isNaN))
    return false;
  for (let index = 0; index < 3; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined || rightPart === undefined) return false;
    if (leftPart > rightPart) return true;
    if (leftPart < rightPart) return false;
  }
  return true;
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
  minimumConnectorVersion();
  maximumDailyTokens();
  configuredLogLevel();
}

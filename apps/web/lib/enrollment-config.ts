import "server-only";

import { Buffer } from "node:buffer";
import { isIP } from "node:net";

import { parsePublicOrigin, resolvePublicOrigin } from "./public-origin";

const base64UrlPattern = /^[A-Za-z0-9_-]+$/;
const githubClientIdPattern = /^[A-Za-z0-9_-]{10,128}$/;
const githubClientSecretPattern = /^[A-Za-z0-9_-]{20,256}$/;
const rpIdPattern =
  /^(?:localhost|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/;

export type EnrollmentConfigurationErrorCode =
  | "cookie_key_invalid"
  | "github_client_id_invalid"
  | "github_client_secret_invalid"
  | "public_origin_invalid"
  | "webauthn_origin_invalid"
  | "webauthn_rp_id_invalid";

export class EnrollmentConfigurationError extends Error {
  readonly code: EnrollmentConfigurationErrorCode;

  constructor(code: EnrollmentConfigurationErrorCode) {
    super("Enrollment configuration is invalid.");
    this.name = "EnrollmentConfigurationError";
    this.code = code;
  }
}

export interface EnrollmentConfig {
  readonly cookieKey: Uint8Array;
  readonly githubCallbackUrl: string;
  readonly githubClientId: string;
  readonly githubClientSecret: string;
  readonly publicOrigin: string;
  readonly secureCookies: boolean;
  readonly webauthnOrigin: string;
  readonly webauthnRpId: string;
}

type Environment = Readonly<Record<string, string | undefined>>;

function fail(code: EnrollmentConfigurationErrorCode): never {
  throw new EnrollmentConfigurationError(code);
}

function exactSecret(
  value: string | undefined,
  pattern: RegExp,
  code: EnrollmentConfigurationErrorCode,
): string {
  const candidate = value ?? fail(code);
  if (candidate.trim() !== candidate || !pattern.test(candidate)) {
    fail(code);
  }
  return candidate;
}

function cookieKey(value: string | undefined): Buffer {
  if (value?.length !== 43 || !base64UrlPattern.test(value) || value.trim() !== value) {
    fail("cookie_key_invalid");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== value) {
    decoded.fill(0);
    fail("cookie_key_invalid");
  }
  return decoded;
}

export function resolveEnrollmentConfig(environment: Environment = process.env): EnrollmentConfig {
  const nodeEnvironment = environment.NODE_ENV;
  if (
    nodeEnvironment !== undefined &&
    nodeEnvironment !== "development" &&
    nodeEnvironment !== "production" &&
    nodeEnvironment !== "test"
  ) {
    fail("public_origin_invalid");
  }
  let publicUrl: URL;
  let webauthnUrl: URL;
  try {
    publicUrl = resolvePublicOrigin(environment.VIBERACING_PUBLIC_ORIGIN, nodeEnvironment);
  } catch {
    fail("public_origin_invalid");
  }
  try {
    webauthnUrl = parsePublicOrigin(environment.WEBAUTHN_ORIGIN ?? "");
  } catch {
    fail("webauthn_origin_invalid");
  }
  if (webauthnUrl.origin !== publicUrl.origin) {
    fail("webauthn_origin_invalid");
  }

  const rpId = environment.WEBAUTHN_RP_ID ?? "";
  if (
    rpId !== rpId.trim() ||
    rpId !== rpId.toLowerCase() ||
    isIP(rpId) !== 0 ||
    !rpIdPattern.test(rpId) ||
    rpId !== webauthnUrl.hostname
  ) {
    fail("webauthn_rp_id_invalid");
  }

  const githubClientId = exactSecret(
    environment.GITHUB_CLIENT_ID,
    githubClientIdPattern,
    "github_client_id_invalid",
  );
  const githubClientSecret = exactSecret(
    environment.GITHUB_CLIENT_SECRET,
    githubClientSecretPattern,
    "github_client_secret_invalid",
  );
  const key = cookieKey(environment.SESSION_SECRET);
  const config = {
    cookieKey: key,
    githubCallbackUrl: new URL("/auth/github/callback", publicUrl).href,
    githubClientId,
    githubClientSecret,
    publicOrigin: publicUrl.origin,
    secureCookies: publicUrl.protocol === "https:",
    webauthnOrigin: webauthnUrl.origin,
    webauthnRpId: rpId,
  } satisfies EnrollmentConfig;
  Object.defineProperty(config, "cookieKey", { enumerable: false });
  Object.defineProperty(config, "githubClientSecret", { enumerable: false });
  Object.defineProperty(config, "toJSON", {
    enumerable: false,
    value: () => ({ redacted: true }),
  });
  return Object.freeze(config);
}

import "server-only";

import { Buffer } from "node:buffer";
import { isIP } from "node:net";

import { parsePublicOrigin, resolvePublicOrigin } from "./public-origin";
import {
  validRecoveryArgon2Configuration,
  type RecoveryArgon2Configuration,
} from "./recovery-code";

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
  | "recovery_argon2_invalid"
  | "recovery_pepper_invalid"
  | "recovery_timing_invalid"
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
  readonly recoveryArgon2: RecoveryArgon2Configuration;
  readonly recoveryPepper: Uint8Array;
  readonly recoveryMinimumResponseMs: number;
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

function canonicalKey(
  value: string | undefined,
  code: "cookie_key_invalid" | "recovery_pepper_invalid",
): Buffer {
  if (value?.length !== 43 || !base64UrlPattern.test(value) || value.trim() !== value) {
    fail(code);
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== value) {
    decoded.fill(0);
    fail(code);
  }
  return decoded;
}

function exactInteger(value: string | undefined): number {
  if (value === undefined || !/^[1-9][0-9]{0,6}$/.test(value)) {
    fail("recovery_argon2_invalid");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || String(parsed) !== value) {
    fail("recovery_argon2_invalid");
  }
  return parsed;
}

function exactRecoveryTiming(value: string | undefined): number {
  if (value === undefined || !/^[1-9][0-9]{2,3}$/.test(value)) {
    fail("recovery_timing_invalid");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || String(parsed) !== value || parsed < 100 || parsed > 5_000) {
    fail("recovery_timing_invalid");
  }
  return parsed;
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
  const key = canonicalKey(environment.SESSION_SECRET, "cookie_key_invalid");
  let recoveryPepper: Buffer | undefined;
  try {
    recoveryPepper = canonicalKey(
      environment.VIBERACING_RECOVERY_PEPPER,
      "recovery_pepper_invalid",
    );
    if (key.equals(recoveryPepper)) {
      fail("recovery_pepper_invalid");
    }
    const recoveryArgon2 = Object.freeze({
      memoryKib: exactInteger(environment.VIBERACING_RECOVERY_ARGON2_MEMORY_KIB),
      parallelism: exactInteger(environment.VIBERACING_RECOVERY_ARGON2_PARALLELISM),
      passes: exactInteger(environment.VIBERACING_RECOVERY_ARGON2_PASSES),
    });
    if (
      !validRecoveryArgon2Configuration(
        recoveryArgon2.memoryKib,
        recoveryArgon2.passes,
        recoveryArgon2.parallelism,
      )
    ) {
      fail("recovery_argon2_invalid");
    }
    const config = {
      cookieKey: key,
      githubCallbackUrl: new URL("/auth/github/callback", publicUrl).href,
      githubClientId,
      githubClientSecret,
      publicOrigin: publicUrl.origin,
      recoveryArgon2,
      recoveryPepper,
      recoveryMinimumResponseMs: exactRecoveryTiming(
        environment.VIBERACING_RECOVERY_MINIMUM_RESPONSE_MS,
      ),
      secureCookies: publicUrl.protocol === "https:",
      webauthnOrigin: webauthnUrl.origin,
      webauthnRpId: rpId,
    } satisfies EnrollmentConfig;
    Object.defineProperty(config, "cookieKey", { enumerable: false });
    Object.defineProperty(config, "githubClientSecret", { enumerable: false });
    Object.defineProperty(config, "recoveryPepper", { enumerable: false });
    Object.defineProperty(config, "toJSON", {
      enumerable: false,
      value: () => ({ redacted: true }),
    });
    return Object.freeze(config);
  } catch (error) {
    key.fill(0);
    recoveryPepper?.fill(0);
    throw error;
  }
}

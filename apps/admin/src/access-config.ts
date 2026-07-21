import { createHash } from "node:crypto";

import { isAdminActorReference } from "./actor-reference.js";

const environmentKeys = {
  audience: "VIBERACING_ADMIN_ACCESS_AUDIENCE",
  issuer: "VIBERACING_ADMIN_ACCESS_TEAM_DOMAIN",
  jwks: "VIBERACING_ADMIN_ACCESS_JWKS",
  members: "VIBERACING_ADMIN_ACCESS_MEMBERS",
} as const;

const audiencePattern = /^[a-f0-9]{64}$/;
const keyIdPattern = /^[a-f0-9]{64}$/;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/;
const subjectPattern = /^[A-Za-z0-9._-]{1,128}$/;
const teamDomainPattern = /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/;
const maximumJwksSourceLength = 24_576;
const maximumMembersSourceLength = 8_192;
const maximumSigningKeys = 2;
const maximumMembers = 16;
const resolvedConfigurations = new WeakSet<object>();

type Environment = Readonly<Record<string, string | undefined>>;

interface AdminAccessJwk {
  readonly alg: "RS256";
  readonly e: "AQAB";
  readonly kid: string;
  readonly kty: "RSA";
  readonly n: string;
  readonly use: "sig";
}

interface AdminAccessMember {
  readonly actorReference: string;
  readonly subjectDigest: string;
}

export interface AdminAccessConfig {
  readonly audience: string;
  readonly issuer: string;
  readonly jwks: Readonly<{
    readonly keys: readonly AdminAccessJwk[];
  }>;
  readonly members: readonly AdminAccessMember[];
}

export type AdminAccessConfigurationErrorCode =
  | "audience_invalid"
  | "environment_unreadable"
  | "issuer_invalid"
  | "jwks_invalid"
  | "members_invalid";

export class AdminAccessConfigurationError extends Error {
  readonly code: AdminAccessConfigurationErrorCode;

  constructor(code: AdminAccessConfigurationErrorCode) {
    super("Admin Access configuration is invalid.");
    this.name = "AdminAccessConfigurationError";
    this.code = code;
  }
}

function fail(code: AdminAccessConfigurationErrorCode): never {
  throw new AdminAccessConfigurationError(code);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).toSorted();
  const sortedExpected = [...expected].toSorted();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function ownDataValue(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    return undefined;
  }
  return descriptor.value;
}

function readEnvironmentValue(environment: Environment, key: string): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(environment, key);
  if (descriptor === undefined) {
    return undefined;
  }
  if (!("value" in descriptor) || !descriptor.enumerable) {
    fail("environment_unreadable");
  }
  const rawValue: unknown = descriptor.value;
  if (rawValue !== undefined && typeof rawValue !== "string") {
    fail("environment_unreadable");
  }
  return rawValue;
}

function parseJson(
  source: string | undefined,
  maximumLength: number,
  code: "jwks_invalid" | "members_invalid",
): unknown {
  if (
    typeof source !== "string" ||
    source.length === 0 ||
    source.length > maximumLength ||
    source !== source.trim()
  ) {
    fail(code);
  }
  try {
    return JSON.parse(source) as unknown;
  } catch {
    fail(code);
  }
}

function validIssuer(value: string | undefined): value is string {
  if (typeof value !== "string" || !teamDomainPattern.test(value)) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.port === "" &&
      parsed.pathname === "/" &&
      parsed.search === "" &&
      parsed.hash === "" &&
      parsed.origin === value
    );
  } catch {
    return false;
  }
}

function decodeCanonicalBase64Url(value: string): Buffer | undefined {
  if (!base64UrlPattern.test(value)) {
    return undefined;
  }
  try {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.length === 0 || decoded.toString("base64url") !== value) {
      return undefined;
    }
    return decoded;
  } catch {
    return undefined;
  }
}

function parseJwk(value: unknown): AdminAccessJwk {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["alg", "e", "kid", "kty", "n", "use"])) {
    fail("jwks_invalid");
  }
  const alg = ownDataValue(value, "alg");
  const exponent = ownDataValue(value, "e");
  const kid = ownDataValue(value, "kid");
  const keyType = ownDataValue(value, "kty");
  const modulus = ownDataValue(value, "n");
  const use = ownDataValue(value, "use");
  if (
    alg !== "RS256" ||
    exponent !== "AQAB" ||
    typeof kid !== "string" ||
    !keyIdPattern.test(kid) ||
    keyType !== "RSA" ||
    typeof modulus !== "string" ||
    use !== "sig"
  ) {
    fail("jwks_invalid");
  }
  const modulusBytes = decodeCanonicalBase64Url(modulus);
  if (modulusBytes === undefined || modulusBytes.length < 256 || modulusBytes.length > 512) {
    fail("jwks_invalid");
  }
  const lastModulusByte = modulusBytes.at(-1);
  if (modulusBytes[0] === 0 || lastModulusByte === undefined || (lastModulusByte & 1) !== 1) {
    fail("jwks_invalid");
  }
  return Object.freeze({
    alg: "RS256" as const,
    e: "AQAB" as const,
    kid,
    kty: "RSA" as const,
    n: modulus,
    use: "sig" as const,
  });
}

function parseJwks(source: string | undefined): AdminAccessConfig["jwks"] {
  const parsed = parseJson(source, maximumJwksSourceLength, "jwks_invalid");
  if (!isPlainRecord(parsed) || !hasExactKeys(parsed, ["keys"])) {
    fail("jwks_invalid");
  }
  const rawKeys = ownDataValue(parsed, "keys");
  if (!Array.isArray(rawKeys) || rawKeys.length === 0 || rawKeys.length > maximumSigningKeys) {
    fail("jwks_invalid");
  }
  const keys = rawKeys.map((value) => parseJwk(value));
  if (new Set(keys.map(({ kid }) => kid)).size !== keys.length) {
    fail("jwks_invalid");
  }
  return Object.freeze({ keys: Object.freeze(keys) });
}

export function hashAdminAccessSubject(issuer: string, subject: string): string {
  return createHash("sha256")
    .update("viberacing-admin-access-subject-v1\0", "utf8")
    .update(issuer, "utf8")
    .update("\0", "utf8")
    .update(subject, "utf8")
    .digest("base64url");
}

function parseMember(value: unknown, issuer: string): AdminAccessMember {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["actorReference", "subject"])) {
    fail("members_invalid");
  }
  const actorReference = ownDataValue(value, "actorReference");
  const subject = ownDataValue(value, "subject");
  if (
    !isAdminActorReference(actorReference) ||
    typeof subject !== "string" ||
    !subjectPattern.test(subject)
  ) {
    fail("members_invalid");
  }
  return Object.freeze({
    actorReference,
    subjectDigest: hashAdminAccessSubject(issuer, subject),
  });
}

function parseMembers(source: string | undefined, issuer: string): readonly AdminAccessMember[] {
  const parsed = parseJson(source, maximumMembersSourceLength, "members_invalid");
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > maximumMembers) {
    fail("members_invalid");
  }
  const members = parsed.map((value) => parseMember(value, issuer));
  if (
    new Set(members.map(({ actorReference }) => actorReference)).size !== members.length ||
    new Set(members.map(({ subjectDigest }) => subjectDigest)).size !== members.length
  ) {
    fail("members_invalid");
  }
  return Object.freeze(members);
}

function buildConfig(environment: Environment): AdminAccessConfig {
  const audience = readEnvironmentValue(environment, environmentKeys.audience);
  const issuer = readEnvironmentValue(environment, environmentKeys.issuer);
  if (typeof audience !== "string" || !audiencePattern.test(audience)) {
    fail("audience_invalid");
  }
  if (!validIssuer(issuer)) {
    fail("issuer_invalid");
  }
  const jwks = parseJwks(readEnvironmentValue(environment, environmentKeys.jwks));
  const members = parseMembers(readEnvironmentValue(environment, environmentKeys.members), issuer);
  const config = Object.create(null) as AdminAccessConfig;
  Object.defineProperties(config, {
    audience: { configurable: false, enumerable: false, value: audience, writable: false },
    issuer: { configurable: false, enumerable: false, value: issuer, writable: false },
    jwks: { configurable: false, enumerable: false, value: jwks, writable: false },
    members: { configurable: false, enumerable: false, value: members, writable: false },
    toJSON: {
      configurable: false,
      enumerable: false,
      value: () => ({ redacted: true }),
      writable: false,
    },
  });
  Object.freeze(config);
  resolvedConfigurations.add(config);
  return config;
}

export function isResolvedAdminAccessConfig(value: unknown): value is AdminAccessConfig {
  return typeof value === "object" && value !== null && resolvedConfigurations.has(value);
}

export function resolveAdminAccessConfig(
  environment: Environment = process.env,
): AdminAccessConfig {
  try {
    return buildConfig(environment);
  } catch (error) {
    if (error instanceof AdminAccessConfigurationError) {
      throw error;
    }
    fail("environment_unreadable");
  }
}

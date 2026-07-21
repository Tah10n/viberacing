import { Buffer } from "node:buffer";
import { createHash, randomBytes as nodeRandomBytes, randomUUID } from "node:crypto";

const authorizationKeys = new Set([
  "accessVerifiedAtMs",
  "actorReference",
  "decision",
  "passkeyVerifiedAtMs",
  "purpose",
  "validUntilMs",
  "version",
]);
const auditAcknowledgementKeys = new Set(["accepted", "phase", "requestId", "version"]);
const dependencyKeys = new Set(["appendAudit", "authorize", "issueInvite"]);
const runtimeKeys = new Set(["clock", "randomBytes", "randomUuid"]);
const actorReferencePattern = /^adm_[A-Za-z0-9_-]{21}[AQgw]$/;
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const passkeyFreshnessMs = 5 * 60 * 1_000;
const inviteLifetimeMs = 7 * 24 * 60 * 60 * 1_000;
const requestEntropyBytes = 16;
const inviteSecretBytes = 32;

export const adminInviteReasonCode = "BETA_ADMISSION" as const;
export const adminInviteLifetimeDays = 7;

export type AdminInviteAuditPhase = "authorized" | "committed";

export interface AdminInviteAuditEvent {
  readonly action: "invite.issue";
  readonly actorReference: string;
  readonly auditEventId: string;
  readonly inviteExpiresAt: string;
  readonly occurredAt: string;
  readonly phase: AdminInviteAuditPhase;
  readonly reasonCode: typeof adminInviteReasonCode;
  readonly requestId: string;
  readonly version: 1;
}

export type AdminInviteIssuanceErrorCode =
  | "argument_invalid"
  | "audit_rejected"
  | "authorization_rejected"
  | "clock_invalid"
  | "dependency_invalid"
  | "entropy_invalid"
  | "entropy_unavailable"
  | "identifier_invalid"
  | "storage_rejected";

export class AdminInviteIssuanceError extends Error {
  readonly code: AdminInviteIssuanceErrorCode;

  constructor(code: AdminInviteIssuanceErrorCode) {
    super("Admin invitation issuance failed.");
    this.name = "AdminInviteIssuanceError";
    this.code = code;
  }
}

export interface AdminInviteIssuer {
  issueBetaInvite(...arguments_: readonly unknown[]): Promise<string>;
}

export interface AdminInviteIssuerDependencies {
  readonly appendAudit: (event: AdminInviteAuditEvent) => Promise<unknown>;
  readonly authorize: () => Promise<unknown>;
  readonly issueInvite: (input: unknown) => Promise<void>;
}

export interface AdminInviteIssuerRuntime {
  readonly clock: () => number;
  readonly randomBytes: (size: number) => Buffer;
  readonly randomUuid: () => string;
}

interface AuthorizationDecision {
  readonly accessVerifiedAtMs: number;
  readonly actorReference: string;
  readonly passkeyVerifiedAtMs: number;
  readonly validUntilMs: number;
}

const systemRuntime: AdminInviteIssuerRuntime = Object.freeze({
  clock: Date.now,
  randomBytes: nodeRandomBytes,
  randomUuid: randomUUID,
});

function fail(code: AdminInviteIssuanceErrorCode): never {
  throw new AdminInviteIssuanceError(code);
}

function isPlainRecord(value: unknown): value is object {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: object, expected: ReadonlySet<string>): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expected.size &&
    keys.every((key) => typeof key === "string" && expected.has(key))
  );
}

function ownDataValue(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor && descriptor.enumerable
    ? (descriptor.value as unknown)
    : undefined;
}

function readDependencies(value: unknown): AdminInviteIssuerDependencies {
  try {
    if (!isPlainRecord(value) || !hasExactKeys(value, dependencyKeys)) {
      fail("dependency_invalid");
    }
    const appendAudit = ownDataValue(value, "appendAudit");
    const authorize = ownDataValue(value, "authorize");
    const issueInvite = ownDataValue(value, "issueInvite");
    if (
      typeof appendAudit !== "function" ||
      typeof authorize !== "function" ||
      typeof issueInvite !== "function"
    ) {
      fail("dependency_invalid");
    }
    return Object.freeze({
      appendAudit: appendAudit as AdminInviteIssuerDependencies["appendAudit"],
      authorize: authorize as AdminInviteIssuerDependencies["authorize"],
      issueInvite: issueInvite as AdminInviteIssuerDependencies["issueInvite"],
    });
  } catch (error) {
    if (error instanceof AdminInviteIssuanceError) {
      throw error;
    }
    fail("dependency_invalid");
  }
}

function readRuntime(value: unknown): AdminInviteIssuerRuntime {
  try {
    if (!isPlainRecord(value) || !hasExactKeys(value, runtimeKeys)) {
      fail("dependency_invalid");
    }
    const clock = ownDataValue(value, "clock");
    const randomBytes = ownDataValue(value, "randomBytes");
    const randomUuid = ownDataValue(value, "randomUuid");
    if (
      typeof clock !== "function" ||
      typeof randomBytes !== "function" ||
      typeof randomUuid !== "function"
    ) {
      fail("dependency_invalid");
    }
    return Object.freeze({
      clock: clock as AdminInviteIssuerRuntime["clock"],
      randomBytes: randomBytes as AdminInviteIssuerRuntime["randomBytes"],
      randomUuid: randomUuid as AdminInviteIssuerRuntime["randomUuid"],
    });
  } catch (error) {
    if (error instanceof AdminInviteIssuanceError) {
      throw error;
    }
    fail("dependency_invalid");
  }
}

function readClock(runtime: AdminInviteIssuerRuntime): number {
  try {
    const now = runtime.clock();
    if (!Number.isSafeInteger(now) || now < 0 || now > Date.parse("9999-12-24T00:00:00.000Z")) {
      fail("clock_invalid");
    }
    return now;
  } catch (error) {
    if (error instanceof AdminInviteIssuanceError) {
      throw error;
    }
    fail("clock_invalid");
  }
}

function readAuthorization(value: unknown, now: number): AuthorizationDecision {
  try {
    if (
      !isPlainRecord(value) ||
      !Object.isFrozen(value) ||
      !hasExactKeys(value, authorizationKeys) ||
      ownDataValue(value, "version") !== 1 ||
      ownDataValue(value, "decision") !== "allow" ||
      ownDataValue(value, "purpose") !== "invite_issue"
    ) {
      fail("authorization_rejected");
    }
    const accessVerifiedAtMs = ownDataValue(value, "accessVerifiedAtMs");
    const actorReference = ownDataValue(value, "actorReference");
    const passkeyVerifiedAtMs = ownDataValue(value, "passkeyVerifiedAtMs");
    const validUntilMs = ownDataValue(value, "validUntilMs");
    if (
      typeof accessVerifiedAtMs !== "number" ||
      !Number.isSafeInteger(accessVerifiedAtMs) ||
      typeof actorReference !== "string" ||
      !actorReferencePattern.test(actorReference) ||
      typeof passkeyVerifiedAtMs !== "number" ||
      !Number.isSafeInteger(passkeyVerifiedAtMs) ||
      typeof validUntilMs !== "number" ||
      !Number.isSafeInteger(validUntilMs) ||
      accessVerifiedAtMs < 0 ||
      accessVerifiedAtMs > passkeyVerifiedAtMs ||
      passkeyVerifiedAtMs > now ||
      now - accessVerifiedAtMs > passkeyFreshnessMs ||
      now - passkeyVerifiedAtMs > passkeyFreshnessMs ||
      validUntilMs !== passkeyVerifiedAtMs + passkeyFreshnessMs ||
      now > validUntilMs
    ) {
      fail("authorization_rejected");
    }
    return Object.freeze({
      accessVerifiedAtMs,
      actorReference,
      passkeyVerifiedAtMs,
      validUntilMs,
    });
  } catch (error) {
    if (error instanceof AdminInviteIssuanceError) {
      throw error;
    }
    fail("authorization_rejected");
  }
}

function requireCurrentAuthorization(
  authorization: AuthorizationDecision,
  initialNow: number,
  runtime: AdminInviteIssuerRuntime,
): void {
  const currentNow = readClock(runtime);
  if (currentNow < initialNow) {
    fail("clock_invalid");
  }
  if (currentNow > authorization.validUntilMs) {
    fail("authorization_rejected");
  }
}

function readUuid(runtime: AdminInviteIssuerRuntime): string {
  try {
    const value = runtime.randomUuid();
    if (typeof value !== "string" || !uuidV4Pattern.test(value)) {
      fail("identifier_invalid");
    }
    return value;
  } catch (error) {
    if (error instanceof AdminInviteIssuanceError) {
      throw error;
    }
    fail("identifier_invalid");
  }
}

function clearMutableBytes(value: Uint8Array): void {
  Uint8Array.prototype.fill.call(value, 0);
}

function clearRejectedEntropy(value: unknown): void {
  try {
    if (value instanceof Uint8Array) {
      clearMutableBytes(value);
    }
  } catch {
    // Rejected reflective values must not replace the closed entropy error.
  }
}

function encodeBase64Url(value: Buffer): string {
  const copy = Buffer.from(value);
  try {
    return copy.toString("base64url");
  } finally {
    clearMutableBytes(copy);
  }
}

function readEntropy(runtime: AdminInviteIssuerRuntime, size: number): Buffer {
  let value: unknown;
  try {
    value = runtime.randomBytes(size);
  } catch {
    fail("entropy_unavailable");
  }
  if (!Buffer.isBuffer(value) || value.length !== size) {
    clearRejectedEntropy(value);
    fail("entropy_invalid");
  }
  return value;
}

function createAuditEvent(
  phase: AdminInviteAuditPhase,
  actorReference: string,
  auditEventId: string,
  requestId: string,
  occurredAt: string,
  inviteExpiresAt: string,
): AdminInviteAuditEvent {
  return Object.freeze(
    Object.assign(Object.create(null) as object, {
      action: "invite.issue",
      actorReference,
      auditEventId,
      inviteExpiresAt,
      occurredAt,
      phase,
      reasonCode: adminInviteReasonCode,
      requestId,
      version: 1,
    }),
  ) as AdminInviteAuditEvent;
}

function validateAuditAcknowledgement(
  value: unknown,
  phase: AdminInviteAuditPhase,
  requestId: string,
): void {
  try {
    if (
      !isPlainRecord(value) ||
      !hasExactKeys(value, auditAcknowledgementKeys) ||
      ownDataValue(value, "accepted") !== true ||
      ownDataValue(value, "phase") !== phase ||
      ownDataValue(value, "requestId") !== requestId ||
      ownDataValue(value, "version") !== 1
    ) {
      fail("audit_rejected");
    }
  } catch (error) {
    if (error instanceof AdminInviteIssuanceError) {
      throw error;
    }
    fail("audit_rejected");
  }
}

async function appendAudit(
  dependency: AdminInviteIssuerDependencies["appendAudit"],
  event: AdminInviteAuditEvent,
): Promise<void> {
  let acknowledgement: unknown;
  try {
    acknowledgement = await dependency(event);
  } catch {
    fail("audit_rejected");
  }
  validateAuditAcknowledgement(acknowledgement, event.phase, event.requestId);
}

async function issueBetaInvite(
  dependencies: AdminInviteIssuerDependencies,
  runtime: AdminInviteIssuerRuntime,
  arguments_: readonly unknown[],
): Promise<string> {
  if (arguments_.length !== 0) {
    fail("argument_invalid");
  }

  let rawAuthorization: unknown;
  try {
    rawAuthorization = await dependencies.authorize();
  } catch {
    fail("authorization_rejected");
  }
  const now = readClock(runtime);
  const authorization = readAuthorization(rawAuthorization, now);
  const occurredAt = new Date(now).toISOString();
  const inviteExpiresAt = new Date(now + inviteLifetimeMs).toISOString();

  const inviteId = readUuid(runtime);
  const auditEventId = readUuid(runtime);
  if (inviteId === auditEventId) {
    fail("identifier_invalid");
  }

  const requestEntropy = readEntropy(runtime, requestEntropyBytes);
  let requestId: string;
  try {
    requestId = `req_${encodeBase64Url(requestEntropy)}`;
  } finally {
    clearMutableBytes(requestEntropy);
  }

  const authorizedEvent = createAuditEvent(
    "authorized",
    authorization.actorReference,
    auditEventId,
    requestId,
    occurredAt,
    inviteExpiresAt,
  );
  await appendAudit(dependencies.appendAudit, authorizedEvent);
  requireCurrentAuthorization(authorization, now, runtime);

  const secret = readEntropy(runtime, inviteSecretBytes);
  let verifierDigest: Buffer | undefined;
  try {
    verifierDigest = createHash("sha256").update(secret).digest();
    try {
      await dependencies.issueInvite(
        Object.freeze({
          auditEventId,
          expiresAt: new Date(inviteExpiresAt),
          inviteId,
          reasonCode: adminInviteReasonCode,
          requestId,
          verifierDigest,
        }),
      );
    } catch {
      fail("storage_rejected");
    }
    const committedEvent = createAuditEvent(
      "committed",
      authorization.actorReference,
      auditEventId,
      requestId,
      occurredAt,
      inviteExpiresAt,
    );
    await appendAudit(dependencies.appendAudit, committedEvent);
    return `vri_${inviteId}_${encodeBase64Url(secret)}`;
  } finally {
    if (verifierDigest !== undefined) {
      clearMutableBytes(verifierDigest);
    }
    clearMutableBytes(secret);
  }
}

export function createAdminInviteIssuer(
  dependenciesValue: unknown,
  runtimeValue: unknown = systemRuntime,
): AdminInviteIssuer {
  const dependencies = readDependencies(dependenciesValue);
  const runtime = readRuntime(runtimeValue);
  return Object.freeze({
    issueBetaInvite(...arguments_: readonly unknown[]): Promise<string> {
      return issueBetaInvite(dependencies, runtime, arguments_);
    },
  });
}

import { Buffer } from "node:buffer";
import crypto from "node:crypto";

import {
  validateConnectorSyncResultV1,
  validateProblemDetailsV1,
  validateUsageSyncResultV1,
  type ConnectorSyncResultV1,
  type ProblemDetailsV1,
  type UsageSyncResultV1,
} from "@viberacing/contracts";

import {
  CommunitySyncDatabaseError,
  createConfiguredCommunitySyncDatabase,
  type CommunitySyncDatabaseErrorCode,
  type CommunitySyncSubmissionResult,
} from "./community-sync-database.js";
import {
  codexAccountingRevision,
  codexProvider,
  CommunitySyncVerificationError,
  type CommunitySyncVerificationErrorCode,
  type VerifiedCommunitySync,
} from "./community-sync-verifier.js";
import type { IngestDatabasePoolSignalSink } from "./database-pool.js";
import { createConfiguredCommunitySyncVerifier } from "./origin-proof-config.js";
import {
  communitySyncRequestTarget,
  usageSyncRequestTarget,
  type CommunitySyncRequestTarget,
} from "./protocol.js";

const requestEntropyBytes = 16;
const syncIdPattern = /^syn_[A-Za-z0-9_-]{22}$/;
const dependencyKeys = new Set(["submit", "verify"]);
const verifiedSubmissionKeys = new Set([
  "accountingRevision",
  "bodyDigestHex",
  "deviceId",
  "deviceKeyId",
  "idempotencyKey",
  "nonceDigestHex",
  "payload",
  "provider",
  "requestTarget",
  "signatureBase64Url",
]);
const connectorPayloadKeys = new Set([
  "codexVersion",
  "connectorVersion",
  "dailyEntries",
  "observedAt",
  "schemaVersion",
  "sourceId",
  "syncId",
]);
const usagePayloadKeys = new Set([
  "agentVersion",
  "clientVersion",
  "dailyEntries",
  "observedAt",
  "schemaVersion",
  "sourceId",
  "syncId",
]);
const submissionResultKeys = new Set(["acceptedEntries", "outcome"]);

export type CommunitySyncApplicationProblemKind = Extract<
  ProblemDetailsV1["errorCode"],
  | "internal_error"
  | "invalid_request"
  | "temporarily_unavailable"
  | "unauthorized"
  | "validation_failed"
>;

export type CommunitySyncApplicationErrorCode =
  "contract_rejected" | "dependency_invalid" | "entropy_invalid" | "entropy_unavailable";

export class CommunitySyncApplicationError extends Error {
  readonly code: CommunitySyncApplicationErrorCode;

  constructor(code: CommunitySyncApplicationErrorCode) {
    super("Community sync application response construction failed.");
    this.name = "CommunitySyncApplicationError";
    this.code = code;
  }
}

export type CommunitySyncApplicationDecision =
  | Readonly<{
      body: ConnectorSyncResultV1 | UsageSyncResultV1;
      ok: true;
      status: 200;
    }>
  | Readonly<{
      body: ProblemDetailsV1;
      ok: false;
      status: 400 | 401 | 422 | 500 | 503;
    }>;

export interface CommunitySyncApplication {
  execute(request: unknown): Promise<CommunitySyncApplicationDecision>;
}

export interface ConfiguredCommunitySyncApplication extends CommunitySyncApplication {
  close(): Promise<void>;
}

export interface CommunitySyncApplicationDependencies {
  readonly submit: (verifiedSubmission: unknown) => Promise<CommunitySyncSubmissionResult>;
  readonly verify: (request: unknown) => Promise<VerifiedCommunitySync>;
}

interface ProblemDefinition {
  readonly retryable: boolean;
  readonly status: 400 | 401 | 422 | 500 | 503;
  readonly title: ProblemDetailsV1["title"];
}

interface VerifiedSummary {
  readonly entryCount: number;
  readonly requestTarget: CommunitySyncRequestTarget;
  readonly syncId: string;
}

const problemDefinitions = Object.freeze({
  internal_error: {
    retryable: false,
    status: 500,
    title: "Internal server error",
  },
  invalid_request: {
    retryable: false,
    status: 400,
    title: "Invalid request",
  },
  temporarily_unavailable: {
    retryable: true,
    status: 503,
    title: "Temporarily unavailable",
  },
  unauthorized: {
    retryable: false,
    status: 401,
    title: "Unauthorized",
  },
  validation_failed: {
    retryable: false,
    status: 422,
    title: "Validation failed",
  },
} as const satisfies Readonly<Record<CommunitySyncApplicationProblemKind, ProblemDefinition>>);

const verificationProblems = Object.freeze({
  dependency_unavailable: "temporarily_unavailable",
  device_rejected: "unauthorized",
  invalid_body: "validation_failed",
  invalid_request: "invalid_request",
  origin_rejected: "unauthorized",
} as const satisfies Readonly<
  Record<CommunitySyncVerificationErrorCode, CommunitySyncApplicationProblemKind>
>);

const databaseProblems = Object.freeze({
  connection_release_failed: "temporarily_unavailable",
  connection_unavailable: "temporarily_unavailable",
  identifier_unavailable: "internal_error",
  input_invalid: "internal_error",
  pool_close_failed: "internal_error",
  query_failed: "temporarily_unavailable",
  result_invalid: "internal_error",
  runtime_boundary_mismatch: "temporarily_unavailable",
} as const satisfies Readonly<
  Record<CommunitySyncDatabaseErrorCode, CommunitySyncApplicationProblemKind>
>);

function fail(code: CommunitySyncApplicationErrorCode): never {
  throw new CommunitySyncApplicationError(code);
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

function readDependencies(value: unknown): CommunitySyncApplicationDependencies {
  try {
    if (!isPlainRecord(value) || !hasExactKeys(value, dependencyKeys)) {
      fail("dependency_invalid");
    }
    const submit = ownDataValue(value, "submit");
    const verify = ownDataValue(value, "verify");
    if (typeof submit !== "function" || typeof verify !== "function") {
      fail("dependency_invalid");
    }
    return Object.freeze({
      submit: submit as CommunitySyncApplicationDependencies["submit"],
      verify: verify as CommunitySyncApplicationDependencies["verify"],
    });
  } catch (error) {
    if (error instanceof CommunitySyncApplicationError) {
      throw error;
    }
    fail("dependency_invalid");
  }
}

function createRequestId(): string {
  let entropy: unknown;
  try {
    entropy = crypto.randomBytes(requestEntropyBytes);
  } catch {
    fail("entropy_unavailable");
  }

  try {
    if (
      !(Buffer.isBuffer(entropy) || entropy instanceof Uint8Array) ||
      entropy.byteLength !== requestEntropyBytes
    ) {
      fail("entropy_invalid");
    }
    return `req_${Buffer.from(entropy).toString("base64url")}`;
  } catch (error) {
    if (error instanceof CommunitySyncApplicationError) {
      throw error;
    }
    fail("entropy_invalid");
  }
}

function validDenseFrozenArray(value: unknown): value is readonly unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    !Object.isFrozen(value)
  ) {
    return false;
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 1 ||
    lengthDescriptor.value > 31
  ) {
    return false;
  }
  const length = lengthDescriptor.value as number;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1 || !keys.includes("length")) {
    return false;
  }
  return Array.from({ length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    return descriptor !== undefined && "value" in descriptor && descriptor.enumerable;
  }).every(Boolean);
}

function readVerifiedSummary(value: unknown): VerifiedSummary | undefined {
  try {
    if (
      !isPlainRecord(value) ||
      !Object.isFrozen(value) ||
      !hasExactKeys(value, verifiedSubmissionKeys)
    ) {
      return undefined;
    }
    const accountingRevision = ownDataValue(value, "accountingRevision");
    const provider = ownDataValue(value, "provider");
    const requestTarget = ownDataValue(value, "requestTarget");
    const payload = ownDataValue(value, "payload");
    if (
      accountingRevision !== codexAccountingRevision ||
      provider !== codexProvider ||
      (requestTarget !== communitySyncRequestTarget && requestTarget !== usageSyncRequestTarget) ||
      !isPlainRecord(payload) ||
      !Object.isFrozen(payload) ||
      !hasExactKeys(
        payload,
        requestTarget === usageSyncRequestTarget ? usagePayloadKeys : connectorPayloadKeys,
      )
    ) {
      return undefined;
    }
    const syncId = ownDataValue(payload, "syncId");
    const dailyEntries = ownDataValue(payload, "dailyEntries");
    if (
      typeof syncId !== "string" ||
      !syncIdPattern.test(syncId) ||
      !validDenseFrozenArray(dailyEntries)
    ) {
      return undefined;
    }
    return Object.freeze({ entryCount: dailyEntries.length, requestTarget, syncId });
  } catch {
    return undefined;
  }
}

function readSubmissionResult(
  value: unknown,
  expectedEntries: number,
): CommunitySyncSubmissionResult | undefined {
  try {
    if (!isPlainRecord(value) || !hasExactKeys(value, submissionResultKeys)) {
      return undefined;
    }
    const acceptedEntries = ownDataValue(value, "acceptedEntries");
    const outcome = ownDataValue(value, "outcome");
    if (
      typeof acceptedEntries !== "number" ||
      !Number.isSafeInteger(acceptedEntries) ||
      (outcome === "accepted" && acceptedEntries !== expectedEntries) ||
      ((outcome === "duplicate" || outcome === "quarantined") && acceptedEntries !== 0) ||
      (outcome !== "accepted" && outcome !== "duplicate" && outcome !== "quarantined")
    ) {
      return undefined;
    }
    return Object.freeze({ acceptedEntries, outcome });
  } catch {
    return undefined;
  }
}

function createSuccessDecision(
  requestId: string,
  requestTarget: CommunitySyncRequestTarget,
  syncId: string,
  result: CommunitySyncSubmissionResult,
): CommunitySyncApplicationDecision {
  const values = {
    schemaVersion: 1,
    requestId,
    syncId,
    outcome: result.outcome,
    acceptedEntries: result.acceptedEntries,
  } as const satisfies ConnectorSyncResultV1 & UsageSyncResultV1;
  const body = Object.freeze(
    Object.assign(Object.create(null) as object, values),
  ) as ConnectorSyncResultV1 & UsageSyncResultV1;
  const valid =
    requestTarget === usageSyncRequestTarget
      ? validateUsageSyncResultV1(body).ok
      : validateConnectorSyncResultV1(body).ok;
  if (!valid) {
    fail("contract_rejected");
  }
  return Object.freeze({ body, ok: true, status: 200 });
}

function createProblemDecision(
  kind: CommunitySyncApplicationProblemKind,
  requestId: string,
): CommunitySyncApplicationDecision {
  const definition = problemDefinitions[kind];
  const values = {
    schemaVersion: 1,
    requestId,
    status: definition.status,
    errorCode: kind,
    title: definition.title,
    retryable: definition.retryable,
  } as const satisfies ProblemDetailsV1;
  const body = Object.freeze(
    Object.assign(Object.create(null) as object, values),
  ) as ProblemDetailsV1;
  if (!validateProblemDetailsV1(body).ok) {
    fail("contract_rejected");
  }
  return Object.freeze({ body, ok: false, status: definition.status });
}

function verificationProblem(error: unknown): CommunitySyncApplicationProblemKind {
  return error instanceof CommunitySyncVerificationError
    ? verificationProblems[error.code]
    : "internal_error";
}

function databaseProblem(error: unknown): CommunitySyncApplicationProblemKind {
  return error instanceof CommunitySyncDatabaseError
    ? databaseProblems[error.code]
    : "internal_error";
}

export function createCommunitySyncApplication(dependencies: unknown): CommunitySyncApplication {
  const validatedDependencies = readDependencies(dependencies);

  return Object.freeze({
    async execute(request: unknown): Promise<CommunitySyncApplicationDecision> {
      const requestId = createRequestId();

      let verifiedSubmission: unknown;
      try {
        verifiedSubmission = await validatedDependencies.verify(request);
      } catch (error) {
        return createProblemDecision(verificationProblem(error), requestId);
      }

      const summary = readVerifiedSummary(verifiedSubmission);
      if (summary === undefined) {
        return createProblemDecision("internal_error", requestId);
      }

      let rawResult: unknown;
      try {
        rawResult = await validatedDependencies.submit(verifiedSubmission);
      } catch (error) {
        return createProblemDecision(databaseProblem(error), requestId);
      }
      const result = readSubmissionResult(rawResult, summary.entryCount);
      return result === undefined
        ? createProblemDecision("internal_error", requestId)
        : createSuccessDecision(requestId, summary.requestTarget, summary.syncId, result);
    },
  });
}

export async function createConfiguredCommunitySyncApplication(
  environment?: Readonly<Record<string, string | undefined>>,
  signalSink?: IngestDatabasePoolSignalSink,
  now: () => number = Date.now,
): Promise<ConfiguredCommunitySyncApplication> {
  const database = createConfiguredCommunitySyncDatabase(environment, signalSink);
  try {
    const verifier = createConfiguredCommunitySyncVerifier(
      {
        consumeOriginNonce: database.consumeOriginNonce.bind(database),
        now,
        readDeviceVerificationMaterial: database.readDeviceVerificationMaterial.bind(database),
      },
      environment,
    );
    const application = createCommunitySyncApplication({
      submit: database.submit.bind(database),
      verify: verifier.verify.bind(verifier),
    });
    return Object.freeze({
      close: database.close.bind(database),
      execute: application.execute.bind(application),
    });
  } catch (error) {
    await database.close();
    throw error;
  }
}

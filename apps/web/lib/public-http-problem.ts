import "server-only";

import { Buffer } from "node:buffer";
import crypto from "node:crypto";

import { validateProblemDetailsV1, type ProblemDetailsV1 } from "@viberacing/contracts";

const requestEntropyBytes = 16;
const requestIdPattern = /^req_[A-Za-z0-9_-]{22}$/;

const publicRequestIdBrand = Symbol("PublicRequestId");

export interface PublicRequestId {
  readonly value: string;
  readonly [publicRequestIdBrand]: true;
}

export type PublicProblemKind = ProblemDetailsV1["errorCode"];

export type PublicHttpProblemErrorCode =
  | "contract_rejected"
  | "entropy_invalid"
  | "entropy_unavailable"
  | "problem_kind_invalid"
  | "request_id_invalid";

export class PublicHttpProblemError extends Error {
  readonly code: PublicHttpProblemErrorCode;

  constructor(code: PublicHttpProblemErrorCode) {
    super("Public HTTP response construction failed.");
    this.name = "PublicHttpProblemError";
    this.code = code;
  }
}

interface PublicProblemDefinition {
  readonly retryable: boolean;
  readonly status: number;
  readonly title: ProblemDetailsV1["title"];
}

const problemDefinitions = Object.freeze({
  conflict: { retryable: false, status: 409, title: "Conflict" },
  forbidden: { retryable: false, status: 403, title: "Forbidden" },
  internal_error: {
    retryable: false,
    status: 500,
    title: "Internal server error",
  },
  invalid_request: { retryable: false, status: 400, title: "Invalid request" },
  not_found: { retryable: false, status: 404, title: "Not found" },
  rate_limited: { retryable: true, status: 429, title: "Rate limited" },
  temporarily_unavailable: {
    retryable: true,
    status: 503,
    title: "Temporarily unavailable",
  },
  unauthorized: { retryable: false, status: 401, title: "Unauthorized" },
  validation_failed: {
    retryable: false,
    status: 422,
    title: "Validation failed",
  },
} as const satisfies Readonly<Record<PublicProblemKind, PublicProblemDefinition>>);

function fail(code: PublicHttpProblemErrorCode): never {
  throw new PublicHttpProblemError(code);
}

function encodeRequestId(entropy: unknown): PublicRequestId {
  try {
    if (
      !(Buffer.isBuffer(entropy) || entropy instanceof Uint8Array) ||
      entropy.byteLength !== requestEntropyBytes
    ) {
      fail("entropy_invalid");
    }
    const requestId = `req_${Buffer.from(entropy).toString("base64url")}`;
    if (!requestIdPattern.test(requestId)) {
      fail("entropy_invalid");
    }
    const token = { value: requestId } as PublicRequestId;
    Object.defineProperty(token, publicRequestIdBrand, {
      configurable: false,
      enumerable: false,
      value: true,
      writable: false,
    });
    return Object.freeze(token);
  } catch (error) {
    if (error instanceof PublicHttpProblemError) {
      throw error;
    }
    fail("entropy_invalid");
  }
}

function validRequestIdToken(value: unknown): value is PublicRequestId {
  try {
    if (
      value === null ||
      typeof value !== "object" ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      !Object.isFrozen(value)
    ) {
      return false;
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length !== 2 || !keys.includes("value") || !keys.includes(publicRequestIdBrand)) {
      return false;
    }
    const valueDescriptor = Object.getOwnPropertyDescriptor(value, "value");
    const brandDescriptor = Object.getOwnPropertyDescriptor(value, publicRequestIdBrand);
    return (
      valueDescriptor !== undefined &&
      "value" in valueDescriptor &&
      valueDescriptor.enumerable === true &&
      typeof valueDescriptor.value === "string" &&
      requestIdPattern.test(valueDescriptor.value) &&
      brandDescriptor !== undefined &&
      "value" in brandDescriptor &&
      brandDescriptor.enumerable === false &&
      brandDescriptor.value === true
    );
  } catch {
    return false;
  }
}

function resolveProblemDefinition(kind: unknown): {
  readonly definition: PublicProblemDefinition;
  readonly kind: PublicProblemKind;
} {
  if (typeof kind !== "string" || !Object.hasOwn(problemDefinitions, kind)) {
    fail("problem_kind_invalid");
  }
  const resolvedKind = kind as PublicProblemKind;
  return { definition: problemDefinitions[resolvedKind], kind: resolvedKind };
}

export function createPublicRequestId(): PublicRequestId {
  let entropy: unknown;
  try {
    entropy = crypto.randomBytes(requestEntropyBytes);
  } catch {
    fail("entropy_unavailable");
  }
  return encodeRequestId(entropy);
}

export function createPublicProblemResponse(kind: unknown, requestId: PublicRequestId): Response {
  if (!validRequestIdToken(requestId)) {
    fail("request_id_invalid");
  }
  const resolved = resolveProblemDefinition(kind);
  const detailValues = {
    schemaVersion: 1,
    requestId: requestId.value,
    status: resolved.definition.status,
    errorCode: resolved.kind,
    title: resolved.definition.title,
    retryable: resolved.definition.retryable,
  } as const satisfies ProblemDetailsV1;
  const details = Object.freeze(Object.assign(Object.create(null) as object, detailValues));
  const validation = validateProblemDetailsV1(details);
  if (!validation.ok) {
    fail("contract_rejected");
  }

  return new Response(JSON.stringify(validation.value), {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/problem+json; charset=utf-8",
      "x-request-id": requestId.value,
    },
    status: resolved.definition.status,
  });
}

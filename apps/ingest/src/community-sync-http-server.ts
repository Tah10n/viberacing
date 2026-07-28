import { Buffer } from "node:buffer";
import crypto from "node:crypto";

import Fastify, {
  type FastifyHttpOptions,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type HTTPMethods,
  type RawServerDefault,
} from "fastify";
import {
  validateProblemDetailsV1,
  validateUsageSyncResultV1,
  type ProblemDetailsV1,
  type UsageSyncResultV1,
} from "@viberacing/contracts";

import {
  createCommunitySyncAdmission,
  createCommunitySyncKeyedAdmission,
} from "./community-sync-admission.js";
import { ingestDatabaseConcurrencyLimit, ingestDatabaseQueryTimeoutMs } from "./database-config.js";
import {
  communitySyncMediaType,
  communitySyncMethod,
  maximumCommunitySyncBodyBytes,
  maximumCommunitySyncRawHeaderPairs,
  usageSyncRequestTarget,
} from "./protocol.js";

const requestEntropyBytes = 16;
const maximumAcceptLength = 1_024;
const maximumAcceptRanges = 32;
const maximumAcceptParameters = 16;
const tokenPattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const qualityPattern = /^(?:0(?:\.[0-9]{0,3})?|1(?:\.0{0,3})?)$/;
const applicationKeys = new Set(["execute"]);
const closeableApplicationKeys = new Set(["close", "execute"]);
const decisionKeys = new Set(["body", "ok", "status"]);
const requiredResultKeys = new Set([
  "acceptedEntries",
  "outcome",
  "requestId",
  "schemaVersion",
  "syncId",
]);
const optionalResultKeys = new Set(["nextAllowedSyncAt", "recoveryAction"]);
const problemKeys = new Set([
  "errorCode",
  "requestId",
  "retryable",
  "schemaVersion",
  "status",
  "title",
]);
const nonPostMethods: HTTPMethods[] = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "PUT", "TRACE"];

export const communitySyncHttpPolicy = Object.freeze({
  acceptPolicy: "closed-json",
  admissionLimit: ingestDatabaseConcurrencyLimit,
  admissionMode: "no-queue",
  perDeviceAdmissionLimit: 1,
  cacheControl: "no-store",
  connectionTimeoutMs: ingestDatabaseQueryTimeoutMs + 2_000,
  corsPolicy: "same-origin",
  forwardedHeadersTrusted: false,
  framework: "fastify-v5",
  handlerTimeoutMs: ingestDatabaseQueryTimeoutMs + 1_000,
  inboundRequestIdAccepted: false,
  keepAliveTimeoutMs: 5_000,
  maximumBodyBytes: maximumCommunitySyncBodyBytes,
  maximumConnections: 32,
  maximumHeaderBytes: 16_384,
  maximumRawHeaderPairs: maximumCommunitySyncRawHeaderPairs,
  maximumRequestsPerSocket: 16,
  requestLogging: false,
  requestTimeoutMs: 5_000,
  trustProxy: false,
});

export type CommunitySyncHttpProblemKind = Extract<
  ProblemDetailsV1["errorCode"],
  | "internal_error"
  | "invalid_request"
  | "method_not_allowed"
  | "not_acceptable"
  | "not_found"
  | "temporarily_unavailable"
>;

export type CommunitySyncHttpServerErrorCode =
  "application_invalid" | "contract_rejected" | "entropy_invalid" | "entropy_unavailable";

export class CommunitySyncHttpServerError extends Error {
  readonly code: CommunitySyncHttpServerErrorCode;

  constructor(code: CommunitySyncHttpServerErrorCode) {
    super("Community sync HTTP boundary failed closed.");
    this.name = "CommunitySyncHttpServerError";
    this.code = code;
  }
}

export interface CommunitySyncHttpApplication {
  execute(request: unknown): Promise<unknown>;
}

export interface CommunitySyncClientErrorSocket {
  destroy(): unknown;
  end(response: string): unknown;
}

interface ValidatedApplication extends CommunitySyncHttpApplication {
  close?: () => Promise<void>;
}

interface ProblemDefinition {
  readonly retryable: boolean;
  readonly status: 400 | 404 | 405 | 406 | 500 | 503;
  readonly title: ProblemDetailsV1["title"];
}

interface ParsedAcceptRange {
  readonly matchesJson: boolean;
  readonly quality: number;
  readonly specificity: number;
}

interface SerializedDecision {
  readonly body: UsageSyncResultV1 | ProblemDetailsV1;
  readonly contentType:
    "application/json; charset=utf-8" | "application/problem+json; charset=utf-8";
  readonly requestId: string;
  readonly status: number;
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
  method_not_allowed: {
    retryable: false,
    status: 405,
    title: "Method not allowed",
  },
  not_acceptable: {
    retryable: false,
    status: 406,
    title: "Not acceptable",
  },
  not_found: {
    retryable: false,
    status: 404,
    title: "Not found",
  },
  temporarily_unavailable: {
    retryable: true,
    status: 503,
    title: "Temporarily unavailable",
  },
} as const satisfies Readonly<Record<CommunitySyncHttpProblemKind, ProblemDefinition>>);

const applicationProblemKinds = Object.freeze({
  400: "invalid_request",
  401: "unauthorized",
  422: "validation_failed",
  500: "internal_error",
  503: "temporarily_unavailable",
} as const satisfies Readonly<Record<number, ProblemDetailsV1["errorCode"]>>);

function fail(code: CommunitySyncHttpServerErrorCode): never {
  throw new CommunitySyncHttpServerError(code);
}

function isPlainRecord(value: unknown): value is object {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactOwnKeys(value: object, expected: ReadonlySet<string>): boolean {
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

function readApplication(value: unknown): ValidatedApplication {
  try {
    if (!isPlainRecord(value) || !Object.isFrozen(value)) {
      fail("application_invalid");
    }
    const keys = Reflect.ownKeys(value);
    const expected = keys.includes("close") ? closeableApplicationKeys : applicationKeys;
    if (!exactOwnKeys(value, expected)) {
      fail("application_invalid");
    }
    const execute = ownDataValue(value, "execute");
    const close = expected === closeableApplicationKeys ? ownDataValue(value, "close") : undefined;
    if (typeof execute !== "function" || (close !== undefined && typeof close !== "function")) {
      fail("application_invalid");
    }
    return Object.freeze({
      ...(close === undefined ? {} : { close: close as () => Promise<void> }),
      execute: execute as CommunitySyncHttpApplication["execute"],
    });
  } catch (error) {
    if (error instanceof CommunitySyncHttpServerError) {
      throw error;
    }
    fail("application_invalid");
  }
}

function canonicalRecord(
  value: unknown,
  expectedKeys: ReadonlySet<string>,
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (!isPlainRecord(value) || !Object.isFrozen(value) || !exactOwnKeys(value, expectedKeys)) {
      return undefined;
    }
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        return undefined;
      }
      result[key] = descriptor.value as unknown;
    }
    return Object.freeze(result);
  } catch {
    return undefined;
  }
}

function canonicalRecordWithOptional(
  value: unknown,
  requiredKeys: ReadonlySet<string>,
  optionalKeys: ReadonlySet<string>,
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (!isPlainRecord(value) || !Object.isFrozen(value)) {
      return undefined;
    }
    const keys = Reflect.ownKeys(value);
    if (
      keys.some(
        (key) => typeof key !== "string" || (!requiredKeys.has(key) && !optionalKeys.has(key)),
      ) ||
      [...requiredKeys].some((key) => !keys.includes(key))
    ) {
      return undefined;
    }
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        typeof key !== "string" ||
        descriptor === undefined ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      ) {
        return undefined;
      }
      result[key] = descriptor.value as unknown;
    }
    return Object.freeze(result);
  } catch {
    return undefined;
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
    if (error instanceof CommunitySyncHttpServerError) {
      throw error;
    }
    fail("entropy_invalid");
  }
}

function createProblemDecision(kind: CommunitySyncHttpProblemKind): SerializedDecision {
  const definition = problemDefinitions[kind];
  const values = Object.freeze(
    Object.assign(Object.create(null) as object, {
      schemaVersion: 1,
      requestId: createRequestId(),
      status: definition.status,
      errorCode: kind,
      title: definition.title,
      retryable: definition.retryable,
    }),
  );
  const validation = validateProblemDetailsV1(values);
  if (!validation.ok) {
    fail("contract_rejected");
  }
  return Object.freeze({
    body: validation.value,
    contentType: "application/problem+json; charset=utf-8",
    requestId: validation.value.requestId,
    status: definition.status,
  });
}

function readApplicationDecision(value: unknown): SerializedDecision | undefined {
  const decision = canonicalRecord(value, decisionKeys);
  if (decision === undefined) {
    return undefined;
  }
  const body = decision.body;
  const ok = decision.ok;
  const status = decision.status;

  if (ok === true && status === 200) {
    const candidate = canonicalRecordWithOptional(body, requiredResultKeys, optionalResultKeys);
    if (candidate === undefined) {
      return undefined;
    }
    const validation = validateUsageSyncResultV1(candidate);
    return validation.ok
      ? Object.freeze({
          body: validation.value,
          contentType: "application/json; charset=utf-8",
          requestId: validation.value.requestId,
          status: 200,
        })
      : undefined;
  }

  if (
    ok === false &&
    typeof status === "number" &&
    Object.hasOwn(applicationProblemKinds, status)
  ) {
    const candidate = canonicalRecord(body, problemKeys);
    if (candidate === undefined) {
      return undefined;
    }
    const validation = validateProblemDetailsV1(candidate);
    if (
      !validation.ok ||
      validation.value.status !== status ||
      validation.value.errorCode !==
        applicationProblemKinds[status as keyof typeof applicationProblemKinds]
    ) {
      return undefined;
    }
    return Object.freeze({
      body: validation.value,
      contentType: "application/problem+json; charset=utf-8",
      requestId: validation.value.requestId,
      status,
    });
  }

  return undefined;
}

function sendDecision(
  reply: FastifyReply,
  decision: SerializedDecision,
  allowPost = false,
): FastifyReply {
  reply.headers({
    "cache-control": communitySyncHttpPolicy.cacheControl,
    "content-type": decision.contentType,
    vary: "Accept",
    "x-content-type-options": "nosniff",
    "x-request-id": decision.requestId,
  });
  if (allowPost) {
    reply.header("allow", communitySyncMethod);
  }
  return reply.code(decision.status).send(JSON.stringify(decision.body));
}

function sendProblem(
  reply: FastifyReply,
  kind: CommunitySyncHttpProblemKind,
  allowPost = false,
): FastifyReply {
  return sendDecision(reply, createProblemDecision(kind), allowPost);
}

function invalidAcceptCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code !== 9 && (code < 32 || code > 126)) {
      return true;
    }
  }
  return false;
}

function parseAcceptRange(rawRange: string): ParsedAcceptRange | undefined {
  const parts = rawRange.split(";");
  if (parts.length < 1 || parts.length > maximumAcceptParameters) {
    return undefined;
  }
  const mediaRange = String(parts[0]).trim().toLowerCase();
  const slash = mediaRange.indexOf("/");
  if (
    slash <= 0 ||
    slash !== mediaRange.lastIndexOf("/") ||
    !tokenPattern.test(mediaRange.slice(0, slash)) ||
    !tokenPattern.test(mediaRange.slice(slash + 1))
  ) {
    return undefined;
  }
  const type = mediaRange.slice(0, slash);
  const subtype = mediaRange.slice(slash + 1);
  if (type === "*" && subtype !== "*") {
    return undefined;
  }
  const matchesJson =
    (type === "*" && subtype === "*") ||
    (type === "application" && (subtype === "*" || subtype === "json"));
  let charsetSeen = false;
  let quality = 1;
  let qualitySeen = false;

  for (const rawParameter of parts.slice(1)) {
    const parameter = rawParameter.trim();
    const equals = parameter.indexOf("=");
    if (equals <= 0 || equals !== parameter.lastIndexOf("=")) {
      return undefined;
    }
    const name = parameter.slice(0, equals).trim().toLowerCase();
    const rawValue = parameter.slice(equals + 1).trim();
    if (!tokenPattern.test(name) || !tokenPattern.test(rawValue)) {
      return undefined;
    }
    if (name === "q") {
      if (qualitySeen || !qualityPattern.test(rawValue)) {
        return undefined;
      }
      qualitySeen = true;
      quality = Number(rawValue);
    } else if (
      name === "charset" &&
      !charsetSeen &&
      !qualitySeen &&
      type === "application" &&
      subtype === "json" &&
      rawValue.toLowerCase() === "utf-8"
    ) {
      charsetSeen = true;
    } else {
      return undefined;
    }
  }
  const specificity =
    type === "application" && subtype === "json"
      ? charsetSeen
        ? 3
        : 2
      : type === "application" && subtype === "*"
        ? 1
        : 0;
  return Object.freeze({ matchesJson, quality, specificity });
}

export function acceptsCommunitySyncJson(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumAcceptLength ||
    invalidAcceptCharacter(value)
  ) {
    return false;
  }
  const ranges = value.split(",");
  if (ranges.length > maximumAcceptRanges) {
    return false;
  }
  let selectedQuality = 0;
  let selectedSpecificity = -1;
  for (const range of ranges) {
    const parsed = parseAcceptRange(range.trim());
    if (parsed === undefined) {
      return false;
    }
    if (!parsed.matchesJson) {
      continue;
    }
    if (parsed.specificity > selectedSpecificity) {
      selectedSpecificity = parsed.specificity;
      selectedQuality = parsed.quality;
    } else if (parsed.specificity === selectedSpecificity) {
      selectedQuality = Math.max(selectedQuality, parsed.quality);
    }
  }
  return selectedQuality > 0;
}

function frameworkProblemKind(error: unknown): CommunitySyncHttpProblemKind {
  try {
    const statusCode = (error as { readonly statusCode?: unknown }).statusCode;
    if (statusCode === 503) {
      return "temporarily_unavailable";
    }
    if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
      return "invalid_request";
    }
  } catch {
    return "internal_error";
  }
  return "internal_error";
}

export function writeCommunitySyncClientError(socket: CommunitySyncClientErrorSocket): void {
  try {
    const decision = createProblemDecision("invalid_request");
    const body = JSON.stringify(decision.body);
    socket.end(
      [
        "HTTP/1.1 400 Bad Request",
        "Connection: close",
        `Cache-Control: ${communitySyncHttpPolicy.cacheControl}`,
        `Content-Type: ${decision.contentType}`,
        `Content-Length: ${String(Buffer.byteLength(body))}`,
        "Vary: Accept",
        "X-Content-Type-Options: nosniff",
        `X-Request-Id: ${decision.requestId}`,
        "",
        body,
      ].join("\r\n"),
    );
  } catch {
    socket.destroy();
  }
}

function createRawEnvelope(request: FastifyRequest): Readonly<Record<string, unknown>> {
  const body = Buffer.isBuffer(request.body) ? Buffer.from(request.body) : Buffer.alloc(0);
  return Object.freeze(
    Object.assign(Object.create(null) as Record<string, unknown>, {
      method: String(request.raw.method),
      rawBody: body,
      rawHeaders: Object.freeze(request.raw.rawHeaders.slice()),
      requestTarget: String(request.raw.url),
    }),
  );
}

function methodNotAllowed(_request: FastifyRequest, reply: FastifyReply): void {
  sendProblem(reply, "method_not_allowed", true);
}

export function createCommunitySyncHttpServer(
  application: unknown,
  usageSyncEnabled = false,
): FastifyInstance {
  if (typeof usageSyncEnabled !== "boolean") {
    fail("application_invalid");
  }
  const validatedApplication = readApplication(application);
  const admission = createCommunitySyncAdmission(communitySyncHttpPolicy.admissionLimit);
  const deviceAdmission = createCommunitySyncKeyedAdmission(
    communitySyncHttpPolicy.perDeviceAdmissionLimit,
    communitySyncHttpPolicy.admissionLimit,
  );
  const options: FastifyHttpOptions<RawServerDefault> = {
    bodyLimit: communitySyncHttpPolicy.maximumBodyBytes,
    clientErrorHandler: (_error, socket) => {
      writeCommunitySyncClientError(socket);
    },
    connectionTimeout: communitySyncHttpPolicy.connectionTimeoutMs,
    exposeHeadRoutes: false,
    forceCloseConnections: false,
    handlerTimeout: communitySyncHttpPolicy.handlerTimeoutMs,
    http: {
      insecureHTTPParser: false,
      joinDuplicateHeaders: false,
      maxHeaderSize: communitySyncHttpPolicy.maximumHeaderBytes,
      rejectNonStandardBodyWrites: true,
      requireHostHeader: true,
    },
    keepAliveTimeout: communitySyncHttpPolicy.keepAliveTimeoutMs,
    logger: communitySyncHttpPolicy.requestLogging,
    maxRequestsPerSocket: communitySyncHttpPolicy.maximumRequestsPerSocket,
    onConstructorPoisoning: "error",
    onProtoPoisoning: "error",
    requestIdHeader: communitySyncHttpPolicy.inboundRequestIdAccepted,
    requestTimeout: communitySyncHttpPolicy.requestTimeoutMs,
    return503OnClosing: true,
    routerOptions: {
      caseSensitive: true,
      ignoreDuplicateSlashes: false,
      ignoreTrailingSlash: false,
      maxParamLength: 64,
    },
    trustProxy: communitySyncHttpPolicy.trustProxy,
  };
  const server = Fastify(options);

  server.server.maxConnections = communitySyncHttpPolicy.maximumConnections;
  server.server.maxHeadersCount = communitySyncHttpPolicy.maximumRawHeaderPairs + 1;
  server.server.headersTimeout = communitySyncHttpPolicy.requestTimeoutMs;
  server.removeAllContentTypeParsers();
  server.addContentTypeParser(
    communitySyncMediaType,
    { bodyLimit: communitySyncHttpPolicy.maximumBodyBytes, parseAs: "buffer" },
    (_request, body, done) => {
      done(null, Buffer.from(body));
    },
  );

  server.addHook("onRequest", (request, reply, done) => {
    if (
      request.raw.rawHeaders.length > communitySyncHttpPolicy.maximumRawHeaderPairs * 2 ||
      request.headers["content-encoding"] !== undefined
    ) {
      sendProblem(reply, "invalid_request");
      return;
    }
    done();
  });

  server.setErrorHandler((error, _request, reply) => {
    try {
      return sendProblem(reply, frameworkProblemKind(error));
    } catch {
      reply.raw.destroy();
      return reply;
    }
  });
  server.setNotFoundHandler((request, reply) => {
    if (
      usageSyncEnabled &&
      String(request.raw.url) === usageSyncRequestTarget &&
      request.raw.method !== communitySyncMethod
    ) {
      return sendProblem(reply, "method_not_allowed", true);
    }
    return sendProblem(reply, "not_found");
  });
  function registerSyncRoute(requestTarget: string): void {
    server.route({
      handler: methodNotAllowed,
      method: nonPostMethods,
      onRequest: methodNotAllowed,
      url: requestTarget,
    });
    server.post(
      requestTarget,
      {
        bodyLimit: communitySyncHttpPolicy.maximumBodyBytes,
        handlerTimeout: communitySyncHttpPolicy.handlerTimeoutMs,
      },
      async (request, reply) => {
        if (!acceptsCommunitySyncJson(request.headers.accept)) {
          sendProblem(reply, "not_acceptable");
          return;
        }
        const lease = admission.tryAcquire();
        if (lease === undefined) {
          sendProblem(reply, "temporarily_unavailable");
          return;
        }
        const deviceHeader = request.headers["x-viberacing-device-id"];
        const deviceAdmissionKey =
          typeof deviceHeader === "string" ? deviceHeader : "invalid-device";
        const deviceLease = deviceAdmission.tryAcquire(deviceAdmissionKey);
        if (deviceLease === undefined) {
          lease.release();
          sendProblem(reply, "temporarily_unavailable");
          return;
        }
        try {
          const decision = await validatedApplication.execute(createRawEnvelope(request));
          // Fastify's handler-timeout signal also observes the IncomingMessage `close` event, which
          // Node emits after a normally completed request stream. `readableAborted` distinguishes a
          // stream destroyed or errored before `end`; a timeout or later client disconnect has
          // already sent or destroyed the outgoing response.
          if (request.raw.readableAborted || reply.raw.destroyed || reply.sent) {
            return;
          }
          const serialized = readApplicationDecision(decision);
          if (serialized === undefined) {
            sendProblem(reply, "internal_error");
          } else {
            sendDecision(reply, serialized);
          }
        } finally {
          deviceLease.release();
          lease.release();
        }
      },
    );
  }

  if (usageSyncEnabled) {
    registerSyncRoute(usageSyncRequestTarget);
  }

  if (validatedApplication.close !== undefined) {
    server.addHook("onClose", async () => {
      await validatedApplication.close?.();
    });
  }
  return server;
}

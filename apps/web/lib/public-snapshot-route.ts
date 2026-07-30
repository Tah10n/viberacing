import "server-only";

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import {
  validateLeaderboardQueryV1,
  validateLeaderboardSeasonPathV1,
  validateLeaderboardSnapshotV1,
  validatePublicProfilePathV1,
  validatePublicProfileQueryV1,
  validatePublicProfileSummaryV1,
  type LeaderboardSnapshotV1,
  type PublicProfileSummaryV1,
} from "@viberacing/contracts";

import {
  PublicSnapshotDatabaseConfigurationError,
  publicSnapshotDatabaseConcurrencyLimit,
  publicSnapshotDatabaseConnectionTimeoutMs,
  publicSnapshotDatabaseQueryTimeoutMs,
  publicSnapshotDatabaseStatementTimeoutMs,
} from "./public-snapshot-database-config";
import {
  createPublicProblemResponse,
  type PublicProblemKind,
  type PublicRequestId,
} from "./public-http-problem";
import type { PublicSnapshotAdmission } from "./public-snapshot-admission";
import {
  PublicSnapshotStoreError,
  type PublicSnapshotRecord,
  type PublicSnapshotStoreErrorCode,
} from "./public-snapshot-store";

const currentLeaderboardPath = "/v1/leaderboards/current";
const seasonLeaderboardPathPrefix = "/v1/leaderboards/";
const publicProfilePathPrefix = "/v1/profiles/";
const maximumUrlLength = 2_048;
const maximumQueryLength = 128;
const maximumAcceptLength = 1_024;
const maximumAcceptRanges = 32;
const maximumAcceptParameters = 16;
const maximumIfNoneMatchLength = 1_024;
const maximumIfNoneMatchTags = 32;
const maximumPayloadBytes = 1_048_576;
const tokenPattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const qualityPattern = /^(?:0(?:\.[0-9]{0,3})?|1(?:\.0{0,3})?)$/;
const pagePattern = /^(?:[1-9]|[1-9][0-9]{1,3}|10000)$/;
const entityTagPattern = /^(?:W\/)?"[a-f0-9]{64}"$/;
const generatedAtPattern = /^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/;
const recordKeys = new Set(["canonicalPayload", "etag", "finalized", "generatedAt"]);
const unavailableStoreErrors = new Set<PublicSnapshotStoreErrorCode>([
  "connection_release_failed",
  "connection_unavailable",
  "pool_close_failed",
  "query_failed",
  "runtime_boundary_mismatch",
  "snapshot_unavailable",
]);

export const publicSnapshotOpenCacheControl =
  "public, max-age=0, s-maxage=60, stale-while-revalidate=300";
export const publicSnapshotFinalizedCacheControl =
  "public, max-age=3600, s-maxage=31536000, immutable";
export const publicSnapshotRoutePolicy = Object.freeze({
  admissionLimit: publicSnapshotDatabaseConcurrencyLimit,
  connectionTimeoutMs: publicSnapshotDatabaseConnectionTimeoutMs,
  queryTimeoutMs: publicSnapshotDatabaseQueryTimeoutMs,
  statementTimeoutMs: publicSnapshotDatabaseStatementTimeoutMs,
});

interface ParsedConditionalHeader {
  readonly any: boolean;
  readonly tags: readonly string[];
}

interface ParsedLeaderboardRequest {
  readonly conditional: ParsedConditionalHeader;
  readonly page: number;
}

interface ParsedSeasonLeaderboardRequest extends ParsedLeaderboardRequest {
  readonly seasonStart: string;
}

interface ParsedPublicProfileRequest {
  readonly conditional: ParsedConditionalHeader;
  readonly handle: string;
}

interface PublicSnapshotRouteBaseDependencies {
  readonly admission: PublicSnapshotAdmission;
  readonly createRequestId: () => PublicRequestId;
  readonly enabled: unknown;
  readonly now?: () => number;
}

export interface CurrentLeaderboardRouteDependencies extends PublicSnapshotRouteBaseDependencies {
  readonly readCurrentLeaderboard: (page: number) => Promise<unknown>;
}

export interface SeasonLeaderboardRouteDependencies extends PublicSnapshotRouteBaseDependencies {
  readonly readSeasonLeaderboard: (seasonStart: string, page: number) => Promise<unknown>;
}

export interface PublicProfileRouteDependencies extends PublicSnapshotRouteBaseDependencies {
  readonly readCurrentProfile: (handle: string) => Promise<unknown>;
}

export interface CurrentLeaderboardRoute {
  get(request: Request): Promise<Response>;
  methodNotAllowed(): Response;
}

export interface SeasonLeaderboardRoute {
  get(request: Request, parameters: Promise<unknown>): Promise<Response>;
  methodNotAllowed(): Response;
}

export interface PublicProfileRoute {
  get(request: Request, parameters: Promise<unknown>): Promise<Response>;
  methodNotAllowed(): Response;
}

function ownDataValue(object: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor !== undefined && "value" in descriptor && descriptor.enumerable
    ? (descriptor.value as unknown)
    : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function trimOptionalWhitespace(value: string): string {
  return value.replace(/^[\t ]+|[\t ]+$/g, "");
}

function hasForbiddenHeaderControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 8 || (code >= 10 && code <= 31) || code === 127) {
      return true;
    }
  }
  return false;
}

function splitQuoted(value: string, delimiter: string, limit: number): string[] | undefined {
  const parts: string[] = [];
  let escaped = false;
  let quoted = false;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
    } else if (quoted && character === "\\") {
      escaped = true;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && character === delimiter) {
      parts.push(value.slice(start, index));
      if (parts.length >= limit) {
        return undefined;
      }
      start = index + 1;
    }
  }
  if (quoted || escaped) {
    return undefined;
  }
  parts.push(value.slice(start));
  return parts.length <= limit ? parts : undefined;
}

function parameterValue(value: string): string | undefined {
  if (tokenPattern.test(value)) {
    return value;
  }
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) {
    return undefined;
  }
  let decoded = "";
  let escaped = false;
  for (const character of value.slice(1, -1)) {
    if (escaped) {
      decoded += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === '"' || hasForbiddenHeaderControl(character)) {
      return undefined;
    } else {
      decoded += character;
    }
    if (decoded.length > 128) {
      return undefined;
    }
  }
  return escaped ? undefined : decoded;
}

function rangeAcceptsJson(range: string): boolean {
  const parts = splitQuoted(range, ";", maximumAcceptParameters);
  if (parts === undefined) {
    return false;
  }
  const mediaRange = trimOptionalWhitespace(parts[0] ?? "").toLowerCase();
  const slash = mediaRange.indexOf("/");
  if (
    slash <= 0 ||
    slash !== mediaRange.lastIndexOf("/") ||
    !tokenPattern.test(mediaRange.slice(0, slash)) ||
    !tokenPattern.test(mediaRange.slice(slash + 1))
  ) {
    return false;
  }
  const type = mediaRange.slice(0, slash);
  const subtype = mediaRange.slice(slash + 1);
  if (type === "*" && subtype !== "*") {
    return false;
  }
  const matchesJson =
    (type === "*" && subtype === "*") ||
    (type === "application" && (subtype === "*" || subtype === "json"));
  let mediaParametersMatch = true;
  let quality = 1;
  let qualitySeen = false;
  for (const rawParameter of parts.slice(1)) {
    const parameter = trimOptionalWhitespace(rawParameter);
    const equals = parameter.indexOf("=");
    if (equals <= 0) {
      return false;
    }
    const name = trimOptionalWhitespace(parameter.slice(0, equals)).toLowerCase();
    const rawValue = trimOptionalWhitespace(parameter.slice(equals + 1));
    const decodedValue = parameterValue(rawValue);
    if (!tokenPattern.test(name) || decodedValue === undefined) {
      return false;
    }
    if (name === "q") {
      if (qualitySeen || !qualityPattern.test(rawValue)) {
        return false;
      }
      qualitySeen = true;
      quality = Number(rawValue);
    } else if (!qualitySeen) {
      mediaParametersMatch =
        mediaParametersMatch &&
        type === "application" &&
        subtype === "json" &&
        name === "charset" &&
        decodedValue.toLowerCase() === "utf-8";
    }
  }
  return matchesJson && mediaParametersMatch && quality > 0;
}

export function acceptsPublicSnapshotJson(accept: string | null): boolean {
  if (accept === null) {
    return true;
  }
  if (
    accept.length === 0 ||
    accept.length > maximumAcceptLength ||
    hasForbiddenHeaderControl(accept)
  ) {
    return false;
  }
  const ranges = splitQuoted(accept, ",", maximumAcceptRanges);
  return ranges?.some((range) => rangeAcceptsJson(trimOptionalWhitespace(range))) ?? false;
}

function parseIfNoneMatch(value: string | null): ParsedConditionalHeader | undefined {
  if (value === null) {
    return Object.freeze({ any: false, tags: Object.freeze([]) });
  }
  if (
    value.length === 0 ||
    value.length > maximumIfNoneMatchLength ||
    hasForbiddenHeaderControl(value)
  ) {
    return undefined;
  }
  if (trimOptionalWhitespace(value) === "*") {
    return Object.freeze({ any: true, tags: Object.freeze([]) });
  }
  const rawTags = value.split(",");
  if (rawTags.length === 0 || rawTags.length > maximumIfNoneMatchTags) {
    return undefined;
  }
  const tags: string[] = [];
  for (const rawTag of rawTags) {
    const tag = trimOptionalWhitespace(rawTag);
    if (!entityTagPattern.test(tag)) {
      return undefined;
    }
    tags.push(tag.startsWith("W/") ? tag.slice(2) : tag);
  }
  return Object.freeze({ any: false, tags: Object.freeze(tags) });
}

function parseExactQuery(
  search: string,
  includePage: boolean,
): { readonly page?: number; readonly trustTier: "community" } | undefined {
  if (search.length < 2 || search.length > maximumQueryLength || !search.startsWith("?")) {
    return undefined;
  }
  const pairs = search.slice(1).split("&");
  if (pairs.length !== (includePage ? 2 : 1)) {
    return undefined;
  }
  let page: number | undefined;
  let trustTier: string | undefined;
  for (const pair of pairs) {
    const equals = pair.indexOf("=");
    if (equals <= 0 || equals !== pair.lastIndexOf("=")) {
      return undefined;
    }
    const key = pair.slice(0, equals);
    const value = pair.slice(equals + 1);
    if (key === "trustTier" && trustTier === undefined) {
      trustTier = value;
    } else if (includePage && key === "page" && page === undefined && pagePattern.test(value)) {
      page = Number(value);
    } else {
      return undefined;
    }
  }
  if (trustTier !== "community") {
    return undefined;
  }
  if (!includePage) {
    return Object.freeze({ trustTier: "community" });
  }
  if (page === undefined) {
    return undefined;
  }
  const validation = validateLeaderboardQueryV1({ page, trustTier });
  return validation.ok ? validation.value : undefined;
}

function parseRequestUrl(request: Request): URL | undefined {
  try {
    if (
      request.body !== null ||
      request.headers.has("transfer-encoding") ||
      !["0", null].includes(request.headers.get("content-length"))
    ) {
      return undefined;
    }
    const text = request.url;
    if (text.length === 0 || text.length > maximumUrlLength) {
      return undefined;
    }
    const url = new URL(text);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      url.hash === ""
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

function parseHeaders(
  request: Request,
): Readonly<{ conditional: ParsedConditionalHeader }> | undefined {
  try {
    if (!acceptsPublicSnapshotJson(request.headers.get("accept"))) {
      return undefined;
    }
    const conditional = parseIfNoneMatch(request.headers.get("if-none-match"));
    return conditional === undefined ? undefined : Object.freeze({ conditional });
  } catch {
    return undefined;
  }
}

function acceptProblem(request: Request): "invalid_request" | "not_acceptable" | undefined {
  try {
    return acceptsPublicSnapshotJson(request.headers.get("accept")) ? undefined : "not_acceptable";
  } catch {
    return "invalid_request";
  }
}

export function parseCurrentLeaderboardRequest(
  request: Request,
): ParsedLeaderboardRequest | undefined {
  const url = parseRequestUrl(request);
  const headers = parseHeaders(request);
  if (url === undefined || headers === undefined || url.pathname !== currentLeaderboardPath) {
    return undefined;
  }
  const query = parseExactQuery(url.search, true);
  return query?.page === undefined
    ? undefined
    : Object.freeze({ conditional: headers.conditional, page: query.page });
}

export function parseSeasonLeaderboardRequest(
  request: Request,
  parameters: unknown,
): ParsedSeasonLeaderboardRequest | undefined {
  const path = validateLeaderboardSeasonPathV1(parameters);
  const url = parseRequestUrl(request);
  const headers = parseHeaders(request);
  if (
    !path.ok ||
    url === undefined ||
    headers === undefined ||
    url.pathname !== `${seasonLeaderboardPathPrefix}${path.value.seasonStart}`
  ) {
    return undefined;
  }
  const query = parseExactQuery(url.search, true);
  return query?.page === undefined
    ? undefined
    : Object.freeze({
        conditional: headers.conditional,
        page: query.page,
        seasonStart: path.value.seasonStart,
      });
}

export function parsePublicProfileRequest(
  request: Request,
  parameters: unknown,
): ParsedPublicProfileRequest | undefined {
  const path = validatePublicProfilePathV1(parameters);
  const url = parseRequestUrl(request);
  const headers = parseHeaders(request);
  if (
    !path.ok ||
    url === undefined ||
    headers === undefined ||
    url.pathname !== `${publicProfilePathPrefix}${path.value.handle}`
  ) {
    return undefined;
  }
  const query = parseExactQuery(url.search, false);
  if (query === undefined || !validatePublicProfileQueryV1(query).ok) {
    return undefined;
  }
  return Object.freeze({ conditional: headers.conditional, handle: path.value.handle });
}

function problemResponse(
  kind: PublicProblemKind,
  requestId: PublicRequestId,
  allowGet = false,
): Response {
  const response = createPublicProblemResponse(kind, requestId);
  response.headers.set("vary", "Accept");
  if (allowGet) {
    response.headers.set("allow", "GET");
  }
  return response;
}

function dependencyProblem(error: unknown): PublicProblemKind {
  try {
    if (error instanceof PublicSnapshotDatabaseConfigurationError) {
      return "temporarily_unavailable";
    }
    if (error instanceof PublicSnapshotStoreError) {
      if (error.code === "not_found") {
        return "not_found";
      }
      if (unavailableStoreErrors.has(error.code)) {
        return "temporarily_unavailable";
      }
    }
  } catch {
    // Hostile thrown values remain opaque.
  }
  return "internal_error";
}

function validateRecord<T>(
  value: unknown,
  validatePayload: (
    value: unknown,
  ) => { readonly ok: false } | { readonly ok: true; readonly value: T },
  verifyPayload: (value: T, record: PublicSnapshotRecord) => boolean,
): PublicSnapshotRecord | undefined {
  try {
    if (
      !isPlainRecord(value) ||
      Reflect.ownKeys(value).length !== recordKeys.size ||
      Reflect.ownKeys(value).some((key) => typeof key !== "string" || !recordKeys.has(key))
    ) {
      return undefined;
    }
    const canonicalPayload = ownDataValue(value, "canonicalPayload");
    const etag = ownDataValue(value, "etag");
    const finalized = ownDataValue(value, "finalized");
    const generatedAt = ownDataValue(value, "generatedAt");
    if (
      typeof canonicalPayload !== "string" ||
      Buffer.byteLength(canonicalPayload, "utf8") < 2 ||
      Buffer.byteLength(canonicalPayload, "utf8") > maximumPayloadBytes ||
      typeof etag !== "string" ||
      !entityTagPattern.test(etag) ||
      etag.startsWith("W/") ||
      typeof finalized !== "boolean" ||
      typeof generatedAt !== "string" ||
      !generatedAtPattern.test(generatedAt) ||
      !Number.isFinite(Date.parse(generatedAt))
    ) {
      return undefined;
    }
    const digest = createHash("sha256").update(canonicalPayload, "utf8").digest("hex");
    if (etag !== `"${digest}"`) {
      return undefined;
    }
    const validation = validatePayload(JSON.parse(canonicalPayload) as unknown);
    const record = Object.freeze({ canonicalPayload, etag, finalized, generatedAt });
    return validation.ok && verifyPayload(validation.value, record) ? record : undefined;
  } catch {
    return undefined;
  }
}

function validateLeaderboardRecord(
  value: unknown,
  page: number,
  seasonStart?: string,
): PublicSnapshotRecord | undefined {
  return validateRecord(
    value,
    validateLeaderboardSnapshotV1,
    (payload: LeaderboardSnapshotV1, record) =>
      payload.page === page &&
      payload.generatedAt === record.generatedAt &&
      record.finalized === (payload.seasonState === "finalized") &&
      (seasonStart === undefined || payload.seasonStart === seasonStart),
  );
}

function validateProfileRecord(value: unknown, handle: string): PublicSnapshotRecord | undefined {
  return validateRecord(
    value,
    validatePublicProfileSummaryV1,
    (payload: PublicProfileSummaryV1, record) =>
      payload.handle === handle &&
      record.finalized === (payload.season.seasonState === "finalized"),
  );
}

function conditionalMatches(conditional: ParsedConditionalHeader, etag: string): boolean {
  return conditional.any || conditional.tags.includes(etag);
}

type SnapshotFreshness =
  "finalized" | "fresh" | "stale-under-5m" | "stale-under-1h" | "stale-under-1d" | "stale-over-1d";

function snapshotFreshness(
  record: PublicSnapshotRecord,
  now: () => number,
): SnapshotFreshness | undefined {
  if (record.finalized) {
    return "finalized";
  }
  try {
    const current = now();
    const generated = Date.parse(record.generatedAt);
    if (!Number.isFinite(current) || current < 0 || !Number.isFinite(generated)) {
      return undefined;
    }
    const ageSeconds = Math.max(0, Math.floor((current - generated) / 1_000));
    if (ageSeconds <= 120) {
      return "fresh";
    }
    if (ageSeconds <= 300) {
      return "stale-under-5m";
    }
    if (ageSeconds <= 3_600) {
      return "stale-under-1h";
    }
    if (ageSeconds <= 86_400) {
      return "stale-under-1d";
    }
    return "stale-over-1d";
  } catch {
    return undefined;
  }
}

function successResponse(
  record: PublicSnapshotRecord,
  conditional: ParsedConditionalHeader,
  requestId: PublicRequestId,
  immutableFinalized: boolean,
  now: () => number,
): Response | undefined {
  const freshness = snapshotFreshness(record, now);
  if (freshness === undefined) {
    return undefined;
  }
  const headers = new Headers({
    "cache-control":
      immutableFinalized && record.finalized
        ? publicSnapshotFinalizedCacheControl
        : publicSnapshotOpenCacheControl,
    etag: record.etag,
    vary: "Accept",
    "x-request-id": requestId.value,
    "x-viberacing-snapshot-freshness": freshness,
  });
  if (freshness.startsWith("stale-")) {
    headers.set("warning", '110 - "Response is stale"');
  }
  if (conditionalMatches(conditional, record.etag)) {
    return new Response(null, { headers, status: 304 });
  }
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(record.canonicalPayload, { headers, status: 200 });
}

function methodNotAllowed(createRequestId: () => PublicRequestId): Response {
  return problemResponse("method_not_allowed", createRequestId(), true);
}

export function createCurrentLeaderboardRoute(
  dependencies: CurrentLeaderboardRouteDependencies,
): CurrentLeaderboardRoute {
  const now = dependencies.now ?? Date.now;
  return Object.freeze({
    async get(request: Request): Promise<Response> {
      const requestId = dependencies.createRequestId();
      if (request.method !== "GET") {
        return problemResponse("method_not_allowed", requestId, true);
      }
      if (dependencies.enabled !== true) {
        return problemResponse("temporarily_unavailable", requestId);
      }
      const acceptFailure = acceptProblem(request);
      if (acceptFailure !== undefined) {
        return problemResponse(acceptFailure, requestId);
      }
      const parsed = parseCurrentLeaderboardRequest(request);
      if (parsed === undefined) {
        return problemResponse("invalid_request", requestId);
      }
      const lease = dependencies.admission.tryAcquire();
      if (lease === undefined) {
        return problemResponse("temporarily_unavailable", requestId);
      }
      try {
        const record = validateLeaderboardRecord(
          await dependencies.readCurrentLeaderboard(parsed.page),
          parsed.page,
        );
        if (record === undefined) {
          return problemResponse("internal_error", requestId);
        }
        return (
          successResponse(record, parsed.conditional, requestId, false, now) ??
          problemResponse("internal_error", requestId)
        );
      } catch (error) {
        return problemResponse(dependencyProblem(error), requestId);
      } finally {
        lease.release();
      }
    },
    methodNotAllowed: () => methodNotAllowed(dependencies.createRequestId),
  });
}

export function createSeasonLeaderboardRoute(
  dependencies: SeasonLeaderboardRouteDependencies,
): SeasonLeaderboardRoute {
  const now = dependencies.now ?? Date.now;
  return Object.freeze({
    async get(request: Request, parameters: Promise<unknown>): Promise<Response> {
      const requestId = dependencies.createRequestId();
      if (request.method !== "GET") {
        return problemResponse("method_not_allowed", requestId, true);
      }
      if (dependencies.enabled !== true) {
        return problemResponse("temporarily_unavailable", requestId);
      }
      const acceptFailure = acceptProblem(request);
      if (acceptFailure !== undefined) {
        return problemResponse(acceptFailure, requestId);
      }
      let path: unknown;
      try {
        path = await parameters;
      } catch {
        return problemResponse("invalid_request", requestId);
      }
      const parsed = parseSeasonLeaderboardRequest(request, path);
      if (parsed === undefined) {
        return problemResponse("invalid_request", requestId);
      }
      const lease = dependencies.admission.tryAcquire();
      if (lease === undefined) {
        return problemResponse("temporarily_unavailable", requestId);
      }
      try {
        const record = validateLeaderboardRecord(
          await dependencies.readSeasonLeaderboard(parsed.seasonStart, parsed.page),
          parsed.page,
          parsed.seasonStart,
        );
        if (record === undefined) {
          return problemResponse("internal_error", requestId);
        }
        return (
          successResponse(record, parsed.conditional, requestId, true, now) ??
          problemResponse("internal_error", requestId)
        );
      } catch (error) {
        return problemResponse(dependencyProblem(error), requestId);
      } finally {
        lease.release();
      }
    },
    methodNotAllowed: () => methodNotAllowed(dependencies.createRequestId),
  });
}

export function createPublicProfileRoute(
  dependencies: PublicProfileRouteDependencies,
): PublicProfileRoute {
  const now = dependencies.now ?? Date.now;
  return Object.freeze({
    async get(request: Request, parameters: Promise<unknown>): Promise<Response> {
      const requestId = dependencies.createRequestId();
      if (request.method !== "GET") {
        return problemResponse("method_not_allowed", requestId, true);
      }
      if (dependencies.enabled !== true) {
        return problemResponse("temporarily_unavailable", requestId);
      }
      const acceptFailure = acceptProblem(request);
      if (acceptFailure !== undefined) {
        return problemResponse(acceptFailure, requestId);
      }
      let path: unknown;
      try {
        path = await parameters;
      } catch {
        return problemResponse("invalid_request", requestId);
      }
      const parsed = parsePublicProfileRequest(request, path);
      if (parsed === undefined) {
        return problemResponse("invalid_request", requestId);
      }
      const lease = dependencies.admission.tryAcquire();
      if (lease === undefined) {
        return problemResponse("temporarily_unavailable", requestId);
      }
      try {
        const record = validateProfileRecord(
          await dependencies.readCurrentProfile(parsed.handle),
          parsed.handle,
        );
        if (record === undefined) {
          return problemResponse("internal_error", requestId);
        }
        return (
          successResponse(record, parsed.conditional, requestId, false, now) ??
          problemResponse("internal_error", requestId)
        );
      } catch (error) {
        return problemResponse(dependencyProblem(error), requestId);
      } finally {
        lease.release();
      }
    },
    methodNotAllowed: () => methodNotAllowed(dependencies.createRequestId),
  });
}

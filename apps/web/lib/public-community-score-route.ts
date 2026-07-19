import "server-only";

import {
  validateCommunityRacePageV1,
  validateCommunityRaceStatusPageV1,
  validateCommunityScorePageV1,
  validateCommunityScoreQueryV1,
  type CommunityScoreQueryV1,
} from "@viberacing/contracts";

import {
  PublicCommunityScoreStoreError,
  type PublicCommunityScoreStoreErrorCode,
} from "./public-community-score-store";
import {
  PublicScoreDatabaseConfigurationError,
  publicScoreDatabaseConcurrencyLimit,
  publicScoreDatabaseConnectionTimeoutMs,
  publicScoreDatabaseQueryTimeoutMs,
  publicScoreDatabaseStatementTimeoutMs,
} from "./public-score-database-config";
import {
  createPublicProblemResponse,
  type PublicProblemKind,
  type PublicRequestId,
} from "./public-http-problem";
import type { PublicScoreAdmission } from "./public-score-admission";

const raceRoutePath = "/v1/community/race";
const raceStatusRoutePath = "/v1/community/race/status";
const scoreRoutePath = "/v1/community/scores";
const queryPrefix = "?seasonStart=";
const maximumUrlLength = 2_048;
const maximumQueryLength = 128;
const maximumAcceptLength = 1_024;
const maximumAcceptRanges = 32;
const maximumAcceptParameters = 16;
const tokenPattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const qualityPattern = /^(?:0(?:\.[0-9]{0,3})?|1(?:\.0{0,3})?)$/;
const unavailableStoreErrors = new Set<PublicCommunityScoreStoreErrorCode>([
  "connection_release_failed",
  "connection_unavailable",
  "query_failed",
  "runtime_boundary_mismatch",
]);

export const publicCommunityScoreRoutePolicy = Object.freeze({
  admissionLimit: publicScoreDatabaseConcurrencyLimit,
  connectionTimeoutMs: publicScoreDatabaseConnectionTimeoutMs,
  queryTimeoutMs: publicScoreDatabaseQueryTimeoutMs,
  statementTimeoutMs: publicScoreDatabaseStatementTimeoutMs,
});
export const publicCommunityRaceRoutePolicy = publicCommunityScoreRoutePolicy;
export const publicCommunityRaceStatusRoutePolicy = publicCommunityScoreRoutePolicy;

export interface PublicCommunityScoreRouteDependencies {
  readonly admission: PublicScoreAdmission;
  readonly createRequestId: () => PublicRequestId;
  readonly enabled: unknown;
  readonly readScores: (seasonStart: string) => Promise<unknown>;
}

export interface PublicCommunityRaceRouteDependencies {
  readonly admission: PublicScoreAdmission;
  readonly createRequestId: () => PublicRequestId;
  readonly enabled: unknown;
  readonly readRace: (seasonStart: string) => Promise<unknown>;
}

export interface PublicCommunityRaceStatusRouteDependencies {
  readonly admission: PublicScoreAdmission;
  readonly createRequestId: () => PublicRequestId;
  readonly enabled: unknown;
  readonly readRaceStatus: (seasonStart: string) => Promise<unknown>;
}

export interface PublicCommunityScoreRoute {
  get(request: Request): Promise<Response>;
  methodNotAllowed(): Response;
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

export function acceptsPublicCommunityScoreJson(accept: string | null): boolean {
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

function parsePublicCommunityQuery(
  request: Request,
  expectedPath: string,
): CommunityScoreQueryV1 | undefined {
  try {
    const contentLength = request.headers.get("content-length");
    if (
      request.body !== null ||
      (contentLength !== null && contentLength !== "0") ||
      request.headers.has("transfer-encoding")
    ) {
      return undefined;
    }
    const urlText = request.url;
    if (urlText.length === 0 || urlText.length > maximumUrlLength) {
      return undefined;
    }
    const url = new URL(urlText);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== "" ||
      url.pathname !== expectedPath ||
      url.search.length > maximumQueryLength ||
      !url.search.startsWith(queryPrefix) ||
      url.search.includes("&")
    ) {
      return undefined;
    }
    const rawValue = url.search.slice(queryPrefix.length);
    if (rawValue.length === 0 || rawValue.includes("=")) {
      return undefined;
    }
    const seasonStart = decodeURIComponent(rawValue.replaceAll("+", " "));
    const candidate = Object.freeze(
      Object.assign(Object.create(null) as Record<string, unknown>, {
        seasonStart,
      }),
    );
    const validation = validateCommunityScoreQueryV1(candidate);
    return validation.ok ? validation.value : undefined;
  } catch {
    return undefined;
  }
}

export function parsePublicCommunityScoreQuery(
  request: Request,
): CommunityScoreQueryV1 | undefined {
  return parsePublicCommunityQuery(request, scoreRoutePath);
}

export function parsePublicCommunityRaceQuery(request: Request): CommunityScoreQueryV1 | undefined {
  return parsePublicCommunityQuery(request, raceRoutePath);
}

export function parsePublicCommunityRaceStatusQuery(
  request: Request,
): CommunityScoreQueryV1 | undefined {
  return parsePublicCommunityQuery(request, raceStatusRoutePath);
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
    if (error instanceof PublicScoreDatabaseConfigurationError) {
      return "temporarily_unavailable";
    }
    if (error instanceof PublicCommunityScoreStoreError && unavailableStoreErrors.has(error.code)) {
      return "temporarily_unavailable";
    }
  } catch {
    // A hostile thrown value is treated as an opaque internal failure.
  }
  return "internal_error";
}

interface PublicCommunityRouteComposition {
  readonly admission: PublicScoreAdmission;
  readonly createRequestId: () => PublicRequestId;
  readonly enabled: unknown;
  readonly parseQuery: (request: Request) => CommunityScoreQueryV1 | undefined;
  readonly readPage: (seasonStart: string) => Promise<unknown>;
  readonly validatePage: (
    value: unknown,
  ) => { readonly ok: false } | { readonly ok: true; readonly value: unknown };
}

function createPublicCommunityRoute(
  dependencies: PublicCommunityRouteComposition,
): PublicCommunityScoreRoute {
  return Object.freeze({
    async get(request: Request): Promise<Response> {
      const requestId = dependencies.createRequestId();
      if (request.method !== "GET") {
        return problemResponse("method_not_allowed", requestId, true);
      }
      if (dependencies.enabled !== true) {
        return problemResponse("temporarily_unavailable", requestId);
      }
      const query = dependencies.parseQuery(request);
      if (query === undefined) {
        return problemResponse("invalid_request", requestId);
      }
      let accept: string | null;
      try {
        accept = request.headers.get("accept");
      } catch {
        return problemResponse("invalid_request", requestId);
      }
      if (!acceptsPublicCommunityScoreJson(accept)) {
        return problemResponse("not_acceptable", requestId);
      }
      const lease = dependencies.admission.tryAcquire();
      if (lease === undefined) {
        return problemResponse("temporarily_unavailable", requestId);
      }
      try {
        const page = await dependencies.readPage(query.seasonStart);
        const validation = dependencies.validatePage(page);
        if (!validation.ok) {
          return problemResponse("internal_error", requestId);
        }
        return new Response(JSON.stringify(validation.value), {
          headers: {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
            vary: "Accept",
            "x-request-id": requestId.value,
          },
          status: 200,
        });
      } catch (error) {
        return problemResponse(dependencyProblem(error), requestId);
      } finally {
        lease.release();
      }
    },
    methodNotAllowed(): Response {
      return problemResponse("method_not_allowed", dependencies.createRequestId(), true);
    },
  });
}

export function createPublicCommunityScoreRoute(
  dependencies: PublicCommunityScoreRouteDependencies,
): PublicCommunityScoreRoute {
  return createPublicCommunityRoute({
    admission: dependencies.admission,
    createRequestId: dependencies.createRequestId,
    enabled: dependencies.enabled,
    parseQuery: parsePublicCommunityScoreQuery,
    readPage: dependencies.readScores,
    validatePage: validateCommunityScorePageV1,
  });
}

export function createPublicCommunityRaceRoute(
  dependencies: PublicCommunityRaceRouteDependencies,
): PublicCommunityScoreRoute {
  return createPublicCommunityRoute({
    admission: dependencies.admission,
    createRequestId: dependencies.createRequestId,
    enabled: dependencies.enabled,
    parseQuery: parsePublicCommunityRaceQuery,
    readPage: dependencies.readRace,
    validatePage: validateCommunityRacePageV1,
  });
}

export function createPublicCommunityRaceStatusRoute(
  dependencies: PublicCommunityRaceStatusRouteDependencies,
): PublicCommunityScoreRoute {
  return createPublicCommunityRoute({
    admission: dependencies.admission,
    createRequestId: dependencies.createRequestId,
    enabled: dependencies.enabled,
    parseQuery: parsePublicCommunityRaceStatusQuery,
    readPage: dependencies.readRaceStatus,
    validatePage: validateCommunityRaceStatusPageV1,
  });
}

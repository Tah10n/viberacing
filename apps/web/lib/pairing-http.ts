import "server-only";

import { Buffer } from "node:buffer";

import {
  validateConnectorPairingPollResultV1,
  validateConnectorPairingPollV1,
  validateConnectorPairingStartResultV1,
  validateConnectorPairingStartV1,
  type ConnectorPairingPollResultV1,
  type ConnectorPairingPollV1,
  type ConnectorPairingStartResultV1,
  type ConnectorPairingStartV1,
} from "@viberacing/contracts";

import { pairingClientIdHeader } from "./pairing-rate-policy";
import {
  createPublicProblemResponse,
  createPublicRequestId,
  type PublicProblemKind,
} from "./public-http-problem";
import type { PairingTransportService } from "./pairing-transport-service";

const startPath = "/v1/connector/pairing/start";
const pollPath = "/v1/connector/pairing/poll";
const maximumBodyBytes = 1_024;
const maximumResponseBytes = 2_048;
const maximumUrlLength = 2_048;
const maximumAcceptLength = 1_024;
const jsonContentTypePattern = /^application\/json(?:;[\t ]*charset=[\t ]*utf-8)?$/i;
const qualityPattern = /^(?:0(?:\.[0-9]{0,3})?|1(?:\.0{0,3})?)$/;

export interface PairingHttpDependencies {
  readonly getService: () => Promise<Pick<PairingTransportService, "poll" | "start">>;
}

export interface PairingHttp {
  methodNotAllowed(request?: Request): Response;
  poll(request: Request): Promise<Response>;
  start(request: Request): Promise<Response>;
}

interface StringToken {
  readonly next: number;
  readonly value: string;
}

function discardBody(request: Request | undefined): void {
  void request?.body?.cancel().catch(() => undefined);
}

function problem(kind: PublicProblemKind, allowPost = false): Response {
  const response = createPublicProblemResponse(kind, createPublicRequestId());
  response.headers.set("referrer-policy", "no-referrer");
  response.headers.set("vary", "Accept");
  if (allowPost) {
    response.headers.set("allow", "POST");
  }
  return response;
}

function containsAsciiControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function acceptsJson(value: string | null): boolean {
  if (value === null) {
    return true;
  }
  if (value.length === 0 || value.length > maximumAcceptLength || containsAsciiControl(value)) {
    return false;
  }
  const ranges = value.split(",");
  if (ranges.length > 32) {
    return false;
  }
  return ranges.some((range) => {
    const parts = range.split(";").map((part) => part.trim());
    if (parts.length === 0 || parts.length > 4) {
      return false;
    }
    const media = parts[0]?.toLowerCase();
    const matches = media === "*/*" || media === "application/*" || media === "application/json";
    if (!matches) {
      return false;
    }
    let quality = 1;
    let qualitySeen = false;
    for (const parameter of parts.slice(1)) {
      const separator = parameter.indexOf("=");
      if (separator <= 0) {
        return false;
      }
      const name = parameter.slice(0, separator).trim().toLowerCase();
      const parameterValue = parameter
        .slice(separator + 1)
        .trim()
        .toLowerCase();
      if (name === "q") {
        if (qualitySeen || !qualityPattern.test(parameterValue)) {
          return false;
        }
        qualitySeen = true;
        quality = Number(parameterValue);
      } else if (name !== "charset" || parameterValue !== "utf-8" || media !== "application/json") {
        return false;
      }
    }
    return quality > 0;
  });
}

function exactRequest(request: Request, expectedPath: string): boolean {
  try {
    if (request.method !== "POST" || request.url.length > maximumUrlLength) {
      return false;
    }
    const url = new URL(request.url);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      url.hash === "" &&
      url.pathname === expectedPath &&
      url.search === ""
    );
  } catch {
    return false;
  }
}

async function boundedBody(request: Request): Promise<string | undefined> {
  const contentLength = request.headers.get("content-length");
  const contentEncoding = request.headers.get("content-encoding");
  if (
    request.headers.has("transfer-encoding") ||
    (contentEncoding !== null && contentEncoding.toLowerCase() !== "identity") ||
    (contentLength !== null &&
      (!/^(?:0|[1-9][0-9]*)$/.test(contentLength) || Number(contentLength) > maximumBodyBytes))
  ) {
    discardBody(request);
    return undefined;
  }
  if (request.body === null) {
    return undefined;
  }
  const expectedLength = contentLength === null ? undefined : Number(contentLength);
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      if (total + chunk.value.byteLength > maximumBodyBytes) {
        chunk.value.fill(0);
        void reader.cancel().catch(() => undefined);
        return undefined;
      }
      const copy = Buffer.from(chunk.value);
      chunk.value.fill(0);
      chunks.push(copy);
      total += copy.byteLength;
    }
    if (total === 0 || (expectedLength !== undefined && expectedLength !== total)) {
      return undefined;
    }
    const bytes = Buffer.concat(chunks, total);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return undefined;
    } finally {
      bytes.fill(0);
    }
  } catch {
    return undefined;
  } finally {
    for (const chunk of chunks) {
      chunk.fill(0);
    }
    reader.releaseLock();
  }
}

function skipWhitespace(value: string, start: number): number {
  let index = start;
  while (index < value.length && /[\t\n\r ]/.test(value[index] ?? "")) {
    index += 1;
  }
  return index;
}

function readString(value: string, start: number): StringToken | undefined {
  if (value[start] !== '"') {
    return undefined;
  }
  for (let index = start + 1; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\\") {
      index += 1;
      if (index >= value.length) {
        return undefined;
      }
      continue;
    }
    if (character === '"') {
      try {
        const decoded: unknown = JSON.parse(value.slice(start, index + 1));
        return typeof decoded === "string" ? { next: index + 1, value: decoded } : undefined;
      } catch {
        return undefined;
      }
    }
    if (character !== undefined && character.charCodeAt(0) <= 0x1f) {
      return undefined;
    }
  }
  return undefined;
}

function readScalar(
  value: string,
  start: number,
): { readonly next: number; readonly value: unknown } | undefined {
  if (value[start] === '"') {
    return readString(value, start);
  }
  let end = start;
  while (end < value.length && value[end] !== "," && value[end] !== "}") {
    end += 1;
  }
  const token = value.slice(start, end).trim();
  if (token.length === 0 || token.includes("{") || token.includes("[") || token.includes('"')) {
    return undefined;
  }
  try {
    const decoded: unknown = JSON.parse(token);
    return decoded === null || typeof decoded !== "object"
      ? { next: end, value: decoded }
      : undefined;
  } catch {
    return undefined;
  }
}

function parseFlatJson(value: string): Readonly<Record<string, unknown>> | undefined {
  try {
    let index = skipWhitespace(value, 0);
    if (value[index] !== "{") {
      return undefined;
    }
    index = skipWhitespace(value, index + 1);
    const result = Object.create(null) as Record<string, unknown>;
    const keys = new Set<string>();
    if (value[index] === "}") {
      return skipWhitespace(value, index + 1) === value.length ? Object.freeze(result) : undefined;
    }
    while (keys.size < 16) {
      const key = readString(value, index);
      if (key === undefined || keys.has(key.value)) {
        return undefined;
      }
      keys.add(key.value);
      index = skipWhitespace(value, key.next);
      if (value[index] !== ":") {
        return undefined;
      }
      index = skipWhitespace(value, index + 1);
      const scalar = readScalar(value, index);
      if (scalar === undefined) {
        return undefined;
      }
      Object.defineProperty(result, key.value, {
        enumerable: true,
        value: scalar.value,
        writable: false,
      });
      index = skipWhitespace(value, scalar.next);
      if (value[index] === "}") {
        return skipWhitespace(value, index + 1) === value.length
          ? Object.freeze(result)
          : undefined;
      }
      if (value[index] !== ",") {
        return undefined;
      }
      index = skipWhitespace(value, index + 1);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function success(
  body: ConnectorPairingPollResultV1 | ConnectorPairingStartResultV1,
): Response | undefined {
  try {
    const encoded = JSON.stringify(body);
    if (Buffer.byteLength(encoded, "utf8") > maximumResponseBytes) {
      return undefined;
    }
    return new Response(encoded, {
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
        "referrer-policy": "no-referrer",
        vary: "Accept",
        "x-request-id": body.requestId,
      },
      status: 200,
    });
  } catch {
    return undefined;
  }
}

async function readRequest(
  request: Request,
  expectedPath: string,
): Promise<
  { readonly clientId: string; readonly value: Readonly<Record<string, unknown>> } | undefined
> {
  if (
    !exactRequest(request, expectedPath) ||
    !jsonContentTypePattern.test(request.headers.get("content-type") ?? "")
  ) {
    discardBody(request);
    return undefined;
  }
  const clientId = request.headers.get(pairingClientIdHeader);
  if (clientId === null) {
    discardBody(request);
    return undefined;
  }
  const body = await boundedBody(request);
  const parsed = body === undefined ? undefined : parseFlatJson(body);
  return parsed === undefined ? undefined : { clientId, value: parsed };
}

export function createPairingHttp(dependencies: PairingHttpDependencies): PairingHttp {
  async function service(): Promise<Pick<PairingTransportService, "poll" | "start"> | undefined> {
    try {
      return await dependencies.getService();
    } catch {
      return undefined;
    }
  }

  return Object.freeze({
    methodNotAllowed(request?: Request): Response {
      discardBody(request);
      return problem("method_not_allowed", true);
    },
    async poll(request: Request): Promise<Response> {
      if (!acceptsJson(request.headers.get("accept"))) {
        discardBody(request);
        return problem("not_acceptable");
      }
      const input = await readRequest(request, pollPath);
      if (input === undefined) {
        return problem("invalid_request");
      }
      const validation = validateConnectorPairingPollV1(input.value);
      if (!validation.ok) {
        return problem("invalid_request");
      }
      const currentService = await service();
      if (currentService === undefined) {
        return problem("temporarily_unavailable");
      }
      const body: ConnectorPairingPollV1 = validation.value;
      const decision = await currentService
        .poll(
          Object.freeze({
            clientIdBase64Url: input.clientId,
            pollToken: body.pollToken,
            possessionSignature: body.possessionSignature,
          }),
        )
        .catch(() => undefined);
      if (decision === undefined || decision.outcome === "not_activated") {
        return problem("temporarily_unavailable");
      }
      if (decision.outcome === "rate_limited") {
        return problem("rate_limited");
      }
      const candidate = Object.freeze({
        schemaVersion: 1 as const,
        requestId: decision.requestId,
        deviceBindings:
          decision.outcome === "activated"
            ? Object.freeze([
                Object.freeze({ deviceId: decision.deviceId, sourceId: decision.sourceId }),
              ])
            : Object.freeze([]),
      });
      const response = validateConnectorPairingPollResultV1(candidate);
      return response.ok
        ? (success(response.value) ?? problem("internal_error"))
        : problem("internal_error");
    },
    async start(request: Request): Promise<Response> {
      if (!acceptsJson(request.headers.get("accept"))) {
        discardBody(request);
        return problem("not_acceptable");
      }
      const input = await readRequest(request, startPath);
      if (input === undefined) {
        return problem("invalid_request");
      }
      const validation = validateConnectorPairingStartV1(input.value);
      if (!validation.ok) {
        return problem("invalid_request");
      }
      const currentService = await service();
      if (currentService === undefined) {
        return problem("temporarily_unavailable");
      }
      const body: ConnectorPairingStartV1 = validation.value;
      const decision = await currentService
        .start(
          Object.freeze({
            architecture: body.architecture,
            clientIdBase64Url: input.clientId,
            connectorVersion: body.connectorVersion,
            deviceLabel: body.deviceLabel,
            devicePublicKeyBase64Url: body.devicePublicKeyBase64Url,
            osFamily: body.osFamily,
          }),
        )
        .catch(() => undefined);
      if (decision === undefined || decision.outcome === "not_created") {
        return problem("temporarily_unavailable");
      }
      if (decision.outcome === "rate_limited") {
        return problem("rate_limited");
      }
      const candidate = Object.freeze({
        schemaVersion: 1 as const,
        requestId: decision.requestId,
        pairingId: decision.pairingId,
        pollToken: decision.pollToken,
        pairingChallengeBase64Url: decision.pairingChallengeBase64Url,
        userCode: decision.userCode,
        expiresAt: decision.expiresAt,
      });
      const response = validateConnectorPairingStartResultV1(candidate);
      return response.ok
        ? (success(response.value) ?? problem("internal_error"))
        : problem("internal_error");
    },
  });
}

import "server-only";

import { Buffer } from "node:buffer";

import {
  validateConnectorCarProposalResultV1,
  type ConnectorCarProposalResultV1,
} from "@viberacing/contracts";

import {
  createConnectorCarProposalAdmission,
  type ConnectorCarProposalAdmission,
} from "./connector-car-proposal-admission";
import type { ConnectorCarProposalService } from "./connector-car-proposal-service";
import {
  connectorCarProposalMaximumBodyBytes,
  connectorCarProposalMediaType,
  connectorCarProposalPath,
} from "./connector-car-proposal-verifier";
import {
  createPublicProblemResponse,
  createPublicRequestId,
  type PublicProblemKind,
  type PublicRequestId,
} from "./public-http-problem";

const maximumUrlLength = 2_048;
const maximumAcceptLength = 256;
const maximumResponseBytes = 512;
const jsonContentTypePattern = /^application\/json(?:;[\t ]*charset=[\t ]*utf-8)?$/i;
const qualityPattern = /^(?:0(?:\.[0-9]{0,3})?|1(?:\.0{0,3})?)$/;
const deviceHeaders = Object.freeze({
  deviceId: "x-viberacing-device-id",
  nonce: "x-viberacing-device-nonce",
  signature: "x-viberacing-device-signature",
  timestamp: "x-viberacing-device-timestamp",
});
const allowedViberacingHeaders = new Set<string>(Object.values(deviceHeaders));

export interface ConnectorCarProposalHttpDependencies {
  readonly admission?: ConnectorCarProposalAdmission;
  readonly carProposalsEnabled?: unknown;
  readonly getService: () => Promise<Pick<ConnectorCarProposalService, "execute">>;
}

export interface ConnectorCarProposalHttp {
  methodNotAllowed(request?: Request): Response;
  post(request: Request): Promise<Response>;
}

function discardBody(request: Request | undefined): void {
  void request?.body?.cancel().catch(() => undefined);
}

function problem(kind: PublicProblemKind, requestId: PublicRequestId, allowPost = false): Response {
  const response = createPublicProblemResponse(kind, requestId);
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
    const media = parts[0]?.toLowerCase();
    if (
      parts.length === 0 ||
      parts.length > 4 ||
      (media !== "*/*" && media !== "application/*" && media !== connectorCarProposalMediaType)
    ) {
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
      } else if (
        name !== "charset" ||
        parameterValue !== "utf-8" ||
        media !== connectorCarProposalMediaType
      ) {
        return false;
      }
    }
    return quality > 0;
  });
}

function exactRequest(request: Request): boolean {
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
      url.pathname === connectorCarProposalPath &&
      url.search === ""
    );
  } catch {
    return false;
  }
}

function exactSecurityHeaders(headers: Headers): boolean {
  try {
    let count = 0;
    for (const [name, value] of headers) {
      count += 1;
      if (
        count > 32 ||
        name.length === 0 ||
        name.length > 64 ||
        value.length > 256 ||
        containsAsciiControl(name) ||
        containsAsciiControl(value)
      ) {
        return false;
      }
      const lowerName = name.toLowerCase();
      if (lowerName.startsWith("x-viberacing-") && !allowedViberacingHeaders.has(lowerName)) {
        return false;
      }
    }
    return Object.values(deviceHeaders).every((name) => {
      const value = headers.get(name);
      return value !== null && value.length > 0 && value.length <= 256 && !value.includes(",");
    });
  } catch {
    return false;
  }
}

async function readBody(request: Request): Promise<Buffer | undefined> {
  const contentLength = request.headers.get("content-length");
  const contentEncoding = request.headers.get("content-encoding");
  if (
    request.headers.has("transfer-encoding") ||
    (contentEncoding !== null && contentEncoding.toLowerCase() !== "identity") ||
    (contentLength !== null &&
      (!/^(?:0|[1-9][0-9]*)$/.test(contentLength) ||
        Number(contentLength) > connectorCarProposalMaximumBodyBytes))
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
      if (total + chunk.value.byteLength > connectorCarProposalMaximumBodyBytes) {
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
    return Buffer.concat(chunks, total);
  } catch {
    return undefined;
  } finally {
    for (const chunk of chunks) {
      chunk.fill(0);
    }
    reader.releaseLock();
  }
}

function success(body: ConnectorCarProposalResultV1): Response | undefined {
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

export function createConnectorCarProposalHttp(
  dependencies: ConnectorCarProposalHttpDependencies,
): ConnectorCarProposalHttp {
  const admission = dependencies.admission ?? createConnectorCarProposalAdmission(4);
  return Object.freeze({
    methodNotAllowed(request?: Request): Response {
      discardBody(request);
      return problem("method_not_allowed", createPublicRequestId(), true);
    },
    async post(request: Request): Promise<Response> {
      const requestId = createPublicRequestId();
      if (dependencies.carProposalsEnabled !== true) {
        discardBody(request);
        return problem("temporarily_unavailable", requestId);
      }
      if (!acceptsJson(request.headers.get("accept"))) {
        discardBody(request);
        return problem("not_acceptable", requestId);
      }
      if (
        !exactRequest(request) ||
        !jsonContentTypePattern.test(request.headers.get("content-type") ?? "") ||
        !exactSecurityHeaders(request.headers)
      ) {
        discardBody(request);
        return problem("invalid_request", requestId);
      }
      const lease = admission.tryAcquire();
      if (lease === undefined) {
        discardBody(request);
        return problem("rate_limited", requestId);
      }
      let rawBody: Buffer | undefined;
      try {
        rawBody = await readBody(request);
        if (rawBody === undefined) {
          return problem("invalid_request", requestId);
        }
        let service: Pick<ConnectorCarProposalService, "execute">;
        try {
          service = await dependencies.getService();
        } catch {
          return problem("temporarily_unavailable", requestId);
        }
        const decision = await service
          .execute(
            Object.freeze({
              deviceId: request.headers.get(deviceHeaders.deviceId),
              deviceNonce: request.headers.get(deviceHeaders.nonce),
              deviceSignature: request.headers.get(deviceHeaders.signature),
              deviceTimestamp: request.headers.get(deviceHeaders.timestamp),
              rawBody,
            }),
            requestId.value,
          )
          .catch(() => undefined);
        if (decision?.requestId !== requestId.value) {
          return problem("internal_error", requestId);
        }
        if (decision.outcome === "rejected") {
          return problem(decision.problem, requestId);
        }
        const response = validateConnectorCarProposalResultV1(
          Object.freeze({
            schemaVersion: 1 as const,
            requestId: requestId.value,
            outcome: "accepted" as const,
          }),
        );
        return response.ok
          ? (success(response.value) ?? problem("internal_error", requestId))
          : problem("internal_error", requestId);
      } finally {
        rawBody?.fill(0);
        lease.release();
      }
    },
  });
}

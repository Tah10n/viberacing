import "server-only";

import { Buffer } from "node:buffer";

import {
  validateConnectorPairingPollResultV1,
  validateConnectorPairingStartResultV1,
} from "@viberacing/contracts";

import {
  createPublicProblemResponse,
  createPublicRequestId,
  type PublicProblemKind,
} from "./public-http-problem";
import type { PairingTransportService } from "./pairing-transport-service";

const paths = {
  poll: "/v1/connector/pairing/poll",
  start: "/v1/connector/pairing/start",
} as const;
const maximumRequestBytes = 32_768;
const maximumResponseBytes = 16_384;
const maximumUrlLength = 2_048;
const maximumHeaderLength = 1_024;
const jsonContentTypePattern = /^application\/json(?:;[\t ]*charset=[\t ]*utf-8)?$/i;

export interface PairingHttpDependencies {
  readonly enabled: unknown;
  readonly getService: () => Promise<Pick<PairingTransportService, "poll" | "start">>;
}

export interface PairingHttp {
  methodNotAllowed(request?: Request): Response;
  poll(request: Request): Promise<Response>;
  start(request: Request): Promise<Response>;
}

function discardBody(request: Request | undefined): void {
  void request?.body?.cancel().catch(() => undefined);
}

function headers(contentType = false): Headers {
  return new Headers({
    "cache-control": "no-store",
    ...(contentType ? { "content-type": "application/json; charset=utf-8" } : {}),
    "referrer-policy": "no-referrer",
    vary: "Accept",
    "x-content-type-options": "nosniff",
  });
}

function problem(kind: PublicProblemKind, allowPost = false): Response {
  const response = createPublicProblemResponse(kind, createPublicRequestId());
  response.headers.set("cache-control", "no-store");
  response.headers.set("referrer-policy", "no-referrer");
  response.headers.set("vary", "Accept");
  response.headers.set("x-content-type-options", "nosniff");
  if (allowPost) {
    response.headers.set("allow", "POST");
  }
  return response;
}

function acceptable(request: Request): boolean {
  const value = request.headers.get("accept");
  if (value === null) {
    return true;
  }
  return (
    value.length <= maximumHeaderLength &&
    value
      .split(",")
      .map((part) => part.trim().split(";", 1)[0]?.toLowerCase())
      .some((mediaType) => mediaType === "application/json" || mediaType === "*/*")
  );
}

function exactRequest(request: Request, path: string): boolean {
  if (
    request.method !== "POST" ||
    request.url.length > maximumUrlLength ||
    !acceptable(request) ||
    !jsonContentTypePattern.test(request.headers.get("content-type") ?? "")
  ) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  if (url.pathname !== path || url.search !== "" || url.hash !== "") {
    return false;
  }
  const contentLength = request.headers.get("content-length");
  return (
    contentLength === null ||
    (/^(?:0|[1-9][0-9]{0,5})$/.test(contentLength) &&
      Number(contentLength) > 0 &&
      Number(contentLength) <= maximumRequestBytes)
  );
}

async function boundedJson(request: Request): Promise<unknown> {
  try {
    const bytes = Buffer.from(await request.arrayBuffer());
    try {
      if (bytes.length === 0 || bytes.length > maximumRequestBytes) {
        return undefined;
      }
      const text = bytes.toString("utf8");
      if (Buffer.byteLength(text, "utf8") !== bytes.length) {
        return undefined;
      }
      return JSON.parse(text) as unknown;
    } finally {
      bytes.fill(0);
    }
  } catch {
    return undefined;
  }
}

function json(value: unknown): Response {
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body, "utf8") > maximumResponseBytes) {
    return problem("temporarily_unavailable");
  }
  return new Response(body, { headers: headers(true), status: 200 });
}

export function createPairingHttp(dependencies: PairingHttpDependencies): PairingHttp {
  async function dispatch(request: Request, operation: "poll" | "start"): Promise<Response> {
    if (dependencies.enabled !== true) {
      discardBody(request);
      return problem("temporarily_unavailable");
    }
    if (!exactRequest(request, paths[operation])) {
      discardBody(request);
      return problem("invalid_request");
    }
    const body = await boundedJson(request);
    if (body === undefined) {
      return problem("invalid_request");
    }
    try {
      const service = await dependencies.getService();
      if (operation === "start") {
        const decision = await service.start(body);
        if (decision.outcome !== "created") {
          return problem(
            decision.outcome === "invalid" ? "invalid_request" : "temporarily_unavailable",
          );
        }
        const validation = validateConnectorPairingStartResultV1(decision.result);
        return validation.ok ? json(validation.value) : problem("temporarily_unavailable");
      }
      const decision = await service.poll(body);
      if (decision.outcome !== "ok") {
        return problem(
          decision.outcome === "invalid" ? "invalid_request" : "temporarily_unavailable",
        );
      }
      const validation = validateConnectorPairingPollResultV1(decision.result);
      return validation.ok ? json(validation.value) : problem("temporarily_unavailable");
    } catch {
      return problem("temporarily_unavailable");
    }
  }

  return Object.freeze({
    methodNotAllowed(request?: Request): Response {
      discardBody(request);
      return problem("method_not_allowed", true);
    },
    poll(request: Request): Promise<Response> {
      return dispatch(request, "poll");
    },
    start(request: Request): Promise<Response> {
      return dispatch(request, "start");
    },
  });
}

import "server-only";

import { Buffer } from "node:buffer";

import type { BatchPairingBrowserService } from "./batch-pairing-browser-service";
import { clearEnrollmentCookie, readCookie, serializeEnrollmentCookie } from "./enrollment-cookie";
import type { EnrollmentAdmission } from "./enrollment-admission";
import { createPublicProblemResponse, createPublicRequestId } from "./public-http-problem";

const paths = {
  options: "/auth/pairing/options",
  review: "/auth/pairing/review",
  verify: "/auth/pairing/verify",
} as const;
const sessionCookieName = "viberacing_session";
const approvalCookieName = "viberacing_pairing_approval";
const approvalCookiePath = "/auth/pairing";
const contentTypePattern = /^application\/json(?:;[\t ]*charset=[\t ]*utf-8)?$/i;

export interface BatchPairingBrowserHttpDependencies {
  readonly admission: EnrollmentAdmission;
  readonly enabled: unknown;
  readonly getService: () => BatchPairingBrowserService;
  readonly publicOrigin: string;
  readonly secureCookies: boolean;
}

export interface BatchPairingBrowserHttp {
  options(request: Request): Promise<Response>;
  review(request: Request): Promise<Response>;
  verify(request: Request): Promise<Response>;
}

function problem(kind: "invalid_request" | "temporarily_unavailable" | "unauthorized"): Response {
  const response = createPublicProblemResponse(kind, createPublicRequestId());
  response.headers.set("cache-control", "no-store");
  response.headers.set("referrer-policy", "no-referrer");
  response.headers.set("x-content-type-options", "nosniff");
  return response;
}

function noStore(extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set("cache-control", "no-store");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  return headers;
}

function exactRequest(request: Request, path: string, origin: string): boolean {
  if (
    request.method !== "POST" ||
    request.url.length > 2_048 ||
    !contentTypePattern.test(request.headers.get("content-type") ?? "") ||
    request.headers.get("origin") !== origin
  ) {
    return false;
  }
  try {
    const url = new URL(request.url);
    return url.origin === origin && url.pathname === path && url.search === "" && url.hash === "";
  } catch {
    return false;
  }
}

async function body(request: Request, maximumBytes: number): Promise<unknown> {
  try {
    const bytes = Buffer.from(await request.arrayBuffer());
    try {
      if (bytes.length === 0 || bytes.length > maximumBytes) {
        return undefined;
      }
      const text = bytes.toString("utf8");
      return Buffer.byteLength(text, "utf8") === bytes.length
        ? (JSON.parse(text) as unknown)
        : undefined;
    } finally {
      bytes.fill(0);
    }
  } catch {
    return undefined;
  }
}

export function createBatchPairingBrowserHttp(
  dependencies: BatchPairingBrowserHttpDependencies,
): BatchPairingBrowserHttp {
  async function admitted<T>(
    request: Request,
    path: string,
    maximumBytes: number,
    operation: (
      service: BatchPairingBrowserService,
      sessionCookie: string,
      parsed: unknown,
      request: Request,
    ) => Promise<T>,
  ): Promise<T | Response> {
    if (dependencies.enabled !== true) {
      void request.body?.cancel().catch(() => undefined);
      return problem("temporarily_unavailable");
    }
    if (!exactRequest(request, path, dependencies.publicOrigin)) {
      void request.body?.cancel().catch(() => undefined);
      return problem("invalid_request");
    }
    const lease = dependencies.admission.tryAcquire();
    if (lease === undefined) {
      void request.body?.cancel().catch(() => undefined);
      return problem("temporarily_unavailable");
    }
    try {
      const parsed = await body(request, maximumBytes);
      if (parsed === undefined) {
        return problem("invalid_request");
      }
      const sessionCookie = readCookie(request.headers.get("cookie"), sessionCookieName);
      if (sessionCookie === undefined) {
        return problem("unauthorized");
      }
      return await operation(dependencies.getService(), sessionCookie, parsed, request);
    } catch {
      return problem("temporarily_unavailable");
    } finally {
      lease.release();
    }
  }

  return Object.freeze({
    async options(request: Request): Promise<Response> {
      const result = await admitted(
        request,
        paths.options,
        8_192,
        async (service, sessionCookie, parsed) =>
          await service.beginApproval(sessionCookie, parsed),
      );
      if (result instanceof Response) {
        return result;
      }
      if (result === undefined) {
        return problem("unauthorized");
      }
      return new Response(JSON.stringify({ options: result.options }), {
        headers: noStore({
          "content-type": "application/json; charset=utf-8",
          "set-cookie": serializeEnrollmentCookie(
            approvalCookieName,
            result.approvalCookie,
            300,
            dependencies.secureCookies,
            approvalCookiePath,
          ),
        }),
        status: 200,
      });
    },
    async review(request: Request): Promise<Response> {
      const result = await admitted(
        request,
        paths.review,
        256,
        async (service, sessionCookie, parsed) => await service.review(sessionCookie, parsed),
      );
      if (result instanceof Response) {
        return result;
      }
      return result === undefined
        ? problem("unauthorized")
        : new Response(JSON.stringify(result), {
            headers: noStore({ "content-type": "application/json; charset=utf-8" }),
            status: 200,
          });
    },
    async verify(request: Request): Promise<Response> {
      const result = await admitted(
        request,
        paths.verify,
        16_384,
        async (service, sessionCookie, parsed, currentRequest) => {
          const approvalCookie = readCookie(
            currentRequest.headers.get("cookie"),
            approvalCookieName,
          );
          return approvalCookie === undefined
            ? false
            : await service.completeApproval(sessionCookie, approvalCookie, parsed);
        },
      );
      if (result instanceof Response) {
        return result;
      }
      if (!result) {
        return problem("unauthorized");
      }
      return new Response(null, {
        headers: noStore({
          "set-cookie": clearEnrollmentCookie(
            approvalCookieName,
            dependencies.secureCookies,
            approvalCookiePath,
          ),
        }),
        status: 204,
      });
    },
  });
}

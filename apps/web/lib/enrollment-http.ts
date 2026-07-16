import "server-only";

import { Buffer } from "node:buffer";

import type { EnrollmentAdmission } from "./enrollment-admission";
import { clearEnrollmentCookie, readCookie, serializeEnrollmentCookie } from "./enrollment-cookie";
import { parseJoinRequest } from "./enrollment-domain";
import type { EnrollmentRuntime } from "./enrollment-runtime";
import { enrollmentCookieNames } from "./enrollment-service";
import { createPublicProblemResponse, createPublicRequestId } from "./public-http-problem";

const formContentTypePattern = /^application\/x-www-form-urlencoded(?:;\s*charset=utf-8)?$/i;
const jsonContentTypePattern = /^application\/json(?:;\s*charset=utf-8)?$/i;
const callbackCancellationKeys = new Set(["error", "error_description", "error_uri", "state"]);
const enrollmentCookiePaths = Object.freeze({
  login: "/auth/login",
  oauth: "/auth/github/callback",
  passkey: "/auth/passkey",
  passkeyAdd: "/auth/passkeys/add",
  passkeyRevoke: "/auth/passkeys/revoke",
  profileDeletion: "/auth/profile/delete",
  session: "/",
});

export interface EnrollmentHttp {
  callback(request: Request): Promise<Response>;
  loginOptions(request: Request): Promise<Response>;
  loginVerify(request: Request): Promise<Response>;
  logout(request: Request): Promise<Response>;
  passkeyOptions(request: Request): Promise<Response>;
  passkeyAddOptions(request: Request): Promise<Response>;
  passkeyAddVerify(request: Request): Promise<Response>;
  passkeyRevokeOptions(request: Request): Promise<Response>;
  passkeyRevokeVerify(request: Request): Promise<Response>;
  passkeyVerify(request: Request): Promise<Response>;
  profileDeletionOptions(request: Request): Promise<Response>;
  profileDeletionVerify(request: Request): Promise<Response>;
  profileVisibility(request: Request): Promise<Response>;
  start(request: Request): Promise<Response>;
}

interface EnrollmentHttpDependencies {
  readonly admission: EnrollmentAdmission;
  readonly getRuntime: () => EnrollmentRuntime;
}

function problem(kind: "invalid_request" | "temporarily_unavailable" | "unauthorized"): Response {
  const response = createPublicProblemResponse(kind, createPublicRequestId());
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}

function noStoreHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("cache-control", "no-store");
  headers.set("referrer-policy", "no-referrer");
  return headers;
}

function redirect(origin: string, path: string, cookies: readonly string[] = []): Response {
  const headers = noStoreHeaders({ location: new URL(path, origin).href });
  for (const cookie of cookies) {
    headers.append("set-cookie", cookie);
  }
  return new Response(null, { headers, status: 303 });
}

function exactOrigin(request: Request, runtime: EnrollmentRuntime, expectedPath: string): boolean {
  try {
    const url = new URL(request.url);
    const publicUrl = new URL(runtime.config.publicOrigin);
    return (
      url.pathname === expectedPath &&
      url.search === "" &&
      request.headers.get("host") === publicUrl.host &&
      request.headers.get("origin") === publicUrl.origin
    );
  } catch {
    return false;
  }
}

function contentType(request: Request, pattern: RegExp): boolean {
  const value = request.headers.get("content-type");
  return value !== null && pattern.test(value);
}

function discardBody(request: Request): void {
  void request.body?.cancel().catch(() => undefined);
}

function readProfileVisibilityForm(value: string): boolean | undefined {
  const parameters = new URLSearchParams(value);
  const keys = [...parameters.keys()];
  if (keys.length !== 1 || keys[0] !== "visibility") {
    return undefined;
  }
  const visibility = parameters.get("visibility");
  return visibility === "public" ? true : visibility === "hidden" ? false : undefined;
}

async function boundedBody(request: Request, maximumBytes: number): Promise<string | undefined> {
  const contentLength = request.headers.get("content-length");
  const contentEncoding = request.headers.get("content-encoding");
  if (
    (contentEncoding !== null && contentEncoding.toLowerCase() !== "identity") ||
    (contentLength !== null &&
      (!/^\d+$/.test(contentLength) || Number(contentLength) > maximumBytes))
  ) {
    void request.body?.cancel().catch(() => undefined);
    return undefined;
  }
  if (request.body === null) {
    return "";
  }
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let finished = false;
  try {
    while (!finished) {
      const chunk = await reader.read();
      if (chunk.done) {
        finished = true;
        continue;
      }
      if (totalBytes + chunk.value.byteLength > maximumBytes) {
        chunk.value.fill(0);
        void reader.cancel().catch(() => undefined);
        return undefined;
      }
      const copy = Buffer.from(chunk.value);
      chunk.value.fill(0);
      chunks.push(copy);
      totalBytes += copy.byteLength;
    }
    const bytes = Buffer.concat(chunks, totalBytes);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return undefined;
    } finally {
      bytes.fill(0);
    }
  } catch {
    void reader.cancel().catch(() => undefined);
    return undefined;
  } finally {
    for (const chunk of chunks) {
      chunk.fill(0);
    }
    reader.releaseLock();
  }
}

function callbackQuery(
  request: Request,
  expectedOrigin: string,
):
  | { readonly code: string; readonly kind: "success"; readonly state: string }
  | { readonly kind: "cancelled"; readonly state: string }
  | undefined {
  if (request.url.length > 2048) {
    return undefined;
  }
  try {
    const url = new URL(request.url);
    const publicUrl = new URL(expectedOrigin);
    if (
      request.headers.get("host") !== publicUrl.host ||
      url.pathname !== "/auth/github/callback"
    ) {
      return undefined;
    }
    const keys = [...url.searchParams.keys()];
    if (new Set(keys).size !== keys.length) {
      return undefined;
    }
    if (keys.length === 2 && keys.includes("code") && keys.includes("state")) {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      return code === null || state === null ? undefined : { code, kind: "success", state };
    }
    const state = url.searchParams.get("state");
    if (
      keys.length >= 2 &&
      keys.length <= callbackCancellationKeys.size &&
      keys.every((key) => callbackCancellationKeys.has(key)) &&
      url.searchParams.get("error") === "access_denied" &&
      state !== null &&
      /^[A-Za-z0-9_-]{43}$/.test(state)
    ) {
      return { kind: "cancelled", state };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function createEnrollmentHttp(dependencies: EnrollmentHttpDependencies): EnrollmentHttp {
  function runtime(): EnrollmentRuntime | undefined {
    try {
      return dependencies.getRuntime();
    } catch {
      return undefined;
    }
  }

  return Object.freeze({
    async callback(request: Request): Promise<Response> {
      const currentRuntime = runtime();
      if (currentRuntime === undefined) {
        return problem("temporarily_unavailable");
      }
      const query = callbackQuery(request, currentRuntime.config.publicOrigin);
      if (query === undefined) {
        return problem("invalid_request");
      }
      const clearOauth = clearEnrollmentCookie(
        enrollmentCookieNames.oauth,
        currentRuntime.config.secureCookies,
        enrollmentCookiePaths.oauth,
      );
      const oauthCookie = readCookie(request.headers.get("cookie"), enrollmentCookieNames.oauth);
      if (query.kind === "cancelled") {
        if (
          oauthCookie === undefined ||
          !currentRuntime.service.cancelGithub(query.state, oauthCookie)
        ) {
          return problem("invalid_request");
        }
        return redirect(currentRuntime.config.publicOrigin, "/join?error=unavailable", [
          clearOauth,
        ]);
      }
      const lease = dependencies.admission.tryAcquire();
      if (oauthCookie === undefined || lease === undefined) {
        return redirect(currentRuntime.config.publicOrigin, "/join?error=unavailable", [
          clearOauth,
        ]);
      }
      try {
        const decision = await currentRuntime.service.completeGithub(
          query.code,
          query.state,
          oauthCookie,
          AbortSignal.timeout(10_000),
        );
        if (decision === undefined) {
          return redirect(currentRuntime.config.publicOrigin, "/join?error=unavailable", [
            clearOauth,
          ]);
        }
        return redirect(currentRuntime.config.publicOrigin, "/join/passkey", [
          clearOauth,
          serializeEnrollmentCookie(
            enrollmentCookieNames.session,
            decision.sessionCookie,
            15 * 60,
            currentRuntime.config.secureCookies,
            enrollmentCookiePaths.session,
          ),
        ]);
      } finally {
        lease.release();
      }
    },
    async loginOptions(request: Request): Promise<Response> {
      const currentRuntime = runtime();
      if (currentRuntime === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      if (
        !exactOrigin(request, currentRuntime, "/auth/login/options") ||
        !contentType(request, jsonContentTypePattern)
      ) {
        discardBody(request);
        return problem("invalid_request");
      }
      const lease = dependencies.admission.tryAcquire();
      if (lease === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      try {
        if ((await boundedBody(request, 2)) !== "{}") {
          return problem("invalid_request");
        }
        const decision = await currentRuntime.service.beginLogin();
        if (decision === undefined) {
          return problem("temporarily_unavailable");
        }
        return new Response(JSON.stringify(decision.options), {
          headers: noStoreHeaders({
            "content-type": "application/json; charset=utf-8",
            "set-cookie": serializeEnrollmentCookie(
              enrollmentCookieNames.login,
              decision.loginCookie,
              300,
              currentRuntime.config.secureCookies,
              enrollmentCookiePaths.login,
            ),
          }),
          status: 200,
        });
      } finally {
        lease.release();
      }
    },
    async loginVerify(request: Request): Promise<Response> {
      const currentRuntime = runtime();
      if (currentRuntime === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      if (
        !exactOrigin(request, currentRuntime, "/auth/login/verify") ||
        !contentType(request, jsonContentTypePattern)
      ) {
        discardBody(request);
        return problem("invalid_request");
      }
      const lease = dependencies.admission.tryAcquire();
      if (lease === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      try {
        const body = await boundedBody(request, 16_384);
        if (body === undefined) {
          return problem("invalid_request");
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(body) as unknown;
        } catch {
          return problem("invalid_request");
        }
        const loginCookie = readCookie(request.headers.get("cookie"), enrollmentCookieNames.login);
        if (loginCookie === undefined) {
          return problem("unauthorized");
        }
        const decision = await currentRuntime.service.completeLogin(loginCookie, parsed);
        if (decision === undefined) {
          return problem("unauthorized");
        }
        const headers = noStoreHeaders();
        headers.append(
          "set-cookie",
          clearEnrollmentCookie(
            enrollmentCookieNames.login,
            currentRuntime.config.secureCookies,
            enrollmentCookiePaths.login,
          ),
        );
        headers.append(
          "set-cookie",
          serializeEnrollmentCookie(
            enrollmentCookieNames.session,
            decision.sessionCookie,
            30 * 24 * 60 * 60,
            currentRuntime.config.secureCookies,
            enrollmentCookiePaths.session,
          ),
        );
        return new Response(null, { headers, status: 204 });
      } finally {
        lease.release();
      }
    },
    async passkeyAddOptions(request: Request): Promise<Response> {
      const currentRuntime = runtime();
      if (currentRuntime === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      if (
        !exactOrigin(request, currentRuntime, "/auth/passkeys/add/options") ||
        !contentType(request, jsonContentTypePattern)
      ) {
        discardBody(request);
        return problem("invalid_request");
      }
      const lease = dependencies.admission.tryAcquire();
      if (lease === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      try {
        const body = await boundedBody(request, 256);
        if (body === undefined) {
          return problem("invalid_request");
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(body) as unknown;
        } catch {
          return problem("invalid_request");
        }
        const sessionCookie = readCookie(
          request.headers.get("cookie"),
          enrollmentCookieNames.session,
        );
        if (sessionCookie === undefined) {
          return problem("unauthorized");
        }
        const decision = await currentRuntime.service.beginPasskeyAdd(sessionCookie, parsed);
        if (decision === undefined) {
          return problem("unauthorized");
        }
        return new Response(
          JSON.stringify({
            authenticationOptions: decision.authenticationOptions,
            registrationOptions: decision.registrationOptions,
          }),
          {
            headers: noStoreHeaders({
              "content-type": "application/json; charset=utf-8",
              "set-cookie": serializeEnrollmentCookie(
                enrollmentCookieNames.passkeyAdd,
                decision.passkeyAddCookie,
                300,
                currentRuntime.config.secureCookies,
                enrollmentCookiePaths.passkeyAdd,
              ),
            }),
            status: 200,
          },
        );
      } finally {
        lease.release();
      }
    },
    async passkeyAddVerify(request: Request): Promise<Response> {
      const currentRuntime = runtime();
      if (currentRuntime === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      if (
        !exactOrigin(request, currentRuntime, "/auth/passkeys/add/verify") ||
        !contentType(request, jsonContentTypePattern)
      ) {
        discardBody(request);
        return problem("invalid_request");
      }
      const lease = dependencies.admission.tryAcquire();
      if (lease === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      try {
        const body = await boundedBody(request, 32_768);
        if (body === undefined) {
          return problem("invalid_request");
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(body) as unknown;
        } catch {
          return problem("invalid_request");
        }
        const cookieHeader = request.headers.get("cookie");
        const sessionCookie = readCookie(cookieHeader, enrollmentCookieNames.session);
        const passkeyAddCookie = readCookie(cookieHeader, enrollmentCookieNames.passkeyAdd);
        if (sessionCookie === undefined || passkeyAddCookie === undefined) {
          return problem("unauthorized");
        }
        const added = await currentRuntime.service.completePasskeyAdd(
          sessionCookie,
          passkeyAddCookie,
          parsed,
        );
        if (!added) {
          return problem("unauthorized");
        }
        return new Response(null, {
          headers: noStoreHeaders({
            "set-cookie": clearEnrollmentCookie(
              enrollmentCookieNames.passkeyAdd,
              currentRuntime.config.secureCookies,
              enrollmentCookiePaths.passkeyAdd,
            ),
          }),
          status: 204,
        });
      } finally {
        lease.release();
      }
    },
    async passkeyRevokeOptions(request: Request): Promise<Response> {
      const currentRuntime = runtime();
      if (currentRuntime === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      if (
        !exactOrigin(request, currentRuntime, "/auth/passkeys/revoke/options") ||
        !contentType(request, jsonContentTypePattern)
      ) {
        discardBody(request);
        return problem("invalid_request");
      }
      const lease = dependencies.admission.tryAcquire();
      if (lease === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      try {
        const body = await boundedBody(request, 64);
        if (body === undefined) {
          return problem("invalid_request");
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(body) as unknown;
        } catch {
          return problem("invalid_request");
        }
        const sessionCookie = readCookie(
          request.headers.get("cookie"),
          enrollmentCookieNames.session,
        );
        if (sessionCookie === undefined) {
          return problem("unauthorized");
        }
        const decision = await currentRuntime.service.beginPasskeyRevoke(sessionCookie, parsed);
        if (decision === undefined) {
          return problem("unauthorized");
        }
        return new Response(JSON.stringify(decision.options), {
          headers: noStoreHeaders({
            "content-type": "application/json; charset=utf-8",
            "set-cookie": serializeEnrollmentCookie(
              enrollmentCookieNames.passkeyRevoke,
              decision.passkeyRevokeCookie,
              300,
              currentRuntime.config.secureCookies,
              enrollmentCookiePaths.passkeyRevoke,
            ),
          }),
          status: 200,
        });
      } finally {
        lease.release();
      }
    },
    async passkeyRevokeVerify(request: Request): Promise<Response> {
      const currentRuntime = runtime();
      if (currentRuntime === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      if (
        !exactOrigin(request, currentRuntime, "/auth/passkeys/revoke/verify") ||
        !contentType(request, jsonContentTypePattern)
      ) {
        discardBody(request);
        return problem("invalid_request");
      }
      const lease = dependencies.admission.tryAcquire();
      if (lease === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      try {
        const body = await boundedBody(request, 16_384);
        if (body === undefined) {
          return problem("invalid_request");
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(body) as unknown;
        } catch {
          return problem("invalid_request");
        }
        const cookieHeader = request.headers.get("cookie");
        const sessionCookie = readCookie(cookieHeader, enrollmentCookieNames.session);
        const passkeyRevokeCookie = readCookie(cookieHeader, enrollmentCookieNames.passkeyRevoke);
        if (sessionCookie === undefined || passkeyRevokeCookie === undefined) {
          return problem("unauthorized");
        }
        const revoked = await currentRuntime.service.completePasskeyRevoke(
          sessionCookie,
          passkeyRevokeCookie,
          parsed,
        );
        if (!revoked) {
          return problem("unauthorized");
        }
        return new Response(null, {
          headers: noStoreHeaders({
            "set-cookie": clearEnrollmentCookie(
              enrollmentCookieNames.passkeyRevoke,
              currentRuntime.config.secureCookies,
              enrollmentCookiePaths.passkeyRevoke,
            ),
          }),
          status: 204,
        });
      } finally {
        lease.release();
      }
    },
    async profileDeletionOptions(request: Request): Promise<Response> {
      const currentRuntime = runtime();
      if (currentRuntime === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      if (
        !exactOrigin(request, currentRuntime, "/auth/profile/delete/options") ||
        !contentType(request, jsonContentTypePattern)
      ) {
        discardBody(request);
        return problem("invalid_request");
      }
      const lease = dependencies.admission.tryAcquire();
      if (lease === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      try {
        const body = await boundedBody(request, 64);
        if (body === undefined) {
          return problem("invalid_request");
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(body) as unknown;
        } catch {
          return problem("invalid_request");
        }
        const sessionCookie = readCookie(
          request.headers.get("cookie"),
          enrollmentCookieNames.session,
        );
        if (sessionCookie === undefined) {
          return problem("unauthorized");
        }
        const decision = await currentRuntime.service.beginProfileDeletion(sessionCookie, parsed);
        if (decision === undefined) {
          return problem("unauthorized");
        }
        return new Response(JSON.stringify(decision.options), {
          headers: noStoreHeaders({
            "content-type": "application/json; charset=utf-8",
            "set-cookie": serializeEnrollmentCookie(
              enrollmentCookieNames.profileDeletion,
              decision.profileDeletionCookie,
              300,
              currentRuntime.config.secureCookies,
              enrollmentCookiePaths.profileDeletion,
            ),
          }),
          status: 200,
        });
      } finally {
        lease.release();
      }
    },
    async profileDeletionVerify(request: Request): Promise<Response> {
      const currentRuntime = runtime();
      if (currentRuntime === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      if (
        !exactOrigin(request, currentRuntime, "/auth/profile/delete/verify") ||
        !contentType(request, jsonContentTypePattern)
      ) {
        discardBody(request);
        return problem("invalid_request");
      }
      const lease = dependencies.admission.tryAcquire();
      if (lease === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      try {
        const body = await boundedBody(request, 16_384);
        if (body === undefined) {
          return problem("invalid_request");
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(body) as unknown;
        } catch {
          return problem("invalid_request");
        }
        const cookieHeader = request.headers.get("cookie");
        const sessionCookie = readCookie(cookieHeader, enrollmentCookieNames.session);
        const profileDeletionCookie = readCookie(
          cookieHeader,
          enrollmentCookieNames.profileDeletion,
        );
        if (sessionCookie === undefined || profileDeletionCookie === undefined) {
          return problem("unauthorized");
        }
        const deleted = await currentRuntime.service.completeProfileDeletion(
          sessionCookie,
          profileDeletionCookie,
          parsed,
        );
        if (!deleted) {
          return problem("unauthorized");
        }
        const headers = noStoreHeaders();
        const cookies = [
          clearEnrollmentCookie(
            enrollmentCookieNames.login,
            currentRuntime.config.secureCookies,
            enrollmentCookiePaths.login,
          ),
          clearEnrollmentCookie(
            enrollmentCookieNames.oauth,
            currentRuntime.config.secureCookies,
            enrollmentCookiePaths.oauth,
          ),
          clearEnrollmentCookie(
            enrollmentCookieNames.passkey,
            currentRuntime.config.secureCookies,
            enrollmentCookiePaths.passkey,
          ),
          clearEnrollmentCookie(
            enrollmentCookieNames.passkeyAdd,
            currentRuntime.config.secureCookies,
            enrollmentCookiePaths.passkeyAdd,
          ),
          clearEnrollmentCookie(
            enrollmentCookieNames.passkeyRevoke,
            currentRuntime.config.secureCookies,
            enrollmentCookiePaths.passkeyRevoke,
          ),
          clearEnrollmentCookie(
            enrollmentCookieNames.profileDeletion,
            currentRuntime.config.secureCookies,
            enrollmentCookiePaths.profileDeletion,
          ),
          clearEnrollmentCookie(enrollmentCookieNames.session, currentRuntime.config.secureCookies),
        ];
        for (const cookie of cookies) {
          headers.append("set-cookie", cookie);
        }
        return new Response(null, { headers, status: 204 });
      } finally {
        lease.release();
      }
    },
    async logout(request: Request): Promise<Response> {
      const currentRuntime = runtime();
      if (currentRuntime === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      if (!exactOrigin(request, currentRuntime, "/auth/logout")) {
        discardBody(request);
        return problem("invalid_request");
      }
      if (!contentType(request, formContentTypePattern)) {
        discardBody(request);
        return problem("invalid_request");
      }
      const lease = dependencies.admission.tryAcquire();
      const clearedCookies = [
        clearEnrollmentCookie(
          enrollmentCookieNames.login,
          currentRuntime.config.secureCookies,
          enrollmentCookiePaths.login,
        ),
        clearEnrollmentCookie(
          enrollmentCookieNames.oauth,
          currentRuntime.config.secureCookies,
          enrollmentCookiePaths.oauth,
        ),
        clearEnrollmentCookie(
          enrollmentCookieNames.passkey,
          currentRuntime.config.secureCookies,
          enrollmentCookiePaths.passkey,
        ),
        clearEnrollmentCookie(
          enrollmentCookieNames.passkeyAdd,
          currentRuntime.config.secureCookies,
          enrollmentCookiePaths.passkeyAdd,
        ),
        clearEnrollmentCookie(
          enrollmentCookieNames.passkeyRevoke,
          currentRuntime.config.secureCookies,
          enrollmentCookiePaths.passkeyRevoke,
        ),
        clearEnrollmentCookie(
          enrollmentCookieNames.profileDeletion,
          currentRuntime.config.secureCookies,
          enrollmentCookiePaths.profileDeletion,
        ),
        clearEnrollmentCookie(enrollmentCookieNames.session, currentRuntime.config.secureCookies),
      ];
      if (lease === undefined) {
        discardBody(request);
        return redirect(
          currentRuntime.config.publicOrigin,
          "/join?error=unavailable",
          clearedCookies,
        );
      }
      try {
        if ((await boundedBody(request, 0)) !== "") {
          return problem("invalid_request");
        }
        const sessionCookie = readCookie(
          request.headers.get("cookie"),
          enrollmentCookieNames.session,
        );
        const revoked = await currentRuntime.service.logout(sessionCookie);
        return redirect(
          currentRuntime.config.publicOrigin,
          revoked ? "/" : "/join?error=unavailable",
          clearedCookies,
        );
      } finally {
        lease.release();
      }
    },
    async passkeyOptions(request: Request): Promise<Response> {
      const currentRuntime = runtime();
      if (currentRuntime === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      if (
        !exactOrigin(request, currentRuntime, "/auth/passkey/options") ||
        !contentType(request, jsonContentTypePattern)
      ) {
        discardBody(request);
        return problem("invalid_request");
      }
      const lease = dependencies.admission.tryAcquire();
      if (lease === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      try {
        if ((await boundedBody(request, 2)) !== "{}") {
          return problem("invalid_request");
        }
        const sessionCookie = readCookie(
          request.headers.get("cookie"),
          enrollmentCookieNames.session,
        );
        if (sessionCookie === undefined) {
          return problem("temporarily_unavailable");
        }
        const decision = await currentRuntime.service.beginPasskey(sessionCookie);
        if (decision === undefined) {
          return problem("unauthorized");
        }
        return new Response(JSON.stringify(decision.options), {
          headers: noStoreHeaders({
            "content-type": "application/json; charset=utf-8",
            "set-cookie": serializeEnrollmentCookie(
              enrollmentCookieNames.passkey,
              decision.passkeyCookie,
              300,
              currentRuntime.config.secureCookies,
              enrollmentCookiePaths.passkey,
            ),
          }),
          status: 200,
        });
      } finally {
        lease.release();
      }
    },
    async passkeyVerify(request: Request): Promise<Response> {
      const currentRuntime = runtime();
      if (currentRuntime === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      if (
        !exactOrigin(request, currentRuntime, "/auth/passkey/verify") ||
        !contentType(request, jsonContentTypePattern)
      ) {
        discardBody(request);
        return problem("invalid_request");
      }
      const lease = dependencies.admission.tryAcquire();
      if (lease === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      try {
        const body = await boundedBody(request, 16_384);
        if (body === undefined) {
          return problem("invalid_request");
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(body) as unknown;
        } catch {
          return problem("invalid_request");
        }
        const sessionCookie = readCookie(
          request.headers.get("cookie"),
          enrollmentCookieNames.session,
        );
        const passkeyCookie = readCookie(
          request.headers.get("cookie"),
          enrollmentCookieNames.passkey,
        );
        if (sessionCookie === undefined || passkeyCookie === undefined) {
          return problem("temporarily_unavailable");
        }
        const decision = await currentRuntime.service.completePasskey(
          sessionCookie,
          passkeyCookie,
          parsed,
        );
        if (decision === undefined) {
          return problem("unauthorized");
        }
        const headers = noStoreHeaders();
        headers.append(
          "set-cookie",
          clearEnrollmentCookie(
            enrollmentCookieNames.passkey,
            currentRuntime.config.secureCookies,
            enrollmentCookiePaths.passkey,
          ),
        );
        headers.append(
          "set-cookie",
          serializeEnrollmentCookie(
            enrollmentCookieNames.session,
            decision.sessionCookie,
            30 * 24 * 60 * 60,
            currentRuntime.config.secureCookies,
            enrollmentCookiePaths.session,
          ),
        );
        return new Response(null, {
          headers,
          status: 204,
        });
      } finally {
        lease.release();
      }
    },
    async profileVisibility(request: Request): Promise<Response> {
      const currentRuntime = runtime();
      if (currentRuntime === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      if (
        !exactOrigin(request, currentRuntime, "/auth/profile/visibility") ||
        !contentType(request, formContentTypePattern)
      ) {
        discardBody(request);
        return problem("invalid_request");
      }
      const lease = dependencies.admission.tryAcquire();
      if (lease === undefined) {
        discardBody(request);
        return redirect(currentRuntime.config.publicOrigin, "/account?error=unavailable");
      }
      try {
        const body = await boundedBody(request, 24);
        const publiclyVisible = body === undefined ? undefined : readProfileVisibilityForm(body);
        if (publiclyVisible === undefined) {
          return problem("invalid_request");
        }
        const sessionCookie = readCookie(
          request.headers.get("cookie"),
          enrollmentCookieNames.session,
        );
        if (sessionCookie === undefined) {
          return redirect(currentRuntime.config.publicOrigin, "/login?error=unavailable");
        }
        const visibility = await currentRuntime.service.setProfileVisibility(
          sessionCookie,
          publiclyVisible,
        );
        return redirect(
          currentRuntime.config.publicOrigin,
          visibility === undefined ? "/account?error=unavailable" : "/account",
        );
      } finally {
        lease.release();
      }
    },
    async start(request: Request): Promise<Response> {
      const currentRuntime = runtime();
      if (currentRuntime === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      if (
        !exactOrigin(request, currentRuntime, "/auth/github/start") ||
        !contentType(request, formContentTypePattern)
      ) {
        discardBody(request);
        return problem("invalid_request");
      }
      const lease = dependencies.admission.tryAcquire();
      if (lease === undefined) {
        discardBody(request);
        return redirect(currentRuntime.config.publicOrigin, "/join?error=unavailable");
      }
      try {
        const body = await boundedBody(request, 1024);
        const join = body === undefined ? undefined : parseJoinRequest(body);
        if (join === undefined) {
          return redirect(currentRuntime.config.publicOrigin, "/join?error=invalid");
        }
        const decision = currentRuntime.service.beginGithub(join);
        if (decision === undefined) {
          return redirect(currentRuntime.config.publicOrigin, "/join?error=unavailable");
        }
        return redirect(currentRuntime.config.publicOrigin, decision.redirectUrl, [
          serializeEnrollmentCookie(
            enrollmentCookieNames.oauth,
            decision.oauthCookie,
            600,
            currentRuntime.config.secureCookies,
            enrollmentCookiePaths.oauth,
          ),
        ]);
      } finally {
        lease.release();
      }
    },
  });
}

import "server-only";

import { Buffer } from "node:buffer";

import type { EnrollmentAdmission } from "./enrollment-admission";
import { clearEnrollmentCookie, readCookie, serializeEnrollmentCookie } from "./enrollment-cookie";
import { parseJoinRequest } from "./enrollment-domain";
import type { EnrollmentRuntime } from "./enrollment-runtime";
import { enrollmentCookieNames } from "./enrollment-service";
import { createPublicProblemResponse, createPublicRequestId } from "./public-http-problem";
import { createRecoveryTiming } from "./recovery-timing";

const formContentTypePattern = /^application\/x-www-form-urlencoded(?:;\s*charset=utf-8)?$/i;
const jsonContentTypePattern = /^application\/json(?:;\s*charset=utf-8)?$/i;
const callbackCancellationKeys = new Set(["error", "error_description", "error_uri", "state"]);
const carRecipeFormKeys = new Set([
  "chassis",
  "cockpit",
  "nose",
  "palette",
  "schemaVersion",
  "seed",
  "trail",
  "wheels",
  "wing",
]);
const enrollmentCookiePaths = Object.freeze({
  login: "/auth/login",
  oauth: "/auth/github/callback",
  pairingApproval: "/auth/pairing",
  passkey: "/auth/passkey",
  passkeyAdd: "/auth/passkeys/add",
  passkeyRevoke: "/auth/passkeys/revoke",
  profileDeletion: "/auth/profile/delete",
  recovery: "/auth/recovery",
  recoveryCodes: "/auth/recovery-codes",
  session: "/",
  sourceReactivation: "/auth/sources/reactivate",
  sourceUnlink: "/auth/sources/unlink",
});

export interface EnrollmentHttp {
  callback(request: Request): Promise<Response>;
  carRecipeApprove(request: Request): Promise<Response>;
  carRecipePropose(request: Request): Promise<Response>;
  carRecipeReject(request: Request): Promise<Response>;
  deviceRevoke(request: Request): Promise<Response>;
  loginOptions(request: Request): Promise<Response>;
  loginVerify(request: Request): Promise<Response>;
  logout(request: Request): Promise<Response>;
  pairingApprovalOptions(request: Request): Promise<Response>;
  pairingApprovalVerify(request: Request): Promise<Response>;
  passkeyOptions(request: Request): Promise<Response>;
  passkeyAddOptions(request: Request): Promise<Response>;
  passkeyAddVerify(request: Request): Promise<Response>;
  passkeyRevokeOptions(request: Request): Promise<Response>;
  passkeyRevokeVerify(request: Request): Promise<Response>;
  passkeyVerify(request: Request): Promise<Response>;
  profileDeletionOptions(request: Request): Promise<Response>;
  profileDeletionVerify(request: Request): Promise<Response>;
  profileVisibility(request: Request): Promise<Response>;
  recoveryOptions(request: Request): Promise<Response>;
  recoveryVerify(request: Request): Promise<Response>;
  recoveryCodeOptions(request: Request): Promise<Response>;
  recoveryCodeVerify(request: Request): Promise<Response>;
  sourcePause(request: Request): Promise<Response>;
  sourceReactivationOptions(request: Request): Promise<Response>;
  sourceReactivationVerify(request: Request): Promise<Response>;
  sourceUnlinkOptions(request: Request): Promise<Response>;
  sourceUnlinkVerify(request: Request): Promise<Response>;
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

function readDeviceRevokeForm(value: string): string | undefined {
  const parameters = new URLSearchParams(value);
  const keys = [...parameters.keys()];
  if (keys.length !== 1 || keys[0] !== "deviceId") {
    return undefined;
  }
  const deviceId = parameters.get("deviceId");
  return deviceId !== null && /^dev_[A-Za-z0-9_-]{22}$/.test(deviceId) ? deviceId : undefined;
}

function readSourcePauseForm(value: string): string | undefined {
  const parameters = new URLSearchParams(value);
  const keys = [...parameters.keys()];
  if (keys.length !== 1 || keys[0] !== "sourceControl") {
    return undefined;
  }
  const sourceControl = parameters.get("sourceControl");
  return sourceControl !== null && sourceControl.length >= 1 && sourceControl.length <= 512
    ? sourceControl
    : undefined;
}

function readCarRecipeForm(value: string): Readonly<Record<string, unknown>> | undefined {
  const parameters = new URLSearchParams(value);
  const keys = [...parameters.keys()];
  if (
    keys.length !== carRecipeFormKeys.size ||
    new Set(keys).size !== keys.length ||
    keys.some((key) => !carRecipeFormKeys.has(key))
  ) {
    return undefined;
  }
  const seedValue = parameters.get("seed");
  if (
    parameters.get("schemaVersion") !== "1" ||
    seedValue === null ||
    !/^\d{1,5}$/.test(seedValue) ||
    Number(seedValue) > 65_535
  ) {
    return undefined;
  }
  return Object.freeze({
    schemaVersion: 1,
    chassis: parameters.get("chassis"),
    nose: parameters.get("nose"),
    cockpit: parameters.get("cockpit"),
    wing: parameters.get("wing"),
    wheels: parameters.get("wheels"),
    palette: parameters.get("palette"),
    trail: parameters.get("trail"),
    seed: Number(seedValue),
  });
}

function readCarProposalControlForm(value: string): string | undefined {
  const parameters = new URLSearchParams(value);
  const keys = [...parameters.keys()];
  if (keys.length !== 1 || keys[0] !== "proposalControl") {
    return undefined;
  }
  const control = parameters.get("proposalControl");
  return control !== null && control.length >= 1 && control.length <= 1024 ? control : undefined;
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

  async function carRecipeDecision(
    request: Request,
    action: "approve" | "reject",
  ): Promise<Response> {
    const currentRuntime = runtime();
    if (currentRuntime === undefined) {
      discardBody(request);
      return problem("temporarily_unavailable");
    }
    const expectedPath = `/auth/cars/proposals/${action}`;
    if (
      !exactOrigin(request, currentRuntime, expectedPath) ||
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
      const body = await boundedBody(request, 1200);
      const proposalControl = body === undefined ? undefined : readCarProposalControlForm(body);
      if (proposalControl === undefined) {
        return problem("invalid_request");
      }
      const sessionCookie = readCookie(
        request.headers.get("cookie"),
        enrollmentCookieNames.session,
      );
      if (sessionCookie === undefined) {
        return redirect(currentRuntime.config.publicOrigin, "/login?error=unavailable");
      }
      let completed = false;
      try {
        completed =
          action === "approve"
            ? await currentRuntime.carProposalService.approve(sessionCookie, proposalControl)
            : await currentRuntime.carProposalService.reject(sessionCookie, proposalControl);
      } catch {
        completed = false;
      }
      return redirect(
        currentRuntime.config.publicOrigin,
        completed ? "/account" : "/account?error=unavailable",
      );
    } finally {
      lease.release();
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
    carRecipeApprove(request: Request): Promise<Response> {
      return carRecipeDecision(request, "approve");
    },
    async carRecipePropose(request: Request): Promise<Response> {
      const currentRuntime = runtime();
      if (currentRuntime === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      if (
        !exactOrigin(request, currentRuntime, "/auth/cars/proposals") ||
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
        const body = await boundedBody(request, 512);
        const recipe = body === undefined ? undefined : readCarRecipeForm(body);
        if (recipe === undefined) {
          return problem("invalid_request");
        }
        const sessionCookie = readCookie(
          request.headers.get("cookie"),
          enrollmentCookieNames.session,
        );
        if (sessionCookie === undefined) {
          return redirect(currentRuntime.config.publicOrigin, "/login?error=unavailable");
        }
        let proposed = false;
        try {
          proposed = await currentRuntime.carProposalService.propose(sessionCookie, recipe);
        } catch {
          proposed = false;
        }
        return redirect(
          currentRuntime.config.publicOrigin,
          proposed ? "/account#car-proposal" : "/account?error=unavailable",
        );
      } finally {
        lease.release();
      }
    },
    carRecipeReject(request: Request): Promise<Response> {
      return carRecipeDecision(request, "reject");
    },
    async deviceRevoke(request: Request): Promise<Response> {
      const currentRuntime = runtime();
      if (currentRuntime === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      if (
        !exactOrigin(request, currentRuntime, "/auth/devices/revoke") ||
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
        const body = await boundedBody(request, 64);
        const deviceId = body === undefined ? undefined : readDeviceRevokeForm(body);
        if (deviceId === undefined) {
          return problem("invalid_request");
        }
        const sessionCookie = readCookie(
          request.headers.get("cookie"),
          enrollmentCookieNames.session,
        );
        if (sessionCookie === undefined) {
          return redirect(currentRuntime.config.publicOrigin, "/login?error=unavailable");
        }
        const revoked = await currentRuntime.service.revokeDevice(sessionCookie, deviceId);
        return redirect(
          currentRuntime.config.publicOrigin,
          revoked ? "/account" : "/account?error=unavailable",
        );
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
    async pairingApprovalOptions(request: Request): Promise<Response> {
      const currentRuntime = runtime();
      if (currentRuntime === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      if (
        !exactOrigin(request, currentRuntime, "/auth/pairing/options") ||
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
        const body = await boundedBody(request, 1024);
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
        const decision = await currentRuntime.service.beginPairingApproval(sessionCookie, parsed);
        if (decision === undefined) {
          return problem("unauthorized");
        }
        return new Response(
          JSON.stringify({ options: decision.options, pairing: decision.pairing }),
          {
            headers: noStoreHeaders({
              "content-type": "application/json; charset=utf-8",
              "set-cookie": serializeEnrollmentCookie(
                enrollmentCookieNames.pairingApproval,
                decision.pairingApprovalCookie,
                300,
                currentRuntime.config.secureCookies,
                enrollmentCookiePaths.pairingApproval,
              ),
            }),
            status: 200,
          },
        );
      } finally {
        lease.release();
      }
    },
    async pairingApprovalVerify(request: Request): Promise<Response> {
      const currentRuntime = runtime();
      if (currentRuntime === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      if (
        !exactOrigin(request, currentRuntime, "/auth/pairing/verify") ||
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
        const pairingApprovalCookie = readCookie(
          cookieHeader,
          enrollmentCookieNames.pairingApproval,
        );
        if (sessionCookie === undefined || pairingApprovalCookie === undefined) {
          return problem("unauthorized");
        }
        const approved = await currentRuntime.service.completePairingApproval(
          sessionCookie,
          pairingApprovalCookie,
          parsed,
        );
        if (!approved) {
          return problem("unauthorized");
        }
        return new Response(null, {
          headers: noStoreHeaders({
            "set-cookie": clearEnrollmentCookie(
              enrollmentCookieNames.pairingApproval,
              currentRuntime.config.secureCookies,
              enrollmentCookiePaths.pairingApproval,
            ),
          }),
          status: 204,
        });
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
    async recoveryOptions(request: Request): Promise<Response> {
      const currentRuntime = runtime();
      if (currentRuntime === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      if (
        !exactOrigin(request, currentRuntime, "/auth/recovery/options") ||
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
      let timing: ReturnType<typeof createRecoveryTiming>;
      let startedAt: number;
      try {
        timing = createRecoveryTiming(currentRuntime.config.recoveryMinimumResponseMs);
        startedAt = timing.start();
      } catch {
        discardBody(request);
        lease.release();
        return problem("temporarily_unavailable");
      }
      try {
        const body = await boundedBody(request, 512);
        if (body === undefined) {
          return problem("invalid_request");
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(body) as unknown;
        } catch {
          return problem("invalid_request");
        }
        const decision = await currentRuntime.service.beginRecovery(parsed);
        if (decision === undefined) {
          return problem("unauthorized");
        }
        return new Response(JSON.stringify(decision.options), {
          headers: noStoreHeaders({
            "content-type": "application/json; charset=utf-8",
            "set-cookie": serializeEnrollmentCookie(
              enrollmentCookieNames.recovery,
              decision.recoveryCookie,
              300,
              currentRuntime.config.secureCookies,
              enrollmentCookiePaths.recovery,
            ),
          }),
          status: 200,
        });
      } finally {
        try {
          await timing.settle(startedAt);
        } finally {
          lease.release();
        }
      }
    },
    async recoveryVerify(request: Request): Promise<Response> {
      const currentRuntime = runtime();
      if (currentRuntime === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      if (
        !exactOrigin(request, currentRuntime, "/auth/recovery/verify") ||
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
        const recoveryCookie = readCookie(
          request.headers.get("cookie"),
          enrollmentCookieNames.recovery,
        );
        if (recoveryCookie === undefined) {
          return problem("unauthorized");
        }
        const decision = await currentRuntime.service.completeRecovery(recoveryCookie, parsed);
        if (decision === undefined) {
          return problem("unauthorized");
        }
        const headers = noStoreHeaders();
        headers.append(
          "set-cookie",
          clearEnrollmentCookie(
            enrollmentCookieNames.recovery,
            currentRuntime.config.secureCookies,
            enrollmentCookiePaths.recovery,
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
    async recoveryCodeOptions(request: Request): Promise<Response> {
      const currentRuntime = runtime();
      if (currentRuntime === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      if (
        !exactOrigin(request, currentRuntime, "/auth/recovery-codes/options") ||
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
          return problem("unauthorized");
        }
        const decision = await currentRuntime.service.beginRecoveryCodeRotation(sessionCookie);
        if (decision === undefined) {
          return problem("unauthorized");
        }
        return new Response(JSON.stringify(decision.options), {
          headers: noStoreHeaders({
            "content-type": "application/json; charset=utf-8",
            "set-cookie": serializeEnrollmentCookie(
              enrollmentCookieNames.recoveryCodes,
              decision.recoveryCodeCookie,
              300,
              currentRuntime.config.secureCookies,
              enrollmentCookiePaths.recoveryCodes,
            ),
          }),
          status: 200,
        });
      } finally {
        lease.release();
      }
    },
    async recoveryCodeVerify(request: Request): Promise<Response> {
      const currentRuntime = runtime();
      if (currentRuntime === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      if (
        !exactOrigin(request, currentRuntime, "/auth/recovery-codes/verify") ||
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
        const recoveryCodeCookie = readCookie(cookieHeader, enrollmentCookieNames.recoveryCodes);
        if (sessionCookie === undefined || recoveryCodeCookie === undefined) {
          return problem("unauthorized");
        }
        const decision = await currentRuntime.service.completeRecoveryCodeRotation(
          sessionCookie,
          recoveryCodeCookie,
          parsed,
        );
        if (decision === undefined) {
          return problem("unauthorized");
        }
        return new Response(JSON.stringify(decision), {
          headers: noStoreHeaders({
            "content-type": "application/json; charset=utf-8",
            "set-cookie": clearEnrollmentCookie(
              enrollmentCookieNames.recoveryCodes,
              currentRuntime.config.secureCookies,
              enrollmentCookiePaths.recoveryCodes,
            ),
          }),
          status: 200,
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
          clearEnrollmentCookie(
            enrollmentCookieNames.recovery,
            currentRuntime.config.secureCookies,
            enrollmentCookiePaths.recovery,
          ),
          clearEnrollmentCookie(
            enrollmentCookieNames.recoveryCodes,
            currentRuntime.config.secureCookies,
            enrollmentCookiePaths.recoveryCodes,
          ),
          clearEnrollmentCookie(
            enrollmentCookieNames.sourceReactivation,
            currentRuntime.config.secureCookies,
            enrollmentCookiePaths.sourceReactivation,
          ),
          clearEnrollmentCookie(
            enrollmentCookieNames.sourceUnlink,
            currentRuntime.config.secureCookies,
            enrollmentCookiePaths.sourceUnlink,
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
    async sourcePause(request: Request): Promise<Response> {
      const currentRuntime = runtime();
      if (currentRuntime === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      if (
        !exactOrigin(request, currentRuntime, "/auth/sources/pause") ||
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
        const body = await boundedBody(request, 768);
        const sourceControl = body === undefined ? undefined : readSourcePauseForm(body);
        if (sourceControl === undefined) {
          return problem("invalid_request");
        }
        const sessionCookie = readCookie(
          request.headers.get("cookie"),
          enrollmentCookieNames.session,
        );
        if (sessionCookie === undefined) {
          return redirect(currentRuntime.config.publicOrigin, "/login?error=unavailable");
        }
        const paused = await currentRuntime.service.pauseSource(sessionCookie, sourceControl);
        return redirect(
          currentRuntime.config.publicOrigin,
          paused ? "/account" : "/account?error=unavailable",
        );
      } finally {
        lease.release();
      }
    },
    async sourceReactivationOptions(request: Request): Promise<Response> {
      const currentRuntime = runtime();
      if (currentRuntime === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      if (
        !exactOrigin(request, currentRuntime, "/auth/sources/reactivate/options") ||
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
        const body = await boundedBody(request, 768);
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
        const decision = await currentRuntime.service.beginSourceReactivation(
          sessionCookie,
          parsed,
        );
        if (decision === undefined) {
          return problem("unauthorized");
        }
        return new Response(JSON.stringify(decision.options), {
          headers: noStoreHeaders({
            "content-type": "application/json; charset=utf-8",
            "set-cookie": serializeEnrollmentCookie(
              enrollmentCookieNames.sourceReactivation,
              decision.sourceReactivationCookie,
              300,
              currentRuntime.config.secureCookies,
              enrollmentCookiePaths.sourceReactivation,
            ),
          }),
          status: 200,
        });
      } finally {
        lease.release();
      }
    },
    async sourceReactivationVerify(request: Request): Promise<Response> {
      const currentRuntime = runtime();
      if (currentRuntime === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      if (
        !exactOrigin(request, currentRuntime, "/auth/sources/reactivate/verify") ||
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
        const sourceReactivationCookie = readCookie(
          cookieHeader,
          enrollmentCookieNames.sourceReactivation,
        );
        if (sessionCookie === undefined || sourceReactivationCookie === undefined) {
          return problem("unauthorized");
        }
        const reactivated = await currentRuntime.service.completeSourceReactivation(
          sessionCookie,
          sourceReactivationCookie,
          parsed,
        );
        if (!reactivated) {
          return problem("unauthorized");
        }
        return new Response(null, {
          headers: noStoreHeaders({
            "set-cookie": clearEnrollmentCookie(
              enrollmentCookieNames.sourceReactivation,
              currentRuntime.config.secureCookies,
              enrollmentCookiePaths.sourceReactivation,
            ),
          }),
          status: 204,
        });
      } finally {
        lease.release();
      }
    },
    async sourceUnlinkOptions(request: Request): Promise<Response> {
      const currentRuntime = runtime();
      if (currentRuntime === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      if (
        !exactOrigin(request, currentRuntime, "/auth/sources/unlink/options") ||
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
        const body = await boundedBody(request, 768);
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
        const decision = await currentRuntime.service.beginSourceUnlink(sessionCookie, parsed);
        if (decision === undefined) {
          return problem("unauthorized");
        }
        return new Response(JSON.stringify(decision.options), {
          headers: noStoreHeaders({
            "content-type": "application/json; charset=utf-8",
            "set-cookie": serializeEnrollmentCookie(
              enrollmentCookieNames.sourceUnlink,
              decision.sourceUnlinkCookie,
              300,
              currentRuntime.config.secureCookies,
              enrollmentCookiePaths.sourceUnlink,
            ),
          }),
          status: 200,
        });
      } finally {
        lease.release();
      }
    },
    async sourceUnlinkVerify(request: Request): Promise<Response> {
      const currentRuntime = runtime();
      if (currentRuntime === undefined) {
        discardBody(request);
        return problem("temporarily_unavailable");
      }
      if (
        !exactOrigin(request, currentRuntime, "/auth/sources/unlink/verify") ||
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
        const sourceUnlinkCookie = readCookie(cookieHeader, enrollmentCookieNames.sourceUnlink);
        if (sessionCookie === undefined || sourceUnlinkCookie === undefined) {
          return problem("unauthorized");
        }
        const unlinked = await currentRuntime.service.completeSourceUnlink(
          sessionCookie,
          sourceUnlinkCookie,
          parsed,
        );
        if (!unlinked) {
          return problem("unauthorized");
        }
        return new Response(null, {
          headers: noStoreHeaders({
            "set-cookie": clearEnrollmentCookie(
              enrollmentCookieNames.sourceUnlink,
              currentRuntime.config.secureCookies,
              enrollmentCookiePaths.sourceUnlink,
            ),
          }),
          status: 204,
        });
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
          enrollmentCookieNames.pairingApproval,
          currentRuntime.config.secureCookies,
          enrollmentCookiePaths.pairingApproval,
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
        clearEnrollmentCookie(
          enrollmentCookieNames.recovery,
          currentRuntime.config.secureCookies,
          enrollmentCookiePaths.recovery,
        ),
        clearEnrollmentCookie(
          enrollmentCookieNames.recoveryCodes,
          currentRuntime.config.secureCookies,
          enrollmentCookiePaths.recoveryCodes,
        ),
        clearEnrollmentCookie(
          enrollmentCookieNames.sourceReactivation,
          currentRuntime.config.secureCookies,
          enrollmentCookiePaths.sourceReactivation,
        ),
        clearEnrollmentCookie(
          enrollmentCookieNames.sourceUnlink,
          currentRuntime.config.secureCookies,
          enrollmentCookiePaths.sourceUnlink,
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

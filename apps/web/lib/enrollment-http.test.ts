/* eslint-disable @typescript-eslint/unbound-method -- Vitest inspects injected method spies without invoking them. */

import { Buffer } from "node:buffer";

import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createEnrollmentAdmission } from "./enrollment-admission";
import { resolveEnrollmentConfig } from "./enrollment-config";
import { createEnrollmentHttp } from "./enrollment-http";
import type { EnrollmentRuntime } from "./enrollment-runtime";
import type { EnrollmentService } from "./enrollment-service";

const origin = "https://race.example.com";
const inviteCode =
  "vri_00000000-0000-4000-8000-000000000601_" + Buffer.alloc(32, 1).toString("base64url");
const joinBody = new URLSearchParams({ inviteCode, locale: "en" }).toString();
const config = resolveEnrollmentConfig({
  GITHUB_CLIENT_ID: "Ov23abcdefghijklmno",
  GITHUB_CLIENT_SECRET: "a".repeat(40),
  NODE_ENV: "test",
  SESSION_SECRET: Buffer.alloc(32, 2).toString("base64url"),
  VIBERACING_PUBLIC_ORIGIN: origin,
  VIBERACING_PAIRING_APPROVAL_ATTEMPT_LIMIT: "6",
  VIBERACING_PAIRING_APPROVAL_WINDOW_SECONDS: "600",
  VIBERACING_RECOVERY_ARGON2_MEMORY_KIB: "19456",
  VIBERACING_RECOVERY_ARGON2_PARALLELISM: "2",
  VIBERACING_RECOVERY_ARGON2_PASSES: "2",
  VIBERACING_RECOVERY_MINIMUM_RESPONSE_MS: "100",
  VIBERACING_RECOVERY_PEPPER: Buffer.alloc(32, 3).toString("base64url"),
  WEBAUTHN_ORIGIN: origin,
  WEBAUTHN_RP_ID: "race.example.com",
});

function post(path: string, body: string, contentType: string, cookie?: string): Request {
  return new Request(`${origin}${path}`, {
    body,
    headers: {
      ...(cookie === undefined ? {} : { cookie }),
      "content-type": contentType,
      host: "race.example.com",
      origin,
    },
    method: "POST",
  });
}

function serviceFixture(): EnrollmentService {
  return {
    beginPairingApproval: vi.fn(() =>
      Promise.resolve({
        options: { challenge: Buffer.alloc(32, 13).toString("base64url") },
        pairing: {
          architecture: "x86_64" as const,
          connectorVersion: "1.2.3",
          deviceLabel: "Studio PC",
          expiresAt: "2026-07-16T10:09:00.000Z",
          osFamily: "windows" as const,
          publicKeyFingerprint: `SHA256:${Buffer.alloc(32, 14).toString("base64url")}`,
        },
        pairingApprovalCookie: "opaque-pairing-approval",
      }),
    ),
    beginGithub: vi.fn(() => ({
      oauthCookie: "opaque-oauth",
      redirectUrl: "https://github.com/login/oauth/authorize?state=opaque",
    })),
    beginLogin: vi.fn(() =>
      Promise.resolve({
        loginCookie: "opaque-login",
        options: {
          challenge: Buffer.alloc(32, 4).toString("base64url"),
        },
      }),
    ),
    beginPasskey: vi.fn(() =>
      Promise.resolve({
        options: {
          challenge: Buffer.alloc(32, 3).toString("base64url"),
        } as PublicKeyCredentialCreationOptionsJSON,
        passkeyCookie: "opaque-passkey",
      }),
    ),
    beginPasskeyAdd: vi.fn(() =>
      Promise.resolve({
        authenticationOptions: { challenge: Buffer.alloc(32, 6).toString("base64url") },
        passkeyAddCookie: "opaque-passkey-add",
        registrationOptions: {
          challenge: Buffer.alloc(32, 7).toString("base64url"),
        } as PublicKeyCredentialCreationOptionsJSON,
      }),
    ),
    beginPasskeyRevoke: vi.fn(() =>
      Promise.resolve({
        options: { challenge: Buffer.alloc(32, 5).toString("base64url") },
        passkeyRevokeCookie: "opaque-passkey-revoke",
      }),
    ),
    beginProfileDeletion: vi.fn(() =>
      Promise.resolve({
        options: { challenge: Buffer.alloc(32, 8).toString("base64url") },
        profileDeletionCookie: "opaque-profile-deletion",
      }),
    ),
    beginRecoveryCodeRotation: vi.fn(() =>
      Promise.resolve({
        options: { challenge: Buffer.alloc(32, 11).toString("base64url") },
        recoveryCodeCookie: "opaque-recovery-code",
      }),
    ),
    beginRecovery: vi.fn(() =>
      Promise.resolve({
        options: {
          challenge: Buffer.alloc(32, 12).toString("base64url"),
        } as PublicKeyCredentialCreationOptionsJSON,
        recoveryCookie: "opaque-recovery",
      }),
    ),
    beginSourceReactivation: vi.fn(() =>
      Promise.resolve({
        options: { challenge: Buffer.alloc(32, 9).toString("base64url") },
        sourceReactivationCookie: "opaque-source-reactivation",
      }),
    ),
    beginSourceUnlink: vi.fn(() =>
      Promise.resolve({
        options: { challenge: Buffer.alloc(32, 10).toString("base64url") },
        sourceUnlinkCookie: "opaque-source-unlink",
      }),
    ),
    cancelGithub: vi.fn(() => true),
    completeGithub: vi.fn(() =>
      Promise.resolve({ outcome: "continue" as const, sessionCookie: "opaque-session" }),
    ),
    completeLogin: vi.fn(() => Promise.resolve({ sessionCookie: "active-session" })),
    completePasskey: vi.fn(() => Promise.resolve({ sessionCookie: "active-session" })),
    completePasskeyAdd: vi.fn(() => Promise.resolve(true)),
    completePairingApproval: vi.fn(() => Promise.resolve(true)),
    completePasskeyRevoke: vi.fn(() => Promise.resolve(true)),
    completeProfileDeletion: vi.fn(() => Promise.resolve(true)),
    completeRecoveryCodeRotation: vi.fn(() =>
      Promise.resolve({
        recoveryCodes: Array.from(
          { length: 10 },
          (_, index) =>
            `vrr1_30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}_${Buffer.alloc(32, index + 1).toString("base64url")}`,
        ),
      }),
    ),
    completeRecovery: vi.fn(() => Promise.resolve({ sessionCookie: "recovered-session" })),
    completeSourceReactivation: vi.fn(() => Promise.resolve(true)),
    completeSourceUnlink: vi.fn(() => Promise.resolve(true)),
    logout: vi.fn(() => Promise.resolve(true)),
    readAccountOverview: vi.fn(() => Promise.resolve(undefined)),
    readActiveDeviceInventory: vi.fn(() => Promise.resolve(undefined)),
    readPasskeyInventory: vi.fn(() => Promise.resolve(undefined)),
    readProfileVisibility: vi.fn(() => Promise.resolve("public" as const)),
    readSession: vi.fn(() => undefined),
    pauseSource: vi.fn(() => Promise.resolve(true)),
    revokeDevice: vi.fn(() => Promise.resolve(true)),
    setProfileVisibility: vi.fn(() => Promise.resolve("hidden" as const)),
  };
}

describe("enrollment HTTP boundary", () => {
  let service: EnrollmentService;
  let runtime: EnrollmentRuntime;

  beforeEach(() => {
    service = serviceFixture();
    runtime = {
      batchPairingService: {
        beginApproval: vi.fn(() => Promise.resolve(undefined)),
        completeApproval: vi.fn(() => Promise.resolve(false)),
        review: vi.fn(() => Promise.resolve(undefined)),
      },
      carProposalService: {
        approve: vi.fn(() => Promise.resolve(true)),
        propose: vi.fn(() => Promise.resolve(true)),
        read: vi.fn(() => Promise.resolve(undefined)),
        reject: vi.fn(() => Promise.resolve(true)),
      },
      config,
      service,
    };
  });

  it.each([false, undefined, "true", 1])(
    "fails closed before enrollment request, runtime, or admission work for enable value %#",
    async (enrollmentEnabled) => {
      const getRuntime = vi.fn(() => {
        throw new Error("runtime-must-not-run");
      });
      const tryAcquire = vi.fn(() => {
        throw new Error("admission-must-not-run");
      });
      const http = createEnrollmentHttp({
        admission: Object.freeze({ tryAcquire }),
        enrollmentEnabled,
        getRuntime,
      });
      const makeHostileRequest = () => {
        const cancelBody = vi.fn();
        const body = new ReadableStream<Uint8Array>({ cancel: cancelBody });
        const target = new Request(`${origin}/auth/github/start`, {
          body,
          duplex: "half",
          method: "POST",
        } as RequestInit & { duplex: "half" });
        const request = new Proxy(target, {
          get(_target, key) {
            if (key === "body") {
              return target.body;
            }
            throw new Error(`request-field-must-not-run:${String(key)}`);
          },
        });
        return { cancelBody, request };
      };

      for (const invoke of [
        (request: Request) => http.start(request),
        (request: Request) => http.callback(request),
        (request: Request) => http.passkeyOptions(request),
        (request: Request) => http.passkeyVerify(request),
      ]) {
        const { cancelBody, request } = makeHostileRequest();
        const response = await invoke(request);
        expect(response.status).toBe(503);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("referrer-policy")).toBe("no-referrer");
        expect(response.headers.has("access-control-allow-origin")).toBe(false);
        await expect(response.json()).resolves.toMatchObject({
          errorCode: "temporarily_unavailable",
          status: 503,
        });
        expect(cancelBody).toHaveBeenCalledOnce();
      }
      expect(getRuntime).not.toHaveBeenCalled();
      expect(tryAcquire).not.toHaveBeenCalled();
    },
  );

  it("starts OAuth only from a bounded same-origin form", async () => {
    const http = createEnrollmentHttp({
      admission: createEnrollmentAdmission(),
      enrollmentEnabled: true,
      getRuntime: () => runtime,
      inviteGateEnabled: true,
    });
    const response = await http.start(
      post("/auth/github/start", joinBody, "application/x-www-form-urlencoded"),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("https://github.com/login/oauth/authorize");
    expect(response.headers.get("set-cookie")).toContain("viberacing_oauth=opaque-oauth");
    expect(response.headers.get("set-cookie")).toContain("Path=/auth/github/callback");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(service.beginGithub).toHaveBeenCalledWith(expect.any(Object), true);

    const crossOrigin = post("/auth/github/start", joinBody, "application/x-www-form-urlencoded");
    crossOrigin.headers.set("origin", "https://attacker.example");
    const rejected = await http.start(crossOrigin);
    expect(rejected.status).toBe(400);
    expect(rejected.headers.get("referrer-policy")).toBe("no-referrer");

    const compressed = post("/auth/github/start", joinBody, "application/x-www-form-urlencoded");
    compressed.headers.set("content-encoding", "gzip");
    const compressedResponse = await http.start(compressed);
    expect(compressedResponse.headers.get("location")).toBe(`${origin}/join?error=invalid`);
    const wrongHost = post("/auth/github/start", joinBody, "application/x-www-form-urlencoded");
    wrongHost.headers.set("host", "attacker.example");
    await expect(http.start(wrongHost)).resolves.toMatchObject({ status: 400 });
    await expect(
      http.start(post("/auth/logout", joinBody, "application/x-www-form-urlencoded")),
    ).resolves.toMatchObject({ status: 400 });
    expect(service.beginGithub).toHaveBeenCalledOnce();
  });

  it("consumes an exact callback cookie and rotates it into an enrollment session", async () => {
    const http = createEnrollmentHttp({
      admission: createEnrollmentAdmission(),
      enrollmentEnabled: true,
      getRuntime: () => runtime,
      inviteGateEnabled: true,
    });
    const response = await http.callback(
      new Request(`${origin}/auth/github/callback?code=valid_code&state=valid_state`, {
        headers: { cookie: "viberacing_oauth=opaque-oauth", host: "race.example.com" },
      }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${origin}/join/passkey`);
    expect(response.headers.get("set-cookie")).toContain("viberacing_session=opaque-session");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=900");
    expect(service.completeGithub).toHaveBeenCalledWith(
      "valid_code",
      "valid_state",
      "opaque-oauth",
      expect.any(AbortSignal),
      true,
      true,
    );

    const cancelled = await http.callback(
      new Request(
        `${origin}/auth/github/callback?error=access_denied&error_description=cancelled&state=${"A".repeat(43)}`,
        {
          headers: { cookie: "viberacing_oauth=opaque-oauth", host: "race.example.com" },
        },
      ),
    );
    expect(cancelled.status).toBe(303);
    expect(cancelled.headers.get("location")).toBe(`${origin}/join?error=unavailable`);
    expect(cancelled.headers.get("set-cookie")).toContain("viberacing_oauth=");
    expect(service.cancelGithub).toHaveBeenCalledWith("A".repeat(43), "opaque-oauth");
    expect(service.completeGithub).toHaveBeenCalledOnce();

    await expect(
      http.callback(
        new Request(`${origin}/auth/github/callback?code=a&state=b&extra=1`, {
          headers: { host: "race.example.com" },
        }),
      ),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      http.callback(
        new Request(`${origin}/auth/github/callback?code=a&state=b`, {
          headers: { host: "attacker.example" },
        }),
      ),
    ).resolves.toMatchObject({ status: 400 });
  });

  it("creates an anonymous login challenge and returns only a passkey-bound session", async () => {
    const http = createEnrollmentHttp({
      admission: createEnrollmentAdmission(),
      enrollmentEnabled: false,
      getRuntime: () => runtime,
    });
    const options = await http.loginOptions(post("/auth/login/options", "{}", "application/json"));
    expect(options.status).toBe(200);
    expect(options.headers.get("set-cookie")).toContain("viberacing_login=opaque-login");
    expect(options.headers.get("set-cookie")).toContain("Path=/auth/login");
    expect(service.beginLogin).toHaveBeenCalledOnce();

    const verification = await http.loginVerify(
      post(
        "/auth/login/verify",
        JSON.stringify({ response: { id: "synthetic" } }),
        "application/json",
        "viberacing_login=opaque-login",
      ),
    );
    expect(verification.status).toBe(204);
    expect(verification.headers.get("set-cookie")).toContain("viberacing_login=");
    expect(verification.headers.get("set-cookie")).toContain("viberacing_session=active-session");
    expect(service.completeLogin).toHaveBeenCalledWith("opaque-login", {
      response: { id: "synthetic" },
    });

    await expect(
      http.loginVerify(post("/auth/login/verify", "{}", "application/json")),
    ).resolves.toMatchObject({ status: 401 });
  });

  it("admits a bounded recovery code and creates a session only after replacement registration", async () => {
    const http = createEnrollmentHttp({
      admission: createEnrollmentAdmission(),
      enrollmentEnabled: false,
      getRuntime: () => runtime,
    });
    const code =
      `vrr1_00000000-0000-4000-8000-000000000650_` + Buffer.alloc(32, 0x65).toString("base64url");
    const options = await http.recoveryOptions(
      post(
        "/auth/recovery/options",
        JSON.stringify({ code, label: "Replacement passkey" }),
        "application/json",
      ),
    );

    expect(options.status).toBe(200);
    expect(options.headers.get("cache-control")).toBe("no-store");
    expect(options.headers.get("set-cookie")).toContain("viberacing_recovery=opaque-recovery");
    expect(options.headers.get("set-cookie")).toContain("Path=/auth/recovery");
    expect(service.beginRecovery).toHaveBeenCalledWith({ code, label: "Replacement passkey" });

    const verification = await http.recoveryVerify(
      post(
        "/auth/recovery/verify",
        JSON.stringify({ response: { id: "synthetic" } }),
        "application/json",
        "viberacing_recovery=opaque-recovery",
      ),
    );
    expect(verification.status).toBe(204);
    expect(verification.headers.get("set-cookie")).toContain("viberacing_recovery=");
    expect(verification.headers.get("set-cookie")).toContain(
      "viberacing_session=recovered-session",
    );
    expect(service.completeRecovery).toHaveBeenCalledWith("opaque-recovery", {
      response: { id: "synthetic" },
    });

    vi.mocked(service.beginRecovery).mockResolvedValueOnce(undefined);
    const rejected = await http.recoveryOptions(
      post(
        "/auth/recovery/options",
        JSON.stringify({ code, label: "Replacement passkey" }),
        "application/json",
      ),
    );
    expect(rejected.status).toBe(401);
    expect(await rejected.text()).not.toContain(code);
    await expect(
      http.recoveryVerify(post("/auth/recovery/verify", "{}", "application/json")),
    ).resolves.toMatchObject({ status: 401 });
  });

  it("serves options, verifies one bounded response, and replaces the session cookie", async () => {
    const http = createEnrollmentHttp({
      admission: createEnrollmentAdmission(),
      enrollmentEnabled: true,
      getRuntime: () => runtime,
    });
    const options = await http.passkeyOptions(
      post(
        "/auth/passkey/options",
        JSON.stringify({ handle: "pixel_driver" }),
        "application/json",
        "viberacing_session=opaque-session",
      ),
    );
    expect(options.status).toBe(200);
    expect(options.headers.get("set-cookie")).toContain("viberacing_passkey=opaque-passkey");
    expect(options.headers.get("set-cookie")).toContain("Path=/auth/passkey");
    const optionsBody = JSON.parse(await options.text()) as unknown;
    expect(optionsBody).toBeTypeOf("object");
    expect(typeof (optionsBody as Record<string, unknown>).challenge).toBe("string");
    expect(service.beginPasskey).toHaveBeenCalledWith(
      "opaque-session",
      { handle: "pixel_driver" },
      true,
    );

    const verification = await http.passkeyVerify(
      post(
        "/auth/passkey/verify",
        JSON.stringify({ response: { id: "synthetic" } }),
        "application/json",
        "viberacing_session=opaque-session; viberacing_passkey=opaque-passkey",
      ),
    );
    expect(verification.status).toBe(204);
    expect(verification.headers.get("set-cookie")).toContain("viberacing_session=active-session");
    expect(verification.headers.get("set-cookie")).toContain("Max-Age=2592000");
    expect(service.completePasskey).toHaveBeenCalledWith(
      "opaque-session",
      "opaque-passkey",
      { response: { id: "synthetic" } },
      true,
    );

    vi.mocked(service.beginPasskey).mockResolvedValueOnce(undefined);
    await expect(
      http.passkeyOptions(
        post(
          "/auth/passkey/options",
          "{}",
          "application/json",
          "viberacing_session=opaque-session",
        ),
      ),
    ).resolves.toMatchObject({ status: 401 });
  });

  it("binds passkey addition to the session and two fresh ceremonies", async () => {
    const http = createEnrollmentHttp({
      admission: createEnrollmentAdmission(),
      getRuntime: () => runtime,
    });
    const options = await http.passkeyAddOptions(
      post(
        "/auth/passkeys/add/options",
        JSON.stringify({ label: "Backup passkey" }),
        "application/json",
        "viberacing_session=opaque-session",
      ),
    );
    expect(options.status).toBe(200);
    expect(options.headers.get("set-cookie")).toContain(
      "viberacing_passkey_add=opaque-passkey-add",
    );
    expect(options.headers.get("set-cookie")).toContain("Path=/auth/passkeys/add");
    await expect(options.json()).resolves.toEqual({
      authenticationOptions: { challenge: Buffer.alloc(32, 6).toString("base64url") },
      registrationOptions: { challenge: Buffer.alloc(32, 7).toString("base64url") },
    });
    expect(service.beginPasskeyAdd).toHaveBeenCalledWith("opaque-session", {
      label: "Backup passkey",
    });

    const body = {
      authentication: { id: "existing" },
      registration: { id: "new" },
    };
    const verification = await http.passkeyAddVerify(
      post(
        "/auth/passkeys/add/verify",
        JSON.stringify(body),
        "application/json",
        "viberacing_session=opaque-session; viberacing_passkey_add=opaque-passkey-add",
      ),
    );
    expect(verification.status).toBe(204);
    expect(verification.headers.get("set-cookie")).toContain("viberacing_passkey_add=");
    expect(service.completePasskeyAdd).toHaveBeenCalledWith(
      "opaque-session",
      "opaque-passkey-add",
      body,
    );
  });

  it("binds passkey revocation to the session, target, and fresh assertion", async () => {
    const http = createEnrollmentHttp({
      admission: createEnrollmentAdmission(),
      getRuntime: () => runtime,
    });
    const targetPasskeyId = "00000000-0000-4000-8000-000000000611";
    const options = await http.passkeyRevokeOptions(
      post(
        "/auth/passkeys/revoke/options",
        JSON.stringify({ passkeyId: targetPasskeyId }),
        "application/json",
        "viberacing_session=opaque-session",
      ),
    );
    expect(options.status).toBe(200);
    expect(options.headers.get("set-cookie")).toContain(
      "viberacing_passkey_revoke=opaque-passkey-revoke",
    );
    expect(options.headers.get("set-cookie")).toContain("Path=/auth/passkeys/revoke");
    expect(service.beginPasskeyRevoke).toHaveBeenCalledWith("opaque-session", {
      passkeyId: targetPasskeyId,
    });

    const verification = await http.passkeyRevokeVerify(
      post(
        "/auth/passkeys/revoke/verify",
        JSON.stringify({ response: { id: "synthetic" } }),
        "application/json",
        "viberacing_session=opaque-session; viberacing_passkey_revoke=opaque-passkey-revoke",
      ),
    );
    expect(verification.status).toBe(204);
    expect(verification.headers.get("set-cookie")).toContain("viberacing_passkey_revoke=");
    expect(service.completePasskeyRevoke).toHaveBeenCalledWith(
      "opaque-session",
      "opaque-passkey-revoke",
      { response: { id: "synthetic" } },
    );

    await expect(
      http.passkeyRevokeOptions(
        post(
          "/auth/passkeys/revoke/options",
          JSON.stringify({ passkeyId: targetPasskeyId }),
          "application/json",
        ),
      ),
    ).resolves.toMatchObject({ status: 401 });
  });

  it("returns a recovery-code batch once after the session-bound fresh assertion", async () => {
    const http = createEnrollmentHttp({
      admission: createEnrollmentAdmission(),
      getRuntime: () => runtime,
    });
    const options = await http.recoveryCodeOptions(
      post(
        "/auth/recovery-codes/options",
        "{}",
        "application/json",
        "viberacing_session=opaque-session",
      ),
    );
    expect(options.status).toBe(200);
    expect(options.headers.get("cache-control")).toBe("no-store");
    expect(options.headers.get("set-cookie")).toContain(
      "viberacing_recovery_codes=opaque-recovery-code",
    );
    expect(options.headers.get("set-cookie")).toContain("Path=/auth/recovery-codes");
    await expect(options.json()).resolves.toEqual({
      challenge: Buffer.alloc(32, 11).toString("base64url"),
    });
    expect(service.beginRecoveryCodeRotation).toHaveBeenCalledWith("opaque-session");

    const body = { response: { id: "synthetic" } };
    const verification = await http.recoveryCodeVerify(
      post(
        "/auth/recovery-codes/verify",
        JSON.stringify(body),
        "application/json",
        "viberacing_session=opaque-session; viberacing_recovery_codes=opaque-recovery-code",
      ),
    );
    expect(verification.status).toBe(200);
    expect(verification.headers.get("cache-control")).toBe("no-store");
    expect(verification.headers.get("referrer-policy")).toBe("no-referrer");
    expect(verification.headers.get("set-cookie")).toContain("viberacing_recovery_codes=");
    const payload = (await verification.json()) as { recoveryCodes: string[] };
    expect(payload.recoveryCodes).toHaveLength(10);
    expect(new Set(payload.recoveryCodes).size).toBe(10);
    expect(service.completeRecoveryCodeRotation).toHaveBeenCalledWith(
      "opaque-session",
      "opaque-recovery-code",
      body,
    );

    await expect(
      http.recoveryCodeOptions(
        post(
          "/auth/recovery-codes/options",
          '{"extra":true}',
          "application/json",
          "viberacing_session=opaque-session",
        ),
      ),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      http.recoveryCodeVerify(
        post(
          "/auth/recovery-codes/verify",
          JSON.stringify(body),
          "application/json",
          "viberacing_session=opaque-session",
        ),
      ),
    ).resolves.toMatchObject({ status: 401 });
  });

  it("binds profile deletion to the exact handle, session, and fresh assertion", async () => {
    const http = createEnrollmentHttp({
      admission: createEnrollmentAdmission(),
      getRuntime: () => runtime,
    });
    const options = await http.profileDeletionOptions(
      post(
        "/auth/profile/delete/options",
        JSON.stringify({ handle: "pixel_driver" }),
        "application/json",
        "viberacing_session=opaque-session",
      ),
    );
    expect(options.status).toBe(200);
    expect(options.headers.get("set-cookie")).toContain(
      "viberacing_profile_deletion=opaque-profile-deletion",
    );
    expect(options.headers.get("set-cookie")).toContain("Path=/auth/profile/delete");
    expect(service.beginProfileDeletion).toHaveBeenCalledWith("opaque-session", {
      handle: "pixel_driver",
    });

    const verification = await http.profileDeletionVerify(
      post(
        "/auth/profile/delete/verify",
        JSON.stringify({ response: { id: "synthetic" } }),
        "application/json",
        "viberacing_session=opaque-session; viberacing_profile_deletion=opaque-profile-deletion",
      ),
    );
    expect(verification.status).toBe(204);
    expect(verification.headers.get("cache-control")).toBe("no-store");
    expect(verification.headers.get("set-cookie")).toContain("viberacing_profile_deletion=");
    expect(verification.headers.get("set-cookie")).toContain("viberacing_recovery=");
    expect(verification.headers.get("set-cookie")).toContain("viberacing_recovery_codes=");
    expect(verification.headers.get("set-cookie")).toContain("viberacing_source_reactivation=");
    expect(verification.headers.get("set-cookie")).toContain("viberacing_source_unlink=");
    expect(verification.headers.get("set-cookie")).toContain("viberacing_session=");
    expect(service.completeProfileDeletion).toHaveBeenCalledWith(
      "opaque-session",
      "opaque-profile-deletion",
      { response: { id: "synthetic" } },
    );

    await expect(
      http.profileDeletionOptions(
        post(
          "/auth/profile/delete/options",
          JSON.stringify({ handle: "pixel_driver" }),
          "application/json",
        ),
      ),
    ).resolves.toMatchObject({ status: 401 });
    await expect(
      http.profileDeletionVerify(
        post(
          "/auth/profile/delete/verify",
          "not-json",
          "application/json",
          "viberacing_session=opaque-session; viberacing_profile_deletion=opaque-profile-deletion",
        ),
      ),
    ).resolves.toMatchObject({ status: 400 });
    const crossOrigin = post(
      "/auth/profile/delete/options",
      JSON.stringify({ handle: "pixel_driver" }),
      "application/json",
      "viberacing_session=opaque-session",
    );
    crossOrigin.headers.set("origin", "https://attacker.example");
    await expect(http.profileDeletionOptions(crossOrigin)).resolves.toMatchObject({ status: 400 });
  });

  it("revokes only one exact owned device from a same-origin session form", async () => {
    const http = createEnrollmentHttp({
      admission: createEnrollmentAdmission(),
      getRuntime: () => runtime,
    });
    const deviceId = `dev_${"A".repeat(22)}`;
    const response = await http.deviceRevoke(
      post(
        "/auth/devices/revoke",
        new URLSearchParams({ deviceId }).toString(),
        "application/x-www-form-urlencoded",
        "viberacing_session=opaque-session",
      ),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${origin}/account`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(service.revokeDevice).toHaveBeenCalledWith("opaque-session", deviceId);

    await expect(
      http.deviceRevoke(
        post(
          "/auth/devices/revoke",
          `deviceId=${deviceId}&deviceId=${deviceId}`,
          "application/x-www-form-urlencoded",
          "viberacing_session=opaque-session",
        ),
      ),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      http.deviceRevoke(
        post(
          "/auth/devices/revoke",
          new URLSearchParams({ deviceId }).toString(),
          "application/x-www-form-urlencoded",
        ),
      ),
    ).resolves.toMatchObject({ status: 303 });
    const crossOrigin = post(
      "/auth/devices/revoke",
      new URLSearchParams({ deviceId }).toString(),
      "application/x-www-form-urlencoded",
      "viberacing_session=opaque-session",
    );
    crossOrigin.headers.set("origin", "https://attacker.example");
    await expect(http.deviceRevoke(crossOrigin)).resolves.toMatchObject({ status: 400 });
  });

  it("changes profile visibility only from the exact same-origin session form", async () => {
    const http = createEnrollmentHttp({
      admission: createEnrollmentAdmission(),
      getRuntime: () => runtime,
    });
    const hidden = await http.profileVisibility(
      post(
        "/auth/profile/visibility",
        "visibility=hidden",
        "application/x-www-form-urlencoded",
        "viberacing_session=opaque-session",
      ),
    );
    expect(hidden.status).toBe(303);
    expect(hidden.headers.get("location")).toBe(`${origin}/account`);
    expect(hidden.headers.get("cache-control")).toBe("no-store");
    expect(service.setProfileVisibility).toHaveBeenCalledWith("opaque-session", false);

    vi.mocked(service.setProfileVisibility).mockResolvedValueOnce(undefined);
    const unavailable = await http.profileVisibility(
      post(
        "/auth/profile/visibility",
        "visibility=public",
        "application/x-www-form-urlencoded",
        "viberacing_session=opaque-session",
      ),
    );
    expect(unavailable.headers.get("location")).toBe(`${origin}/account?error=unavailable`);

    const missingSession = await http.profileVisibility(
      post("/auth/profile/visibility", "visibility=hidden", "application/x-www-form-urlencoded"),
    );
    expect(missingSession.headers.get("location")).toBe(`${origin}/login?error=unavailable`);

    await expect(
      http.profileVisibility(
        post(
          "/auth/profile/visibility",
          "visibility=hidden&visibility=public",
          "application/x-www-form-urlencoded",
          "viberacing_session=opaque-session",
        ),
      ),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      http.profileVisibility(
        post(
          "/auth/profile/visibility",
          "visibility=hidden",
          "text/plain",
          "viberacing_session=opaque-session",
        ),
      ),
    ).resolves.toMatchObject({ status: 400 });
  });

  it("pauses one opaque source control and reactivates it only after fresh passkey proof", async () => {
    const http = createEnrollmentHttp({
      admission: createEnrollmentAdmission(),
      getRuntime: () => runtime,
    });
    const sourceControl = "opaque-source-control";
    const paused = await http.sourcePause(
      post(
        "/auth/sources/pause",
        new URLSearchParams({ sourceControl }).toString(),
        "application/x-www-form-urlencoded",
        "viberacing_session=opaque-session",
      ),
    );
    expect(paused.status).toBe(303);
    expect(paused.headers.get("location")).toBe(`${origin}/account`);
    expect(service.pauseSource).toHaveBeenCalledWith("opaque-session", sourceControl);

    const options = await http.sourceReactivationOptions(
      post(
        "/auth/sources/reactivate/options",
        JSON.stringify({ sourceControl }),
        "application/json",
        "viberacing_session=opaque-session",
      ),
    );
    expect(options.status).toBe(200);
    expect(options.headers.get("set-cookie")).toContain(
      "viberacing_source_reactivation=opaque-source-reactivation",
    );
    expect(options.headers.get("set-cookie")).toContain("Path=/auth/sources/reactivate");
    expect(service.beginSourceReactivation).toHaveBeenCalledWith("opaque-session", {
      sourceControl,
    });

    const verification = await http.sourceReactivationVerify(
      post(
        "/auth/sources/reactivate/verify",
        JSON.stringify({ response: { id: "synthetic" } }),
        "application/json",
        "viberacing_session=opaque-session; viberacing_source_reactivation=opaque-source-reactivation",
      ),
    );
    expect(verification.status).toBe(204);
    expect(verification.headers.get("set-cookie")).toContain("viberacing_source_reactivation=");
    expect(service.completeSourceReactivation).toHaveBeenCalledWith(
      "opaque-session",
      "opaque-source-reactivation",
      { response: { id: "synthetic" } },
    );

    const unlinkOptions = await http.sourceUnlinkOptions(
      post(
        "/auth/sources/unlink/options",
        JSON.stringify({ sourceControl }),
        "application/json",
        "viberacing_session=opaque-session",
      ),
    );
    expect(unlinkOptions.status).toBe(200);
    expect(unlinkOptions.headers.get("set-cookie")).toContain(
      "viberacing_source_unlink=opaque-source-unlink",
    );
    expect(unlinkOptions.headers.get("set-cookie")).toContain("Path=/auth/sources/unlink");
    expect(service.beginSourceUnlink).toHaveBeenCalledWith("opaque-session", { sourceControl });

    const unlinkVerification = await http.sourceUnlinkVerify(
      post(
        "/auth/sources/unlink/verify",
        JSON.stringify({ response: { id: "synthetic" } }),
        "application/json",
        "viberacing_session=opaque-session; viberacing_source_unlink=opaque-source-unlink",
      ),
    );
    expect(unlinkVerification.status).toBe(204);
    expect(unlinkVerification.headers.get("set-cookie")).toContain("viberacing_source_unlink=");
    expect(service.completeSourceUnlink).toHaveBeenCalledWith(
      "opaque-session",
      "opaque-source-unlink",
      { response: { id: "synthetic" } },
    );

    await expect(
      http.sourcePause(
        post(
          "/auth/sources/pause",
          `sourceControl=${sourceControl}&sourceControl=${sourceControl}`,
          "application/x-www-form-urlencoded",
          "viberacing_session=opaque-session",
        ),
      ),
    ).resolves.toMatchObject({ status: 400 });
    const crossOrigin = post(
      "/auth/sources/reactivate/options",
      JSON.stringify({ sourceControl }),
      "application/json",
      "viberacing_session=opaque-session",
    );
    crossOrigin.headers.set("origin", "https://attacker.example");
    await expect(http.sourceReactivationOptions(crossOrigin)).resolves.toMatchObject({
      status: 400,
    });
  });

  it.each([false, undefined, "true", 1])(
    "fails closed before pairing runtime, request parsing, or admission acquisition for enable value %#",
    async (pairingEnabled) => {
      const getRuntime = vi.fn(() => {
        throw new Error("runtime-must-not-run");
      });
      const tryAcquire = vi.fn(() => {
        throw new Error("admission-must-not-run");
      });
      const http = createEnrollmentHttp({
        admission: Object.freeze({ tryAcquire }),
        getRuntime,
        pairingEnabled,
      });
      const makeHostileRequest = () =>
        new Proxy(new Request(`${origin}/auth/pairing/options`, { method: "POST" }), {
          get(_target, key) {
            if (key === "body") {
              return null;
            }
            throw new Error(`request-field-must-not-run:${String(key)}`);
          },
        });

      for (const invoke of [
        (request: Request) => http.pairingApprovalOptions(request),
        (request: Request) => http.pairingApprovalVerify(request),
      ]) {
        const response = await invoke(makeHostileRequest());
        expect(response.status).toBe(503);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("referrer-policy")).toBe("no-referrer");
        expect(response.headers.has("access-control-allow-origin")).toBe(false);
        await expect(response.json()).resolves.toMatchObject({
          errorCode: "temporarily_unavailable",
          status: 503,
        });
      }
      expect(getRuntime).not.toHaveBeenCalled();
      expect(tryAcquire).not.toHaveBeenCalled();
    },
  );

  it("serves pairing review and approval as two closed same-origin steps", async () => {
    const http = createEnrollmentHttp({
      admission: createEnrollmentAdmission(),
      getRuntime: () => runtime,
      pairingEnabled: true,
      sourceCreationEnabled: false,
    });
    const options = await http.pairingApprovalOptions(
      post(
        "/auth/pairing/options",
        JSON.stringify({
          sourceChoice: "existing",
          sourceControl: "opaque-source-control",
          userCode: "7K9M-P2QR-W4XY",
        }),
        "application/json",
        "viberacing_session=opaque-session",
      ),
    );
    expect(options.status).toBe(200);
    expect(options.headers.get("cache-control")).toBe("no-store");
    expect(options.headers.get("referrer-policy")).toBe("no-referrer");
    expect(options.headers.get("set-cookie")).toContain(
      "viberacing_pairing_approval=opaque-pairing-approval",
    );
    expect(options.headers.get("set-cookie")).toContain("Path=/auth/pairing");
    await expect(options.json()).resolves.toMatchObject({
      options: { challenge: Buffer.alloc(32, 13).toString("base64url") },
      pairing: {
        architecture: "x86_64",
        connectorVersion: "1.2.3",
        deviceLabel: "Studio PC",
        osFamily: "windows",
      },
    });
    expect(service.beginPairingApproval).toHaveBeenCalledWith(
      "opaque-session",
      {
        sourceChoice: "existing",
        sourceControl: "opaque-source-control",
        userCode: "7K9M-P2QR-W4XY",
      },
      false,
    );

    const verification = await http.pairingApprovalVerify(
      post(
        "/auth/pairing/verify",
        JSON.stringify({ response: { id: "synthetic" } }),
        "application/json",
        "viberacing_session=opaque-session; viberacing_pairing_approval=opaque-pairing-approval",
      ),
    );
    expect(verification.status).toBe(204);
    expect(verification.headers.get("set-cookie")).toContain("viberacing_pairing_approval=");
    expect(verification.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(service.completePairingApproval).toHaveBeenCalledWith(
      "opaque-session",
      "opaque-pairing-approval",
      { response: { id: "synthetic" } },
      false,
    );

    const crossOrigin = post(
      "/auth/pairing/options",
      JSON.stringify({ sourceChoice: "new", userCode: "7K9M-P2QR-W4XY" }),
      "application/json",
      "viberacing_session=opaque-session",
    );
    crossOrigin.headers.set("origin", "https://attacker.example");
    await expect(http.pairingApprovalOptions(crossOrigin)).resolves.toMatchObject({ status: 400 });
    await expect(
      http.pairingApprovalOptions(
        post(
          "/auth/pairing/options",
          "x".repeat(1025),
          "application/json",
          "viberacing_session=opaque-session",
        ),
      ),
    ).resolves.toMatchObject({ status: 400 });
    expect(service.beginPairingApproval).toHaveBeenCalledOnce();
    await expect(
      http.pairingApprovalVerify(
        post(
          "/auth/pairing/verify",
          JSON.stringify({ response: { id: "synthetic" } }),
          "application/json",
          "viberacing_session=opaque-session; viberacing_pairing_approval=one; viberacing_pairing_approval=two",
        ),
      ),
    ).resolves.toMatchObject({ status: 401 });
    expect(service.completePairingApproval).toHaveBeenCalledOnce();
  });

  it.each([false, undefined, "true", 1])(
    "fails closed before CarRecipe proposal runtime, parsing, or admission for enable value %#",
    async (carProposalsEnabled) => {
      const getRuntime = vi.fn(() => {
        throw new Error("runtime-must-not-run");
      });
      const tryAcquire = vi.fn(() => {
        throw new Error("admission-must-not-run");
      });
      const http = createEnrollmentHttp({
        admission: Object.freeze({ tryAcquire }),
        carProposalsEnabled,
        getRuntime,
      });
      const makeHostileRequest = () =>
        new Proxy(new Request(`${origin}/auth/cars/proposals`, { method: "POST" }), {
          get(_target, key) {
            if (key === "body") {
              return null;
            }
            throw new Error(`request-field-must-not-run:${String(key)}`);
          },
        });

      for (const invoke of [
        (request: Request) => http.carRecipePropose(request),
        (request: Request) => http.carRecipeApprove(request),
      ]) {
        const response = await invoke(makeHostileRequest());
        expect(response.status).toBe(503);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("referrer-policy")).toBe("no-referrer");
        expect(response.headers.has("access-control-allow-origin")).toBe(false);
        await expect(response.json()).resolves.toMatchObject({
          errorCode: "temporarily_unavailable",
          status: 503,
        });
      }
      expect(getRuntime).not.toHaveBeenCalled();
      expect(tryAcquire).not.toHaveBeenCalled();
    },
  );

  it("accepts only one exact bounded CarRecipe proposal form under the session cookie", async () => {
    const http = createEnrollmentHttp({
      admission: createEnrollmentAdmission(),
      carProposalsEnabled: true,
      getRuntime: () => runtime,
    });
    const values = {
      schemaVersion: "1",
      chassis: "rally",
      nose: "scoop",
      cockpit: "rally",
      wing: "low",
      wheels: "all-terrain",
      palette: "sunburst",
      trail: "spark",
      seed: "42",
    };
    const proposed = await http.carRecipePropose(
      post(
        "/auth/cars/proposals",
        new URLSearchParams(values).toString(),
        "application/x-www-form-urlencoded",
        "viberacing_session=opaque-session",
      ),
    );
    expect(proposed.status).toBe(303);
    expect(proposed.headers.get("location")).toBe(`${origin}/account#car-proposal`);
    expect(proposed.headers.get("cache-control")).toBe("no-store");
    expect(runtime.carProposalService.propose).toHaveBeenCalledWith(
      "opaque-session",
      {
        schemaVersion: 1,
        chassis: "rally",
        nose: "scoop",
        cockpit: "rally",
        wing: "low",
        wheels: "all-terrain",
        palette: "sunburst",
        trail: "spark",
        seed: 42,
      },
      true,
    );

    for (const body of [
      `${new URLSearchParams(values).toString()}&seed=7`,
      `${new URLSearchParams(values).toString()}&assetUrl=https%3A%2F%2Finvalid.example%2Fcar.svg`,
      new URLSearchParams({ ...values, schemaVersion: "2" }).toString(),
      new URLSearchParams({ ...values, seed: "65536" }).toString(),
      new URLSearchParams({ ...values, seed: "1.5" }).toString(),
    ]) {
      await expect(
        http.carRecipePropose(
          post(
            "/auth/cars/proposals",
            body,
            "application/x-www-form-urlencoded",
            "viberacing_session=opaque-session",
          ),
        ),
      ).resolves.toMatchObject({ status: 400 });
    }
    expect(runtime.carProposalService.propose).toHaveBeenCalledOnce();

    const missingSession = await http.carRecipePropose(
      post(
        "/auth/cars/proposals",
        new URLSearchParams(values).toString(),
        "application/x-www-form-urlencoded",
      ),
    );
    expect(missingSession.headers.get("location")).toBe(`${origin}/login?error=unavailable`);

    const crossOrigin = post(
      "/auth/cars/proposals",
      new URLSearchParams(values).toString(),
      "application/x-www-form-urlencoded",
      "viberacing_session=opaque-session",
    );
    crossOrigin.headers.set("origin", "https://attacker.example");
    await expect(http.carRecipePropose(crossOrigin)).resolves.toMatchObject({ status: 400 });
    await expect(
      http.carRecipePropose(
        post(
          "/auth/cars/proposals?next=/account",
          new URLSearchParams(values).toString(),
          "application/x-www-form-urlencoded",
          "viberacing_session=opaque-session",
        ),
      ),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      http.carRecipePropose(
        post(
          "/auth/cars/proposals",
          new URLSearchParams(values).toString(),
          "text/plain",
          "viberacing_session=opaque-session",
        ),
      ),
    ).resolves.toMatchObject({ status: 400 });

    vi.mocked(runtime.carProposalService.propose).mockRejectedValueOnce(
      new Error("private dependency detail"),
    );
    const contained = await http.carRecipePropose(
      post(
        "/auth/cars/proposals",
        new URLSearchParams(values).toString(),
        "application/x-www-form-urlencoded",
        "viberacing_session=opaque-session",
      ),
    );
    expect(contained.headers.get("location")).toBe(`${origin}/account?error=unavailable`);
  });

  it("approves or rejects only one bounded opaque CarRecipe control", async () => {
    const http = createEnrollmentHttp({
      admission: createEnrollmentAdmission(),
      carProposalsEnabled: true,
      getRuntime: () => runtime,
    });
    const body = new URLSearchParams({ proposalControl: "opaque-proposal-control" }).toString();
    const cookie = "viberacing_session=opaque-session";

    const approved = await http.carRecipeApprove(
      post("/auth/cars/proposals/approve", body, "application/x-www-form-urlencoded", cookie),
    );
    const rejected = await http.carRecipeReject(
      post("/auth/cars/proposals/reject", body, "application/x-www-form-urlencoded", cookie),
    );
    const disabledMutations = createEnrollmentHttp({
      admission: createEnrollmentAdmission(),
      carProposalsEnabled: false,
      getRuntime: () => runtime,
    });
    const rejectedWhileDisabled = await disabledMutations.carRecipeReject(
      post("/auth/cars/proposals/reject", body, "application/x-www-form-urlencoded", cookie),
    );
    expect(approved.headers.get("location")).toBe(`${origin}/account`);
    expect(rejected.headers.get("location")).toBe(`${origin}/account`);
    expect(rejectedWhileDisabled.headers.get("location")).toBe(`${origin}/account`);
    expect(runtime.carProposalService.approve).toHaveBeenCalledWith(
      "opaque-session",
      "opaque-proposal-control",
      true,
    );
    expect(runtime.carProposalService.reject).toHaveBeenNthCalledWith(
      1,
      "opaque-session",
      "opaque-proposal-control",
    );
    expect(runtime.carProposalService.reject).toHaveBeenNthCalledWith(
      2,
      "opaque-session",
      "opaque-proposal-control",
    );

    await expect(
      http.carRecipeApprove(
        post(
          "/auth/cars/proposals/approve",
          `${body}&proposalControl=second`,
          "application/x-www-form-urlencoded",
          cookie,
        ),
      ),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      http.carRecipeReject(
        post(
          "/auth/cars/proposals/reject",
          `proposalControl=${"x".repeat(1025)}`,
          "application/x-www-form-urlencoded",
          cookie,
        ),
      ),
    ).resolves.toMatchObject({ status: 400 });
    const missingSession = await http.carRecipeApprove(
      post("/auth/cars/proposals/approve", body, "application/x-www-form-urlencoded"),
    );
    expect(missingSession.headers.get("location")).toBe(`${origin}/login?error=unavailable`);

    vi.mocked(runtime.carProposalService.approve).mockRejectedValueOnce(
      new Error("private dependency detail"),
    );
    const contained = await http.carRecipeApprove(
      post("/auth/cars/proposals/approve", body, "application/x-www-form-urlencoded", cookie),
    );
    expect(contained.headers.get("location")).toBe(`${origin}/account?error=unavailable`);

    const admission = createEnrollmentAdmission(1);
    const held = admission.tryAcquire();
    const overloaded = createEnrollmentHttp({ admission, getRuntime: () => runtime });
    const busy = await overloaded.carRecipeReject(
      post("/auth/cars/proposals/reject", body, "application/x-www-form-urlencoded", cookie),
    );
    held?.release();
    expect(busy.headers.get("location")).toBe(`${origin}/account?error=unavailable`);
    expect(runtime.carProposalService.reject).toHaveBeenCalledTimes(2);
  });

  it("clears every browser credential on same-origin logout even when admission is busy", async () => {
    const admission = createEnrollmentAdmission(1);
    const held = admission.tryAcquire();
    const http = createEnrollmentHttp({
      admission,
      enrollmentEnabled: true,
      getRuntime: () => runtime,
    });
    const response = await http.logout(
      post("/auth/logout", "", "application/x-www-form-urlencoded", "viberacing_session=s"),
    );
    held?.release();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${origin}/join?error=unavailable`);
    expect(response.headers.get("set-cookie")).toContain("viberacing_login=");
    expect(response.headers.get("set-cookie")).toContain("viberacing_passkey_add=");
    expect(response.headers.get("set-cookie")).toContain("viberacing_passkey_revoke=");
    expect(response.headers.get("set-cookie")).toContain("viberacing_profile_deletion=");
    expect(response.headers.get("set-cookie")).toContain("viberacing_recovery=");
    expect(response.headers.get("set-cookie")).toContain("viberacing_recovery_codes=");
    expect(response.headers.get("set-cookie")).toContain("viberacing_source_reactivation=");
    expect(response.headers.get("set-cookie")).toContain("viberacing_source_unlink=");
    expect(response.headers.get("set-cookie")).toContain("viberacing_pairing_approval=");
    expect(response.headers.get("set-cookie")).toContain("viberacing_session=");
    expect(service.logout).not.toHaveBeenCalled();

    await expect(
      http.logout(
        post(
          "/auth/logout",
          "unexpected",
          "application/x-www-form-urlencoded",
          "viberacing_session=s",
        ),
      ),
    ).resolves.toMatchObject({ status: 400 });
  });

  it("fails closed on overload, malformed bodies, unavailable runtime, and missing cookies", async () => {
    const admission = createEnrollmentAdmission(1);
    const held = admission.tryAcquire();
    const http = createEnrollmentHttp({
      admission,
      enrollmentEnabled: true,
      getRuntime: () => runtime,
    });
    const cancelBody = vi.fn();
    const overloadBody = new ReadableStream<Uint8Array>({ cancel: cancelBody });
    const overload = await http.start(
      new Request(`${origin}/auth/github/start`, {
        body: overloadBody,
        duplex: "half",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          host: "race.example.com",
          origin,
        },
        method: "POST",
      } as RequestInit & { duplex: "half" }),
    );
    held?.release();
    expect(overload.headers.get("location")).toBe(`${origin}/join?error=unavailable`);
    expect(cancelBody).toHaveBeenCalledOnce();

    const oversized = await http.start(
      post("/auth/github/start", "x".repeat(1025), "application/x-www-form-urlencoded"),
    );
    expect(oversized.headers.get("location")).toBe(`${origin}/join?error=invalid`);

    await expect(
      http.passkeyVerify(post("/auth/passkey/verify", "not-json", "application/json")),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      http.passkeyOptions(post("/auth/passkey/options", "{}", "application/json")),
    ).resolves.toMatchObject({ status: 503 });
    const unavailable = createEnrollmentHttp({
      admission: createEnrollmentAdmission(),
      enrollmentEnabled: true,
      getRuntime: () => {
        throw new Error("private config");
      },
    });
    await expect(
      unavailable.start(post("/auth/github/start", joinBody, "application/x-www-form-urlencoded")),
    ).resolves.toMatchObject({ status: 503 });
  });
});

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
const joinBody = new URLSearchParams({
  handle: "pixel_driver",
  inviteCode,
  locale: "en",
  motionPreference: "system",
  streakVisible: "false",
  theme: "neon-night",
}).toString();
const config = resolveEnrollmentConfig({
  GITHUB_CLIENT_ID: "Ov23abcdefghijklmno",
  GITHUB_CLIENT_SECRET: "a".repeat(40),
  NODE_ENV: "test",
  SESSION_SECRET: Buffer.alloc(32, 2).toString("base64url"),
  VIBERACING_PUBLIC_ORIGIN: origin,
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
    cancelGithub: vi.fn(() => true),
    completeGithub: vi.fn(() => Promise.resolve({ sessionCookie: "opaque-session" })),
    completeLogin: vi.fn(() => Promise.resolve({ sessionCookie: "active-session" })),
    completePasskey: vi.fn(() => Promise.resolve({ sessionCookie: "active-session" })),
    completePasskeyAdd: vi.fn(() => Promise.resolve(true)),
    completePasskeyRevoke: vi.fn(() => Promise.resolve(true)),
    completeProfileDeletion: vi.fn(() => Promise.resolve(true)),
    logout: vi.fn(() => Promise.resolve(true)),
    readPasskeyInventory: vi.fn(() => Promise.resolve(undefined)),
    readProfileVisibility: vi.fn(() => Promise.resolve("public" as const)),
    readSession: vi.fn(() => undefined),
    setProfileVisibility: vi.fn(() => Promise.resolve("hidden" as const)),
  };
}

describe("enrollment HTTP boundary", () => {
  let service: EnrollmentService;
  let runtime: EnrollmentRuntime;

  beforeEach(() => {
    service = serviceFixture();
    runtime = { config, service };
  });

  it("starts OAuth only from a bounded same-origin form", async () => {
    const http = createEnrollmentHttp({
      admission: createEnrollmentAdmission(),
      getRuntime: () => runtime,
    });
    const response = await http.start(
      post("/auth/github/start", joinBody, "application/x-www-form-urlencoded"),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("https://github.com/login/oauth/authorize");
    expect(response.headers.get("set-cookie")).toContain("viberacing_oauth=opaque-oauth");
    expect(response.headers.get("set-cookie")).toContain("Path=/auth/github/callback");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(service.beginGithub).toHaveBeenCalledOnce();

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
      getRuntime: () => runtime,
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

  it("serves options, verifies one bounded response, and replaces the session cookie", async () => {
    const http = createEnrollmentHttp({
      admission: createEnrollmentAdmission(),
      getRuntime: () => runtime,
    });
    const options = await http.passkeyOptions(
      post("/auth/passkey/options", "{}", "application/json", "viberacing_session=opaque-session"),
    );
    expect(options.status).toBe(200);
    expect(options.headers.get("set-cookie")).toContain("viberacing_passkey=opaque-passkey");
    expect(options.headers.get("set-cookie")).toContain("Path=/auth/passkey");
    const optionsBody = JSON.parse(await options.text()) as unknown;
    expect(optionsBody).toBeTypeOf("object");
    expect(typeof (optionsBody as Record<string, unknown>).challenge).toBe("string");

    const verification = await http.passkeyVerify(
      post(
        "/auth/passkey/verify",
        JSON.stringify({ label: "Primary passkey", response: { id: "synthetic" } }),
        "application/json",
        "viberacing_session=opaque-session; viberacing_passkey=opaque-passkey",
      ),
    );
    expect(verification.status).toBe(204);
    expect(verification.headers.get("set-cookie")).toContain("viberacing_session=active-session");
    expect(verification.headers.get("set-cookie")).toContain("Max-Age=2592000");
    expect(service.completePasskey).toHaveBeenCalledOnce();

    await expect(
      http.passkeyOptions(
        post(
          "/auth/passkey/options",
          " {}",
          "application/json",
          "viberacing_session=opaque-session",
        ),
      ),
    ).resolves.toMatchObject({ status: 400 });
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

  it("clears every browser credential on same-origin logout even when admission is busy", async () => {
    const admission = createEnrollmentAdmission(1);
    const held = admission.tryAcquire();
    const http = createEnrollmentHttp({ admission, getRuntime: () => runtime });
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
    const http = createEnrollmentHttp({ admission, getRuntime: () => runtime });
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
      getRuntime: () => {
        throw new Error("private config");
      },
    });
    await expect(
      unavailable.start(post("/auth/github/start", joinBody, "application/x-www-form-urlencoded")),
    ).resolves.toMatchObject({ status: 503 });
  });
});

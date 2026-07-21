import { generateKeyPair, exportJWK, SignJWT, type CryptoKey } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { resolveAdminAccessConfig, type AdminAccessConfig } from "./access-config.js";
import {
  adminAccessClockSkewSeconds,
  adminAccessMaximumTokenLifetimeSeconds,
  createAdminAccessVerifier,
  type AdminAccessVerificationError,
  type AdminAccessVerifierRuntime,
} from "./access-verifier.js";

const issuer = "https://viberacing-admin.cloudflareaccess.com";
const audience = "a".repeat(64);
const actorReference = `adm_${"A".repeat(22)}`;
const subject = "8ec31cb0-3b95-47f9-a4ba-705a3f00e312";
const keyId = "b".repeat(64);
const secondKeyId = "c".repeat(64);
const nowMs = Date.parse("2026-07-21T12:00:00.000Z");
const nowSeconds = nowMs / 1_000;

let privateKey: CryptoKey;
let secondPrivateKey: CryptoKey;
let config: AdminAccessConfig;

interface TokenOptions {
  readonly header?: Readonly<Record<string, unknown>>;
  readonly key?: CryptoKey | Uint8Array;
  readonly payload?: Readonly<Record<string, unknown>>;
}

function runtime(...values: readonly number[]): AdminAccessVerifierRuntime {
  let index = 0;
  return Object.freeze({
    clock: () => values[Math.min(index++, values.length - 1)]!,
  });
}

function expectVerificationError(
  action: () => Promise<unknown>,
  code: AdminAccessVerificationError["code"],
): Promise<void> {
  return expect(action()).rejects.toMatchObject({
    code,
    message: "Admin Access verification failed.",
  });
}

async function signToken(options: TokenOptions = {}): Promise<string> {
  const payload = {
    aud: [audience],
    email: "ignored@example.com",
    exp: nowSeconds + 300,
    iat: nowSeconds - 60,
    iss: issuer,
    sub: subject,
    type: "app",
    ...options.payload,
  };
  const header = {
    alg: options.key instanceof Uint8Array ? "HS256" : "RS256",
    kid: keyId,
    typ: "JWT",
    ...options.header,
  };
  return new SignJWT(payload).setProtectedHeader(header).sign(options.key ?? privateKey);
}

beforeAll(async () => {
  const first = await generateKeyPair("RS256", { extractable: true, modulusLength: 2_048 });
  const second = await generateKeyPair("RS256", { extractable: true, modulusLength: 2_048 });
  privateKey = first.privateKey;
  secondPrivateKey = second.privateKey;
  const firstJwk = await exportJWK(first.publicKey);
  const secondJwk = await exportJWK(second.publicKey);
  if (
    firstJwk.e === undefined ||
    firstJwk.n === undefined ||
    secondJwk.e === undefined ||
    secondJwk.n === undefined
  ) {
    throw new Error("RSA test key export failed.");
  }
  config = resolveAdminAccessConfig({
    VIBERACING_ADMIN_ACCESS_AUDIENCE: audience,
    VIBERACING_ADMIN_ACCESS_JWKS: JSON.stringify({
      keys: [
        { alg: "RS256", e: firstJwk.e, kid: keyId, kty: "RSA", n: firstJwk.n, use: "sig" },
        {
          alg: "RS256",
          e: secondJwk.e,
          kid: secondKeyId,
          kty: "RSA",
          n: secondJwk.n,
          use: "sig",
        },
      ],
    }),
    VIBERACING_ADMIN_ACCESS_MEMBERS: JSON.stringify([{ actorReference, subject }]),
    VIBERACING_ADMIN_ACCESS_TEAM_DOMAIN: issuer,
  });
});

describe("Admin Cloudflare Access verification", () => {
  it("returns only one redacted frozen individual identity after exact RS256 verification", async () => {
    const token = await signToken();
    const identity = await createAdminAccessVerifier(config, runtime(nowMs, nowMs + 5)).verify(
      token,
    );

    expect(identity.accessExpiresAtMs).toBe((nowSeconds + 300) * 1_000);
    expect(identity.accessVerifiedAtMs).toBe(nowMs + 5);
    expect(identity.actorReference).toBe(actorReference);
    expect(identity.purpose).toBe("invite_issue");
    expect(identity.version).toBe(1);
    expect(Object.keys(identity)).toEqual([]);
    expect(Object.isFrozen(identity)).toBe(true);
    expect(JSON.stringify(identity)).toBe('{"redacted":true}');
    expect(JSON.stringify(identity)).not.toContain("ignored@example.com");
    expect(JSON.stringify(identity)).not.toContain(subject);
    expect(adminAccessClockSkewSeconds).toBe(30);
    expect(adminAccessMaximumTokenLifetimeSeconds).toBe(3_600);
  });

  it("accepts the previous exact signing key during the bounded rotation overlap", async () => {
    const token = await signToken({
      header: { kid: secondKeyId },
      key: secondPrivateKey,
    });
    await expect(
      createAdminAccessVerifier(config, runtime(nowMs, nowMs)).verify(token),
    ).resolves.toMatchObject({ actorReference });
  });

  it.each([
    { arguments_: [] },
    { arguments_: ["one", "two"] },
    { arguments_: [undefined] },
    { arguments_: [42] },
    { arguments_: [" token"] },
    { arguments_: ["a.b"] },
    { arguments_: [`${"a".repeat(8_193)}.b.c`] },
  ])("rejects an invalid call or assertion envelope %#", async ({ arguments_ }) => {
    const verifier = createAdminAccessVerifier(config, runtime(nowMs, nowMs));
    const code = arguments_.length === 1 ? "access_rejected" : "argument_invalid";
    await expectVerificationError(() => verifier.verify(...arguments_), code);
  });

  const invalidTokenOptions: readonly TokenOptions[] = [
    { payload: { iss: "https://another.cloudflareaccess.com" } },
    { payload: { aud: ["d".repeat(64)] } },
    { payload: { aud: [audience, "d".repeat(64)] } },
    { payload: { aud: audience } },
    { payload: { type: "org" } },
    { payload: { type: undefined } },
    { payload: { sub: "unknown-subject" } },
    { payload: { sub: "contains whitespace" } },
    { payload: { sub: "someone@example.com" } },
    { payload: { sub: undefined } },
    { payload: { service_token_id: "service", sub: subject } },
    { payload: { common_name: "service.access", sub: subject } },
    { payload: { service_token_status: true, sub: subject } },
    { payload: { exp: nowSeconds - 1 } },
    { payload: { exp: nowSeconds - 60, iat: nowSeconds - 60 } },
    { payload: { exp: nowSeconds + 3_601, iat: nowSeconds } },
    { payload: { exp: nowSeconds + 300.5 } },
    { payload: { iat: nowSeconds + adminAccessClockSkewSeconds + 1 } },
    { payload: { nbf: nowSeconds + adminAccessClockSkewSeconds + 1 } },
    { header: { jku: "https://attacker.invalid/jwks" } },
    { header: { typ: "application/jwt" } },
  ];

  it.each(invalidTokenOptions)(
    "collapses invalid signed policy or claim state %#",
    async (options) => {
      const token = await signToken(options);
      await expectVerificationError(
        () => createAdminAccessVerifier(config, runtime(nowMs, nowMs)).verify(token),
        "access_rejected",
      );
    },
  );

  it("rejects a valid-looking token signed by an untrusted key", async () => {
    const attacker = await generateKeyPair("RS256", { modulusLength: 2_048 });
    const token = await signToken({ key: attacker.privateKey });
    await expectVerificationError(
      () => createAdminAccessVerifier(config, runtime(nowMs, nowMs)).verify(token),
      "access_rejected",
    );
  });

  it("rejects algorithm confusion before policy output", async () => {
    const token = await signToken({
      header: { alg: "HS256", kid: keyId },
      key: new TextEncoder().encode("a sufficiently long synthetic HMAC test key"),
    });
    await expectVerificationError(
      () => createAdminAccessVerifier(config, runtime(nowMs, nowMs)).verify(token),
      "access_rejected",
    );
  });

  it("rejects expiry that occurs while verification is settling", async () => {
    const token = await signToken({ payload: { exp: nowSeconds + 1, iat: nowSeconds - 60 } });
    await expectVerificationError(
      () => createAdminAccessVerifier(config, runtime(nowMs, nowMs + 1_000)).verify(token),
      "access_rejected",
    );
  });

  it("rejects a backward clock after cryptographic verification", async () => {
    const token = await signToken();
    await expectVerificationError(
      () => createAdminAccessVerifier(config, runtime(nowMs, nowMs - 1)).verify(token),
      "clock_invalid",
    );
  });

  it.each([Number.NaN, -1, Date.parse("9999-12-31T23:59:59.001Z")])(
    "rejects an invalid clock value %#",
    async (value) => {
      const token = await signToken();
      await expectVerificationError(
        () => createAdminAccessVerifier(config, runtime(value)).verify(token),
        "clock_invalid",
      );
    },
  );

  it("maps a throwing clock to one closed clock failure", async () => {
    const token = await signToken();
    const verifier = createAdminAccessVerifier(config, {
      clock() {
        throw new Error("private marker");
      },
    });
    await expectVerificationError(() => verifier.verify(token), "clock_invalid");
  });

  it.each([null, [], 42, {}, { clock: 42 }, { clock: () => nowMs, extra: true }])(
    "rejects an invalid runtime dependency %#",
    (runtimeValue) => {
      expect(() => createAdminAccessVerifier(config, runtimeValue)).toThrow(
        expect.objectContaining({ code: "dependency_invalid" }),
      );
    },
  );

  it("rejects a caller-built configuration even when its visible fields match", () => {
    expect(() =>
      createAdminAccessVerifier({
        audience: config.audience,
        issuer: config.issuer,
        jwks: config.jwks,
        members: config.members,
      }),
    ).toThrow(expect.objectContaining({ code: "dependency_invalid" }));
  });

  it("rejects reflective runtime dependencies without exposing their exception", () => {
    const reflective = new Proxy(
      { clock: () => nowMs },
      {
        ownKeys() {
          throw new Error("private marker");
        },
      },
    );
    expect(() => createAdminAccessVerifier(config, reflective)).toThrow(
      expect.objectContaining({ code: "dependency_invalid" }),
    );
  });
});

import { generateKeyPair, exportJWK } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import {
  AdminAccessConfigurationError,
  hashAdminAccessSubject,
  resolveAdminAccessConfig,
} from "./access-config.js";

const issuer = "https://viberacing-admin.cloudflareaccess.com";
const audience = "a".repeat(64);
const actorReference = `adm_${"A".repeat(22)}`;
const subject = "8ec31cb0-3b95-47f9-a4ba-705a3f00e312";
const keyId = "b".repeat(64);

let publicJwk: Readonly<Record<string, string>> = Object.freeze({
  e: "AQAB",
  n: Buffer.alloc(256, 0xff).toString("base64url"),
});

function expectConfigurationError(
  environment: Readonly<Record<string, string | undefined>>,
  code: AdminAccessConfigurationError["code"],
): void {
  try {
    resolveAdminAccessConfig(environment);
    throw new Error("Expected configuration rejection.");
  } catch (error) {
    expect(error).toBeInstanceOf(AdminAccessConfigurationError);
    expect(error).toMatchObject({ code, message: "Admin Access configuration is invalid." });
  }
}

function key(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    alg: "RS256",
    e: publicJwk.e,
    kid: keyId,
    kty: "RSA",
    n: publicJwk.n,
    use: "sig",
    ...overrides,
  };
}

function environment(
  overrides: Readonly<Record<string, string | undefined>> = {},
): Record<string, string | undefined> {
  return {
    VIBERACING_ADMIN_ACCESS_AUDIENCE: audience,
    VIBERACING_ADMIN_ACCESS_JWKS: JSON.stringify({ keys: [key()] }),
    VIBERACING_ADMIN_ACCESS_MEMBERS: JSON.stringify([{ actorReference, subject }]),
    VIBERACING_ADMIN_ACCESS_TEAM_DOMAIN: issuer,
    ...overrides,
  };
}

beforeAll(async () => {
  const { publicKey } = await generateKeyPair("RS256", { extractable: true, modulusLength: 2_048 });
  const exported = await exportJWK(publicKey);
  if (exported.e === undefined || exported.n === undefined) {
    throw new Error("RSA test key export failed.");
  }
  publicJwk = Object.freeze({ e: exported.e, n: exported.n });
});

describe("Admin Access protected configuration", () => {
  it("resolves one redacted frozen issuer, audience, rotation set, and individual membership", () => {
    const rotatedKey = key({ kid: "c".repeat(64) });
    const secondActor = `adm_${"B".repeat(21)}Q`;
    const secondSubject = "198eec51-bfc6-43f4-8b99-9ee7295aa9b3";
    const config = resolveAdminAccessConfig(
      environment({
        VIBERACING_ADMIN_ACCESS_JWKS: JSON.stringify({ keys: [key(), rotatedKey] }),
        VIBERACING_ADMIN_ACCESS_MEMBERS: JSON.stringify([
          { actorReference, subject },
          { actorReference: secondActor, subject: secondSubject },
        ]),
      }),
    );

    expect(config.audience).toBe(audience);
    expect(config.issuer).toBe(issuer);
    expect(config.jwks.keys).toHaveLength(2);
    expect(config.members).toEqual([
      {
        actorReference,
        subjectDigest: hashAdminAccessSubject(issuer, subject),
      },
      {
        actorReference: secondActor,
        subjectDigest: hashAdminAccessSubject(issuer, secondSubject),
      },
    ]);
    expect(JSON.stringify(config)).toBe('{"redacted":true}');
    expect(Object.keys(config)).toEqual([]);
    expect(JSON.stringify(config)).not.toContain(subject);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.jwks)).toBe(true);
    expect(Object.isFrozen(config.jwks.keys)).toBe(true);
    expect(config.jwks.keys.every((entry) => Object.isFrozen(entry))).toBe(true);
    expect(Object.isFrozen(config.members)).toBe(true);
    expect(config.members.every((entry) => Object.isFrozen(entry))).toBe(true);
  });

  it.each([undefined, "", "A".repeat(64), "a".repeat(63), `${"a".repeat(63)}g`])(
    "rejects an invalid audience %#",
    (value) => {
      expectConfigurationError(
        environment({ VIBERACING_ADMIN_ACCESS_AUDIENCE: value }),
        "audience_invalid",
      );
    },
  );

  it.each([
    undefined,
    "",
    "http://viberacing-admin.cloudflareaccess.com",
    "https://VIBERACING.cloudflareaccess.com",
    "https://viberacing-admin.cloudflareaccess.com/extra",
    "https://viberacing-admin.cloudflareaccess.com?query=1",
    "https://viberacing-admin.cloudflareaccess.com#fragment",
    "https://viberacing-admin.cloudflareaccess.com:8443",
    "https://cloudflareaccess.com",
  ])("rejects an invalid team domain %#", (value) => {
    expectConfigurationError(
      environment({ VIBERACING_ADMIN_ACCESS_TEAM_DOMAIN: value }),
      "issuer_invalid",
    );
  });

  it.each([
    undefined,
    "",
    " {}",
    "not-json",
    JSON.stringify([]),
    JSON.stringify({}),
    JSON.stringify({ keys: "wrong" }),
    JSON.stringify({ keys: [] }),
    JSON.stringify({ keys: [key(), key({ kid: "c".repeat(64) }), key({ kid: "d".repeat(64) })] }),
    "x".repeat(24_577),
  ])("rejects an invalid JWKS container %#", (value) => {
    expectConfigurationError(environment({ VIBERACING_ADMIN_ACCESS_JWKS: value }), "jwks_invalid");
  });

  it.each([
    null,
    {},
    key({ extra: true }),
    key({ alg: "HS256" }),
    key({ e: "Aw" }),
    key({ kid: "B".repeat(64) }),
    key({ kid: "b".repeat(63) }),
    key({ kty: "EC" }),
    key({ n: "not+base64url" }),
    key({ n: Buffer.alloc(255, 0xff).toString("base64url") }),
    key({ n: Buffer.alloc(513, 0xff).toString("base64url") }),
    key({ n: Buffer.concat([Buffer.from([0]), Buffer.alloc(256, 0xff)]).toString("base64url") }),
    key({ n: Buffer.concat([Buffer.alloc(255, 0xff), Buffer.from([0xfe])]).toString("base64url") }),
    key({ use: "enc" }),
  ])("rejects an invalid RSA signing key %#", (value) => {
    expectConfigurationError(
      environment({ VIBERACING_ADMIN_ACCESS_JWKS: JSON.stringify({ keys: [value] }) }),
      "jwks_invalid",
    );
  });

  it("rejects duplicate signing key IDs", () => {
    expectConfigurationError(
      environment({
        VIBERACING_ADMIN_ACCESS_JWKS: JSON.stringify({ keys: [key(), key()] }),
      }),
      "jwks_invalid",
    );
  });

  it.each([
    undefined,
    "",
    " []",
    "not-json",
    JSON.stringify({}),
    JSON.stringify([]),
    JSON.stringify(
      Array.from({ length: 17 }, (_, index) => ({
        actorReference: `adm_${index.toString().padStart(22, "0")}`,
        subject: `subject-${index.toString()}`,
      })),
    ),
    "x".repeat(8_193),
  ])("rejects an invalid membership container %#", (value) => {
    expectConfigurationError(
      environment({ VIBERACING_ADMIN_ACCESS_MEMBERS: value }),
      "members_invalid",
    );
  });

  it.each([
    null,
    {},
    { actorReference, subject, extra: true },
    { actorReference: `adm_${"A".repeat(21)}B`, subject },
    { actorReference, subject: "contains whitespace" },
    { actorReference, subject: "someone@example.com" },
    { actorReference, subject: "ü" },
    { actorReference, subject: "a".repeat(129) },
  ])("rejects an invalid individual membership %#", (value) => {
    expectConfigurationError(
      environment({ VIBERACING_ADMIN_ACCESS_MEMBERS: JSON.stringify([value]) }),
      "members_invalid",
    );
  });

  it.each([
    {
      members: [
        { actorReference, subject },
        { actorReference, subject: "another-subject" },
      ],
    },
    {
      members: [
        { actorReference, subject },
        { actorReference: `adm_${"C".repeat(21)}g`, subject },
      ],
    },
  ])("rejects duplicated actors or Access subjects %#", ({ members }) => {
    expectConfigurationError(
      environment({ VIBERACING_ADMIN_ACCESS_MEMBERS: JSON.stringify(members) }),
      "members_invalid",
    );
  });

  it("rejects non-data and reflective environment values without evaluating or exposing them", () => {
    const accessor = environment();
    Object.defineProperty(accessor, "VIBERACING_ADMIN_ACCESS_AUDIENCE", {
      enumerable: true,
      get() {
        throw new Error("private getter marker");
      },
    });
    const hidden = environment();
    Object.defineProperty(hidden, "VIBERACING_ADMIN_ACCESS_AUDIENCE", {
      enumerable: false,
      value: audience,
    });
    const wrongType = environment();
    Object.defineProperty(wrongType, "VIBERACING_ADMIN_ACCESS_AUDIENCE", {
      enumerable: true,
      value: 42,
    });
    const reflective = new Proxy(environment(), {
      getOwnPropertyDescriptor() {
        throw new Error("private reflection marker");
      },
    });
    expectConfigurationError(accessor, "environment_unreadable");
    expectConfigurationError(hidden, "environment_unreadable");
    expectConfigurationError(wrongType, "environment_unreadable");
    expectConfigurationError(reflective, "environment_unreadable");
  });
});

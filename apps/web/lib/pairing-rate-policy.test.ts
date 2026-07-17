// @vitest-environment node

import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import {
  derivePairingClientIdentity,
  pairingClientIdBytes,
  pairingClientIdHeader,
  PairingRatePolicyConfigurationError,
  resolvePairingRatePolicy,
} from "./pairing-rate-policy";

const validEnvironment = Object.freeze({
  VIBERACING_WEB_PAIRING_POLL_BUCKET_LIMIT: "120",
  VIBERACING_WEB_PAIRING_POLL_GLOBAL_LIMIT: "1200",
  VIBERACING_WEB_PAIRING_POLL_WINDOW_SECONDS: "60",
  VIBERACING_WEB_PAIRING_START_BUCKET_LIMIT: "12",
  VIBERACING_WEB_PAIRING_START_GLOBAL_LIMIT: "120",
  VIBERACING_WEB_PAIRING_START_WINDOW_SECONDS: "60",
});

describe("pairing rate policy", () => {
  it("returns only the reviewed start and poll limits", () => {
    const policy = resolvePairingRatePolicy(validEnvironment);

    expect(policy.limits("start")).toEqual({
      bucketLimit: 12,
      globalLimit: 120,
      windowSeconds: 60,
    });
    expect(policy.limits("poll")).toEqual({
      bucketLimit: 120,
      globalLimit: 1200,
      windowSeconds: 60,
    });
    expect(pairingClientIdBytes).toBe(16);
    expect(pairingClientIdHeader).toBe("x-viberacing-client-id");
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.limits("start"))).toBe(true);
  });

  it.each([
    {},
    { ...validEnvironment, VIBERACING_WEB_PAIRING_START_BUCKET_LIMIT: "0" },
    { ...validEnvironment, VIBERACING_WEB_PAIRING_START_BUCKET_LIMIT: "121" },
    { ...validEnvironment, VIBERACING_WEB_PAIRING_START_GLOBAL_LIMIT: "01" },
    { ...validEnvironment, VIBERACING_WEB_PAIRING_POLL_WINDOW_SECONDS: "3601" },
  ])("rejects incomplete or out-of-range deployment policy: %o", (environment) => {
    expect(() => resolvePairingRatePolicy(environment)).toThrow(
      PairingRatePolicyConfigurationError,
    );
  });

  it("derives a fixed digest from one canonical anonymous client id", () => {
    const clientId = Buffer.alloc(pairingClientIdBytes, 0x7a).toString("base64url");
    const first = derivePairingClientIdentity(clientId);
    const second = derivePairingClientIdentity(clientId);

    expect(first.accepted).toBe(true);
    expect(first.digest).toHaveLength(32);
    expect(first.digest).toEqual(second.digest);
    expect(first.digest).not.toEqual(Buffer.alloc(32));
    expect(Object.isFrozen(first)).toBe(true);

    first.digest.fill(0);
    second.digest.fill(0);
  });

  it.each([undefined, null, "", "A".repeat(21), "!".repeat(22)])(
    "uses one fixed dummy digest for malformed input: %o",
    (value) => {
      const actual = derivePairingClientIdentity(value);
      const expected = derivePairingClientIdentity(undefined);

      expect(actual.accepted).toBe(false);
      expect(actual.digest).toEqual(expected.digest);

      actual.digest.fill(0);
      expected.digest.fill(0);
    },
  );

  it("contains an unreadable environment without reflecting it", () => {
    const environment = new Proxy(validEnvironment, {
      get() {
        throw new Error("private deployment value");
      },
    });

    expect(() => resolvePairingRatePolicy(environment)).toThrow(
      expect.objectContaining({
        code: "environment_unreadable",
        message: "Pairing rate policy configuration is invalid.",
      }),
    );
  });
});

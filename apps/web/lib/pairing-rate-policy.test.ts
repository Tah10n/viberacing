// @vitest-environment node

import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import {
  derivePairingPollRateIdentity,
  derivePairingStartRateIdentity,
  pairingPollTokenBytes,
  pairingStartRateIdentifierBytes,
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

describe("batch pairing rate policy", () => {
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
    expect(pairingStartRateIdentifierBytes).toBe(16);
    expect(pairingPollTokenBytes).toBe(32);
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

  it("domain-separates fixed digests for canonical start and poll identities", () => {
    const shared = Buffer.alloc(pairingPollTokenBytes, 0x7a);
    const start = derivePairingStartRateIdentity(
      shared.subarray(0, pairingStartRateIdentifierBytes).toString("base64url"),
    );
    const poll = derivePairingPollRateIdentity(shared.toString("base64url"));
    const repeated = derivePairingPollRateIdentity(shared.toString("base64url"));

    expect(start.accepted).toBe(true);
    expect(poll.accepted).toBe(true);
    expect(start.digest).toHaveLength(32);
    expect(poll.digest).toEqual(repeated.digest);
    expect(start.digest).not.toEqual(poll.digest);

    shared.fill(0);
    start.digest.fill(0);
    poll.digest.fill(0);
    repeated.digest.fill(0);
  });

  it.each([
    [derivePairingStartRateIdentity, undefined],
    [derivePairingStartRateIdentity, "A".repeat(21)],
    [derivePairingStartRateIdentity, "!".repeat(22)],
    [derivePairingPollRateIdentity, null],
    [derivePairingPollRateIdentity, "A".repeat(42)],
    [derivePairingPollRateIdentity, "!".repeat(43)],
  ] as const)("uses an operation-local dummy digest for malformed input", (derive, value) => {
    const actual = derive(value);
    const expected = derive(undefined);

    expect(actual.accepted).toBe(false);
    expect(actual.digest).toEqual(expected.digest);

    actual.digest.fill(0);
    expected.digest.fill(0);
  });

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

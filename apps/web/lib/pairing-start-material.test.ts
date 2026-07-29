import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import { createPairingStartMaterial, pairingStartLifetimeMs } from "./pairing-start-material";

describe("pairing start material", () => {
  it("derives exact bounded one-time values from one entropy buffer", () => {
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    const material = createPairingStartMaterial(now, (length) => Buffer.alloc(length, 7));

    expect(material.pairingId).toMatch(/^pair_[A-Za-z0-9_-]{22}$/);
    expect(material.pollToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(material.pairingChallengeBase64Url).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(material.userCode).toMatch(/^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}$/);
    expect(material.expiresAt).toBe(new Date(now + pairingStartLifetimeMs).toISOString());
    material.clear();
    expect(material.pairingChallenge.every((byte) => byte === 0)).toBe(true);
  });

  it("fails closed for invalid clocks, entropy length, and all-zero entropy", () => {
    expect(() => createPairingStartMaterial(-1)).toThrow("pairing material unavailable");
    expect(() => createPairingStartMaterial(0, () => Buffer.alloc(1, 1))).toThrow(
      "pairing material unavailable",
    );
    expect(() => createPairingStartMaterial(0, (length) => Buffer.alloc(length))).toThrow(
      "pairing material unavailable",
    );
  });
});

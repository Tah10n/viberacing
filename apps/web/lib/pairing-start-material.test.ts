import { Buffer } from "node:buffer";
import crypto from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPairingStartMaterial,
  pairingStartLifetimeMs,
  PairingStartMaterialError,
} from "./pairing-start-material";
import { pairingUserCodePattern } from "./pairing-user-code-verifier";

interface RandomBytesSpy {
  mockImplementation(implementation: (size: number) => Uint8Array): void;
}

describe("pairing start material", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("generates bounded independent identifiers, secrets, code, challenge, and expiry", () => {
    const before = Date.now();
    const first = createPairingStartMaterial();
    const second = createPairingStartMaterial();
    const after = Date.now();

    expect(first.pairingId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(first.deviceKeyId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(first.deviceKeyId).not.toBe(first.pairingId);
    expect(Buffer.from(first.pollToken, "base64url")).toHaveLength(32);
    expect(first.pollToken).toHaveLength(43);
    expect(Buffer.from(first.pairingChallengeBase64Url, "base64url")).toEqual(
      first.pairingChallenge,
    );
    expect(first.pairingChallenge).toHaveLength(32);
    expect(pairingUserCodePattern.test(first.userCode)).toBe(true);
    expect(Date.parse(first.expiresAt)).toBeGreaterThanOrEqual(before + pairingStartLifetimeMs);
    expect(Date.parse(first.expiresAt)).toBeLessThanOrEqual(after + pairingStartLifetimeMs);
    expect(second.pollToken).not.toBe(first.pollToken);
    expect(second.pairingChallengeBase64Url).not.toBe(first.pairingChallengeBase64Url);
    expect(second.userCode).not.toBe(first.userCode);
    expect(Object.isFrozen(first)).toBe(true);

    first.clear();
    first.clear();
    second.clear();
    expect(first.pairingChallenge).toEqual(Buffer.alloc(32));
  });

  it("maps unavailable or malformed entropy and clock state non-reflectively", () => {
    const privateValue = "private-entropy-failure-that-must-not-be-reflected";
    const randomBytes = vi.spyOn(crypto, "randomBytes") as unknown as RandomBytesSpy;
    randomBytes.mockImplementation(() => {
      throw new Error(privateValue);
    });
    expect(() => createPairingStartMaterial()).toThrow(
      expect.objectContaining({
        code: "entropy_unavailable",
        message: "Pairing start material is unavailable.",
      }),
    );

    vi.restoreAllMocks();
    const malformedRandomBytes = vi.spyOn(crypto, "randomBytes") as unknown as RandomBytesSpy;
    malformedRandomBytes.mockImplementation(() => Buffer.alloc(1));
    expect(() => createPairingStartMaterial()).toThrow(
      expect.objectContaining({ code: "entropy_unavailable" }),
    );

    vi.restoreAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(Number.NaN);
    try {
      createPairingStartMaterial();
    } catch (error) {
      expect(error).toBeInstanceOf(PairingStartMaterialError);
      expect(error).toMatchObject({ code: "clock_unavailable" });
      expect(String(error)).not.toContain(privateValue);
      return;
    }
    throw new Error("expected pairing start material clock failure");
  });

  it("maps an out-of-range clock to the clock failure code", () => {
    vi.spyOn(Date, "now").mockReturnValue(Number.MAX_SAFE_INTEGER);

    expect(() => createPairingStartMaterial()).toThrow(
      expect.objectContaining({ code: "clock_unavailable" }),
    );
  });
});

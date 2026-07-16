import { Buffer } from "node:buffer";
import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createConfiguredPairingPollVerifier,
  pairingPollTokenBytes,
  pairingPollVerifierDigestBytes,
  pairingPollVerifierPrefix,
  PairingPollVerifierConfigurationError,
  type PairingPollVerifierConfigurationErrorCode,
} from "./pairing-poll-verifier";

const primaryKey = Buffer.alloc(32, 0x11);
const secondaryKey = Buffer.alloc(32, 0x22);
const pollTokenBytes = Buffer.alloc(pairingPollTokenBytes, 0x33);
const pollToken = pollTokenBytes.toString("base64url");
const primaryEnvironment = {
  VIBERACING_WEB_PAIRING_POLL_PRIMARY_KEY_BASE64URL: primaryKey.toString("base64url"),
} as const;

function expectedDigest(key: Uint8Array, prefix: string, token: Uint8Array): Buffer {
  return createHmac("sha256", key).update(prefix).update("\n").update(token).digest();
}

function expectConfigurationError(
  environment: Readonly<Record<string, unknown>>,
  code: PairingPollVerifierConfigurationErrorCode,
): void {
  const privateValue = "private-pairing-key-that-must-not-be-reflected";
  try {
    createConfiguredPairingPollVerifier(environment);
  } catch (error) {
    expect(error).toBeInstanceOf(PairingPollVerifierConfigurationError);
    expect(error).toMatchObject({
      code,
      message: "Pairing poll verifier configuration is invalid.",
      name: "PairingPollVerifierConfigurationError",
    });
    expect(String(error)).not.toContain(privateValue);
    return;
  }
  throw new Error("expected pairing poll verifier configuration to fail");
}

describe("pairing poll verifier", () => {
  it("derives the exact domain-separated primary HMAC and a fixed inactive candidate", () => {
    const verifier = createConfiguredPairingPollVerifier(primaryEnvironment);
    const candidates = verifier.derive(pollToken);

    expect(candidates.tokenAccepted).toBe(true);
    expect(candidates.secondaryActive).toBe(false);
    expect(candidates.digests[0]).toEqual(
      expectedDigest(primaryKey, pairingPollVerifierPrefix, pollTokenBytes),
    );
    expect(candidates.digests[1]).toEqual(
      expectedDigest(primaryKey, "viberacing-pairing-poll-verifier-dummy-v1", pollTokenBytes),
    );
    expect(candidates.digests[0]).toHaveLength(pairingPollVerifierDigestBytes);
    expect(candidates.digests[1]).not.toEqual(candidates.digests[0]);
    expect(Object.isFrozen(candidates)).toBe(true);
    expect(Object.isFrozen(candidates.digests)).toBe(true);

    candidates.clear();
    candidates.clear();
    expect(candidates.digests[0]).toEqual(Buffer.alloc(pairingPollVerifierDigestBytes));
    expect(candidates.digests[1]).toEqual(Buffer.alloc(pairingPollVerifierDigestBytes));
    verifier.close();
  });

  it("accepts a distinct secondary key for bounded rotation and derives both candidates", () => {
    const verifier = createConfiguredPairingPollVerifier({
      ...primaryEnvironment,
      VIBERACING_WEB_PAIRING_POLL_SECONDARY_KEY_BASE64URL: secondaryKey.toString("base64url"),
    });
    const candidates = verifier.derive(pollToken);

    expect(candidates.secondaryActive).toBe(true);
    expect(candidates.digests[0]).toEqual(
      expectedDigest(primaryKey, pairingPollVerifierPrefix, pollTokenBytes),
    );
    expect(candidates.digests[1]).toEqual(
      expectedDigest(secondaryKey, pairingPollVerifierPrefix, pollTokenBytes),
    );

    candidates.clear();
    verifier.close();
  });

  it.each([undefined, null, 32, "", "A".repeat(42), `${pollToken}=`, `${pollToken.slice(0, -1)}+`])(
    "uses fixed dummy-token work but never accepts malformed input: %o",
    (value) => {
      const verifier = createConfiguredPairingPollVerifier(primaryEnvironment);
      const candidates = verifier.derive(value);

      expect(candidates.tokenAccepted).toBe(false);
      expect(candidates.digests[0]).toEqual(
        expectedDigest(primaryKey, pairingPollVerifierPrefix, Buffer.alloc(pairingPollTokenBytes)),
      );
      expect(candidates.digests).toHaveLength(2);

      candidates.clear();
      verifier.close();
    },
  );

  it.each([
    {
      code: "primary_key_invalid" as const,
      environment: {},
    },
    {
      code: "primary_key_invalid" as const,
      environment: {
        VIBERACING_WEB_PAIRING_POLL_PRIMARY_KEY_BASE64URL: "not-canonical",
      },
    },
    {
      code: "primary_key_invalid" as const,
      environment: {
        VIBERACING_WEB_PAIRING_POLL_PRIMARY_KEY_BASE64URL: `${primaryKey.toString("base64url")}=`,
      },
    },
    {
      code: "secondary_key_invalid" as const,
      environment: {
        ...primaryEnvironment,
        VIBERACING_WEB_PAIRING_POLL_SECONDARY_KEY_BASE64URL: "not-canonical",
      },
    },
    {
      code: "duplicate_key_material" as const,
      environment: {
        ...primaryEnvironment,
        VIBERACING_WEB_PAIRING_POLL_SECONDARY_KEY_BASE64URL: primaryKey.toString("base64url"),
      },
    },
  ])("rejects unsafe key configuration: $code", ({ code, environment }) => {
    expectConfigurationError(environment, code);
  });

  it("converts unreadable environment access without reflecting the thrown value", () => {
    const privateValue = "private-pairing-key-that-must-not-be-reflected";
    const environment = new Proxy<Readonly<Record<string, unknown>>>(
      {},
      {
        get() {
          throw new Error(privateValue);
        },
      },
    );

    expectConfigurationError(environment, "environment_unreadable");
  });

  it("closes the retained key capability idempotently and rejects later derivation", () => {
    const verifier = createConfiguredPairingPollVerifier(primaryEnvironment);

    verifier.close();
    verifier.close();

    expect(() => verifier.derive(pollToken)).toThrow(expect.objectContaining({ code: "closed" }));
  });
});

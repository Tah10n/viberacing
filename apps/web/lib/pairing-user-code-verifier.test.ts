import { Buffer } from "node:buffer";
import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createConfiguredPairingUserCodeVerifier,
  pairingUserCodePattern,
  pairingUserCodeVerifierDigestBytes,
  pairingUserCodeVerifierPrefix,
  PairingUserCodeVerifierConfigurationError,
  type PairingUserCodeVerifierConfigurationErrorCode,
} from "./pairing-user-code-verifier";

const pollPrimaryKey = Buffer.alloc(32, 0x11);
const pollSecondaryKey = Buffer.alloc(32, 0x22);
const codePrimaryKey = Buffer.alloc(32, 0x33);
const codeSecondaryKey = Buffer.alloc(32, 0x44);
const userCode = "2345-6789-ABCD";
const baseEnvironment = {
  VIBERACING_WEB_PAIRING_CODE_PRIMARY_KEY_BASE64URL: codePrimaryKey.toString("base64url"),
  VIBERACING_WEB_PAIRING_POLL_PRIMARY_KEY_BASE64URL: pollPrimaryKey.toString("base64url"),
} as const;

function expectedDigest(key: Uint8Array, prefix: string, code: string): Buffer {
  return createHmac("sha256", key).update(prefix).update("\n").update(code, "ascii").digest();
}

function expectConfigurationError(
  environment: Readonly<Record<string, unknown>>,
  code: PairingUserCodeVerifierConfigurationErrorCode,
): void {
  const privateValue = "private-user-code-key-that-must-not-be-reflected";
  try {
    createConfiguredPairingUserCodeVerifier(environment);
  } catch (error) {
    expect(error).toBeInstanceOf(PairingUserCodeVerifierConfigurationError);
    expect(error).toMatchObject({
      code,
      message: "Pairing user-code verifier configuration is invalid.",
      name: "PairingUserCodeVerifierConfigurationError",
    });
    expect(String(error)).not.toContain(privateValue);
    return;
  }
  throw new Error("expected pairing user-code verifier configuration to fail");
}

describe("pairing user-code verifier", () => {
  it("derives the exact domain-separated primary HMAC and fixed inactive candidate", () => {
    const verifier = createConfiguredPairingUserCodeVerifier(baseEnvironment);
    const candidates = verifier.derive(userCode);

    expect(pairingUserCodePattern.test(userCode)).toBe(true);
    expect(candidates.codeAccepted).toBe(true);
    expect(candidates.secondaryActive).toBe(false);
    expect(candidates.digests[0]).toEqual(
      expectedDigest(codePrimaryKey, pairingUserCodeVerifierPrefix, userCode),
    );
    expect(candidates.digests[1]).toEqual(
      expectedDigest(codePrimaryKey, "viberacing-pairing-user-code-verifier-inactive-v1", userCode),
    );
    expect(candidates.digests[0]).toHaveLength(pairingUserCodeVerifierDigestBytes);
    expect(candidates.digests[1]).not.toEqual(candidates.digests[0]);
    expect(Object.isFrozen(candidates)).toBe(true);
    expect(Object.isFrozen(candidates.digests)).toBe(true);

    candidates.clear();
    candidates.clear();
    expect(candidates.digests).toEqual([Buffer.alloc(32), Buffer.alloc(32)]);
    verifier.close();
  });

  it("accepts a distinct secondary key for bounded code rotation", () => {
    const verifier = createConfiguredPairingUserCodeVerifier({
      ...baseEnvironment,
      VIBERACING_WEB_PAIRING_CODE_SECONDARY_KEY_BASE64URL: codeSecondaryKey.toString("base64url"),
      VIBERACING_WEB_PAIRING_POLL_SECONDARY_KEY_BASE64URL: pollSecondaryKey.toString("base64url"),
    });
    const candidates = verifier.derive(userCode);

    expect(candidates.secondaryActive).toBe(true);
    expect(candidates.digests).toEqual([
      expectedDigest(codePrimaryKey, pairingUserCodeVerifierPrefix, userCode),
      expectedDigest(codeSecondaryKey, pairingUserCodeVerifierPrefix, userCode),
    ]);

    candidates.clear();
    verifier.close();
  });

  it.each([
    undefined,
    null,
    1234,
    "",
    "A".repeat(10_000),
    "0123-4567-89AB",
    "2345-6789-ABCI",
    "0123456789AB",
    "0123-4567-89ab",
  ])("uses fixed invalid-code work but never accepts malformed input: %o", (value) => {
    const verifier = createConfiguredPairingUserCodeVerifier(baseEnvironment);
    const candidates = verifier.derive(value);

    expect(candidates.codeAccepted).toBe(false);
    expect(candidates.digests[0]).toEqual(
      expectedDigest(
        codePrimaryKey,
        "viberacing-pairing-user-code-verifier-invalid-v1",
        "0000-0000-0000",
      ),
    );

    candidates.clear();
    verifier.close();
  });

  it.each([
    { code: "primary_key_invalid" as const, environment: {} },
    {
      code: "secondary_key_invalid" as const,
      environment: {
        ...baseEnvironment,
        VIBERACING_WEB_PAIRING_CODE_SECONDARY_KEY_BASE64URL: "not-canonical",
      },
    },
    {
      code: "duplicate_key_material" as const,
      environment: {
        ...baseEnvironment,
        VIBERACING_WEB_PAIRING_CODE_SECONDARY_KEY_BASE64URL: codePrimaryKey.toString("base64url"),
      },
    },
    {
      code: "cross_purpose_key_material" as const,
      environment: {
        ...baseEnvironment,
        VIBERACING_WEB_PAIRING_CODE_PRIMARY_KEY_BASE64URL: pollPrimaryKey.toString("base64url"),
      },
    },
    {
      code: "cross_purpose_key_material" as const,
      environment: {
        ...baseEnvironment,
        VIBERACING_WEB_PAIRING_CODE_SECONDARY_KEY_BASE64URL: pollPrimaryKey.toString("base64url"),
      },
    },
  ])("rejects unsafe code-key configuration: $code", ({ code, environment }) => {
    expectConfigurationError(environment, code);
  });

  it("contains unreadable environment access and closes idempotently", () => {
    const privateValue = "private-user-code-key-that-must-not-be-reflected";
    const environment = new Proxy<Readonly<Record<string, unknown>>>(
      {},
      {
        get() {
          throw new Error(privateValue);
        },
      },
    );
    expectConfigurationError(environment, "environment_unreadable");

    const verifier = createConfiguredPairingUserCodeVerifier(baseEnvironment);
    verifier.close();
    verifier.close();
    expect(() => verifier.derive(userCode)).toThrow(expect.objectContaining({ code: "closed" }));
  });
});

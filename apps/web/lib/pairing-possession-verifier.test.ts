// @vitest-environment node

import { Buffer } from "node:buffer";

import { verifyAsync as verifyEd25519Strict } from "@noble/ed25519";
import pairingPolicy from "../../../contracts/v1/connector-pairing-authentication.json";
import pairingVector from "../../../contracts/v1/connector-pairing-possession.test-vector.json";
import syncVector from "../../../contracts/v1/connector-usage-sync-device-request.test-vector.json";
import { describe, expect, it, vi } from "vitest";

import {
  pairingChallengeBytes,
  pairingIdPattern,
  pairingPossessionMessagePrefix,
  pairingPublicKeyBytes,
  pairingSignatureBytes,
  verifyPairingPossession,
} from "./pairing-possession-verifier";

function vectorMaterial(): {
  pairingChallenge: Uint8Array;
  pairingId: string;
  publicKey: Uint8Array;
} {
  return {
    pairingChallenge: Uint8Array.from(pairingVector.pairingChallengeBytes),
    pairingId: pairingVector.pairingId,
    publicKey: Buffer.from(pairingVector.devicePublicKeyBase64Url, "base64url"),
  };
}

describe("pairing possession verifier", () => {
  it("strictly verifies the exact cross-language vector", async () => {
    const material = vectorMaterial();
    expect(Object.getPrototypeOf(material)).toBe(Object.prototype);
    expect(Reflect.ownKeys(material).sort()).toEqual([
      "pairingChallenge",
      "pairingId",
      "publicKey",
    ]);
    expect(Object.getPrototypeOf(material.pairingChallenge)).toBe(Uint8Array.prototype);
    expect(Object.getPrototypeOf(material.publicKey)).toBe(Buffer.prototype);
    expect(
      await verifyEd25519Strict(
        Buffer.from(pairingVector.possessionSignatureBase64Url, "base64url"),
        Buffer.from(pairingVector.possessionMessage, "utf8"),
        material.publicKey,
        { zip215: false },
      ),
    ).toBe(true);
    expect(
      await verifyPairingPossession(material, pairingVector.possessionSignatureBase64Url),
    ).toBe(true);
    expect(pairingVector.devicePublicKeyBase64Url).toBe(syncVector.devicePublicKeyBase64Url);
    expect(pairingVector.possessionMessage.endsWith("\n")).toBe(false);
  });

  it("binds the transaction, challenge, public key, and signature", async () => {
    const changedId = vectorMaterial();
    changedId.pairingId = "00000000-0000-4000-8000-000000001002";
    const changedChallenge = vectorMaterial();
    changedChallenge.pairingChallenge[31] = changedChallenge.pairingChallenge[31]! ^ 1;
    const changedKey = vectorMaterial();
    changedKey.publicKey[0] = changedKey.publicKey[0]! ^ 1;
    const changedSignature = `${pairingVector.possessionSignatureBase64Url.slice(0, -1)}A`;

    for (const [material, signature] of [
      [changedId, pairingVector.possessionSignatureBase64Url],
      [changedChallenge, pairingVector.possessionSignatureBase64Url],
      [changedKey, pairingVector.possessionSignatureBase64Url],
      [vectorMaterial(), changedSignature],
    ] as const) {
      expect(await verifyPairingPossession(material, signature)).toBe(false);
    }
  });

  it("rejects invalid point and all-zero signature material", async () => {
    const zeroKey = vectorMaterial();
    zeroKey.publicKey.fill(0);
    const zeroSignature = Buffer.alloc(pairingSignatureBytes).toString("base64url");

    expect(await verifyPairingPossession(zeroKey, zeroSignature)).toBe(false);
  });

  it("rejects malformed identifiers, byte views, encodings, and object shapes", async () => {
    const validSignature = pairingVector.possessionSignatureBase64Url;
    const inherited = Object.create({ pairingId: pairingVector.pairingId }) as Record<
      string,
      unknown
    >;
    inherited.pairingChallenge = Uint8Array.from(pairingVector.pairingChallengeBytes);
    inherited.publicKey = Buffer.from(pairingVector.devicePublicKeyBase64Url, "base64url");
    const accessor = {
      get pairingChallenge(): never {
        throw new Error("must not execute");
      },
      pairingId: pairingVector.pairingId,
      publicKey: Buffer.from(pairingVector.devicePublicKeyBase64Url, "base64url"),
    };
    class DerivedBytes extends Uint8Array {}

    const invalidMaterials: unknown[] = [
      null,
      [],
      inherited,
      accessor,
      new Proxy(vectorMaterial(), {
        ownKeys(): never {
          throw new Error("must not escape");
        },
      }),
      { ...vectorMaterial(), extra: true },
      { ...vectorMaterial(), [Symbol("extra")]: true },
      { ...vectorMaterial(), pairingId: "00000000-0000-4000-8000-00000000100A" },
      { ...vectorMaterial(), pairingId: "00000000-0000-3000-8000-000000001001" },
      { ...vectorMaterial(), pairingId: "00000000-0000-4000-7000-000000001001" },
      { ...vectorMaterial(), pairingChallenge: new Uint8Array(pairingChallengeBytes - 1) },
      { ...vectorMaterial(), pairingChallenge: new DerivedBytes(pairingChallengeBytes) },
      { ...vectorMaterial(), publicKey: new Uint8Array(pairingPublicKeyBytes - 1) },
      { ...vectorMaterial(), publicKey: new DerivedBytes(pairingPublicKeyBytes) },
    ];
    for (const material of invalidMaterials) {
      expect(await verifyPairingPossession(material, validSignature)).toBe(false);
    }

    for (const signature of [
      null,
      "",
      `${validSignature}=`,
      validSignature.replace("_", "+"),
      `${validSignature.slice(0, -1)}h`,
      validSignature.slice(0, -1),
      `${validSignature}A`,
    ]) {
      expect(await verifyPairingPossession(vectorMaterial(), signature)).toBe(false);
    }
  });

  it("copies caller-owned bytes before asynchronous verification", async () => {
    const material = vectorMaterial();
    const verification = verifyPairingPossession(
      material,
      pairingVector.possessionSignatureBase64Url,
    );
    material.pairingChallenge.fill(0xff);
    material.publicKey.fill(0xff);

    expect(await verification).toBe(true);
  });

  it("zeroes a decoded signature when material is rejected before verification", async () => {
    const fill = vi.spyOn(Buffer.prototype, "fill");
    try {
      expect(await verifyPairingPossession(null, pairingVector.possessionSignatureBase64Url)).toBe(
        false,
      );
      expect(
        fill.mock.instances.some(
          (instance) =>
            Buffer.isBuffer(instance) &&
            instance.byteLength === pairingSignatureBytes &&
            instance.every((byte) => byte === 0),
        ),
      ).toBe(true);
    } finally {
      fill.mockRestore();
    }
  });

  it("matches the versioned policy constants", () => {
    expect(pairingPolicy.schemaVersion).toBe(1);
    expect(pairingPolicy.protocolId).toBe(pairingVector.protocolId);
    expect(pairingPolicy.algorithm).toBe("Ed25519");
    expect(pairingPolicy.publicKeyBytes).toBe(pairingPublicKeyBytes);
    expect(pairingPolicy.challengeBytes).toBe(pairingChallengeBytes);
    expect(pairingPolicy.signatureBytes).toBe(pairingSignatureBytes);
    expect(pairingPolicy.messagePrefix).toBe(pairingPossessionMessagePrefix);
    expect(pairingPolicy.pairingIdPattern).toBe(
      "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    );
    expect(pairingIdPattern.test(pairingVector.pairingId)).toBe(true);
    expect(pairingPolicy.canonicalFields).toEqual([
      "messagePrefix",
      "pairingId",
      "pairingChallengeBase64Url",
      "devicePublicKeyBase64Url",
    ]);
    expect(pairingPolicy.activationPreconditions).toEqual([
      "exact-poll-verifier-match",
      "browser-approved-transaction",
      "unexpired-pending-device-key",
      "strict-possession-signature",
    ]);
  });
});

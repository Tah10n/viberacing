// @vitest-environment node

import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";
import type { ConnectorPairingStartV1 } from "@viberacing/contracts";

import pairingPolicy from "../../../contracts/v1/connector-pairing-authentication.json";
import pollVector from "../../../contracts/v1/connector-pairing-possession.test-vector.json";
import startVector from "../../../contracts/v1/connector-pairing-start-possession.test-vector.json";
import {
  pairingChallengeBytes,
  pairingPollPossessionMessagePrefix,
  pairingPublicKeyBytes,
  pairingSignatureBytes,
  pairingStartMaximumAgeMilliseconds,
  pairingStartMaximumFutureSkewMilliseconds,
  pairingStartNonceBytes,
  pairingStartPossessionMessagePrefix,
  verifyPairingPollPossession,
  verifyPairingStartPossession,
} from "./pairing-possession-verifier";

const signedAt = Date.parse(startVector.signedAt);

function startRequest(): ConnectorPairingStartV1 {
  return {
    schemaVersion: 1 as const,
    discoveryManifest: startVector.manifest as ConnectorPairingStartV1["discoveryManifest"],
    installationPossessionProof: {
      nonce: startVector.nonce,
      signature: startVector.possessionSignature,
      signedAt: startVector.signedAt,
    },
    clientRateIdentifier: startVector.clientRateIdentifier,
  };
}

function pollMaterial() {
  return {
    installationPublicKey: Buffer.from(pollVector.installationPublicKey, "base64url"),
    pairingChallenge: Buffer.from(pollVector.pairingChallenge, "base64url"),
    pairingId: pollVector.pairingId,
  };
}

describe("pairing possession verifier", () => {
  it("verifies and returns only copied digest material for the shared start vector", async () => {
    const verified = await verifyPairingStartPossession(startRequest(), signedAt);

    expect(verified?.manifestDigestHex).toBe(startVector.manifestDigest);
    expect(verified?.installationPublicKey.toString("base64url")).toBe(
      startVector.manifest.installationPublicKey,
    );
    expect(verified?.startProofDigest).toHaveLength(32);
    verified?.clear();
    expect(verified?.installationPublicKey.every((byte) => byte === 0)).toBe(true);
    expect(verified?.manifestDigest.every((byte) => byte === 0)).toBe(true);
    expect(verified?.startProofDigest.every((byte) => byte === 0)).toBe(true);
  });

  it("rejects manifest mutation, property reordering, signature mutation, and stale time", async () => {
    const request = startRequest();
    const mutatedManifest = {
      ...request,
      discoveryManifest: {
        ...request.discoveryManifest,
        candidates: [
          {
            ...request.discoveryManifest.candidates[0],
            safeDisplayLabel: "mutated",
          },
        ],
      },
    } as ConnectorPairingStartV1;
    const reordered = {
      ...request,
      discoveryManifest: {
        candidates: request.discoveryManifest.candidates,
        architecture: request.discoveryManifest.architecture,
        osFamily: request.discoveryManifest.osFamily,
        connectorVersion: request.discoveryManifest.connectorVersion,
        installationPublicKey: request.discoveryManifest.installationPublicKey,
        schemaVersion: request.discoveryManifest.schemaVersion,
      },
    } as ConnectorPairingStartV1;
    const mutatedSignature = {
      ...request,
      installationPossessionProof: {
        ...request.installationPossessionProof,
        signature: `A${request.installationPossessionProof.signature.slice(1)}`,
      },
    } as ConnectorPairingStartV1;

    await expect(verifyPairingStartPossession(mutatedManifest, signedAt)).resolves.toBeUndefined();
    await expect(verifyPairingStartPossession(reordered, signedAt)).resolves.toBeUndefined();
    await expect(verifyPairingStartPossession(mutatedSignature, signedAt)).resolves.toBeUndefined();
    await expect(
      verifyPairingStartPossession(request, signedAt + pairingStartMaximumAgeMilliseconds + 1),
    ).resolves.toBeUndefined();
    await expect(
      verifyPairingStartPossession(
        request,
        signedAt - pairingStartMaximumFutureSkewMilliseconds - 1,
      ),
    ).resolves.toBeUndefined();
  });

  it("strictly verifies the shared poll vector and binds every field", async () => {
    await expect(
      verifyPairingPollPossession(pollMaterial(), pollVector.possessionSignature),
    ).resolves.toBe(true);

    const material = pollMaterial();
    material.pairingChallenge[0] = (material.pairingChallenge[0] ?? 0) ^ 1;
    await expect(
      verifyPairingPollPossession(material, pollVector.possessionSignature),
    ).resolves.toBe(false);
    await expect(
      verifyPairingPollPossession(pollMaterial(), `A${pollVector.possessionSignature.slice(1)}`),
    ).resolves.toBe(false);
  });

  it("matches the versioned authentication policy", () => {
    expect(pairingPolicy.publicKeyBytes).toBe(pairingPublicKeyBytes);
    expect(pairingPolicy.challengeBytes).toBe(pairingChallengeBytes);
    expect(pairingPolicy.signatureBytes).toBe(pairingSignatureBytes);
    expect(pairingPolicy.nonceBytes).toBe(pairingStartNonceBytes);
    expect(pairingPolicy.startProof.messagePrefix).toBe(pairingStartPossessionMessagePrefix);
    expect(pairingPolicy.startProof.maximumAgeMilliseconds).toBe(
      pairingStartMaximumAgeMilliseconds,
    );
    expect(pairingPolicy.startProof.maximumFutureSkewMilliseconds).toBe(
      pairingStartMaximumFutureSkewMilliseconds,
    );
    expect(pairingPolicy.pollProof.messagePrefix).toBe(pairingPollPossessionMessagePrefix);
  });
});

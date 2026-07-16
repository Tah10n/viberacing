import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";

import {
  createInitialPasskeyOptions,
  passkeyChallengeDigest,
  passkeyContextDigest,
  verifyInitialPasskey,
} from "./passkey-registration";

describe("initial passkey registration", () => {
  it("creates a discoverable user-verified option set without attestation", async () => {
    const options = await createInitialPasskeyOptions(
      "00000000-0000-4000-8000-000000000201",
      "pixel_driver",
      "race.example.com",
    );
    expect(options).toMatchObject({
      attestation: "none",
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      rp: { id: "race.example.com", name: "Vibe Racing" },
      timeout: 300_000,
      user: { displayName: "pixel_driver", name: "pixel_driver" },
    });
    expect(options.pubKeyCredParams.map(({ alg }) => alg)).toEqual([-7, -257]);
    expect(options.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(options.user.id).toBe(
      Buffer.from("00000000000040008000000000000201", "hex").toString("base64url"),
    );
  });

  it("binds the challenge and exact profile/RP context", () => {
    expect(passkeyChallengeDigest(Buffer.alloc(32, 1).toString("base64url"))).toHaveLength(32);
    expect(
      passkeyContextDigest(
        "00000000-0000-4000-8000-000000000201",
        "pixel_driver",
        "race.example.com",
        "https://race.example.com",
      ).toString("hex"),
    ).not.toBe(
      passkeyContextDigest(
        "00000000-0000-4000-8000-000000000201",
        "other_driver",
        "race.example.com",
        "https://race.example.com",
      ).toString("hex"),
    );
  });

  it("returns only bounded credential material from a verified response", async () => {
    const credentialId = Buffer.alloc(32, 0x31);
    const publicKey = Buffer.alloc(77, 0x41);
    const verifier = vi.fn(() =>
      Promise.resolve({
        registrationInfo: {
          aaguid: "00000000-0000-0000-0000-000000000000",
          attestationObject: new Uint8Array(),
          credential: {
            counter: 7,
            id: credentialId.toString("base64url"),
            publicKey,
          },
          credentialBackedUp: true,
          credentialDeviceType: "multiDevice" as const,
          credentialType: "public-key" as const,
          fmt: "none" as const,
          origin: "https://race.example.com",
          rpID: "race.example.com",
          userVerified: true,
        },
        verified: true as const,
      }),
    );
    const material = await verifyInitialPasskey(
      {},
      Buffer.alloc(32, 1).toString("base64url"),
      "https://race.example.com",
      "race.example.com",
      verifier,
    );
    expect(material).toMatchObject({ backupEligible: true, backupState: true, signCount: 7 });
    expect(material?.credentialId).toEqual(credentialId);
    expect(material?.cosePublicKey).toEqual(publicKey);
    expect(verifier).toHaveBeenCalledWith({
      expectedChallenge: Buffer.alloc(32, 1).toString("base64url"),
      expectedOrigin: "https://race.example.com",
      expectedRPID: "race.example.com",
      expectedType: "webauthn.create",
      requireUserPresence: true,
      requireUserVerification: true,
      response: {},
      supportedAlgorithmIDs: [-7, -257],
    });
  });

  it("fails closed for verifier errors and invalid returned material", async () => {
    await expect(
      verifyInitialPasskey({}, "bad", "https://race.example.com", "race.example.com", () =>
        Promise.reject(new Error("private")),
      ),
    ).resolves.toBeUndefined();
    await expect(
      verifyInitialPasskey({}, "bad", "https://race.example.com", "race.example.com", () =>
        Promise.resolve({
          registrationInfo: {
            aaguid: "00000000-0000-0000-0000-000000000000",
            attestationObject: new Uint8Array(),
            credential: { counter: -1, id: "bad", publicKey: new Uint8Array() },
            credentialBackedUp: false,
            credentialDeviceType: "singleDevice",
            credentialType: "public-key",
            fmt: "none",
            origin: "https://race.example.com",
            userVerified: true,
          },
          verified: true,
        }),
      ),
    ).resolves.toBeUndefined();
  });
});

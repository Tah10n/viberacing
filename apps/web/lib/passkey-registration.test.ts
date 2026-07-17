import { Buffer } from "node:buffer";

import type { VerifyAuthenticationResponseOpts } from "@simplewebauthn/server";
import { describe, expect, it, vi } from "vitest";

import {
  createPasskeyRegistrationOptions,
  passkeyAddContextDigest,
  createPasskeyLoginOptions,
  passkeyChallengeDigest,
  passkeyContextDigest,
  passkeyLoginContextDigest,
  passkeyLoginCredentialId,
  passkeyRevokeContextDigest,
  profileDeletionContextDigest,
  recoveryCodeRotationContextDigest,
  sourceReactivationContextDigest,
  sourceUnlinkContextDigest,
  verifyInitialPasskey,
  verifyPasskeyLogin,
} from "./passkey-registration";

describe("initial passkey registration", () => {
  it("creates a discoverable user-verified option set without attestation", async () => {
    const options = await createPasskeyRegistrationOptions(
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

describe("passkey login", () => {
  const credentialId = Buffer.alloc(32, 0x51);
  const response = {
    clientExtensionResults: {},
    id: credentialId.toString("base64url"),
    rawId: credentialId.toString("base64url"),
    response: {
      authenticatorData: "synthetic",
      clientDataJSON: "synthetic",
      signature: "synthetic",
    },
    type: "public-key",
  };

  it("creates a profile-free user-verified discoverable challenge", async () => {
    const options = await createPasskeyLoginOptions("race.example.com");
    expect(options).toMatchObject({
      rpId: "race.example.com",
      timeout: 300_000,
      userVerification: "required",
    });
    expect(options.allowCredentials).toBeUndefined();
    expect(options.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(
      passkeyLoginContextDigest("race.example.com", "https://race.example.com").toString("hex"),
    ).not.toBe(
      passkeyLoginContextDigest("other.example.com", "https://race.example.com").toString("hex"),
    );
    expect(
      passkeyAddContextDigest(
        "00000000-0000-4000-8000-000000000101",
        "00000000-0000-4000-8000-000000000102",
        "pixel_driver",
        "Backup passkey",
        Buffer.alloc(32, 0x41).toString("base64url"),
        "race.example.com",
        "https://race.example.com",
      ),
    ).not.toEqual(
      passkeyAddContextDigest(
        "00000000-0000-4000-8000-000000000101",
        "00000000-0000-4000-8000-000000000102",
        "pixel_driver",
        "Backup passkey",
        Buffer.alloc(32, 0x42).toString("base64url"),
        "race.example.com",
        "https://race.example.com",
      ),
    );
    expect(
      passkeyAddContextDigest(
        "00000000-0000-4000-8000-000000000101",
        "00000000-0000-4000-8000-000000000102",
        "pixel_driver",
        "Backup passkey",
        Buffer.alloc(32, 0x41).toString("base64url"),
        "race.example.com",
        "https://race.example.com",
      ),
    ).not.toEqual(
      passkeyAddContextDigest(
        "00000000-0000-4000-8000-000000000101",
        "00000000-0000-4000-8000-000000000102",
        "pixel_driver",
        "Travel key",
        Buffer.alloc(32, 0x41).toString("base64url"),
        "race.example.com",
        "https://race.example.com",
      ),
    );
    expect(
      passkeyRevokeContextDigest(
        "00000000-0000-4000-8000-000000000101",
        "00000000-0000-4000-8000-000000000102",
        "race.example.com",
        "https://race.example.com",
      ),
    ).not.toEqual(
      passkeyRevokeContextDigest(
        "00000000-0000-4000-8000-000000000101",
        "00000000-0000-4000-8000-000000000103",
        "race.example.com",
        "https://race.example.com",
      ),
    );
    expect(
      profileDeletionContextDigest(
        "00000000-0000-4000-8000-000000000101",
        "00000000-0000-4000-8000-000000000102",
        "pixel_driver",
        "race.example.com",
        "https://race.example.com",
      ),
    ).not.toEqual(
      profileDeletionContextDigest(
        "00000000-0000-4000-8000-000000000101",
        "00000000-0000-4000-8000-000000000102",
        "other_driver",
        "race.example.com",
        "https://race.example.com",
      ),
    );
    expect(
      recoveryCodeRotationContextDigest(
        "00000000-0000-4000-8000-000000000101",
        "00000000-0000-4000-8000-000000000102",
        "race.example.com",
        "https://race.example.com",
      ),
    ).not.toEqual(
      recoveryCodeRotationContextDigest(
        "00000000-0000-4000-8000-000000000101",
        "00000000-0000-4000-8000-000000000103",
        "race.example.com",
        "https://race.example.com",
      ),
    );
    expect(
      sourceReactivationContextDigest(
        "00000000-0000-4000-8000-000000000101",
        `src_${"A".repeat(22)}`,
        "race.example.com",
        "https://race.example.com",
      ),
    ).not.toEqual(
      sourceReactivationContextDigest(
        "00000000-0000-4000-8000-000000000101",
        `src_${"B".repeat(22)}`,
        "race.example.com",
        "https://race.example.com",
      ),
    );
    expect(
      sourceUnlinkContextDigest(
        "00000000-0000-4000-8000-000000000101",
        `src_${"A".repeat(22)}`,
        "race.example.com",
        "https://race.example.com",
      ),
    ).not.toEqual(
      sourceReactivationContextDigest(
        "00000000-0000-4000-8000-000000000101",
        `src_${"A".repeat(22)}`,
        "race.example.com",
        "https://race.example.com",
      ),
    );
  });

  it("extracts only a canonical bounded credential ID", () => {
    expect(passkeyLoginCredentialId(response)).toEqual(credentialId);
    expect(passkeyLoginCredentialId({ ...response, rawId: "different" })).toBeUndefined();
    expect(passkeyLoginCredentialId({ ...response, id: "bad", rawId: "bad" })).toBeUndefined();
  });

  it("verifies the exact credential, RP, origin, type, and user verification", async () => {
    const publicKey = Buffer.alloc(77, 0x61);
    let verifiedPublicKey: Buffer | undefined;
    const verifier = vi.fn((input: VerifyAuthenticationResponseOpts) => {
      verifiedPublicKey = Buffer.from(input.credential.publicKey);
      return Promise.resolve({
        authenticationInfo: {
          credentialBackedUp: true,
          credentialDeviceType: "multiDevice" as const,
          credentialID: credentialId.toString("base64url"),
          newCounter: 8,
          origin: "https://race.example.com",
          rpID: "race.example.com",
          userVerified: true,
        },
        verified: true,
      });
    });
    await expect(
      verifyPasskeyLogin(
        response,
        Buffer.alloc(32, 1).toString("base64url"),
        "https://race.example.com",
        "race.example.com",
        {
          backupEligible: true,
          cosePublicKey: publicKey,
          credentialId,
          signCount: 7,
        },
        verifier,
      ),
    ).resolves.toEqual({ backupState: true, signCount: 8 });
    expect(verifier).toHaveBeenCalledOnce();
    const verificationInput = verifier.mock.calls[0]?.[0];
    expect(verificationInput?.credential.counter).toBe(7);
    expect(verificationInput?.credential.id).toBe(credentialId.toString("base64url"));
    expect(verificationInput?.expectedOrigin).toBe("https://race.example.com");
    expect(verificationInput?.expectedRPID).toBe("race.example.com");
    expect(verificationInput?.expectedType).toBe("webauthn.get");
    expect(verificationInput?.requireUserVerification).toBe(true);
    expect(verificationInput?.response).toBe(response);
    expect(verifiedPublicKey).toEqual(publicKey);
    expect(credentialId).toEqual(Buffer.alloc(32, 0x51));
    expect(publicKey).toEqual(Buffer.alloc(77, 0x61));
  });

  it("fails closed on verification error or credential metadata drift", async () => {
    const material = {
      backupEligible: false,
      cosePublicKey: Buffer.alloc(77),
      credentialId,
      signCount: 0,
    };
    await expect(
      verifyPasskeyLogin(
        response,
        "challenge",
        "https://race.example.com",
        "race.example.com",
        material,
        () => Promise.reject(new Error("private")),
      ),
    ).resolves.toBeUndefined();
    await expect(
      verifyPasskeyLogin(
        response,
        "challenge",
        "https://race.example.com",
        "race.example.com",
        material,
        () =>
          Promise.resolve({
            authenticationInfo: {
              credentialBackedUp: true,
              credentialDeviceType: "multiDevice",
              credentialID: credentialId.toString("base64url"),
              newCounter: 1,
              origin: "https://race.example.com",
              rpID: "race.example.com",
              userVerified: true,
            },
            verified: true,
          }),
      ),
    ).resolves.toBeUndefined();
  });
});

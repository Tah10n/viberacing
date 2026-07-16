import "server-only";

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type PublicKeyCredentialCreationOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";

const supportedAlgorithms = [-7, -257] as const;
type RegistrationVerifier = typeof verifyRegistrationResponse;

export interface RegisteredPasskey {
  readonly backupEligible: boolean;
  readonly backupState: boolean;
  readonly cosePublicKey: Uint8Array;
  readonly credentialId: Uint8Array;
  readonly signCount: number;
}

function uuidBytes(value: string): Uint8Array<ArrayBuffer> {
  const decoded = Buffer.from(value.replaceAll("-", ""), "hex");
  try {
    return Uint8Array.from(decoded);
  } finally {
    decoded.fill(0);
  }
}

export async function createInitialPasskeyOptions(
  profileId: string,
  handle: string,
  rpId: string,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const userId = uuidBytes(profileId);
  try {
    return await generateRegistrationOptions({
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
      rpID: rpId,
      rpName: "Vibe Racing",
      supportedAlgorithmIDs: [...supportedAlgorithms],
      timeout: 300_000,
      userDisplayName: handle,
      userID: userId,
      userName: handle,
    });
  } finally {
    userId.fill(0);
  }
}

export function passkeyContextDigest(
  profileId: string,
  handle: string,
  rpId: string,
  origin: string,
): Buffer {
  return createHash("sha256")
    .update(
      `viberacing-passkey-registration-v1\n${profileId}\n${handle}\n${rpId}\n${origin}`,
      "utf8",
    )
    .digest();
}

export function passkeyChallengeDigest(challenge: string): Buffer {
  return createHash("sha256").update(challenge, "ascii").digest();
}

export async function verifyInitialPasskey(
  response: unknown,
  expectedChallenge: string,
  expectedOrigin: string,
  expectedRpId: string,
  verifyRegistration: RegistrationVerifier = verifyRegistrationResponse,
): Promise<RegisteredPasskey | undefined> {
  try {
    const result = await verifyRegistration({
      expectedChallenge,
      expectedOrigin,
      expectedRPID: expectedRpId,
      expectedType: "webauthn.create",
      requireUserPresence: true,
      requireUserVerification: true,
      response: response as RegistrationResponseJSON,
      supportedAlgorithmIDs: [...supportedAlgorithms],
    });
    if (!result.verified) {
      return undefined;
    }
    const { credential, credentialBackedUp, credentialDeviceType } = result.registrationInfo;
    const credentialId = Buffer.from(credential.id, "base64url");
    const publicKey = Buffer.from(credential.publicKey);
    if (
      credentialId.length < 16 ||
      credentialId.length > 1024 ||
      credentialId.toString("base64url") !== credential.id ||
      publicKey.length < 32 ||
      publicKey.length > 4096 ||
      !Number.isSafeInteger(credential.counter) ||
      credential.counter < 0
    ) {
      credentialId.fill(0);
      publicKey.fill(0);
      return undefined;
    }
    return Object.freeze({
      backupEligible: credentialDeviceType === "multiDevice",
      backupState: credentialBackedUp,
      cosePublicKey: publicKey,
      credentialId,
      signCount: credential.counter,
    });
  } catch {
    return undefined;
  }
}

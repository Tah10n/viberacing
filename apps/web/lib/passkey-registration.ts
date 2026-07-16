import "server-only";

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";

const supportedAlgorithms = [-7, -257] as const;
type RegistrationVerifier = typeof verifyRegistrationResponse;
type AuthenticationVerifier = typeof verifyAuthenticationResponse;

export interface RegisteredPasskey {
  readonly backupEligible: boolean;
  readonly backupState: boolean;
  readonly cosePublicKey: Uint8Array;
  readonly credentialId: Uint8Array;
  readonly signCount: number;
}

export interface PasskeyAuthenticationMaterial {
  readonly backupEligible: boolean;
  readonly cosePublicKey: Uint8Array;
  readonly credentialId: Uint8Array;
  readonly signCount: number;
}

export interface VerifiedPasskeyAuthentication {
  readonly backupState: boolean;
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

export async function createPasskeyLoginOptions(
  rpId: string,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: rpId,
    timeout: 300_000,
    userVerification: "required",
  });
}

export function passkeyLoginContextDigest(rpId: string, origin: string): Buffer {
  return createHash("sha256")
    .update(`viberacing-passkey-login-v1\n${rpId}\n${origin}`, "utf8")
    .digest();
}

export function passkeyLoginCredentialId(response: unknown): Buffer | undefined {
  if (
    response === null ||
    typeof response !== "object" ||
    Array.isArray(response) ||
    Object.getPrototypeOf(response) !== Object.prototype
  ) {
    return undefined;
  }
  const record = response as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.rawId !== "string" ||
    record.rawId !== record.id ||
    record.type !== "public-key" ||
    !/^[A-Za-z0-9_-]+$/.test(record.id)
  ) {
    return undefined;
  }
  const credentialId = Buffer.from(record.id, "base64url");
  if (
    credentialId.length < 16 ||
    credentialId.length > 1024 ||
    credentialId.toString("base64url") !== record.id
  ) {
    credentialId.fill(0);
    return undefined;
  }
  return credentialId;
}

export async function verifyPasskeyLogin(
  response: unknown,
  expectedChallenge: string,
  expectedOrigin: string,
  expectedRpId: string,
  material: PasskeyAuthenticationMaterial,
  verifyAuthentication: AuthenticationVerifier = verifyAuthenticationResponse,
): Promise<VerifiedPasskeyAuthentication | undefined> {
  const credentialId = Buffer.from(material.credentialId);
  const publicKey = Buffer.from(material.cosePublicKey);
  let responseCredentialId: Buffer | undefined;
  try {
    const encodedCredentialId = credentialId.toString("base64url");
    responseCredentialId = passkeyLoginCredentialId(response);
    if (
      responseCredentialId?.toString("base64url") !== encodedCredentialId ||
      publicKey.length < 32 ||
      publicKey.length > 4096 ||
      !Number.isSafeInteger(material.signCount) ||
      material.signCount < 0
    ) {
      return undefined;
    }
    const result = await verifyAuthentication({
      credential: {
        counter: material.signCount,
        id: encodedCredentialId,
        publicKey,
      },
      expectedChallenge,
      expectedOrigin,
      expectedRPID: expectedRpId,
      expectedType: "webauthn.get",
      requireUserVerification: true,
      response: response as AuthenticationResponseJSON,
    });
    const expectedDeviceType = material.backupEligible ? "multiDevice" : "singleDevice";
    if (
      !result.verified ||
      !result.authenticationInfo.userVerified ||
      result.authenticationInfo.credentialID !== encodedCredentialId ||
      result.authenticationInfo.origin !== expectedOrigin ||
      result.authenticationInfo.rpID !== expectedRpId ||
      result.authenticationInfo.credentialDeviceType !== expectedDeviceType ||
      (result.authenticationInfo.credentialBackedUp && !material.backupEligible) ||
      !Number.isSafeInteger(result.authenticationInfo.newCounter) ||
      result.authenticationInfo.newCounter < 0
    ) {
      return undefined;
    }
    return Object.freeze({
      backupState: result.authenticationInfo.credentialBackedUp,
      signCount: result.authenticationInfo.newCounter,
    });
  } catch {
    return undefined;
  } finally {
    credentialId.fill(0);
    publicKey.fill(0);
    responseCredentialId?.fill(0);
  }
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

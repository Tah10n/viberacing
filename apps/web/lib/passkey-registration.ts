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

export async function createPasskeyRegistrationOptions(
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

export function createRecoveryPasskeyRegistrationOptions(
  recoveryAuthorityId: string,
  rpId: string,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return createPasskeyRegistrationOptions(recoveryAuthorityId, "Vibe Racing recovery", rpId);
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

export function passkeyAddContextDigest(
  sessionId: string,
  profileId: string,
  handle: string,
  label: string,
  registrationChallenge: string,
  rpId: string,
  origin: string,
): Buffer {
  return createHash("sha256")
    .update(
      `viberacing-passkey-add-v1\n${sessionId}\n${profileId}\n${handle}\n${label}\n${registrationChallenge}\n${rpId}\n${origin}`,
      "utf8",
    )
    .digest();
}

export function passkeyRevokeContextDigest(
  sessionId: string,
  targetPasskeyId: string,
  rpId: string,
  origin: string,
): Buffer {
  return createHash("sha256")
    .update(
      `viberacing-passkey-revoke-v1\n${sessionId}\n${targetPasskeyId}\n${rpId}\n${origin}`,
      "utf8",
    )
    .digest();
}

export function profileDeletionContextDigest(
  sessionId: string,
  profileId: string,
  handle: string,
  rpId: string,
  origin: string,
): Buffer {
  return createHash("sha256")
    .update(
      `viberacing-profile-deletion-v1\n${sessionId}\n${profileId}\n${handle}\n${rpId}\n${origin}`,
      "utf8",
    )
    .digest();
}

export function recoveryCodeRotationContextDigest(
  sessionId: string,
  profileId: string,
  rpId: string,
  origin: string,
): Buffer {
  return createHash("sha256")
    .update(
      `viberacing-recovery-code-rotation-v1\n${sessionId}\n${profileId}\n${rpId}\n${origin}`,
      "utf8",
    )
    .digest();
}

export function recoveryPasskeyContextDigest(
  recoveryAuthorityId: string,
  label: string,
  registrationChallenge: string,
  rpId: string,
  origin: string,
): Buffer {
  return createHash("sha256")
    .update(
      `viberacing-recovery-passkey-v1\n${recoveryAuthorityId}\n${label}\n${registrationChallenge}\n${rpId}\n${origin}`,
      "utf8",
    )
    .digest();
}

export type AccountTargetActionPurpose =
  "account_reactivate" | "account_unlink" | "device_revoke" | "installation_revoke";

export function accountTargetActionContextDigest(
  sessionId: string,
  purpose: AccountTargetActionPurpose,
  targetId: string,
  rpId: string,
  origin: string,
): Buffer {
  return createHash("sha256")
    .update(
      `viberacing-account-target-action-v1\n${sessionId}\n${purpose}\n${targetId}\n${rpId}\n${origin}`,
      "utf8",
    )
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

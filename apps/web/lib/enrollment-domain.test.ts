import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  parseJoinRequest,
  readAccountTargetActionChallenge,
  readEnrollmentSession,
  readInitialPasskeyChallenge,
  readPasskeyAddChallenge,
  readPasskeyChallenge,
  readPasskeyRevokeChallenge,
  readPendingEnrollment,
  readProfileDeletionChallenge,
  readRecoveryAuthorityChallenge,
} from "./enrollment-domain";

const secret = Buffer.alloc(32, 0x42);
const inviteCode = "vri_00000000-0000-4000-8000-000000000101_" + secret.toString("base64url");
const invitedForm = new URLSearchParams({ inviteCode, locale: "ru" }).toString();
const openForm = new URLSearchParams({ locale: "en" }).toString();

describe("enrollment domain", () => {
  it("accepts the minimal open form and minimizes an enabled invite to its digest", () => {
    expect(parseJoinRequest(openForm, false)).toEqual({ locale: "en" });
    expect(parseJoinRequest(invitedForm, true)).toEqual({
      inviteDigest: createHash("sha256").update(secret).digest("base64url"),
      inviteId: "00000000-0000-4000-8000-000000000101",
      locale: "ru",
    });
    expect(parseJoinRequest(invitedForm, false)).toBeUndefined();
    expect(parseJoinRequest(openForm, true)).toBeUndefined();
  });

  it.each([
    "",
    invitedForm + "&extra=true",
    invitedForm + "&inviteCode=duplicate",
    invitedForm.replace(encodeURIComponent(inviteCode), "bad"),
    "x".repeat(257),
  ])("rejects malformed or open join form %s", (body) => {
    expect(parseJoinRequest(body, true)).toBeUndefined();
  });

  it("accepts only closed, unexpired encrypted payload shapes", () => {
    const now = 1_800_000_000;
    const digest = createHash("sha256").update(secret).digest("base64url");
    const pending = {
      codeVerifier: Buffer.alloc(32, 1).toString("base64url"),
      expiresAt: now + 600,
      inviteDigest: digest,
      inviteId: "00000000-0000-4000-8000-000000000101",
      locale: "en",
      state: Buffer.alloc(32, 2).toString("base64url"),
      version: 1,
    } as const;
    const session = {
      expiresAt: now + 60,
      handle: "pixel_driver",
      locale: "en",
      passkeyRegistered: false,
      profileId: "00000000-0000-4000-8000-000000000102",
      sessionId: "00000000-0000-4000-8000-000000000103",
      sessionVerifier: Buffer.alloc(32, 3).toString("base64url"),
      version: 1,
    } as const;
    const challenge = {
      challenge: Buffer.alloc(32, 4).toString("base64url"),
      challengeId: "00000000-0000-4000-8000-000000000104",
      expiresAt: now + 300,
      version: 1,
    } as const;
    const initialPasskeyChallenge = {
      ...challenge,
      handle: "pixel_driver",
    } as const;
    const revokeChallenge = {
      ...challenge,
      targetPasskeyId: "00000000-0000-4000-8000-000000000105",
    } as const;
    const profileDeletionChallenge = {
      ...challenge,
      handle: "pixel_driver",
    } as const;
    const accountTargetChallenge = {
      ...challenge,
      purpose: "account_unlink",
      targetId: `acc_${"B".repeat(22)}`,
    } as const;
    const addChallenge = {
      authenticationChallenge: challenge.challenge,
      challengeId: challenge.challengeId,
      expiresAt: challenge.expiresAt,
      label: "Backup passkey",
      registrationChallenge: Buffer.alloc(32, 0x45).toString("base64url"),
      version: 1,
    } as const;
    const recoveryAuthority = {
      authorityId: "00000000-0000-4000-8000-000000000106",
      authoritySecret: Buffer.alloc(32, 0x46).toString("base64url"),
      challenge: challenge.challenge,
      expiresAt: now + 300,
      label: "Replacement passkey",
      version: 1,
    } as const;

    expect(readPendingEnrollment(pending, now)).toEqual(pending);
    expect(readEnrollmentSession(session, now)).toEqual(session);
    expect(readPasskeyChallenge(challenge, now)).toEqual(challenge);
    expect(readInitialPasskeyChallenge(initialPasskeyChallenge, now)).toEqual(
      initialPasskeyChallenge,
    );
    expect(readPasskeyAddChallenge(addChallenge, now)).toEqual(addChallenge);
    expect(readPasskeyRevokeChallenge(revokeChallenge, now)).toEqual(revokeChallenge);
    expect(readProfileDeletionChallenge(profileDeletionChallenge, now)).toEqual(
      profileDeletionChallenge,
    );
    expect(readAccountTargetActionChallenge(accountTargetChallenge, now)).toEqual(
      accountTargetChallenge,
    );
    expect(readRecoveryAuthorityChallenge(recoveryAuthority, now)).toEqual(recoveryAuthority);
    expect(readPendingEnrollment({ ...pending, extra: true }, now)).toBeUndefined();
    expect(readEnrollmentSession({ ...session, expiresAt: now }, now)).toBeUndefined();
    expect(readPasskeyChallenge({ ...challenge, challenge: "bad" }, now)).toBeUndefined();
    expect(readPasskeyChallenge(revokeChallenge, now)).toBeUndefined();
    expect(readPasskeyChallenge(addChallenge, now)).toBeUndefined();
    expect(readPasskeyChallenge(profileDeletionChallenge, now)).toBeUndefined();
    expect(readInitialPasskeyChallenge(challenge, now)).toBeUndefined();
    expect(
      readInitialPasskeyChallenge(
        { ...initialPasskeyChallenge, handle: "pending_1234567890abcdef" },
        now,
      ),
    ).toBeUndefined();
    expect(readPasskeyAddChallenge(challenge, now)).toBeUndefined();
    expect(
      readPasskeyAddChallenge(
        { ...addChallenge, registrationChallenge: addChallenge.authenticationChallenge },
        now,
      ),
    ).toBeUndefined();
    expect(readPasskeyAddChallenge({ ...addChallenge, label: " Backup" }, now)).toBeUndefined();
    expect(readPasskeyRevokeChallenge(addChallenge, now)).toBeUndefined();
    expect(readPasskeyRevokeChallenge(challenge, now)).toBeUndefined();
    expect(
      readPasskeyRevokeChallenge({ ...revokeChallenge, targetPasskeyId: "bad" }, now),
    ).toBeUndefined();
    expect(readPasskeyRevokeChallenge({ ...revokeChallenge, extra: true }, now)).toBeUndefined();
    expect(readProfileDeletionChallenge(challenge, now)).toBeUndefined();
    expect(readProfileDeletionChallenge(revokeChallenge, now)).toBeUndefined();
    expect(
      readProfileDeletionChallenge({ ...profileDeletionChallenge, handle: "UPPERCASE" }, now),
    ).toBeUndefined();
    expect(
      readProfileDeletionChallenge({ ...profileDeletionChallenge, extra: true }, now),
    ).toBeUndefined();
    expect(readAccountTargetActionChallenge(challenge, now)).toBeUndefined();
    expect(
      readAccountTargetActionChallenge(
        { ...accountTargetChallenge, purpose: "device_revoke", targetId: `dev_${"C".repeat(22)}` },
        now,
      ),
    ).toMatchObject({ purpose: "device_revoke", targetId: `dev_${"C".repeat(22)}` });
    expect(
      readAccountTargetActionChallenge({ ...accountTargetChallenge, targetId: "bad" }, now),
    ).toBeUndefined();
    expect(
      readAccountTargetActionChallenge({ ...accountTargetChallenge, purpose: "unknown" }, now),
    ).toBeUndefined();
    expect(
      readAccountTargetActionChallenge({ ...accountTargetChallenge, extra: true }, now),
    ).toBeUndefined();
    expect(readRecoveryAuthorityChallenge(challenge, now)).toBeUndefined();
    expect(
      readRecoveryAuthorityChallenge({ ...recoveryAuthority, authoritySecret: "bad" }, now),
    ).toBeUndefined();
    expect(
      readRecoveryAuthorityChallenge({ ...recoveryAuthority, label: " Replacement" }, now),
    ).toBeUndefined();
    expect(
      readRecoveryAuthorityChallenge({ ...recoveryAuthority, expiresAt: now + 601 }, now),
    ).toBeUndefined();
  });
});

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  parseJoinRequest,
  readEnrollmentSession,
  readPasskeyChallenge,
  readPasskeyRevokeChallenge,
  readPendingEnrollment,
} from "./enrollment-domain";

const secret = Buffer.alloc(32, 0x42);
const inviteCode = "vri_00000000-0000-4000-8000-000000000101_" + secret.toString("base64url");
const validForm = new URLSearchParams({
  handle: "pixel_driver",
  inviteCode,
  locale: "ru",
  motionPreference: "system",
  streakVisible: "false",
  theme: "neon-night",
}).toString();

describe("enrollment domain", () => {
  it("minimizes a canonical invite form to its digest and public preferences", () => {
    expect(parseJoinRequest(validForm)).toEqual({
      handle: "pixel_driver",
      inviteDigest: createHash("sha256").update(secret).digest("base64url"),
      inviteId: "00000000-0000-4000-8000-000000000101",
      locale: "ru",
      motionPreference: "system",
      streakVisible: false,
      theme: "neon-night",
    });
  });

  it.each([
    "",
    validForm + "&extra=true",
    validForm + "&handle=duplicate",
    validForm.replace("pixel_driver", "UPPERCASE"),
    validForm.replace(encodeURIComponent(inviteCode), "bad"),
    "x".repeat(1025),
  ])("rejects malformed or open join form %s", (body) => {
    expect(parseJoinRequest(body)).toBeUndefined();
  });

  it("accepts only closed, unexpired encrypted payload shapes", () => {
    const now = 1_800_000_000;
    const digest = createHash("sha256").update(secret).digest("base64url");
    const pending = {
      codeVerifier: Buffer.alloc(32, 1).toString("base64url"),
      expiresAt: now + 600,
      handle: "pixel_driver",
      inviteDigest: digest,
      inviteId: "00000000-0000-4000-8000-000000000101",
      locale: "en",
      motionPreference: "off",
      state: Buffer.alloc(32, 2).toString("base64url"),
      streakVisible: true,
      theme: "cyber-rally",
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
    const revokeChallenge = {
      ...challenge,
      targetPasskeyId: "00000000-0000-4000-8000-000000000105",
    } as const;

    expect(readPendingEnrollment(pending, now)).toEqual(pending);
    expect(readEnrollmentSession(session, now)).toEqual(session);
    expect(readPasskeyChallenge(challenge, now)).toEqual(challenge);
    expect(readPasskeyRevokeChallenge(revokeChallenge, now)).toEqual(revokeChallenge);
    expect(readPendingEnrollment({ ...pending, extra: true }, now)).toBeUndefined();
    expect(readEnrollmentSession({ ...session, expiresAt: now }, now)).toBeUndefined();
    expect(readPasskeyChallenge({ ...challenge, challenge: "bad" }, now)).toBeUndefined();
    expect(readPasskeyChallenge(revokeChallenge, now)).toBeUndefined();
    expect(readPasskeyRevokeChallenge(challenge, now)).toBeUndefined();
    expect(
      readPasskeyRevokeChallenge({ ...revokeChallenge, targetPasskeyId: "bad" }, now),
    ).toBeUndefined();
    expect(readPasskeyRevokeChallenge({ ...revokeChallenge, extra: true }, now)).toBeUndefined();
  });
});

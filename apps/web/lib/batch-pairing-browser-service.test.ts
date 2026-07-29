// @vitest-environment node
/* eslint-disable @typescript-eslint/unbound-method -- Vitest inspects injected service spies. */

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const passkeys = vi.hoisted(() => ({
  createPasskeyLoginOptions: vi.fn(() =>
    Promise.resolve({ challenge: Buffer.alloc(32, 0x31).toString("base64url") }),
  ),
  passkeyChallengeDigest: vi.fn((challenge: string) =>
    createHash("sha256").update(challenge, "ascii").digest(),
  ),
  passkeyLoginCredentialId: vi.fn(() => Buffer.alloc(32, 0x44)),
  verifyPasskeyLogin: vi.fn(() => Promise.resolve({ backupState: false, signCount: 7 })),
}));

vi.mock("./passkey-registration", () => passkeys);

import {
  createBatchPairingBrowserService,
  deriveBatchPairingControlKey,
  pairingApprovalContextDigest,
} from "./batch-pairing-browser-service";
import type { BatchPairingDatabase, PairingSessionAuthority } from "./batch-pairing-database";
import { createEnrollmentCookieCodec } from "./enrollment-cookie";
import type { EnrollmentSession } from "./enrollment-domain";
import type { PairingUserCodeVerifier } from "./pairing-user-code-verifier";

const now = Date.parse("2026-07-28T12:00:00.000Z");
const expiresAt = "2026-07-28T12:09:00.000Z";
const pairingId = "pair_AAAAAAAAAAAAAAAAAAAAAA";
const candidateA = "cand_AAAAAAAAAAAAAAAAAAAAAA";
const candidateB = "cand_BBBBBBBBBBBBBBBBBBBBBB";
const accountA = "acc_AAAAAAAAAAAAAAAAAAAAAA";
const session: EnrollmentSession = Object.freeze({
  expiresAt: now + 60_000,
  handle: "pixel_driver",
  locale: "en",
  passkeyRegistered: true,
  profileId: "30000000-0000-4000-8000-000000000001",
  sessionId: "30000000-0000-4000-8000-000000000002",
  sessionVerifier: Buffer.alloc(32, 0x41).toString("base64url"),
  version: 1,
});

function approvalRows(): readonly Record<string, unknown>[] {
  const base = {
    architecture: "x86_64",
    connector_version: "0.0.0",
    expires_at: expiresAt,
    installation_label: "Main workstation",
    installation_public_key: Buffer.alloc(32, 0x51),
    manifest_digest: Buffer.alloc(32, 0x52),
    os_family: "windows",
    pairing_id: pairingId,
    provider_code: "codex",
    reader_version: "codex_app_server_0_144_5_v1",
    accounting_revision: 1,
  };
  return [
    {
      ...base,
      candidate_id: candidateA,
      fingerprint_digest: Buffer.alloc(32, 0x11),
      fingerprint_kind: "stable_opaque",
      preview_current_week_token_total: "1200",
      preview_last_usage_date: "2026-07-28",
      preview_status: "ready",
      safe_local_display_label: "Codex personal",
    },
    {
      ...base,
      candidate_id: candidateB,
      fingerprint_digest: null,
      fingerprint_kind: "unavailable",
      preview_current_week_token_total: "0",
      preview_last_usage_date: null,
      preview_status: "unavailable",
      safe_local_display_label: "Codex secondary",
    },
  ];
}

function accountRows(): readonly Record<string, unknown>[] {
  return [
    {
      account_state: "active",
      accounting_revision: 1,
      agent_account_id: accountA,
      fingerprint_digest: Buffer.alloc(32, 0x11),
      fingerprint_kind: "stable_opaque",
      private_label: "Personal account",
      provider_code: "codex",
      scope_kind: "agent_account",
    },
  ];
}

function databaseFixture(): BatchPairingDatabase {
  return {
    activate: vi.fn(),
    admit: vi.fn(),
    approve: vi.fn(() => Promise.resolve([{ approved_count: 2 }])),
    close: vi.fn(() => Promise.resolve()),
    createApprovalChallenge: vi.fn(
      (_authority: PairingSessionAuthority, input: Readonly<{ readonly challengeId: string }>) =>
        Promise.resolve([{ challenge_id: input.challengeId }]),
    ),
    poll: vi.fn(),
    readAccounts: vi.fn(() => Promise.resolve(accountRows())),
    readApproval: vi.fn(() => Promise.resolve(approvalRows())),
    readPairingIdByCode: vi.fn(() => Promise.resolve([{ pairing_id: pairingId }])),
    readPasskey: vi.fn(() =>
      Promise.resolve([
        {
          backup_eligible: true,
          backup_state: false,
          cose_public_key: Buffer.alloc(64, 0x45),
          passkey_id: "30000000-0000-4000-8000-000000000004",
          sign_count: "4",
        },
      ]),
    ),
    readPossession: vi.fn(),
    start: vi.fn(),
  };
}

function verifierFixture(): PairingUserCodeVerifier & {
  readonly clear: ReturnType<typeof vi.fn>;
} {
  const clear = vi.fn();
  return {
    clear,
    close: vi.fn(),
    derive: vi.fn(() => ({
      clear,
      codeAccepted: true,
      digests: Object.freeze([Buffer.alloc(32, 0x53), Buffer.alloc(32, 0x54)] as const),
      secondaryActive: true,
    })),
  };
}

function serviceFixture(database = databaseFixture(), currentNow = () => now) {
  const verifier = verifierFixture();
  const cookieCodec = createEnrollmentCookieCodec(Buffer.alloc(32, 0x61), (size) =>
    Buffer.alloc(size, 0x62),
  );
  const controlKey = deriveBatchPairingControlKey(Buffer.alloc(32, 0x63));
  const service = createBatchPairingBrowserService({
    controlKey,
    cookieCodec,
    database,
    now: currentNow,
    pairingCodeVerifier: verifier,
    readSession: (cookie) => (cookie === "session" ? session : undefined),
    webauthnOrigin: "https://viberacing.invalid",
    webauthnRpId: "viberacing.invalid",
  });
  controlKey.fill(0);
  return { cookieCodec, database, service, verifier };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("batch pairing browser service", () => {
  it("returns the full manifest and suggests attachment only for an exact stable match", async () => {
    const { database, service, verifier } = serviceFixture();

    const review = await service.review("session", { userCode: "7K9M-P2QR-W4XY" });

    expect(database.readPairingIdByCode).toHaveBeenCalledOnce();
    expect(database.readApproval).toHaveBeenCalledOnce();
    expect(database.readAccounts).toHaveBeenCalledOnce();
    expect(review?.approval).toEqual({
      manifestDigest: Buffer.alloc(32, 0x52).toString("hex"),
      pairingId,
      schemaVersion: 1,
    });
    expect(review?.pairing.architecture).toBe("x86_64");
    expect(review?.pairing.installationLabel).toBe("Main workstation");
    expect(review?.pairing.candidates[0]).toMatchObject({
      candidateId: candidateA,
      fingerprintKind: "stable_opaque",
    });
    expect(review?.pairing.candidates[0]?.suggestedAgentAccountControl).toMatch(
      /^ctl_[A-Za-z0-9_-]{23}$/,
    );
    expect(review?.pairing.candidates[1]).toMatchObject({
      candidateId: candidateB,
      fingerprintKind: "unavailable",
    });
    expect(review?.pairing.existingAccounts[0]).toMatchObject({
      privateLabel: "Personal account",
    });
    expect(review?.pairing.existingAccounts[0]?.accountControl).toMatch(/^ctl_[A-Za-z0-9_-]{23}$/);
    expect(review?.pairing.candidates[1]).not.toHaveProperty("suggestedAgentAccountControl");
    expect(database.readPairingIdByCode).toHaveBeenCalledOnce();
    expect(verifier.clear).toHaveBeenCalledOnce();
  });

  it("binds ordered decisions into one challenge and atomically consumes one passkey result", async () => {
    const { database, service } = serviceFixture();
    const review = await service.review("session", { userCode: "7K9M-P2QR-W4XY" });
    const target = review?.pairing.candidates[0]?.suggestedAgentAccountControl;
    if (review === undefined || target === undefined) {
      throw new Error("expected safe review fixture");
    }
    const approval = {
      ...review.approval,
      decisions: [
        {
          action: "attach_existing",
          candidateId: candidateA,
          targetAgentAccountControl: target,
        },
        {
          action: "create",
          candidateId: candidateB,
          privateLabel: "Secondary account",
        },
      ],
    };

    const options = await service.beginApproval("session", approval);
    expect(options?.approvalCookie.length).toBeLessThanOrEqual(4096);
    expect(database.createApprovalChallenge).toHaveBeenCalledOnce();
    if (options === undefined) {
      throw new Error("expected approval options");
    }

    await expect(
      service.completeApproval("session", options.approvalCookie, {
        response: { id: "synthetic" },
      }),
    ).resolves.toBe(true);

    expect(passkeys.verifyPasskeyLogin).toHaveBeenCalledOnce();
    expect(database.approve).toHaveBeenCalledOnce();
    const approved = vi.mocked(database.approve).mock.calls[0]?.[0];
    expect(approved).toMatchObject({
      backupState: false,
      observedSignCount: 7,
      pairingId,
      verifiedPasskeyId: "30000000-0000-4000-8000-000000000004",
    });
    expect(approved?.manifestDigest).toBeInstanceOf(Uint8Array);
    expect(approved?.decisions).toEqual([
      expect.objectContaining({
        candidateId: candidateA,
        decision: "attach_existing",
        targetAgentAccountId: accountA,
      }),
      expect.objectContaining({
        candidateId: candidateB,
        decision: "create",
        privateLabel: "Secondary account",
      }),
    ]);
  });

  it("seals the approval continuation before creating a persistent challenge", async () => {
    const database = databaseFixture();
    const verifier = verifierFixture();
    const controlKey = deriveBatchPairingControlKey(Buffer.alloc(32, 0x63));
    const service = createBatchPairingBrowserService({
      controlKey,
      cookieCodec: {
        open: () => undefined,
        seal: () => {
          throw new Error("cookie unavailable");
        },
      },
      database,
      now: () => now,
      pairingCodeVerifier: verifier,
      readSession: (cookie) => (cookie === "session" ? session : undefined),
      webauthnOrigin: "https://viberacing.invalid",
      webauthnRpId: "viberacing.invalid",
    });
    controlKey.fill(0);
    const review = await service.review("session", { userCode: "7K9M-P2QR-W4XY" });
    const target = review?.pairing.candidates[0]?.suggestedAgentAccountControl;
    if (review === undefined || target === undefined) {
      throw new Error("expected safe review fixture");
    }

    await expect(
      service.beginApproval("session", {
        ...review.approval,
        decisions: [
          {
            action: "attach_existing",
            candidateId: candidateA,
            targetAgentAccountControl: target,
          },
          { action: "create", candidateId: candidateB, privateLabel: "Secondary" },
        ],
      }),
    ).resolves.toBeUndefined();
    expect(database.createApprovalChallenge).not.toHaveBeenCalled();
  });

  it("rejects reordered, mutated, expired, and replayed approvals without widening authority", async () => {
    let currentNow = now;
    const database = databaseFixture();
    vi.mocked(database.approve)
      .mockResolvedValueOnce([{ approved_count: 2 }])
      .mockRejectedValueOnce(new Error("challenge replay"));
    const { service } = serviceFixture(database, () => currentNow);
    const review = await service.review("session", { userCode: "7K9M-P2QR-W4XY" });
    const target = review?.pairing.candidates[0]?.suggestedAgentAccountControl;
    if (review === undefined || target === undefined) {
      throw new Error("expected safe review fixture");
    }
    const approval = {
      ...review.approval,
      decisions: [
        {
          action: "attach_existing",
          candidateId: candidateA,
          targetAgentAccountControl: target,
        },
        { action: "create", candidateId: candidateB, privateLabel: "Secondary" },
      ],
    };
    await expect(
      service.beginApproval("session", {
        ...approval,
        decisions: [...approval.decisions].reverse(),
      }),
    ).resolves.toBeUndefined();
    await expect(
      service.beginApproval("session", {
        ...approval,
        manifestDigest: "00".repeat(32),
      }),
    ).resolves.toBeUndefined();
    expect(database.createApprovalChallenge).not.toHaveBeenCalled();

    const options = await service.beginApproval("session", approval);
    if (options === undefined) {
      throw new Error("expected approval options");
    }
    await expect(
      service.completeApproval("session", options.approvalCookie, {
        response: { id: "synthetic" },
      }),
    ).resolves.toBe(true);
    await expect(
      service.completeApproval("session", options.approvalCookie, {
        response: { id: "synthetic" },
      }),
    ).resolves.toBe(false);

    currentNow += 5 * 60 * 1_000 + 1;
    await expect(
      service.completeApproval("session", options.approvalCookie, {
        response: { id: "synthetic" },
      }),
    ).resolves.toBe(false);
    expect(database.approve).toHaveBeenCalledTimes(2);
  });

  it("produces a context digest that changes with any authority-bearing field", () => {
    const approval = {
      decisions: [{ action: "skip" as const, candidateId: candidateA }],
      manifestDigest: "52".repeat(32),
      pairingId,
      schemaVersion: 1 as const,
    };
    const original = pairingApprovalContextDigest(
      session.sessionId,
      approval,
      Buffer.alloc(32, 0x51),
      expiresAt,
      "viberacing.invalid",
      "https://viberacing.invalid",
    );
    const changed = pairingApprovalContextDigest(
      session.sessionId,
      { ...approval, manifestDigest: "53".repeat(32) },
      Buffer.alloc(32, 0x51),
      expiresAt,
      "viberacing.invalid",
      "https://viberacing.invalid",
    );
    expect(changed.equals(original)).toBe(false);
    original.fill(0);
    changed.fill(0);
  });
});

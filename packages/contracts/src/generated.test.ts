import { describe, expect, it } from "vitest";

import * as publicApi from "./index";
import {
  connectorDiscoveryManifestV1Schema,
  contractSourceDigest,
  contractVersion,
  leaderboardSnapshotV1Schema,
  validateAgentProviderV1,
  validateCarRecipeV1,
  validateConnectorCarProposalResultV1,
  validateConnectorDiscoveryManifestV1,
  validateConnectorPairingApprovalV1,
  validateConnectorPairingPollResultV1,
  validateConnectorPairingPollV1,
  validateConnectorPairingStartResultV1,
  validateConnectorPairingStartV1,
  validateLeaderboardQueryV1,
  validateLeaderboardSeasonPathV1,
  validateLeaderboardSnapshotV1,
  validateProblemDetailsV1,
  validatePublicProfilePathV1,
  validatePublicProfileQueryV1,
  validatePublicProfileSummaryV1,
  validateUsageSyncResultV1,
  validateUsageSyncV1,
} from "./generated";

const opaque22 = "0123456789ABCDEFGHIJKL";
const publicKey = "A".repeat(43);
const signature = "B".repeat(86);
const digest = "c".repeat(64);

function validCarRecipe() {
  return {
    schemaVersion: 1,
    chassis: "roadster",
    nose: "classic",
    cockpit: "canopy",
    wing: "none",
    wheels: "street",
    palette: "magenta",
    trail: "spark",
    seed: 42,
  };
}

function validDiscoveryManifest() {
  return {
    schemaVersion: 1,
    installationPublicKey: publicKey,
    connectorVersion: "0.1.0",
    osFamily: "windows",
    architecture: "x86_64",
    candidates: [
      {
        candidateId: `cand_${opaque22}`,
        provider: "codex",
        readerVersion: "codex_app_server_0_144_5_v1",
        accountingRevision: 1,
        scopeKind: "agent_account",
        fingerprintKind: "stable_opaque",
        accountFingerprintDigest: digest,
        safeDisplayLabel: "Codex account",
        syncPublicKey: publicKey,
        preview: {
          currentWeekTokenTotal: "9007199254740993",
          lastUsageDate: "2026-07-27",
          status: "ready",
        },
      },
    ],
  };
}

function validPairingStart() {
  return {
    schemaVersion: 1,
    discoveryManifest: validDiscoveryManifest(),
    installationPossessionProof: {
      signedAt: "2026-07-28T18:00:00.000Z",
      nonce: opaque22,
      signature,
    },
    clientRateIdentifier: opaque22,
  };
}

function validLeaderboardSnapshot() {
  return {
    schemaVersion: 1,
    metricVersion: "provider_reported_tokens_v1",
    trustTier: "community",
    seasonStart: "2026-07-27",
    seasonEnd: "2026-08-02",
    seasonState: "open",
    generatedAt: "2026-07-28T18:00:00.000000Z",
    snapshotRevision: 3,
    participantCount: 1,
    page: 1,
    pageSize: 100,
    nextPage: null,
    participants: [
      {
        handle: "demo_driver",
        weeklyTokenTotal: "9007199254740993",
        rankPosition: 1,
        displayPosition: 1,
        freshnessDays: 0,
        carRecipe: validCarRecipe(),
        providerBreakdown: [{ provider: "codex", percentage: 100 }],
      },
    ],
  };
}

function validUsageSync() {
  return {
    schemaVersion: 1,
    agentAccountId: `acc_${opaque22}`,
    syncId: `syn_${opaque22}`,
    observedAt: "2026-07-28T18:00:00.000Z",
    clientVersion: "0.1.0",
    readerVersion: "codex_app_server_0_144_5_v1",
    dailyEntries: [
      { usageDate: "2026-07-27", dailyTokenTotal: "9007199254740993" },
      { usageDate: "2026-07-28", dailyTokenTotal: "9".repeat(30) },
    ],
  };
}

describe("generated clean product contracts", () => {
  it("exports only the generated bounded contract surface", () => {
    expect(contractVersion).toBe("v1");
    expect(contractSourceDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(Object.hasOwn(publicApi, "validateContract")).toBe(false);
    expect(Object.isFrozen(connectorDiscoveryManifestV1Schema)).toBe(true);
    expect(Object.isFrozen(leaderboardSnapshotV1Schema.properties.participants.items)).toBe(true);
  });

  it("keeps the supported provider enum closed", () => {
    expect(validateAgentProviderV1("codex")).toMatchObject({ ok: true, value: "codex" });
    expect(validateAgentProviderV1("claude_code").ok).toBe(false);
    expect(validateAgentProviderV1({ provider: "codex" }).ok).toBe(false);
  });

  it("validates the project-owned car and generic proposal acknowledgement", () => {
    expect(validateCarRecipeV1(validCarRecipe()).ok).toBe(true);
    expect(
      validateCarRecipeV1({ ...validCarRecipe(), assetUrl: "https://invalid.example" }).ok,
    ).toBe(false);
    expect(
      validateConnectorCarProposalResultV1({
        schemaVersion: 1,
        requestId: `req_${opaque22}`,
        outcome: "accepted",
      }).ok,
    ).toBe(true);
    expect(
      validateConnectorCarProposalResultV1({
        schemaVersion: 1,
        requestId: `req_${opaque22}`,
        outcome: "accepted",
        profileId: "private",
      }).ok,
    ).toBe(false);
  });

  it("accepts one privacy-minimized discovery manifest and rejects private reader detail", () => {
    const manifest = validDiscoveryManifest();
    expect(validateConnectorDiscoveryManifestV1(manifest).ok).toBe(true);
    expect(
      validateConnectorDiscoveryManifestV1({
        ...manifest,
        candidates: [{ ...manifest.candidates[0], accountFingerprintDigest: undefined }],
      }).ok,
    ).toBe(false);
    const [firstCandidate] = manifest.candidates;
    if (firstCandidate === undefined) {
      throw new Error("fixture must contain one candidate");
    }
    const { accountFingerprintDigest: ignoredDigest, ...candidateWithoutDigest } = firstCandidate;
    void ignoredDigest;
    const withoutOptionalDigest = {
      ...manifest,
      candidates: [
        {
          ...candidateWithoutDigest,
          fingerprintKind: "unavailable",
        },
      ],
    };
    expect(validateConnectorDiscoveryManifestV1(withoutOptionalDigest).ok).toBe(true);
    for (const privateField of ["email", "localPath", "repository", "model", "accessToken"]) {
      expect(
        validateConnectorDiscoveryManifestV1({
          ...manifest,
          candidates: [{ ...manifest.candidates[0], [privateField]: "private" }],
        }).ok,
      ).toBe(false);
    }
    expect(
      validateConnectorDiscoveryManifestV1({
        ...manifest,
        candidates: [manifest.candidates[0], manifest.candidates[0]],
      }).ok,
    ).toBe(false);
  });

  it("validates batch start, approval, poll, and bounded activation material", () => {
    expect(validateConnectorPairingStartV1(validPairingStart()).ok).toBe(true);
    expect(
      validateConnectorPairingStartResultV1({
        schemaVersion: 1,
        pairingId: `pair_${opaque22}`,
        pollToken: publicKey,
        pairingChallenge: publicKey,
        userCode: "ABCD-EFGH-JKLM",
        approvalUrl: "https://example.test/connect?code=ABCD-EFGH-JKLM",
        expiresAt: "2026-07-28T18:09:00.000Z",
        requestId: `req_${opaque22}`,
      }).ok,
    ).toBe(true);
    expect(
      validateConnectorPairingApprovalV1({
        schemaVersion: 1,
        pairingId: `pair_${opaque22}`,
        manifestDigest: digest,
        decisions: [
          {
            candidateId: `cand_${opaque22}`,
            action: "create",
            privateLabel: "Primary Codex",
          },
        ],
      }).ok,
    ).toBe(true);
    expect(
      validateConnectorPairingPollV1({
        schemaVersion: 1,
        pairingId: `pair_${opaque22}`,
        pollToken: publicKey,
        possessionSignature: signature,
      }).ok,
    ).toBe(true);
    expect(
      validateConnectorPairingPollResultV1({
        schemaVersion: 1,
        requestId: `req_${opaque22}`,
        pairingState: "activated",
        candidateActivations: [
          {
            candidateId: `cand_${opaque22}`,
            activationState: "active",
            agentAccountId: `acc_${opaque22}`,
            deviceId: `dev_${opaque22}`,
            serverBindingMaterial: {
              deviceKeyId: `key_${opaque22}`,
              usageEndpoint: "/v1/usage",
              signatureProtocol: "viberacing-usage-sync-auth-v1",
            },
            nextAction: "sync",
          },
        ],
      }).ok,
    ).toBe(true);
  });

  it("validates exact public path and query contracts", () => {
    expect(validateLeaderboardQueryV1({ trustTier: "community", page: 1 }).ok).toBe(true);
    expect(validateLeaderboardSeasonPathV1({ seasonStart: "2026-07-27" }).ok).toBe(true);
    expect(validateLeaderboardSeasonPathV1({ seasonStart: "2026-07-28" }).ok).toBe(false);
    expect(validatePublicProfilePathV1({ handle: "demo_driver" }).ok).toBe(true);
    expect(validatePublicProfilePathV1({ handle: "../private" }).ok).toBe(false);
    expect(validatePublicProfileQueryV1({ trustTier: "community" }).ok).toBe(true);
    expect(validatePublicProfileQueryV1({ trustTier: "verified" }).ok).toBe(false);
  });

  it("validates direct-token snapshots with nullability and optional public presentation only", () => {
    const snapshot = validLeaderboardSnapshot();
    expect(validateLeaderboardSnapshotV1(snapshot).ok).toBe(true);
    expect(
      validateLeaderboardSnapshotV1({
        ...snapshot,
        participants: [
          {
            ...snapshot.participants[0],
            carRecipe: undefined,
            providerBreakdown: undefined,
            freshnessDays: null,
          },
        ],
      }).ok,
    ).toBe(false);
    const minimalParticipant = { ...snapshot.participants[0], freshnessDays: null };
    delete minimalParticipant.carRecipe;
    delete minimalParticipant.providerBreakdown;
    expect(
      validateLeaderboardSnapshotV1({ ...snapshot, participants: [minimalParticipant] }).ok,
    ).toBe(true);
    expect(
      validateLeaderboardSnapshotV1({
        ...snapshot,
        participants: [{ ...snapshot.participants[0], accountCount: 2 }],
      }).ok,
    ).toBe(false);
    expect(
      validateLeaderboardSnapshotV1({
        ...snapshot,
        participants: [
          {
            ...snapshot.participants[0],
            weeklyTokenTotal: Number.MAX_SAFE_INTEGER + 1,
          },
        ],
      }).ok,
    ).toBe(false);
  });

  it("validates a precomputed public profile and explicit absent car recipe", () => {
    const profile = {
      schemaVersion: 1,
      handle: "demo_driver",
      trustTier: "community",
      season: {
        seasonStart: "2026-07-27",
        seasonEnd: "2026-08-02",
        seasonState: "open",
      },
      weeklyTokenTotal: "9007199254740993",
      rankPosition: 1,
      participantCount: 10,
      providerBreakdown: [{ provider: "codex", percentage: 100 }],
      freshnessDays: null,
      carRecipe: null,
    };
    expect(validatePublicProfileSummaryV1(profile).ok).toBe(true);
    expect(validatePublicProfileSummaryV1({ ...profile, deviceId: `dev_${opaque22}` }).ok).toBe(
      false,
    );
    expect(validatePublicProfileSummaryV1({ ...profile, carRecipe: validCarRecipe() }).ok).toBe(
      true,
    );
  });

  it("accepts decimal strings beyond JavaScript safe integers without rounding", () => {
    const input = validUsageSync();
    const result = validateUsageSyncV1(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.dailyEntries[0]?.dailyTokenTotal).toBe("9007199254740993");
      expect(result.value.dailyEntries[1]?.dailyTokenTotal).toBe("9".repeat(30));
    }
    expect(
      validateUsageSyncV1({
        ...input,
        dailyEntries: [{ usageDate: "2026-07-27", dailyTokenTotal: "9".repeat(31) }],
      }).ok,
    ).toBe(false);
    expect(
      validateUsageSyncV1({
        ...input,
        dailyEntries: [{ usageDate: "2026-07-27", dailyTokenTotal: 9007199254740992 }],
      }).ok,
    ).toBe(false);
    for (const field of ["provider", "accountingRevision", "trustTier", "rank", "model"]) {
      expect(validateUsageSyncV1({ ...input, [field]: "private" }).ok).toBe(false);
    }
  });

  it("validates only coarse usage outcomes and bounded generic problems", () => {
    expect(
      validateUsageSyncResultV1({
        schemaVersion: 1,
        requestId: `req_${opaque22}`,
        syncId: `syn_${opaque22}`,
        outcome: "quarantined",
        acceptedEntries: 0,
        nextAllowedSyncAt: "2026-07-28T18:01:00.000Z",
        recoveryAction: "contact_support",
      }).ok,
    ).toBe(true);
    expect(
      validateUsageSyncResultV1({
        schemaVersion: 1,
        requestId: `req_${opaque22}`,
        syncId: `syn_${opaque22}`,
        outcome: "quarantined",
        acceptedEntries: 0,
        quarantineReason: "private",
      }).ok,
    ).toBe(false);
    expect(
      validateProblemDetailsV1({
        schemaVersion: 1,
        requestId: `req_${opaque22}`,
        status: 503,
        errorCode: "temporarily_unavailable",
        title: "Temporarily unavailable",
        retryable: true,
      }).ok,
    ).toBe(true);
    expect(
      validateProblemDetailsV1({
        schemaVersion: 1,
        requestId: `req_${opaque22}`,
        status: 500,
        errorCode: "internal_error",
        title: "Internal server error",
        retryable: true,
        stack: "private",
      }).ok,
    ).toBe(false);
  });
});

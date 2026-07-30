import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";

import { resolvePairingDatabaseConfig } from "./pairing-database-config";
import { createPairingDatabasePool, type PairingDatabasePoolSignal } from "./pairing-database-pool";

const config = resolvePairingDatabaseConfig({
  NODE_ENV: "development",
  VIBERACING_WEB_DATABASE_HOST: "127.0.0.1",
  VIBERACING_WEB_DATABASE_NAME: "viberacing_local",
  VIBERACING_WEB_DATABASE_PASSWORD: "private-pairing-database-password",
  VIBERACING_WEB_DATABASE_PORT: "54329",
  VIBERACING_WEB_DATABASE_TLS_MODE: "disable",
  VIBERACING_WEB_DATABASE_USER: "viberacing_web_login",
});

describe("pairing database pool", () => {
  it("uses only fixed private-dashboard and passkey-bound account-action statements", async () => {
    const returnedRows = [
      [{ weekly_token_total: "9007199254740993" }],
      [{ agent_account_id: `acc_${"A".repeat(22)}` }],
      [{ paused: true }],
      [{ created: true }],
      [{ completed: true }],
      [{ completed: true }],
      [{ completed: true }],
      [{ completed: true }],
      [{ provider_breakdown_visible: true }],
    ];
    const liveQueries: { text: string; values: unknown[] }[] = [];
    const snapshots: { text: string; values: unknown[] }[] = [];
    const driverClient = {
      query(query: { text: string; values: unknown[] }): Promise<{ rows: unknown }> {
        liveQueries.push(query);
        snapshots.push({
          text: query.text,
          values: query.values.map((value) =>
            Buffer.isBuffer(value) ? Buffer.from(value) : value,
          ),
        });
        return Promise.resolve({ rows: returnedRows.shift() });
      },
      release: vi.fn(),
    };
    const driverPool = {
      connect: () => Promise.resolve(driverClient),
      end: () => Promise.resolve(),
      on() {
        return this;
      },
    };
    const pool = createPairingDatabasePool(config, undefined, () => driverPool);
    const client = await pool.connect();
    const sessionId = "00000000-0000-4000-8000-000000000312";
    const challengeId = "00000000-0000-4000-8000-000000000313";
    const passkeyId = "00000000-0000-4000-8000-000000000314";
    const sessionDigest = Buffer.alloc(32, 0x51);
    const challengeDigest = Buffer.alloc(32, 0x52);
    const contextDigest = Buffer.alloc(32, 0x53);
    const targetIds = [
      `acc_${"A".repeat(22)}`,
      `acc_${"A".repeat(22)}`,
      `dev_${"B".repeat(22)}`,
      `ins_${"C".repeat(22)}`,
    ] as const;

    await client.readPrivateDashboardRanking({ sessionId, sessionVerifierDigest: sessionDigest });
    await client.readAgentAccountDashboard({ sessionId, sessionVerifierDigest: sessionDigest });
    await client.pauseAgentAccount({
      agentAccountId: targetIds[0],
      sessionId,
      sessionVerifierDigest: sessionDigest,
    });
    await client.createAccountTargetChallenge({
      challengeDigest,
      challengeId,
      contextDigest,
      expiresAt: "2026-07-16T10:05:00.000Z",
      purpose: "account_unlink",
      sessionId,
      sessionVerifierDigest: sessionDigest,
    });
    const completion = {
      backupState: false,
      challengeId,
      contextDigest,
      observedSignCount: 4,
      sessionId,
      sessionVerifierDigest: sessionDigest,
      verifiedPasskeyId: passkeyId,
    };
    await client.completeAgentAccountReactivation({ ...completion, targetId: targetIds[0] });
    await client.completeAgentAccountUnlink({ ...completion, targetId: targetIds[1] });
    await client.completeDeviceKeyRevocation({ ...completion, targetId: targetIds[2] });
    await client.completeInstallationRevocation({ ...completion, targetId: targetIds[3] });
    await client.setProviderBreakdownVisibility({
      providerBreakdownVisible: true,
      sessionId,
      sessionVerifierDigest: sessionDigest,
    });

    expect(snapshots.map(({ text }) => text)).toEqual([
      expect.stringContaining("read_private_dashboard_ranking"),
      expect.stringContaining("read_agent_account_dashboard"),
      expect.stringContaining("pause_agent_account"),
      expect.stringContaining("create_auth_challenge"),
      expect.stringContaining("reactivate_agent_account"),
      expect.stringContaining("unlink_agent_account"),
      expect.stringContaining("revoke_device_key"),
      expect.stringContaining("revoke_connector_installation"),
      expect.stringContaining("set_provider_breakdown_visibility"),
    ]);
    expect(snapshots[2]?.values).toEqual([sessionId, sessionDigest, targetIds[0]]);
    expect(snapshots[3]?.values).toEqual([
      sessionId,
      sessionDigest,
      challengeId,
      "account_unlink",
      challengeDigest,
      contextDigest,
      "2026-07-16T10:05:00.000Z",
    ]);
    for (const [index, targetId] of targetIds.entries()) {
      expect(snapshots[index + 4]?.values).toEqual([
        sessionId,
        sessionDigest,
        challengeId,
        contextDigest,
        passkeyId,
        4,
        false,
        targetId,
      ]);
    }
    expect(snapshots[8]?.values).toEqual([sessionId, sessionDigest, true]);
    for (const query of liveQueries) {
      for (const value of query.values) {
        if (Buffer.isBuffer(value)) {
          expect(value).toEqual(Buffer.alloc(value.length));
        }
      }
    }
  });

  it("composes recovery-code challenge consumption and replacement in one fixed statement", async () => {
    const returnedRows = [[{ created: true }], [{ replaced: true }]];
    const snapshots: { text: string; values: unknown[] }[] = [];
    const driverClient = {
      query(query: { text: string; values: unknown[] }): Promise<{ rows: unknown }> {
        snapshots.push({
          text: query.text,
          values: query.values.map((value) =>
            Buffer.isBuffer(value) ? Buffer.from(value) : value,
          ),
        });
        return Promise.resolve({ rows: returnedRows.shift() });
      },
      release: vi.fn(),
    };
    const pool = createPairingDatabasePool(config, undefined, () => ({
      connect: () => Promise.resolve(driverClient),
      end: () => Promise.resolve(),
      on() {
        return this;
      },
    }));
    const client = await pool.connect();
    const digest = Buffer.alloc(32, 0x61);
    const context = Buffer.alloc(32, 0x62);
    const recoveryCodeIds = Array.from(
      { length: 10 },
      (_, index) => `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    );
    const verifierPhcs = Array.from(
      { length: 10 },
      (_, index) =>
        `$argon2id$v=19$m=19456,t=2,p=2$${"A".repeat(22)}$${String(index)}${"B".repeat(42)}`,
    );

    await expect(
      client.createRecoveryCodeChallenge({
        challengeDigest: digest,
        challengeId: "00000000-0000-4000-8000-000000000701",
        contextDigest: context,
        expiresAt: "2026-07-16T10:05:00.000Z",
        sessionId: "00000000-0000-4000-8000-000000000702",
        sessionVerifierDigest: digest,
      }),
    ).resolves.toEqual([{ created: true }]);
    await expect(
      client.completeRecoveryCodeReplacement({
        backupState: true,
        batchId: "00000000-0000-4000-8000-000000000703",
        challengeId: "00000000-0000-4000-8000-000000000701",
        contextDigest: context,
        observedSignCount: 9,
        recoveryCodeIds,
        sessionId: "00000000-0000-4000-8000-000000000702",
        sessionVerifierDigest: digest,
        verifierPhcs,
        verifiedPasskeyId: "00000000-0000-4000-8000-000000000705",
      }),
    ).resolves.toEqual([{ replaced: true }]);

    expect(snapshots[0]?.text).toContain("create_auth_challenge");
    expect(snapshots[0]?.text).toContain("'recovery_change'::text");
    expect(snapshots[0]?.values).toEqual([
      "00000000-0000-4000-8000-000000000702",
      digest,
      "00000000-0000-4000-8000-000000000701",
      digest,
      context,
      "2026-07-16T10:05:00.000Z",
    ]);
    expect(snapshots[1]?.text).toContain("replace_recovery_codes");
    expect(snapshots[1]?.text).toContain("AS MATERIALIZED");
    expect(snapshots[1]?.values).toEqual([
      "00000000-0000-4000-8000-000000000702",
      digest,
      "00000000-0000-4000-8000-000000000701",
      context,
      "00000000-0000-4000-8000-000000000705",
      9,
      true,
      "00000000-0000-4000-8000-000000000703",
      recoveryCodeIds,
      verifierPhcs,
    ]);
  });

  it("uses only the fixed restricted-recovery lookup, start, and completion statements", async () => {
    const recoveryCodeId = "00000000-0000-4000-8000-000000000711";
    const returnedRows = [
      [{ recovery_code_id: recoveryCodeId, verifier_phc: "synthetic-phc" }],
      [{ started: true }],
      [
        {
          handle: "pixel_driver",
          locale: "en",
          profile_id: "00000000-0000-4000-8000-000000000712",
        },
      ],
    ];
    const snapshots: { text: string; values: unknown[] }[] = [];
    const driverClient = {
      query(query: { text: string; values: unknown[] }): Promise<{ rows: unknown }> {
        snapshots.push({
          text: query.text,
          values: query.values.map((value) =>
            Buffer.isBuffer(value) ? Buffer.from(value) : value,
          ),
        });
        return Promise.resolve({ rows: returnedRows.shift() });
      },
      release: vi.fn(),
    };
    const pool = createPairingDatabasePool(config, undefined, () => ({
      connect: () => Promise.resolve(driverClient),
      end: () => Promise.resolve(),
      on() {
        return this;
      },
    }));
    const client = await pool.connect();
    const authorityDigest = Buffer.alloc(32, 0x71);
    const challengeDigest = Buffer.alloc(32, 0x72);
    const contextDigest = Buffer.alloc(32, 0x73);
    const credentialId = Buffer.alloc(32, 0x74);
    const cosePublicKey = Buffer.alloc(77, 0x75);
    const sessionDigest = Buffer.alloc(32, 0x76);

    await expect(client.readRecoveryCodeVerificationMaterial(recoveryCodeId)).resolves.toEqual([
      { recovery_code_id: recoveryCodeId, verifier_phc: "synthetic-phc" },
    ]);
    await expect(
      client.startRecovery({
        authorityId: "00000000-0000-4000-8000-000000000714",
        authorityVerifierDigest: authorityDigest,
        challengeDigest,
        contextDigest,
        expiresAt: "2026-07-16T10:05:00.000Z",
        recoveryCodeId,
      }),
    ).resolves.toEqual([{ started: true }]);
    await expect(
      client.completeRecoveryRegistration({
        authorityId: "00000000-0000-4000-8000-000000000714",
        authorityVerifierDigest: authorityDigest,
        backupEligible: true,
        backupState: false,
        challengeDigest,
        contextDigest,
        cosePublicKey,
        credentialId,
        label: "Replacement passkey",
        passkeyId: "00000000-0000-4000-8000-000000000716",
        sessionExpiresAt: "2026-08-15T10:00:00.000Z",
        sessionId: "00000000-0000-4000-8000-000000000717",
        sessionVerifierDigest: sessionDigest,
        signCount: 0,
      }),
    ).resolves.toEqual([
      {
        handle: "pixel_driver",
        locale: "en",
        profile_id: "00000000-0000-4000-8000-000000000712",
      },
    ]);

    expect(snapshots).toHaveLength(3);
    expect(snapshots[0]?.text).toContain("read_recovery_code_verification_material");
    expect(snapshots[0]?.values).toEqual([recoveryCodeId]);
    expect(snapshots[1]?.text).toContain("start_recovery");
    expect(snapshots[1]?.text).toContain("AS MATERIALIZED");
    expect(snapshots[1]?.values).toEqual([
      recoveryCodeId,
      "00000000-0000-4000-8000-000000000714",
      authorityDigest,
      challengeDigest,
      contextDigest,
      "2026-07-16T10:05:00.000Z",
    ]);
    expect(snapshots[2]?.text).toContain("complete_recovery_registration_session");
    expect(snapshots[2]?.values).toEqual([
      "00000000-0000-4000-8000-000000000714",
      authorityDigest,
      challengeDigest,
      contextDigest,
      "00000000-0000-4000-8000-000000000716",
      credentialId,
      cosePublicKey,
      "Replacement passkey",
      0,
      true,
      false,
      "00000000-0000-4000-8000-000000000717",
      sessionDigest,
      "2026-08-15T10:00:00.000Z",
    ]);
  });

  it("reports idle-driver failures only through the stable non-reflective signal", () => {
    const privateValue = "private-driver-error-that-must-not-be-reflected";
    const signals: PairingDatabasePoolSignal[] = [];
    let listener: ((error: Error) => void) | undefined;
    const driverPool = {
      connect(): Promise<never> {
        return Promise.reject(new Error("not used"));
      },
      end(): Promise<void> {
        return Promise.resolve();
      },
      on(event: "error", received: (error: Error) => void) {
        expect(event).toBe("error");
        listener = received;
        return this;
      },
    };

    createPairingDatabasePool(
      config,
      (signal) => {
        signals.push(signal);
      },
      () => driverPool,
    );
    listener?.(new Error(privateValue));

    expect(signals).toEqual(["idle_client_error"]);
    expect(JSON.stringify(signals)).not.toContain(privateValue);
  });

  it("exposes only fixed enrollment, passkey, profile, and session procedures on the shared Web/Auth pool", async () => {
    const returnedRows = [
      [
        {
          created: true,
          handle: "pending_0000000000004000",
          locale: "en",
          profile_id: "00000000-0000-4000-8000-000000000302",
          profile_state: "enrolling",
          session_created: true,
        },
      ],
      [{ created: true }],
      [{ registered: true }],
      [
        {
          backup_eligible: true,
          backup_state: false,
          cose_public_key: Buffer.alloc(77),
          passkey_id: "00000000-0000-4000-8000-000000000306",
          sign_count: "1",
        },
      ],
      [
        {
          handle: "pixel_driver",
          locale: "en",
          profile_id: "00000000-0000-4000-8000-000000000302",
        },
      ],
      [
        {
          created_on: "2026-07-15",
          current_authenticator: true,
          label: "Primary passkey",
          passkey_id: "00000000-0000-4000-8000-000000000306",
          state: "active",
        },
      ],
      [{ visibility: "public" }],
      [{ created: true }],
      [{ added: true }],
      [{ created: true }],
      [{ revoked: true }],
      [{ created: true }],
      [{ deleted: true }],
      [{ visibility: "hidden" }],
      [{ revoked: true }],
    ];
    const liveQueries: { text: string; values: unknown[] }[] = [];
    const snapshots: { text: string; values: unknown[] }[] = [];
    const release = vi.fn();
    const driverClient = {
      query(query: { text: string; values: unknown[] }): Promise<{ rows: unknown }> {
        liveQueries.push(query);
        snapshots.push({
          text: query.text,
          values: query.values.map((value) =>
            Buffer.isBuffer(value) ? Buffer.from(value) : value,
          ),
        });
        return Promise.resolve({ rows: returnedRows.shift() });
      },
      release,
    };
    const pool = createPairingDatabasePool(config, undefined, () => ({
      connect: () => Promise.resolve(driverClient),
      end: () => Promise.resolve(),
      on() {
        return this;
      },
    }));
    const client = await pool.connect();
    const digest = Buffer.alloc(32, 0x51);
    const context = Buffer.alloc(32, 0x52);
    const credential = Buffer.alloc(32, 0x53);
    const publicKey = Buffer.alloc(77, 0x54);

    await expect(
      client.enrollProfile({
        githubUserId: 123,
        handle: "pending_0000000000004000",
        inviteId: "00000000-0000-4000-8000-000000000301",
        inviteRequired: true,
        inviteVerifierDigest: digest,
        locale: "en",
        profileId: "00000000-0000-4000-8000-000000000302",
        sessionExpiresAt: "2026-08-15T10:00:00.000Z",
        sessionId: "00000000-0000-4000-8000-000000000303",
        sessionVerifierDigest: digest,
      }),
    ).resolves.toEqual([
      {
        created: true,
        handle: "pending_0000000000004000",
        locale: "en",
        profile_id: "00000000-0000-4000-8000-000000000302",
        profile_state: "enrolling",
        session_created: true,
      },
    ]);
    await expect(
      client.createPasskeyChallenge({
        challengeDigest: digest,
        challengeId: "00000000-0000-4000-8000-000000000304",
        contextDigest: context,
        expiresAt: "2026-07-16T10:05:00.000Z",
        handle: "pixel_driver",
        sessionId: "00000000-0000-4000-8000-000000000303",
        sessionVerifierDigest: digest,
      }),
    ).resolves.toEqual([{ created: true }]);
    await expect(
      client.completeInitialPasskey({
        backupEligible: true,
        backupState: false,
        challengeId: "00000000-0000-4000-8000-000000000304",
        contextDigest: context,
        cosePublicKey: publicKey,
        credentialId: credential,
        handle: "pixel_driver",
        passkeyId: "00000000-0000-4000-8000-000000000306",
        rotatedSessionExpiresAt: "2026-08-15T10:00:00.000Z",
        rotatedSessionId: "00000000-0000-4000-8000-000000000308",
        rotatedSessionVerifierDigest: digest,
        sessionId: "00000000-0000-4000-8000-000000000303",
        sessionVerifierDigest: digest,
        signCount: 1,
      }),
    ).resolves.toEqual([{ registered: true }]);
    await expect(client.readPasskeyLoginMaterial(credential)).resolves.toEqual([
      {
        backup_eligible: true,
        backup_state: false,
        cose_public_key: Buffer.alloc(77),
        passkey_id: "00000000-0000-4000-8000-000000000306",
        sign_count: "1",
      },
    ]);
    await expect(
      client.completePasskeyLogin({
        backupState: false,
        challengeDigest: digest,
        challengeExpiresAt: "2026-07-16T10:05:00.000Z",
        challengeId: "00000000-0000-4000-8000-000000000310",
        contextDigest: context,
        credentialId: credential,
        observedSignCount: 2,
        passkeyId: "00000000-0000-4000-8000-000000000306",
        sessionExpiresAt: "2026-08-15T10:00:00.000Z",
        sessionId: "00000000-0000-4000-8000-000000000312",
        sessionVerifierDigest: digest,
      }),
    ).resolves.toEqual([
      {
        handle: "pixel_driver",
        locale: "en",
        profile_id: "00000000-0000-4000-8000-000000000302",
      },
    ]);
    await expect(
      client.readPasskeyInventory({
        sessionId: "00000000-0000-4000-8000-000000000312",
        sessionVerifierDigest: digest,
      }),
    ).resolves.toEqual([
      {
        created_on: "2026-07-15",
        current_authenticator: true,
        label: "Primary passkey",
        passkey_id: "00000000-0000-4000-8000-000000000306",
        state: "active",
      },
    ]);
    await expect(
      client.readProfileVisibility({
        sessionId: "00000000-0000-4000-8000-000000000312",
        sessionVerifierDigest: digest,
      }),
    ).resolves.toEqual([{ visibility: "public" }]);
    await expect(
      client.createPasskeyAddChallenge({
        challengeDigest: digest,
        challengeId: "00000000-0000-4000-8000-000000000313",
        contextDigest: context,
        expiresAt: "2026-07-16T10:05:00.000Z",
        sessionId: "00000000-0000-4000-8000-000000000312",
        sessionVerifierDigest: digest,
      }),
    ).resolves.toEqual([{ created: true }]);
    await expect(
      client.completePasskeyAddition({
        backupEligible: true,
        backupState: false,
        challengeId: "00000000-0000-4000-8000-000000000313",
        contextDigest: context,
        cosePublicKey: publicKey,
        credentialId: credential,
        label: "Backup passkey",
        observedSignCount: 3,
        passkeyId: "00000000-0000-4000-8000-000000000314",
        sessionId: "00000000-0000-4000-8000-000000000312",
        sessionVerifierDigest: digest,
        signCount: 0,
        verifiedBackupState: false,
        verifiedPasskeyId: "00000000-0000-4000-8000-000000000306",
      }),
    ).resolves.toEqual([{ added: true }]);
    await expect(
      client.createPasskeyRevokeChallenge({
        challengeDigest: digest,
        challengeId: "00000000-0000-4000-8000-000000000316",
        contextDigest: context,
        expiresAt: "2026-07-16T10:05:00.000Z",
        sessionId: "00000000-0000-4000-8000-000000000312",
        sessionVerifierDigest: digest,
      }),
    ).resolves.toEqual([{ created: true }]);
    await expect(
      client.completePasskeyRevocation({
        backupState: false,
        challengeId: "00000000-0000-4000-8000-000000000316",
        contextDigest: context,
        observedSignCount: 3,
        sessionId: "00000000-0000-4000-8000-000000000312",
        sessionVerifierDigest: digest,
        targetPasskeyId: "00000000-0000-4000-8000-000000000307",
        verifiedPasskeyId: "00000000-0000-4000-8000-000000000306",
      }),
    ).resolves.toEqual([{ revoked: true }]);
    await expect(
      client.createProfileDeletionChallenge({
        challengeDigest: digest,
        challengeId: "00000000-0000-4000-8000-000000000318",
        contextDigest: context,
        expiresAt: "2026-07-16T10:05:00.000Z",
        sessionId: "00000000-0000-4000-8000-000000000312",
        sessionVerifierDigest: digest,
      }),
    ).resolves.toEqual([{ created: true }]);
    await expect(
      client.completeProfileDeletion({
        backupState: false,
        challengeId: "00000000-0000-4000-8000-000000000318",
        contextDigest: context,
        observedSignCount: 4,
        sessionId: "00000000-0000-4000-8000-000000000312",
        sessionVerifierDigest: digest,
        typedHandle: "pixel_driver",
        verifiedPasskeyId: "00000000-0000-4000-8000-000000000306",
      }),
    ).resolves.toEqual([{ deleted: true }]);
    await expect(
      client.setProfileVisibility({
        publiclyVisible: false,
        sessionId: "00000000-0000-4000-8000-000000000312",
        sessionVerifierDigest: digest,
      }),
    ).resolves.toEqual([{ visibility: "hidden" }]);
    await expect(
      client.revokeEnrollmentSession({
        sessionId: "00000000-0000-4000-8000-000000000303",
        sessionVerifierDigest: digest,
      }),
    ).resolves.toEqual([{ revoked: true }]);
    expect(snapshots.map(({ text }) => text)).toEqual([
      expect.stringContaining("open_github_profile"),
      expect.stringContaining("begin_initial_passkey"),
      expect.stringContaining("complete_initial_passkey"),
      expect.stringContaining("read_passkey_verification_material"),
      expect.stringContaining("complete_passkey_login_session"),
      expect.stringContaining("read_passkey_inventory"),
      expect.stringContaining("read_private_profile"),
      expect.stringContaining("create_auth_challenge"),
      expect.stringContaining("add_passkey"),
      expect.stringContaining("create_auth_challenge"),
      expect.stringContaining("revoke_passkey"),
      expect.stringContaining("create_auth_challenge"),
      expect.stringContaining("request_profile_deletion"),
      expect.stringContaining("set_profile_visibility"),
      expect.stringContaining("revoke_session"),
    ]);
    expect(snapshots[2]?.text).toContain("complete_initial_passkey");
    expect(snapshots[2]?.text).not.toContain("rotate_session");
    expect(snapshots[2]?.text).toContain("AS MATERIALIZED");
    expect(snapshots[8]?.text).toContain("add_passkey");
    expect(snapshots[8]?.text).toContain("AS MATERIALIZED");
    expect(snapshots[10]?.text).toContain("revoke_passkey");
    expect(snapshots[10]?.text).toContain("AS MATERIALIZED");
    expect(snapshots[12]?.text).toContain("request_profile_deletion");
    expect(snapshots[12]?.text).toContain("AS MATERIALIZED");
    expect(snapshots[4]?.values).toEqual([
      "00000000-0000-4000-8000-000000000310",
      digest,
      context,
      "2026-07-16T10:05:00.000Z",
      "00000000-0000-4000-8000-000000000306",
      credential,
      2,
      false,
      "00000000-0000-4000-8000-000000000312",
      digest,
      "2026-08-15T10:00:00.000Z",
    ]);
    expect(snapshots[5]?.values).toEqual(["00000000-0000-4000-8000-000000000312", digest]);
    expect(snapshots[6]?.values).toEqual(["00000000-0000-4000-8000-000000000312", digest]);
    expect(snapshots[7]?.values).toEqual([
      "00000000-0000-4000-8000-000000000312",
      digest,
      "00000000-0000-4000-8000-000000000313",
      digest,
      context,
      "2026-07-16T10:05:00.000Z",
    ]);
    expect(snapshots[8]?.values).toEqual([
      "00000000-0000-4000-8000-000000000312",
      digest,
      "00000000-0000-4000-8000-000000000313",
      context,
      "00000000-0000-4000-8000-000000000306",
      3,
      false,
      "00000000-0000-4000-8000-000000000314",
      credential,
      publicKey,
      "Backup passkey",
      0,
      true,
      false,
    ]);
    expect(snapshots[9]?.values).toEqual([
      "00000000-0000-4000-8000-000000000312",
      digest,
      "00000000-0000-4000-8000-000000000316",
      digest,
      context,
      "2026-07-16T10:05:00.000Z",
    ]);
    expect(snapshots[10]?.values).toEqual([
      "00000000-0000-4000-8000-000000000312",
      digest,
      "00000000-0000-4000-8000-000000000316",
      context,
      "00000000-0000-4000-8000-000000000306",
      3,
      false,
      "00000000-0000-4000-8000-000000000307",
    ]);
    expect(snapshots[11]?.values).toEqual([
      "00000000-0000-4000-8000-000000000312",
      digest,
      "00000000-0000-4000-8000-000000000318",
      digest,
      context,
      "2026-07-16T10:05:00.000Z",
    ]);
    expect(snapshots[12]?.values).toEqual([
      "00000000-0000-4000-8000-000000000312",
      digest,
      "00000000-0000-4000-8000-000000000318",
      context,
      "00000000-0000-4000-8000-000000000306",
      4,
      false,
      "pixel_driver",
    ]);
    expect(snapshots[13]?.values).toEqual([
      "00000000-0000-4000-8000-000000000312",
      digest,
      "hidden",
    ]);
    expect(snapshots[14]?.values).toEqual(["00000000-0000-4000-8000-000000000303", digest]);
    expect(digest).toEqual(Buffer.alloc(32, 0x51));
    expect(context).toEqual(Buffer.alloc(32, 0x52));
    expect(credential).toEqual(Buffer.alloc(32, 0x53));
    expect(publicKey).toEqual(Buffer.alloc(77, 0x54));
    for (const query of liveQueries) {
      for (const value of query.values) {
        if (Buffer.isBuffer(value)) {
          expect(value).toEqual(Buffer.alloc(value.length));
        }
      }
    }
  });

  it("uses only fixed CarRecipe statements and clears copied session proof", async () => {
    const liveQueries: { text: string; values: unknown[] }[] = [];
    const snapshots: { text: string; values: unknown[] }[] = [];
    const releases: boolean[] = [];
    const driverClient = {
      query(query: { text: string; values: unknown[] }): Promise<{ rows: unknown }> {
        liveQueries.push(query);
        snapshots.push({
          text: query.text,
          values: query.values.map((value) =>
            Buffer.isBuffer(value) ? Buffer.from(value) : value,
          ),
        });
        return Promise.resolve({ rows: [] });
      },
      release(destroy = false): void {
        releases.push(destroy);
      },
    };
    const driverPool = {
      connect: () => Promise.resolve(driverClient),
      end: () => Promise.resolve(),
      on() {
        return this;
      },
    };
    const pool = createPairingDatabasePool(config, undefined, () => driverPool);
    const client = await pool.connect();
    const digest = Buffer.alloc(32, 0x71);
    const request = {
      sessionId: "00000000-0000-4000-8000-000000000312",
      sessionVerifierDigest: digest,
    };
    const proposalId = "00000000-0000-4000-8000-000000000701";

    await client.proposeCarRecipe({
      ...request,
      expiresAt: "2026-07-17T11:00:00.000Z",
      proposalId,
      recipe: {
        schemaVersion: 1,
        chassis: "rally",
        nose: "scoop",
        cockpit: "rally",
        wing: "low",
        wheels: "all-terrain",
        palette: "sunburst",
        trail: "spark",
        seed: 42,
      },
    });
    await client.readCarRecipeState(request);
    await client.approveCarRecipe({ ...request, proposalId });
    await client.rejectCarRecipe({ ...request, proposalId });
    client.release();

    expect(snapshots).toHaveLength(4);
    expect(snapshots[0]?.text).toContain("viberacing_api.propose_car_recipe");
    expect(snapshots[0]?.values).toEqual([
      request.sessionId,
      digest,
      proposalId,
      1,
      "rally",
      "scoop",
      "rally",
      "low",
      "all-terrain",
      "sunburst",
      "spark",
      42,
      "2026-07-17T11:00:00.000Z",
    ]);
    expect(snapshots[1]?.text).toContain("viberacing_api.read_car_recipe_state");
    expect(snapshots[1]?.values).toEqual([request.sessionId, digest]);
    expect(snapshots[2]?.text).toContain("viberacing_api.approve_car_recipe");
    expect(snapshots[2]?.values).toEqual([request.sessionId, digest, proposalId]);
    expect(snapshots[3]?.text).toContain("viberacing_api.reject_car_recipe");
    expect(snapshots[3]?.values).toEqual([request.sessionId, digest, proposalId]);
    expect(digest).toEqual(Buffer.alloc(32, 0x71));
    for (const query of liveQueries) {
      expect(query.values[1]).toEqual(Buffer.alloc(32));
    }
    expect(releases).toEqual([false]);
  });

  it("binds the exact device proposal SQL and wipes only the query-owned nonce digest", async () => {
    const liveQueries: { text: string; values: unknown[] }[] = [];
    const snapshots: { text: string; values: unknown[] }[] = [];
    const driverClient = {
      query(query: { text: string; values: unknown[] }): Promise<{ rows: unknown }> {
        liveQueries.push(query);
        snapshots.push({
          text: query.text,
          values: query.values.map((value) =>
            Buffer.isBuffer(value) ? Buffer.from(value) : value,
          ),
        });
        return Promise.resolve({ rows: [] });
      },
      release: vi.fn(),
    };
    const driverPool = {
      connect: () => Promise.resolve(driverClient),
      end: () => Promise.resolve(),
      on() {
        return this;
      },
    };
    const pool = createPairingDatabasePool(config, undefined, () => driverPool);
    const client = await pool.connect();
    const nonceDigest = Buffer.alloc(32, 0x72);
    const deviceId = "dev_AAAAAAAAAAAAAAAAAAAAAA";
    const deviceKeyId = "00000000-0000-4000-8000-000000000801";

    await client.readCarProposalDeviceMaterial(deviceId);
    await client.proposeCarRecipeFromDevice({
      deviceId,
      deviceKeyId,
      nonceDigest,
      observedAt: "2026-07-17T12:34:56.789Z",
      proposalId: "00000000-0000-4000-8000-000000000802",
      recipe: {
        schemaVersion: 1,
        chassis: "formula",
        nose: "wedge",
        cockpit: "canopy",
        wing: "high",
        wheels: "slick",
        palette: "turbo-blue",
        trail: "spark",
        seed: 4242,
      },
    });

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]?.text).toContain("viberacing_api.read_car_proposal_device_material");
    expect(snapshots[0]?.values).toEqual([deviceId]);
    expect(snapshots[1]?.text).toContain("viberacing_api.propose_car_recipe_from_device");
    expect(snapshots[1]?.values).toEqual([
      deviceKeyId,
      deviceId,
      "2026-07-17T12:34:56.789Z",
      Buffer.alloc(32, 0x72),
      "00000000-0000-4000-8000-000000000802",
      1,
      "formula",
      "wedge",
      "canopy",
      "high",
      "slick",
      "turbo-blue",
      "spark",
      4242,
    ]);
    expect(nonceDigest).toEqual(Buffer.alloc(32, 0x72));
    expect(liveQueries[1]?.values[3]).toEqual(Buffer.alloc(32));
  });

  it("contains synchronous and asynchronous monitoring failures", async () => {
    const listeners: ((error: Error) => void)[] = [];
    const driverPool = {
      connect(): Promise<never> {
        return Promise.reject(new Error("not used"));
      },
      end(): Promise<void> {
        return Promise.resolve();
      },
      on(_event: "error", listener: (error: Error) => void) {
        listeners.push(listener);
        return this;
      },
    };
    const synchronous = vi.fn(() => {
      throw new Error("monitoring failure");
    });
    const asynchronous = vi.fn(() => Promise.reject(new Error("monitoring failure")));

    createPairingDatabasePool(config, synchronous, () => driverPool);
    createPairingDatabasePool(config, asynchronous, () => driverPool);

    expect(() => listeners[0]?.(new Error("driver failure"))).not.toThrow();
    listeners[1]?.(new Error("driver failure"));
    await expect(Promise.resolve()).resolves.toBeUndefined();
    expect(synchronous).toHaveBeenCalledWith("idle_client_error");
    expect(asynchronous).toHaveBeenCalledWith("idle_client_error");
  });
});

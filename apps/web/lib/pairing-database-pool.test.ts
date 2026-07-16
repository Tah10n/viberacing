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
  it("exposes only fixed probe, start, two-candidate lookup, activation, release, and close", async () => {
    const returnedRows = [[{ role_ok: true }], [], [{ activated: true }], [{ started: true }]];
    const liveQueries: { text: string; values: unknown[] }[] = [];
    const querySnapshots: { text: string; values: unknown[] }[] = [];
    const releases: boolean[] = [];
    let ended = false;
    const driverClient = {
      query(query: { text: string; values: unknown[] }): Promise<{ rows: unknown }> {
        liveQueries.push(query);
        querySnapshots.push({
          text: query.text,
          values: query.values.map((value) =>
            Buffer.isBuffer(value) ? Buffer.from(value) : value,
          ),
        });
        return Promise.resolve({ rows: returnedRows.shift() });
      },
      release(destroy = false): void {
        releases.push(destroy);
      },
    };
    const driverPool = {
      connect() {
        return Promise.resolve(driverClient);
      },
      end(): Promise<void> {
        ended = true;
        return Promise.resolve();
      },
      on() {
        return this;
      },
    };
    const pool = createPairingDatabasePool(config, undefined, (receivedConfig) => {
      expect(receivedConfig).toBe(config);
      return driverPool;
    });
    const client = await pool.connect();
    const firstDigest = Buffer.alloc(32, 0x11);
    const secondDigest = Buffer.alloc(32, 0x22);
    const activationDigest = Buffer.alloc(32, 0x33);
    const codeDigest = Buffer.alloc(32, 0x44);
    const challenge = Buffer.alloc(32, 0x55);
    const publicKey = Buffer.alloc(32, 0x66);

    await expect(client.verifyRuntimeBoundary()).resolves.toEqual([{ role_ok: true }]);
    await expect(client.readVerificationMaterial([firstDigest, secondDigest])).resolves.toEqual([]);
    await expect(
      client.activatePairing({
        auditEventId: "00000000-0000-4000-8000-000000000027",
        deviceId: "dev_AAAAAAAAAAAAAAAAAAAAAA",
        pairingId: "00000000-0000-4000-8000-000000000026",
        pollVerifierDigest: activationDigest,
        requestId: "req_AAAAAAAAAAAAAAAAAAAAAA",
      }),
    ).resolves.toEqual([{ activated: true }]);
    await expect(
      client.startPairing({
        architecture: "x86_64",
        connectorVersion: "0.0.0-test",
        deviceKeyId: "00000000-0000-4000-8000-000000000028",
        deviceLabel: "Synthetic device",
        expiresAt: "2026-07-16T08:00:00.000Z",
        osFamily: "windows",
        pairingChallenge: challenge,
        pairingId: "00000000-0000-4000-8000-000000000029",
        pollVerifierDigest: activationDigest,
        publicKey,
        userCodeDigest: codeDigest,
      }),
    ).resolves.toEqual([{ started: true }]);
    client.release();
    client.release(true);
    await pool.close();

    expect(querySnapshots).toHaveLength(4);
    expect(querySnapshots[0]?.text).toContain("CURRENT_USER = 'viberacing_web'");
    expect(querySnapshots[0]?.text).toContain("default_transaction_read_only') = 'off'");
    expect(querySnapshots[0]?.values).toEqual([]);
    expect(querySnapshots[1]?.text).toContain("VALUES");
    expect(querySnapshots[1]?.text).toContain("read_pairing_verification_material");
    expect(querySnapshots[1]?.values).toEqual([firstDigest, secondDigest]);
    expect(querySnapshots[2]?.text).toContain("activate_pairing");
    expect(querySnapshots[2]?.text).toContain("AS MATERIALIZED");
    expect(querySnapshots[2]?.values).toEqual([
      activationDigest,
      "00000000-0000-4000-8000-000000000026",
      "dev_AAAAAAAAAAAAAAAAAAAAAA",
      "00000000-0000-4000-8000-000000000027",
      "req_AAAAAAAAAAAAAAAAAAAAAA",
    ]);
    expect(querySnapshots[3]?.text).toContain("start_pairing");
    expect(querySnapshots[3]?.text).toContain("AS MATERIALIZED");
    expect(querySnapshots[3]?.values).toEqual([
      "00000000-0000-4000-8000-000000000029",
      activationDigest,
      codeDigest,
      challenge,
      "00000000-0000-4000-8000-000000000028",
      publicKey,
      "Synthetic device",
      "0.0.0-test",
      "windows",
      "x86_64",
      "2026-07-16T08:00:00.000Z",
    ]);
    expect(firstDigest).toEqual(Buffer.alloc(32, 0x11));
    expect(secondDigest).toEqual(Buffer.alloc(32, 0x22));
    expect(activationDigest).toEqual(Buffer.alloc(32, 0x33));
    expect(codeDigest).toEqual(Buffer.alloc(32, 0x44));
    expect(challenge).toEqual(Buffer.alloc(32, 0x55));
    expect(publicKey).toEqual(Buffer.alloc(32, 0x66));
    expect(liveQueries[1]?.values).toEqual([Buffer.alloc(32), Buffer.alloc(32)]);
    expect(liveQueries[2]?.values[0]).toEqual(Buffer.alloc(32));
    expect(liveQueries[3]?.values.slice(1, 4)).toEqual([
      Buffer.alloc(32),
      Buffer.alloc(32),
      Buffer.alloc(32),
    ]);
    expect(liveQueries[3]?.values[5]).toEqual(Buffer.alloc(32));
    expect(releases).toEqual([false, true]);
    expect(ended).toBe(true);
    expect(Object.isFrozen(client)).toBe(true);
    expect(Object.isFrozen(pool)).toBe(true);
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
      [{ enrolled: true }],
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
      [
        {
          activated_on: "2026-07-14",
          architecture: "x86_64",
          connector_version: "1.2.3",
          device_id: `dev_${"A".repeat(22)}`,
          device_label: "Studio PC",
          device_state: "active",
          os_family: "windows",
          source_id: `src_${"B".repeat(22)}`,
          source_state: "active",
        },
      ],
      [{ revoked: true }],
      [{ paused: true }],
      [{ created: true }],
      [{ reactivated: true }],
      [{ created: true }],
      [{ unlinked: true }],
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
        auditEventId: "00000000-0000-4000-8000-000000000305",
        githubUserId: 123,
        handle: "pixel_driver",
        inviteId: "00000000-0000-4000-8000-000000000301",
        inviteVerifierDigest: digest,
        locale: "en",
        motionPreference: "system",
        profileId: "00000000-0000-4000-8000-000000000302",
        requestId: "req_AAAAAAAAAAAAAAAAAAAAAA",
        sessionExpiresAt: "2026-08-15T10:00:00.000Z",
        sessionId: "00000000-0000-4000-8000-000000000303",
        sessionVerifierDigest: digest,
        streakVisible: false,
        theme: "neon-night",
      }),
    ).resolves.toEqual([{ enrolled: true }]);
    await expect(
      client.createPasskeyChallenge({
        challengeDigest: digest,
        challengeId: "00000000-0000-4000-8000-000000000304",
        contextDigest: context,
        expiresAt: "2026-07-16T10:05:00.000Z",
        sessionId: "00000000-0000-4000-8000-000000000303",
        sessionVerifierDigest: digest,
      }),
    ).resolves.toEqual([{ created: true }]);
    await expect(
      client.completeInitialPasskey({
        auditEventId: "00000000-0000-4000-8000-000000000305",
        backupEligible: true,
        backupState: false,
        challengeDigest: digest,
        challengeId: "00000000-0000-4000-8000-000000000304",
        contextDigest: context,
        cosePublicKey: publicKey,
        credentialId: credential,
        label: "Primary passkey",
        passkeyId: "00000000-0000-4000-8000-000000000306",
        requestId: "req_AAAAAAAAAAAAAAAAAAAAAA",
        rotatedSessionExpiresAt: "2026-08-15T10:00:00.000Z",
        rotatedSessionId: "00000000-0000-4000-8000-000000000308",
        rotatedSessionVerifierDigest: digest,
        rotationAuditEventId: "00000000-0000-4000-8000-000000000309",
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
        auditEventId: "00000000-0000-4000-8000-000000000311",
        backupState: false,
        challengeDigest: digest,
        challengeExpiresAt: "2026-07-16T10:05:00.000Z",
        challengeId: "00000000-0000-4000-8000-000000000310",
        contextDigest: context,
        credentialId: credential,
        observedSignCount: 2,
        passkeyId: "00000000-0000-4000-8000-000000000306",
        requestId: "req_AAAAAAAAAAAAAAAAAAAAAA",
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
        auditEventId: "00000000-0000-4000-8000-000000000315",
        backupEligible: true,
        backupState: false,
        challengeDigest: digest,
        challengeId: "00000000-0000-4000-8000-000000000313",
        contextDigest: context,
        cosePublicKey: publicKey,
        credentialId: credential,
        label: "Backup passkey",
        observedSignCount: 3,
        passkeyId: "00000000-0000-4000-8000-000000000314",
        requestId: "req_AAAAAAAAAAAAAAAAAAAAAA",
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
        targetPasskeyId: "00000000-0000-4000-8000-000000000307",
      }),
    ).resolves.toEqual([{ created: true }]);
    await expect(
      client.completePasskeyRevocation({
        auditEventId: "00000000-0000-4000-8000-000000000317",
        backupState: false,
        challengeDigest: digest,
        challengeId: "00000000-0000-4000-8000-000000000316",
        contextDigest: context,
        observedSignCount: 3,
        requestId: "req_AAAAAAAAAAAAAAAAAAAAAA",
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
        auditEventId: "00000000-0000-4000-8000-000000000320",
        backupState: false,
        challengeDigest: digest,
        challengeId: "00000000-0000-4000-8000-000000000318",
        contextDigest: context,
        deletionJobId: "00000000-0000-4000-8000-000000000319",
        observedSignCount: 4,
        profileRefDigest: digest,
        requestId: "req_AAAAAAAAAAAAAAAAAAAAAA",
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
        auditEventId: "00000000-0000-4000-8000-000000000307",
        requestId: "req_AAAAAAAAAAAAAAAAAAAAAA",
        sessionId: "00000000-0000-4000-8000-000000000303",
        sessionVerifierDigest: digest,
      }),
    ).resolves.toEqual([{ revoked: true }]);
    await expect(
      client.readActiveDeviceInventory({
        sessionId: "00000000-0000-4000-8000-000000000312",
        sessionVerifierDigest: digest,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        device_id: `dev_${"A".repeat(22)}`,
        device_label: "Studio PC",
      }),
    ]);
    await expect(
      client.revokeDevice({
        auditEventId: "00000000-0000-4000-8000-000000000321",
        deviceId: `dev_${"A".repeat(22)}`,
        requestId: "req_AAAAAAAAAAAAAAAAAAAAAA",
        sessionId: "00000000-0000-4000-8000-000000000312",
        sessionVerifierDigest: digest,
      }),
    ).resolves.toEqual([{ revoked: true }]);
    await expect(
      client.pauseSource({
        auditEventId: "00000000-0000-4000-8000-000000000322",
        requestId: "req_AAAAAAAAAAAAAAAAAAAAAA",
        sessionId: "00000000-0000-4000-8000-000000000312",
        sessionVerifierDigest: digest,
        sourceId: `src_${"B".repeat(22)}`,
      }),
    ).resolves.toEqual([{ paused: true }]);
    await expect(
      client.createSourceReactivationChallenge({
        challengeDigest: digest,
        challengeId: "00000000-0000-4000-8000-000000000323",
        contextDigest: context,
        expiresAt: "2026-07-16T10:05:00.000Z",
        sessionId: "00000000-0000-4000-8000-000000000312",
        sessionVerifierDigest: digest,
        sourceId: `src_${"B".repeat(22)}`,
      }),
    ).resolves.toEqual([{ created: true }]);
    await expect(
      client.completeSourceReactivation({
        auditEventId: "00000000-0000-4000-8000-000000000324",
        backupState: false,
        challengeDigest: digest,
        challengeId: "00000000-0000-4000-8000-000000000323",
        contextDigest: context,
        observedSignCount: 5,
        requestId: "req_AAAAAAAAAAAAAAAAAAAAAA",
        sessionId: "00000000-0000-4000-8000-000000000312",
        sessionVerifierDigest: digest,
        sourceId: `src_${"B".repeat(22)}`,
        verifiedPasskeyId: "00000000-0000-4000-8000-000000000306",
      }),
    ).resolves.toEqual([{ reactivated: true }]);
    await expect(
      client.createSourceUnlinkChallenge({
        challengeDigest: digest,
        challengeId: "00000000-0000-4000-8000-000000000325",
        contextDigest: context,
        expiresAt: "2026-07-16T10:05:00.000Z",
        sessionId: "00000000-0000-4000-8000-000000000312",
        sessionVerifierDigest: digest,
        sourceId: `src_${"B".repeat(22)}`,
      }),
    ).resolves.toEqual([{ created: true }]);
    await expect(
      client.completeSourceUnlink({
        auditEventId: "00000000-0000-4000-8000-000000000326",
        backupState: false,
        challengeDigest: digest,
        challengeId: "00000000-0000-4000-8000-000000000325",
        contextDigest: context,
        observedSignCount: 6,
        requestId: "req_AAAAAAAAAAAAAAAAAAAAAA",
        sessionId: "00000000-0000-4000-8000-000000000312",
        sessionVerifierDigest: digest,
        sourceId: `src_${"B".repeat(22)}`,
        verifiedPasskeyId: "00000000-0000-4000-8000-000000000306",
      }),
    ).resolves.toEqual([{ unlinked: true }]);

    expect(snapshots.map(({ text }) => text)).toEqual([
      expect.stringContaining("enroll_profile"),
      expect.stringContaining("create_auth_challenge"),
      expect.stringContaining("consume_auth_challenge"),
      expect.stringContaining("read_passkey_verification_material"),
      expect.stringContaining("complete_passkey_login_session"),
      expect.stringContaining("read_passkey_inventory"),
      expect.stringContaining("read_profile_visibility"),
      expect.stringContaining("create_passkey_change_challenge"),
      expect.stringContaining("consume_passkey_challenge"),
      expect.stringContaining("create_passkey_change_challenge"),
      expect.stringContaining("consume_passkey_challenge"),
      expect.stringContaining("create_auth_challenge"),
      expect.stringContaining("consume_passkey_challenge"),
      expect.stringContaining("set_profile_visibility"),
      expect.stringContaining("revoke_session"),
      expect.stringContaining("read_source_inventory"),
      expect.stringContaining("revoke_device"),
      expect.stringContaining("pause_source"),
      expect.stringContaining("create_source_action_challenge"),
      expect.stringContaining("reactivate_source"),
      expect.stringContaining("create_source_action_challenge"),
      expect.stringContaining("unlink_source"),
    ]);
    expect(snapshots[2]?.text).toContain("register_initial_passkey");
    expect(snapshots[2]?.text).toContain("rotate_session");
    expect(snapshots[2]?.text).toContain("AS MATERIALIZED");
    expect(snapshots[8]?.text).toContain("add_passkey");
    expect(snapshots[8]?.text).toContain("AS MATERIALIZED");
    expect(snapshots[10]?.text).toContain("revoke_passkey");
    expect(snapshots[10]?.text).toContain("AS MATERIALIZED");
    expect(snapshots[12]?.text).toContain("request_profile_deletion");
    expect(snapshots[12]?.text).toContain("AS MATERIALIZED");
    expect(snapshots[15]?.text).toContain("LIMIT 96");
    expect(snapshots[15]?.text).toContain("device_state = 'active'");
    expect(snapshots[15]?.text).toContain("sources_without_active_devices");
    expect(snapshots[15]?.text).not.toContain("public_key");
    expect(snapshots[15]?.text).not.toContain("device_key_id");
    expect(snapshots[16]?.text).toContain("AS MATERIALIZED");
    expect(snapshots[17]?.text).toContain("AS MATERIALIZED");
    expect(snapshots[18]?.text).toContain("'source_reactivation'::text");
    expect(snapshots[19]?.text).toContain("consume_passkey_challenge");
    expect(snapshots[19]?.text).toContain("reactivate_source");
    expect(snapshots[20]?.text).toContain("'source_unlink'::text");
    expect(snapshots[21]?.text).toContain("consume_passkey_challenge");
    expect(snapshots[21]?.text).toContain("unlink_source");
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
      "00000000-0000-4000-8000-000000000311",
      "req_AAAAAAAAAAAAAAAAAAAAAA",
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
      digest,
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
      "00000000-0000-4000-8000-000000000315",
      "req_AAAAAAAAAAAAAAAAAAAAAA",
    ]);
    expect(snapshots[9]?.values).toEqual([
      "00000000-0000-4000-8000-000000000312",
      digest,
      "00000000-0000-4000-8000-000000000307",
      "00000000-0000-4000-8000-000000000316",
      digest,
      context,
      "2026-07-16T10:05:00.000Z",
    ]);
    expect(snapshots[10]?.values).toEqual([
      "00000000-0000-4000-8000-000000000312",
      digest,
      "00000000-0000-4000-8000-000000000316",
      digest,
      context,
      "00000000-0000-4000-8000-000000000306",
      3,
      false,
      "00000000-0000-4000-8000-000000000307",
      "00000000-0000-4000-8000-000000000317",
      "req_AAAAAAAAAAAAAAAAAAAAAA",
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
      digest,
      context,
      "00000000-0000-4000-8000-000000000306",
      4,
      false,
      "pixel_driver",
      "00000000-0000-4000-8000-000000000319",
      digest,
      "00000000-0000-4000-8000-000000000320",
      "req_AAAAAAAAAAAAAAAAAAAAAA",
    ]);
    expect(snapshots[13]?.values).toEqual(["00000000-0000-4000-8000-000000000312", digest, false]);
    expect(snapshots[15]?.values).toEqual(["00000000-0000-4000-8000-000000000312", digest]);
    expect(snapshots[16]?.values).toEqual([
      "00000000-0000-4000-8000-000000000312",
      digest,
      `dev_${"A".repeat(22)}`,
      "00000000-0000-4000-8000-000000000321",
      "req_AAAAAAAAAAAAAAAAAAAAAA",
    ]);
    expect(snapshots[17]?.values).toEqual([
      "00000000-0000-4000-8000-000000000312",
      digest,
      `src_${"B".repeat(22)}`,
      "00000000-0000-4000-8000-000000000322",
      "req_AAAAAAAAAAAAAAAAAAAAAA",
    ]);
    expect(snapshots[18]?.values).toEqual([
      "00000000-0000-4000-8000-000000000312",
      digest,
      `src_${"B".repeat(22)}`,
      "00000000-0000-4000-8000-000000000323",
      digest,
      context,
      "2026-07-16T10:05:00.000Z",
    ]);
    expect(snapshots[19]?.values).toEqual([
      "00000000-0000-4000-8000-000000000312",
      digest,
      "00000000-0000-4000-8000-000000000323",
      digest,
      context,
      "00000000-0000-4000-8000-000000000306",
      5,
      false,
      `src_${"B".repeat(22)}`,
      "00000000-0000-4000-8000-000000000324",
      "req_AAAAAAAAAAAAAAAAAAAAAA",
    ]);
    expect(snapshots[20]?.values).toEqual([
      "00000000-0000-4000-8000-000000000312",
      digest,
      `src_${"B".repeat(22)}`,
      "00000000-0000-4000-8000-000000000325",
      digest,
      context,
      "2026-07-16T10:05:00.000Z",
    ]);
    expect(snapshots[21]?.values).toEqual([
      "00000000-0000-4000-8000-000000000312",
      digest,
      "00000000-0000-4000-8000-000000000325",
      digest,
      context,
      "00000000-0000-4000-8000-000000000306",
      6,
      false,
      `src_${"B".repeat(22)}`,
      "00000000-0000-4000-8000-000000000326",
      "req_AAAAAAAAAAAAAAAAAAAAAA",
    ]);
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

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

  it("exposes only fixed enrollment, passkey, and session procedures on the shared Web/Auth pool", async () => {
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
      client.revokeEnrollmentSession({
        auditEventId: "00000000-0000-4000-8000-000000000307",
        requestId: "req_AAAAAAAAAAAAAAAAAAAAAA",
        sessionId: "00000000-0000-4000-8000-000000000303",
        sessionVerifierDigest: digest,
      }),
    ).resolves.toEqual([{ revoked: true }]);

    expect(snapshots.map(({ text }) => text)).toEqual([
      expect.stringContaining("enroll_profile"),
      expect.stringContaining("create_auth_challenge"),
      expect.stringContaining("consume_auth_challenge"),
      expect.stringContaining("read_passkey_verification_material"),
      expect.stringContaining("complete_passkey_login_session"),
      expect.stringContaining("read_passkey_inventory"),
      expect.stringContaining("revoke_session"),
    ]);
    expect(snapshots[2]?.text).toContain("register_initial_passkey");
    expect(snapshots[2]?.text).toContain("rotate_session");
    expect(snapshots[2]?.text).toContain("AS MATERIALIZED");
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

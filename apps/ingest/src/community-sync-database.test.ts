import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CommunitySyncDatabaseError,
  createCloseableCommunitySyncDatabase,
  createCommunitySyncDatabase,
  createConfiguredCommunitySyncDatabase,
  type CommunitySyncDatabaseErrorCode,
  type PublicIdFactory,
} from "./community-sync-database.js";
import type {
  IngestDatabaseClient,
  IngestDatabasePool,
  IngestDatabaseUsageSubmission,
} from "./database-pool.js";
import { usageSyncRequestTarget } from "./protocol.js";

const deviceId = "dev_AAAAAAAAAAAAAAAAAAAAAA";
const agentAccountId = "acc_BBBBBBBBBBBBBBBBBBBBBB";
const deviceKeyId = "key_CCCCCCCCCCCCCCCCCCCCCC";
const installationId = "ins_DDDDDDDDDDDDDDDDDDDDDD";
const syncId = "syn_EEEEEEEEEEEEEEEEEEEEEE";
const observationId = "obs_FFFFFFFFFFFFFFFFFFFFFF";
const eventId = "evt_GGGGGGGGGGGGGGGGGGGGGG";
const originExpiryMilliseconds = Date.parse("2026-07-15T12:01:00.000Z");
const runtimeBoundary = [{ role_ok: true, login_scope_ok: true, search_path_ok: true }];
const deviceRow = {
  accounting_revision: 1,
  agent_account_id: agentAccountId,
  device_id: deviceId,
  device_key_id: deviceKeyId,
  identity_assurance: "community_local",
  installation_id: installationId,
  maximum_backfill_days: 31,
  provider_code: "codex",
  public_key: Buffer.alloc(32, 7),
  reader_version: "codex_daily_usage_buckets_v1",
  scope_kind: "agent_account",
};
const explicitEnvironment = {
  NODE_ENV: "test",
  VIBERACING_INGEST_DATABASE_HOST: "127.0.0.1",
  VIBERACING_INGEST_DATABASE_NAME: "viberacing_local",
  VIBERACING_INGEST_DATABASE_PASSWORD: "synthetic-ingest-password",
  VIBERACING_INGEST_DATABASE_PORT: "54329",
  VIBERACING_INGEST_DATABASE_TLS_MODE: "disable",
  VIBERACING_INGEST_DATABASE_USER: "viberacing_ingest_login",
} as const;

const fixedIdFactory: PublicIdFactory = (prefix) => (prefix === "obs" ? observationId : eventId);

function verifiedSubmission(): Record<string, unknown> {
  return {
    accountingRevision: 1,
    agentAccountId,
    bodyDigestHex: "11".repeat(32),
    deviceNonceDigestHex: "22".repeat(32),
    deviceId,
    deviceKeyId,
    idempotencyKey: syncId,
    originExpiresAtMilliseconds: originExpiryMilliseconds,
    originKeyId: "edge_primary",
    originNonceDigestHex: "33".repeat(32),
    payload: {
      agentAccountId,
      clientVersion: "1.2.3",
      dailyEntries: [
        { dailyTokenTotal: "42", usageDate: "2026-07-13" },
        { dailyTokenTotal: "9007199254740993", usageDate: "2026-07-14" },
      ],
      observedAt: "2026-07-15T12:00:00.000Z",
      readerVersion: "codex_daily_usage_buckets_v1",
      schemaVersion: 1,
      syncId,
    },
    provider: "codex",
    readerVersion: "codex_daily_usage_buckets_v1",
    requestTarget: usageSyncRequestTarget,
    signatureBase64Url: Buffer.alloc(64, 3).toString("base64url"),
    scopeKind: "agent_account",
  };
}

interface FixtureOptions {
  readonly deviceRows?: unknown;
  readonly runtimeRows?: unknown;
  readonly submissionRows?: unknown;
}

function createFixture(options: FixtureOptions = {}): Readonly<{
  client: IngestDatabaseClient;
  close: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  pool: IngestDatabasePool;
  readDevice: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  submit: ReturnType<typeof vi.fn>;
  verifyBoundary: ReturnType<typeof vi.fn>;
}> {
  const readDevice = vi.fn(() =>
    Promise.resolve(Object.hasOwn(options, "deviceRows") ? options.deviceRows : [deviceRow]),
  );
  const submit = vi.fn(() =>
    Promise.resolve(
      Object.hasOwn(options, "submissionRows")
        ? options.submissionRows
        : [{ accepted_entries: 2, outcome: "accepted", recovery_action: null }],
    ),
  );
  const verifyBoundary = vi.fn(() =>
    Promise.resolve(Object.hasOwn(options, "runtimeRows") ? options.runtimeRows : runtimeBoundary),
  );
  const release = vi.fn();
  const client: IngestDatabaseClient = {
    readDeviceVerificationMaterial: readDevice,
    release,
    submitUsageSync: submit,
    verifyRuntimeBoundary: verifyBoundary,
  };
  const connect = vi.fn(() => Promise.resolve(client));
  const close = vi.fn(() => Promise.resolve());
  return Object.freeze({
    client,
    close,
    connect,
    pool: Object.freeze({ close, connect }),
    readDevice,
    release,
    submit,
    verifyBoundary,
  });
}

async function expectDatabaseError(
  operation: Promise<unknown>,
  code: CommunitySyncDatabaseErrorCode,
): Promise<void> {
  await expect(operation).rejects.toMatchObject({
    code,
    message: "Community sync database operation failed.",
    name: "CommunitySyncDatabaseError",
  });
  await expect(operation).rejects.toBeInstanceOf(CommunitySyncDatabaseError);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Community sync database adapter", () => {
  it("maps one exact device row into copied, frozen server-derived material", async () => {
    const fixture = createFixture();
    const database = createCommunitySyncDatabase(fixture.pool, fixedIdFactory);

    const material = await database.readDeviceVerificationMaterial(deviceId);

    expect(material).toEqual({
      accountingRevision: 1,
      agentAccountId,
      deviceKeyId,
      identityAssurance: "community_local",
      installationId,
      maximumBackfillDays: 31,
      provider: "codex",
      publicKey: Buffer.alloc(32, 7),
      readerVersion: "codex_daily_usage_buckets_v1",
      scopeKind: "agent_account",
    });
    expect(Object.isFrozen(material)).toBe(true);
    expect(material?.publicKey).not.toBe(deviceRow.public_key);
    expect(fixture.readDevice).toHaveBeenCalledWith(deviceId);
    expect(fixture.verifyBoundary).toHaveBeenCalledOnce();
    expect(fixture.release).toHaveBeenCalledWith(false);
  });

  it("returns null only for the exact empty device result", async () => {
    const fixture = createFixture({ deviceRows: [] });
    await expect(
      createCommunitySyncDatabase(fixture.pool, fixedIdFactory).readDeviceVerificationMaterial(
        deviceId,
      ),
    ).resolves.toBeNull();
    expect(fixture.release).toHaveBeenCalledWith(false);
  });

  it("maps a verified payload into one atomic submission without Number coercion", async () => {
    const fixture = createFixture();
    const database = createCommunitySyncDatabase(fixture.pool, fixedIdFactory);

    const result = await database.submit(verifiedSubmission());

    expect(result).toEqual({ acceptedEntries: 2, outcome: "accepted" });
    expect(Object.isFrozen(result)).toBe(true);
    const mapped = fixture.submit.mock.calls[0]![0] as IngestDatabaseUsageSubmission;
    expect(mapped).toMatchObject({
      agentAccountId,
      clientVersion: "1.2.3",
      dailyTokenTotals: ["42", "9007199254740993"],
      deviceId,
      deviceKeyId,
      eventId,
      observationId,
      observedAt: "2026-07-15T12:00:00.000Z",
      originExpiresAt: "2026-07-15T12:01:00.000Z",
      originKeyId: "edge_primary",
      readerVersion: "codex_daily_usage_buckets_v1",
      syncId,
      usageDates: ["2026-07-13", "2026-07-14"],
    });
    expect(mapped.bodyDigest).toEqual(Buffer.alloc(32, 0x11));
    expect(mapped.deviceNonceDigest).toEqual(Buffer.alloc(32, 0x22));
    expect(mapped.originNonceDigest).toEqual(Buffer.alloc(32, 0x33));
    expect(mapped.signature).toEqual(Buffer.alloc(64, 3));
    expect(Object.isFrozen(mapped)).toBe(true);
    expect(Object.isFrozen(mapped.usageDates)).toBe(true);
    expect(Object.isFrozen(mapped.dailyTokenTotals)).toBe(true);
    expect(fixture.release).toHaveBeenCalledWith(false);
  });

  it.each([
    [
      { accepted_entries: 1, outcome: "accepted", recovery_action: null },
      { acceptedEntries: 1, outcome: "accepted" },
    ],
    [
      { accepted_entries: 0, outcome: "duplicate", recovery_action: null },
      { acceptedEntries: 0, outcome: "duplicate" },
    ],
    [
      {
        accepted_entries: 0,
        outcome: "quarantined",
        recovery_action: "contact_support",
      },
      {
        acceptedEntries: 0,
        outcome: "quarantined",
        recoveryAction: "contact_support",
      },
    ],
  ] as const)("maps a closed procedure result", async (row, expected) => {
    const fixture = createFixture({ submissionRows: [row] });
    await expect(
      createCommunitySyncDatabase(fixture.pool, fixedIdFactory).submit(verifiedSubmission()),
    ).resolves.toEqual(expected);
  });

  it("generates separate canonical observation and event identifiers by default", async () => {
    const fixture = createFixture();
    await createCommunitySyncDatabase(fixture.pool).submit(verifiedSubmission());
    const mapped = fixture.submit.mock.calls[0]![0] as IngestDatabaseUsageSubmission;
    expect(mapped.observationId).toMatch(/^obs_[A-Za-z0-9_-]{22}$/);
    expect(mapped.eventId).toMatch(/^evt_[A-Za-z0-9_-]{22}$/);
  });

  it.each([
    null,
    [],
    { ...verifiedSubmission(), extra: true },
    { ...verifiedSubmission(), accountingRevision: 0 },
    { ...verifiedSubmission(), agentAccountId: "acc_short" },
    { ...verifiedSubmission(), bodyDigestHex: "AA".repeat(32) },
    { ...verifiedSubmission(), bodyDigestHex: "11".repeat(31) },
    { ...verifiedSubmission(), deviceNonceDigestHex: "zz".repeat(32) },
    { ...verifiedSubmission(), deviceId: "invalid" },
    { ...verifiedSubmission(), deviceKeyId: "key_short" },
    { ...verifiedSubmission(), idempotencyKey: "invalid" },
    { ...verifiedSubmission(), idempotencyKey: "syn_ZZZZZZZZZZZZZZZZZZZZZZ" },
    { ...verifiedSubmission(), originExpiresAtMilliseconds: "invalid" },
    { ...verifiedSubmission(), originExpiresAtMilliseconds: Number.MAX_SAFE_INTEGER },
    { ...verifiedSubmission(), originKeyId: "primary" },
    { ...verifiedSubmission(), originNonceDigestHex: "33".repeat(31) },
    { ...verifiedSubmission(), provider: "CODEX" },
    { ...verifiedSubmission(), readerVersion: "../reader" },
    { ...verifiedSubmission(), requestTarget: "/v1/private" },
    { ...verifiedSubmission(), scopeKind: "profile" },
    { ...verifiedSubmission(), signatureBase64Url: "invalid" },
    { ...verifiedSubmission(), signatureBase64Url: 42 },
    { ...verifiedSubmission(), payload: null },
    {
      ...verifiedSubmission(),
      payload: { ...(verifiedSubmission().payload as object), extra: true },
    },
    {
      ...verifiedSubmission(),
      payload: {
        ...(verifiedSubmission().payload as object),
        agentAccountId: "acc_ZZZZZZZZZZZZZZZZZZZZZZ",
      },
    },
    {
      ...verifiedSubmission(),
      payload: {
        ...(verifiedSubmission().payload as object),
        readerVersion: "other_reader_v1",
      },
    },
    {
      ...verifiedSubmission(),
      payload: { ...(verifiedSubmission().payload as object), schemaVersion: 2 },
    },
    {
      ...verifiedSubmission(),
      payload: { ...(verifiedSubmission().payload as object), dailyEntries: [] },
    },
    {
      ...verifiedSubmission(),
      payload: { ...(verifiedSubmission().payload as object), dailyEntries: [null] },
    },
    {
      ...verifiedSubmission(),
      payload: {
        ...(verifiedSubmission().payload as object),
        dailyEntries: [{ usageDate: "2026-07-13", dailyTokenTotal: "42", extra: true }],
      },
    },
    {
      ...verifiedSubmission(),
      payload: {
        ...(verifiedSubmission().payload as object),
        dailyEntries: [{ usageDate: "2026-07-13", dailyTokenTotal: "0042" }],
      },
    },
  ])("rejects malformed verified input before acquiring a connection", async (input) => {
    const fixture = createFixture();
    await expectDatabaseError(
      createCommunitySyncDatabase(fixture.pool, fixedIdFactory).submit(input),
      "input_invalid",
    );
    expect(fixture.connect).not.toHaveBeenCalled();
  });

  it("rejects accessors, proxies, sparse, decorated, and exotic entry arrays", async () => {
    const accessor = verifiedSubmission();
    Object.defineProperty(accessor, "bodyDigestHex", {
      enumerable: true,
      get() {
        throw new Error("must not execute");
      },
    });
    const trapped = new Proxy(verifiedSubmission(), {
      ownKeys() {
        throw new Error("must not escape");
      },
    });
    const sparse = verifiedSubmission();
    (sparse.payload as { dailyEntries: unknown[] }).dailyEntries = new Array(1);
    const decorated = verifiedSubmission();
    const decoratedEntries = [{ usageDate: "2026-07-13", dailyTokenTotal: "42" }];
    Object.assign(decoratedEntries, { extra: true });
    (decorated.payload as { dailyEntries: unknown[] }).dailyEntries = decoratedEntries;
    const exotic = verifiedSubmission();
    const exoticEntries = [{ usageDate: "2026-07-13", dailyTokenTotal: "42" }];
    Object.setPrototypeOf(exoticEntries, null);
    (exotic.payload as { dailyEntries: unknown[] }).dailyEntries = exoticEntries;
    const oversized = verifiedSubmission();
    (oversized.payload as { dailyEntries: unknown[] }).dailyEntries = Array.from(
      { length: 32 },
      () => ({ usageDate: "2026-07-13", dailyTokenTotal: "42" }),
    );
    const accessorEntry = verifiedSubmission();
    Object.defineProperty((accessorEntry.payload as { dailyEntries: object[] }).dailyEntries, "0", {
      enumerable: true,
      get: () => ({ usageDate: "2026-07-13", dailyTokenTotal: "42" }),
    });

    const nullPrototype = Object.assign(Object.create(null) as object, verifiedSubmission());
    await expect(
      createCommunitySyncDatabase(createFixture().pool, fixedIdFactory).submit(nullPrototype),
    ).resolves.toMatchObject({ outcome: "accepted" });

    for (const input of [accessor, trapped, sparse, decorated, exotic, oversized, accessorEntry]) {
      const fixture = createFixture();
      await expectDatabaseError(
        createCommunitySyncDatabase(fixture.pool, fixedIdFactory).submit(input),
        "input_invalid",
      );
      expect(fixture.connect).not.toHaveBeenCalled();
    }
  });

  it.each([null, 42, "invalid", "dev_short"])(
    "rejects malformed device lookup input before acquiring: %s",
    async (input) => {
      const fixture = createFixture();
      await expectDatabaseError(
        createCommunitySyncDatabase(fixture.pool, fixedIdFactory).readDeviceVerificationMaterial(
          input as never,
        ),
        "input_invalid",
      );
      expect(fixture.connect).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    {},
    [deviceRow, deviceRow],
    [{ ...deviceRow, extra: true }],
    [{ ...deviceRow, accounting_revision: 0 }],
    [{ ...deviceRow, agent_account_id: "acc_short" }],
    [{ ...deviceRow, device_id: "dev_ZZZZZZZZZZZZZZZZZZZZZZ" }],
    [{ ...deviceRow, device_key_id: "key_short" }],
    [{ ...deviceRow, identity_assurance: "remote" }],
    [{ ...deviceRow, installation_id: "ins_short" }],
    [{ ...deviceRow, maximum_backfill_days: 91 }],
    [{ ...deviceRow, provider_code: "CODEX" }],
    [{ ...deviceRow, public_key: "invalid" }],
    [{ ...deviceRow, public_key: Buffer.alloc(31) }],
    [{ ...deviceRow, reader_version: "../reader" }],
    [{ ...deviceRow, scope_kind: "profile" }],
  ])("destroys the client for malformed device result rows", async (deviceRows) => {
    const fixture = createFixture({ deviceRows });
    await expectDatabaseError(
      createCommunitySyncDatabase(fixture.pool, fixedIdFactory).readDeviceVerificationMaterial(
        deviceId,
      ),
      "result_invalid",
    );
    expect(fixture.release).toHaveBeenCalledWith(true);
  });

  it("rejects decorated/accessor/proxy result structures and exotic key bytes", async () => {
    const decorated = [deviceRow];
    Object.assign(decorated, { extra: true });
    const accessorRow = { ...deviceRow };
    Object.defineProperty(accessorRow, "agent_account_id", {
      enumerable: true,
      get() {
        throw new Error("must not execute");
      },
    });
    class ExoticBytes extends Uint8Array {}
    const exoticKey = new ExoticBytes(32);
    const trappedRows = new Proxy([deviceRow], {
      getPrototypeOf() {
        throw new Error("synthetic result trap");
      },
    });
    for (const deviceRows of [
      decorated,
      [accessorRow],
      [{ ...deviceRow, public_key: exoticKey }],
      trappedRows,
    ]) {
      const fixture = createFixture({ deviceRows });
      await expectDatabaseError(
        createCommunitySyncDatabase(fixture.pool, fixedIdFactory).readDeviceVerificationMaterial(
          deviceId,
        ),
        "result_invalid",
      );
      expect(fixture.release).toHaveBeenCalledWith(true);
    }
  });

  it.each([
    null,
    [],
    [
      { accepted_entries: 2, outcome: "accepted", recovery_action: null },
      { accepted_entries: 2, outcome: "accepted", recovery_action: null },
    ],
    [{ accepted_entries: 2, outcome: "accepted", recovery_action: null, extra: true }],
    [{ accepted_entries: "2", outcome: "accepted", recovery_action: null }],
    [{ accepted_entries: 1.5, outcome: "accepted", recovery_action: null }],
    [{ accepted_entries: 0, outcome: "accepted", recovery_action: null }],
    [{ accepted_entries: 3, outcome: "accepted", recovery_action: null }],
    [{ accepted_entries: 1, outcome: "duplicate", recovery_action: null }],
    [{ accepted_entries: 1, outcome: "quarantined", recovery_action: "contact_support" }],
    [{ accepted_entries: 0, outcome: "unknown", recovery_action: null }],
    [{ accepted_entries: 0, outcome: "duplicate", recovery_action: "retry_later" }],
    [{ accepted_entries: 0, outcome: "quarantined", recovery_action: null }],
  ])("destroys the client for malformed submission result rows", async (submissionRows) => {
    const fixture = createFixture({ submissionRows });
    await expectDatabaseError(
      createCommunitySyncDatabase(fixture.pool, fixedIdFactory).submit(verifiedSubmission()),
      "result_invalid",
    );
    expect(fixture.release).toHaveBeenCalledWith(true);
  });

  it("contains unexpected submission-result proxy failures", async () => {
    const trappedRows = new Proxy(
      [{ accepted_entries: 2, outcome: "accepted", recovery_action: null }],
      {
        getPrototypeOf() {
          throw new Error("synthetic result trap");
        },
      },
    );
    const fixture = createFixture({ submissionRows: trappedRows });
    await expectDatabaseError(
      createCommunitySyncDatabase(fixture.pool, fixedIdFactory).submit(verifiedSubmission()),
      "result_invalid",
    );
    expect(fixture.release).toHaveBeenCalledWith(true);
  });

  it.each([
    { runtimeRows: [] },
    { runtimeRows: [{ role_ok: false, login_scope_ok: true, search_path_ok: true }] },
    { runtimeRows: [{ role_ok: true, login_scope_ok: false, search_path_ok: true }] },
    { runtimeRows: [{ role_ok: true, login_scope_ok: true, search_path_ok: false }] },
    {
      runtimeRows: [{ role_ok: true, login_scope_ok: true, search_path_ok: true, extra: true }],
    },
  ])("rejects a mismatched runtime boundary before capability access", async ({ runtimeRows }) => {
    const fixture = createFixture({ runtimeRows });
    await expectDatabaseError(
      createCommunitySyncDatabase(fixture.pool, fixedIdFactory).readDeviceVerificationMaterial(
        deviceId,
      ),
      "runtime_boundary_mismatch",
    );
    expect(fixture.readDevice).not.toHaveBeenCalled();
    expect(fixture.release).toHaveBeenCalledWith(true);
  });

  it("contains runtime proxies and maps connection/query failures generically", async () => {
    const trappedRows = new Proxy(runtimeBoundary, {
      getPrototypeOf() {
        throw new Error("synthetic boundary trap");
      },
    });
    const trappedFixture = createFixture({ runtimeRows: trappedRows });
    await expectDatabaseError(
      createCommunitySyncDatabase(trappedFixture.pool, fixedIdFactory).submit(verifiedSubmission()),
      "runtime_boundary_mismatch",
    );

    const connectionFixture = createFixture();
    connectionFixture.connect.mockRejectedValueOnce(new Error("synthetic connection detail"));
    await expectDatabaseError(
      createCommunitySyncDatabase(connectionFixture.pool, fixedIdFactory).submit(
        verifiedSubmission(),
      ),
      "connection_unavailable",
    );

    const boundaryFixture = createFixture();
    boundaryFixture.verifyBoundary.mockRejectedValueOnce(new Error("synthetic boundary detail"));
    await expectDatabaseError(
      createCommunitySyncDatabase(boundaryFixture.pool, fixedIdFactory).submit(
        verifiedSubmission(),
      ),
      "query_failed",
    );
    expect(boundaryFixture.release).toHaveBeenCalledWith(true);

    const queryFixture = createFixture();
    queryFixture.submit.mockRejectedValueOnce(new Error("synthetic query detail"));
    await expectDatabaseError(
      createCommunitySyncDatabase(queryFixture.pool, fixedIdFactory).submit(verifiedSubmission()),
      "query_failed",
    );
    expect(queryFixture.release).toHaveBeenCalledWith(true);
  });

  it("fails closed for throwing or malformed public-ID dependencies", async () => {
    for (const factory of [
      (() => {
        throw new Error("synthetic identifier detail");
      }) as PublicIdFactory,
      (() => "invalid") as PublicIdFactory,
      ((prefix) => (prefix === "obs" ? observationId : "evt_short")) as PublicIdFactory,
    ]) {
      const fixture = createFixture();
      await expectDatabaseError(
        createCommunitySyncDatabase(fixture.pool, factory).submit(verifiedSubmission()),
        "identifier_unavailable",
      );
      expect(fixture.connect).not.toHaveBeenCalled();
    }
  });

  it("surfaces release failure and never reports the operation as successful", async () => {
    const fixture = createFixture();
    fixture.release.mockImplementation(() => {
      throw new Error("synthetic release detail");
    });
    await expectDatabaseError(
      createCommunitySyncDatabase(fixture.pool, fixedIdFactory).submit(verifiedSubmission()),
      "connection_release_failed",
    );
  });

  it("provides a closeable wrapper and maps close failure generically", async () => {
    const fixture = createFixture();
    const database = createCloseableCommunitySyncDatabase(fixture.pool, fixedIdFactory);
    await expect(database.readDeviceVerificationMaterial(deviceId)).resolves.toMatchObject({
      deviceKeyId,
    });
    await expect(database.submit(verifiedSubmission())).resolves.toMatchObject({
      outcome: "accepted",
    });
    await expect(database.close()).resolves.toBeUndefined();
    expect(fixture.close).toHaveBeenCalledOnce();

    const failingFixture = createFixture();
    failingFixture.close.mockRejectedValueOnce(new Error("synthetic close detail"));
    await expectDatabaseError(
      createCloseableCommunitySyncDatabase(failingFixture.pool).close(),
      "pool_close_failed",
    );
  });

  it("constructs configured pools from explicit and default environment readers", async () => {
    const explicit = createConfiguredCommunitySyncDatabase(explicitEnvironment);
    await explicit.close();

    for (const [key, value] of Object.entries(explicitEnvironment)) {
      vi.stubEnv(key, value);
    }
    const fromDefaultEnvironment = createConfiguredCommunitySyncDatabase();
    await fromDefaultEnvironment.close();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CommunitySyncDatabaseError,
  createCloseableCommunitySyncDatabase,
  createCommunitySyncDatabase,
  createConfiguredCommunitySyncDatabase,
  type CommunitySyncDatabaseErrorCode,
} from "./community-sync-database.js";
import type {
  IngestDatabaseClient,
  IngestDatabaseOriginNonce,
  IngestDatabasePool,
  IngestDatabaseSubmission,
} from "./database-pool.js";

const deviceId = "dev_AAAAAAAAAAAAAAAAAAAAAA";
const sourceId = "src_BBBBBBBBBBBBBBBBBBBBBB";
const syncId = "syn_CCCCCCCCCCCCCCCCCCCCCC";
const deviceKeyId = "00000000-0000-4000-8000-000000000201";
const snapshotId = "00000000-0000-4000-8000-000000000202";
const originExpiryMilliseconds = Date.parse("2026-07-15T12:01:00.000Z");
const runtimeBoundary = [{ role_ok: true, login_scope_ok: true, search_path_ok: true }];
const deviceRow = {
  device_key_id: deviceKeyId,
  public_key: Buffer.alloc(32, 7),
  source_id: sourceId,
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

function verifiedSubmission(): Record<string, unknown> {
  return {
    bodyDigestHex: "11".repeat(32),
    deviceId,
    deviceKeyId,
    idempotencyKey: syncId,
    nonceDigestHex: "22".repeat(32),
    payload: {
      codexVersion: "1.2.3",
      connectorVersion: "1.2.3",
      dailyEntries: [
        { codexReportedDate: "2026-07-13", tokens: 42 },
        { codexReportedDate: "2026-07-14", tokens: 84 },
      ],
      observedAt: "2026-07-15T12:00:00.000Z",
      schemaVersion: 1,
      sourceId,
      syncId,
    },
    signatureBase64Url: Buffer.alloc(64, 3).toString("base64url"),
  };
}

function originNonceConsumption(): Record<string, unknown> {
  return {
    expiresAtMilliseconds: originExpiryMilliseconds,
    keyId: "edge_primary",
    nonceDigestHex: "33".repeat(32),
  };
}

interface FixtureOptions {
  readonly deviceRows?: unknown;
  readonly originRows?: unknown;
  readonly runtimeRows?: unknown;
  readonly submissionRows?: unknown;
}

function createFixture(options: FixtureOptions = {}): Readonly<{
  client: IngestDatabaseClient;
  close: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  pool: IngestDatabasePool;
  consumeOrigin: ReturnType<typeof vi.fn>;
  readDevice: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  submit: ReturnType<typeof vi.fn>;
  verifyBoundary: ReturnType<typeof vi.fn>;
}> {
  const readDevice = vi.fn(() =>
    Promise.resolve(Object.hasOwn(options, "deviceRows") ? options.deviceRows : [deviceRow]),
  );
  const consumeOrigin = vi.fn(() =>
    Promise.resolve(
      Object.hasOwn(options, "originRows") ? options.originRows : [{ consumed: true }],
    ),
  );
  const submit = vi.fn(() =>
    Promise.resolve(
      Object.hasOwn(options, "submissionRows")
        ? options.submissionRows
        : [{ accepted_entries: 2, outcome: "accepted" }],
    ),
  );
  const verifyBoundary = vi.fn(() =>
    Promise.resolve(Object.hasOwn(options, "runtimeRows") ? options.runtimeRows : runtimeBoundary),
  );
  const release = vi.fn();
  const client: IngestDatabaseClient = {
    consumeOriginNonce: consumeOrigin,
    readDeviceVerificationMaterial: readDevice,
    release,
    submitCommunitySync: submit,
    verifyRuntimeBoundary: verifyBoundary,
  };
  const connect = vi.fn(() => Promise.resolve(client));
  const close = vi.fn(() => Promise.resolve());
  return Object.freeze({
    client,
    close,
    connect,
    pool: Object.freeze({ close, connect }),
    consumeOrigin,
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
  it.each([true, false])("maps the exact origin nonce result %s", async (consumed) => {
    const fixture = createFixture({ originRows: [{ consumed }] });
    const database = createCommunitySyncDatabase(fixture.pool, () => snapshotId);
    const input = originNonceConsumption();

    await expect(database.consumeOriginNonce(input)).resolves.toBe(consumed);

    expect(fixture.consumeOrigin).toHaveBeenCalledOnce();
    const mapped = fixture.consumeOrigin.mock.calls[0]![0] as IngestDatabaseOriginNonce;
    expect(mapped).toEqual({
      expiresAt: "2026-07-15T12:01:00.000Z",
      nonceDigest: Buffer.alloc(32, 0x33),
      originKeyId: "edge_primary",
    });
    expect(Object.isFrozen(mapped)).toBe(true);
    expect(fixture.verifyBoundary).toHaveBeenCalledOnce();
    expect(fixture.release).toHaveBeenCalledWith(false);
  });

  it.each([
    null,
    [],
    { ...originNonceConsumption(), extra: true },
    { ...originNonceConsumption(), expiresAtMilliseconds: "invalid" },
    { ...originNonceConsumption(), expiresAtMilliseconds: 1.5 },
    { ...originNonceConsumption(), expiresAtMilliseconds: -1 },
    { ...originNonceConsumption(), expiresAtMilliseconds: Number.MAX_SAFE_INTEGER },
    { ...originNonceConsumption(), keyId: 42 },
    { ...originNonceConsumption(), keyId: "primary" },
    { ...originNonceConsumption(), nonceDigestHex: "AA".repeat(32) },
    { ...originNonceConsumption(), nonceDigestHex: "33".repeat(31) },
  ])("rejects malformed origin nonce input before acquiring a connection", async (input) => {
    const fixture = createFixture();
    const database = createCommunitySyncDatabase(fixture.pool, () => snapshotId);

    await expectDatabaseError(database.consumeOriginNonce(input), "input_invalid");
    expect(fixture.connect).not.toHaveBeenCalled();
  });

  it("contains accessors and proxies in origin nonce input", async () => {
    const accessor = originNonceConsumption();
    Object.defineProperty(accessor, "keyId", {
      enumerable: true,
      get() {
        throw new Error("must not execute");
      },
    });
    const proxy = new Proxy(originNonceConsumption(), {
      ownKeys() {
        throw new Error("must not escape");
      },
    });

    for (const input of [accessor, proxy]) {
      const fixture = createFixture();
      await expectDatabaseError(
        createCommunitySyncDatabase(fixture.pool, () => snapshotId).consumeOriginNonce(input),
        "input_invalid",
      );
      expect(fixture.connect).not.toHaveBeenCalled();
    }
  });

  it.each([
    null,
    [],
    [{ consumed: true }, { consumed: false }],
    [null],
    [{ consumed: true, extra: true }],
    [{ consumed: "true" }],
  ])("destroys the client for malformed origin nonce result rows", async (originRows) => {
    const fixture = createFixture({ originRows });

    await expectDatabaseError(
      createCommunitySyncDatabase(fixture.pool, () => snapshotId).consumeOriginNonce(
        originNonceConsumption(),
      ),
      "result_invalid",
    );
    expect(fixture.release).toHaveBeenCalledWith(true);
  });

  it("contains unexpected origin nonce result proxy failures", async () => {
    const originRows = new Proxy([{ consumed: true }], {
      getPrototypeOf() {
        throw new Error("synthetic result trap");
      },
    });
    const fixture = createFixture({ originRows });

    await expectDatabaseError(
      createCommunitySyncDatabase(fixture.pool, () => snapshotId).consumeOriginNonce(
        originNonceConsumption(),
      ),
      "result_invalid",
    );
    expect(fixture.release).toHaveBeenCalledWith(true);
  });

  it("maps one device row into copied, frozen verifier material", async () => {
    const fixture = createFixture();
    const database = createCommunitySyncDatabase(fixture.pool, () => snapshotId);

    const material = await database.readDeviceVerificationMaterial(deviceId);

    expect(material).toEqual({ deviceKeyId, publicKey: Buffer.alloc(32, 7), sourceId });
    expect(Object.isFrozen(material)).toBe(true);
    expect(material?.publicKey).not.toBe(deviceRow.public_key);
    expect(fixture.readDevice).toHaveBeenCalledWith(deviceId);
    expect(fixture.verifyBoundary).toHaveBeenCalledOnce();
    expect(fixture.release).toHaveBeenCalledWith(false);
  });

  it("returns null only for the exact empty device result", async () => {
    const fixture = createFixture({ deviceRows: [] });
    const database = createCommunitySyncDatabase(fixture.pool, () => snapshotId);

    await expect(database.readDeviceVerificationMaterial(deviceId)).resolves.toBeNull();
    expect(fixture.release).toHaveBeenCalledWith(false);
  });

  it("maps a verified submission to the exact procedure input and copies mutable values", async () => {
    const fixture = createFixture();
    const database = createCommunitySyncDatabase(fixture.pool, () => snapshotId);
    const input = verifiedSubmission();

    const result = await database.submit(input);

    expect(result).toEqual({ acceptedEntries: 2, outcome: "accepted" });
    expect(Object.isFrozen(result)).toBe(true);
    expect(fixture.submit).toHaveBeenCalledOnce();
    const mapped = fixture.submit.mock.calls[0]![0] as IngestDatabaseSubmission;
    expect(mapped).toMatchObject({
      codexReportedDates: ["2026-07-13", "2026-07-14"],
      codexVersion: "1.2.3",
      connectorVersion: "1.2.3",
      deviceId,
      deviceKeyId,
      observedAt: "2026-07-15T12:00:00.000Z",
      snapshotId,
      sourceId,
      syncId,
      tokens: [42, 84],
    });
    expect(mapped.bodyDigest).toEqual(Buffer.alloc(32, 0x11));
    expect(mapped.nonceDigest).toEqual(Buffer.alloc(32, 0x22));
    expect(mapped.signature).toEqual(Buffer.alloc(64, 3));
    expect(Object.isFrozen(mapped)).toBe(true);
    expect(Object.isFrozen(mapped.codexReportedDates)).toBe(true);
    expect(Object.isFrozen(mapped.tokens)).toBe(true);
    expect(fixture.release).toHaveBeenCalledWith(false);
  });

  it.each([
    [
      { accepted_entries: 0, outcome: "duplicate" },
      { acceptedEntries: 0, outcome: "duplicate" },
    ],
    [
      { accepted_entries: 0, outcome: "quarantined" },
      { acceptedEntries: 0, outcome: "quarantined" },
    ],
  ] as const)("maps the terminal %s procedure outcome", async (row, expected) => {
    const fixture = createFixture({ submissionRows: [row] });
    const database = createCommunitySyncDatabase(fixture.pool, () => snapshotId);

    await expect(database.submit(verifiedSubmission())).resolves.toEqual(expected);
  });

  it("uses a canonical server-generated snapshot identifier by default", async () => {
    const fixture = createFixture();
    const database = createCommunitySyncDatabase(fixture.pool);

    await database.submit(verifiedSubmission());

    const mapped = fixture.submit.mock.calls[0]![0] as IngestDatabaseSubmission;
    expect(mapped.snapshotId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it.each([
    null,
    [],
    { ...verifiedSubmission(), extra: true },
    { ...verifiedSubmission(), bodyDigestHex: "AA".repeat(32) },
    { ...verifiedSubmission(), bodyDigestHex: "11".repeat(31) },
    { ...verifiedSubmission(), deviceId: "invalid" },
    { ...verifiedSubmission(), deviceKeyId: "INVALID" },
    { ...verifiedSubmission(), idempotencyKey: "invalid" },
    { ...verifiedSubmission(), idempotencyKey: "syn_DDDDDDDDDDDDDDDDDDDDDD" },
    { ...verifiedSubmission(), nonceDigestHex: "zz".repeat(32) },
    { ...verifiedSubmission(), signatureBase64Url: "invalid" },
    { ...verifiedSubmission(), signatureBase64Url: 42 },
    { ...verifiedSubmission(), payload: null },
    {
      ...verifiedSubmission(),
      payload: { ...(verifiedSubmission().payload as object), extra: true },
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
        dailyEntries: [{ codexReportedDate: "2026-07-13", tokens: 42, extra: true }],
      },
    },
  ])("rejects malformed verified input before acquiring a connection", async (input) => {
    const fixture = createFixture();
    const database = createCommunitySyncDatabase(fixture.pool, () => snapshotId);

    await expectDatabaseError(database.submit(input), "input_invalid");
    expect(fixture.connect).not.toHaveBeenCalled();
  });

  it("rejects accessors, proxies, sparse arrays, and exotic array prototypes", async () => {
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
    const exotic = verifiedSubmission();
    const exoticEntries = [{ codexReportedDate: "2026-07-13", tokens: 42 }];
    Object.setPrototypeOf(exoticEntries, null);
    (exotic.payload as { dailyEntries: unknown[] }).dailyEntries = exoticEntries;

    const nullPrototype = Object.assign(Object.create(null) as object, verifiedSubmission());
    const oversized = verifiedSubmission();
    (oversized.payload as { dailyEntries: unknown[] }).dailyEntries = Array.from(
      { length: 32 },
      (_, index) => ({ codexReportedDate: "2026-07-13", tokens: index }),
    );
    const falseDescriptor = verifiedSubmission();
    const proxiedEntries = new Proxy([{ codexReportedDate: "2026-07-13", tokens: 42 }], {
      getOwnPropertyDescriptor(target, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        return key === "0" && descriptor !== undefined
          ? { ...descriptor, enumerable: false }
          : descriptor;
      },
    });
    (falseDescriptor.payload as { dailyEntries: unknown[] }).dailyEntries = proxiedEntries;

    await expect(
      createCommunitySyncDatabase(createFixture().pool, () => snapshotId).submit(nullPrototype),
    ).resolves.toMatchObject({ outcome: "accepted" });

    for (const input of [accessor, trapped, sparse, exotic, oversized, falseDescriptor]) {
      const fixture = createFixture();
      const database = createCommunitySyncDatabase(fixture.pool, () => snapshotId);
      await expectDatabaseError(database.submit(input), "input_invalid");
      expect(fixture.connect).not.toHaveBeenCalled();
    }
  });

  it.each([null, 42, "invalid", "dev_short"])(
    "rejects a malformed device lookup input before acquiring: %s",
    async (input) => {
      const fixture = createFixture();
      const database = createCommunitySyncDatabase(fixture.pool, () => snapshotId);
      await expectDatabaseError(
        database.readDeviceVerificationMaterial(input as never),
        "input_invalid",
      );
      expect(fixture.connect).not.toHaveBeenCalled();
    },
  );

  it.each([
    { deviceRows: null },
    { deviceRows: {} },
    { deviceRows: [deviceRow, deviceRow] },
    { deviceRows: [{ ...deviceRow, extra: true }] },
    { deviceRows: [{ ...deviceRow, device_key_id: "invalid" }] },
    { deviceRows: [{ ...deviceRow, source_id: "invalid" }] },
    { deviceRows: [{ ...deviceRow, public_key: "invalid" }] },
    { deviceRows: [{ ...deviceRow, public_key: Buffer.alloc(31) }] },
  ])("destroys the client for malformed device result rows", async ({ deviceRows }) => {
    const fixture = createFixture({ deviceRows });
    const database = createCommunitySyncDatabase(fixture.pool, () => snapshotId);

    await expectDatabaseError(database.readDeviceVerificationMaterial(deviceId), "result_invalid");
    expect(fixture.release).toHaveBeenCalledWith(true);
  });

  it("rejects decorated result arrays, accessor rows, and exotic public-key bytes", async () => {
    const decorated = [deviceRow];
    Object.assign(decorated, { extra: true });
    const accessorRow = { ...deviceRow };
    Object.defineProperty(accessorRow, "source_id", {
      enumerable: true,
      get() {
        throw new Error("must not execute");
      },
    });
    class ExoticBytes extends Uint8Array {}
    const exoticKey = new ExoticBytes(32);
    exoticKey.fill(7);

    for (const deviceRows of [
      decorated,
      [accessorRow],
      [{ ...deviceRow, public_key: exoticKey }],
    ]) {
      const fixture = createFixture({ deviceRows });
      const database = createCommunitySyncDatabase(fixture.pool, () => snapshotId);
      await expectDatabaseError(
        database.readDeviceVerificationMaterial(deviceId),
        "result_invalid",
      );
      expect(fixture.release).toHaveBeenCalledWith(true);
    }
  });

  it("contains unexpected device-result proxy failures", async () => {
    const trappedRows = new Proxy([deviceRow], {
      getPrototypeOf() {
        throw new Error("synthetic result trap");
      },
    });
    const fixture = createFixture({ deviceRows: trappedRows });
    await expectDatabaseError(
      createCommunitySyncDatabase(fixture.pool, () => snapshotId).readDeviceVerificationMaterial(
        deviceId,
      ),
      "result_invalid",
    );
    expect(fixture.release).toHaveBeenCalledWith(true);
  });

  it.each([
    { submissionRows: null },
    { submissionRows: [] },
    { submissionRows: [{ accepted_entries: 2, outcome: "accepted", extra: true }] },
    { submissionRows: [{ accepted_entries: "2", outcome: "accepted" }] },
    { submissionRows: [{ accepted_entries: 1.5, outcome: "accepted" }] },
    { submissionRows: [{ accepted_entries: 1, outcome: "accepted" }] },
    { submissionRows: [{ accepted_entries: 1, outcome: "duplicate" }] },
    { submissionRows: [{ accepted_entries: 1, outcome: "quarantined" }] },
    { submissionRows: [{ accepted_entries: 0, outcome: "unknown" }] },
  ])("destroys the client for malformed submission result rows", async ({ submissionRows }) => {
    const fixture = createFixture({ submissionRows });
    const database = createCommunitySyncDatabase(fixture.pool, () => snapshotId);

    await expectDatabaseError(database.submit(verifiedSubmission()), "result_invalid");
    expect(fixture.release).toHaveBeenCalledWith(true);
  });

  it("contains unexpected submission-result proxy failures", async () => {
    const trappedRows = new Proxy([{ accepted_entries: 2, outcome: "accepted" }], {
      getPrototypeOf() {
        throw new Error("synthetic result trap");
      },
    });
    const fixture = createFixture({ submissionRows: trappedRows });
    await expectDatabaseError(
      createCommunitySyncDatabase(fixture.pool, () => snapshotId).submit(verifiedSubmission()),
      "result_invalid",
    );
    expect(fixture.release).toHaveBeenCalledWith(true);
  });

  it.each([
    { runtimeRows: [] },
    { runtimeRows: [{ role_ok: false, login_scope_ok: true, search_path_ok: true }] },
    { runtimeRows: [{ role_ok: true, login_scope_ok: false, search_path_ok: true }] },
    { runtimeRows: [{ role_ok: true, login_scope_ok: true, search_path_ok: false }] },
    { runtimeRows: [{ role_ok: true, login_scope_ok: true, search_path_ok: true, extra: true }] },
  ])("rejects a mismatched runtime boundary before capability access", async ({ runtimeRows }) => {
    const fixture = createFixture({ runtimeRows });
    const database = createCommunitySyncDatabase(fixture.pool, () => snapshotId);

    await expectDatabaseError(
      database.readDeviceVerificationMaterial(deviceId),
      "runtime_boundary_mismatch",
    );
    expect(fixture.readDevice).not.toHaveBeenCalled();
    expect(fixture.release).toHaveBeenCalledWith(true);
  });

  it("treats an unexpected runtime-boundary proxy failure as a mismatch", async () => {
    const trappedRows = new Proxy(runtimeBoundary, {
      getPrototypeOf() {
        throw new Error("synthetic boundary trap");
      },
    });
    const fixture = createFixture({ runtimeRows: trappedRows });
    await expectDatabaseError(
      createCommunitySyncDatabase(fixture.pool, () => snapshotId).submit(verifiedSubmission()),
      "runtime_boundary_mismatch",
    );
    expect(fixture.submit).not.toHaveBeenCalled();
    expect(fixture.release).toHaveBeenCalledWith(true);
  });

  it("maps connection and query failures without reflecting dependency details", async () => {
    const connectionFixture = createFixture();
    connectionFixture.connect.mockRejectedValueOnce(new Error("synthetic connection detail"));
    await expectDatabaseError(
      createCommunitySyncDatabase(connectionFixture.pool, () => snapshotId).submit(
        verifiedSubmission(),
      ),
      "connection_unavailable",
    );

    const boundaryFixture = createFixture();
    boundaryFixture.verifyBoundary.mockRejectedValueOnce(new Error("synthetic boundary detail"));
    await expectDatabaseError(
      createCommunitySyncDatabase(boundaryFixture.pool, () => snapshotId).submit(
        verifiedSubmission(),
      ),
      "query_failed",
    );
    expect(boundaryFixture.release).toHaveBeenCalledWith(true);

    const queryFixture = createFixture();
    queryFixture.submit.mockRejectedValueOnce(new Error("synthetic query detail"));
    await expectDatabaseError(
      createCommunitySyncDatabase(queryFixture.pool, () => snapshotId).submit(verifiedSubmission()),
      "query_failed",
    );
    expect(queryFixture.release).toHaveBeenCalledWith(true);

    const originFixture = createFixture();
    originFixture.consumeOrigin.mockRejectedValueOnce(new Error("synthetic origin detail"));
    await expectDatabaseError(
      createCommunitySyncDatabase(originFixture.pool, () => snapshotId).consumeOriginNonce(
        originNonceConsumption(),
      ),
      "query_failed",
    );
    expect(originFixture.release).toHaveBeenCalledWith(true);
  });

  it("fails closed for throwing or malformed snapshot identifier dependencies", async () => {
    for (const factory of [
      () => {
        throw new Error("synthetic identifier detail");
      },
      () => "invalid",
      () => "00000000-0000-0000-0000-000000000000",
    ]) {
      const fixture = createFixture();
      const database = createCommunitySyncDatabase(fixture.pool, factory);
      await expectDatabaseError(database.submit(verifiedSubmission()), "identifier_unavailable");
      expect(fixture.connect).not.toHaveBeenCalled();
    }
  });

  it("surfaces release failure and never reports the operation as successful", async () => {
    const fixture = createFixture();
    fixture.release.mockImplementation(() => {
      throw new Error("synthetic release detail");
    });
    const database = createCommunitySyncDatabase(fixture.pool, () => snapshotId);

    await expectDatabaseError(database.submit(verifiedSubmission()), "connection_release_failed");
  });

  it("provides a closeable wrapper and maps close failure generically", async () => {
    const fixture = createFixture();
    const database = createCloseableCommunitySyncDatabase(fixture.pool, () => snapshotId);
    await expect(database.consumeOriginNonce(originNonceConsumption())).resolves.toBe(true);
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

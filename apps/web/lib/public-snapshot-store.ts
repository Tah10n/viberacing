import "server-only";

import { Buffer } from "node:buffer";
import { createHash, timingSafeEqual } from "node:crypto";

import {
  validateLeaderboardQueryV1,
  validateLeaderboardSeasonPathV1,
  validateLeaderboardSnapshotV1,
  validatePublicProfilePathV1,
  validatePublicProfileSummaryV1,
} from "@viberacing/contracts";

import { resolvePublicSnapshotDatabaseConfig } from "./public-snapshot-database-config";
import {
  createPublicSnapshotDatabasePool,
  type PublicSnapshotDatabaseClient,
  type PublicSnapshotDatabasePool,
  type PublicSnapshotDatabasePoolSignalSink,
} from "./public-snapshot-database-pool";

const runtimeBoundaryColumns = [
  "role_ok",
  "login_scope_ok",
  "search_path_ok",
  "read_only_ok",
] as const;
const runtimeBoundaryColumnSet = new Set<string>(runtimeBoundaryColumns);
const snapshotRowColumns = [
  "canonical_payload",
  "payload_digest",
  "etag",
  "generated_at",
  "finalized",
] as const;
const snapshotRowColumnSet = new Set<string>(snapshotRowColumns);
const maximumLeaderboardPayloadBytes = 1_048_576;
const maximumProfilePayloadBytes = 65_536;
const generatedAtPattern = /^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/;
const etagPattern = /^"[a-f0-9]{64}"$/;

const runtimeBoundaryQuery = `SELECT
  CURRENT_USER = 'viberacing_web' AS role_ok,
  (
    SESSION_USER <> CURRENT_USER
    AND pg_catalog.pg_has_role(SESSION_USER, 'viberacing_web', 'SET')
    AND pg_catalog.has_database_privilege(SESSION_USER, pg_catalog.current_database(), 'CONNECT')
    AND NOT pg_catalog.has_database_privilege(
      SESSION_USER,
      pg_catalog.current_database(),
      'CREATE'
    )
    AND NOT pg_catalog.has_database_privilege(
      SESSION_USER,
      pg_catalog.current_database(),
      'TEMPORARY'
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles AS login_role
      WHERE login_role.rolname = SESSION_USER
        AND login_role.rolcanlogin
        AND NOT login_role.rolsuper
        AND NOT login_role.rolcreatedb
        AND NOT login_role.rolcreaterole
        AND NOT login_role.rolreplication
        AND NOT login_role.rolbypassrls
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles AS granted_role
      WHERE granted_role.rolname <> SESSION_USER
        AND granted_role.rolname <> 'viberacing_web'
        AND pg_catalog.pg_has_role(SESSION_USER, granted_role.oid, 'MEMBER')
    )
  ) AS login_scope_ok,
  pg_catalog.current_setting('search_path') = 'pg_catalog,pg_temp' AS search_path_ok,
  pg_catalog.current_setting('default_transaction_read_only') = 'on' AS read_only_ok`;

const generatedAtProjection = `pg_catalog.to_char(
    snapshot.generated_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
  ) AS generated_at`;

const currentLeaderboardQuery = `SELECT
  snapshot.canonical_payload,
  snapshot.payload_digest,
  snapshot.etag,
  ${generatedAtProjection},
  snapshot.finalized
FROM viberacing_api.read_current_leaderboard_page($1::integer) AS snapshot`;

const seasonLeaderboardQuery = `SELECT
  snapshot.canonical_payload,
  snapshot.payload_digest,
  snapshot.etag,
  ${generatedAtProjection},
  snapshot.finalized
FROM viberacing_api.read_season_leaderboard_page(
  $1::date,
  $2::integer
) AS snapshot`;

const currentProfileQuery = `SELECT
  snapshot.canonical_payload,
  snapshot.payload_digest,
  snapshot.etag,
  ${generatedAtProjection},
  snapshot.finalized
FROM viberacing_api.read_current_public_profile($1::text) AS snapshot`;

export type PublicSnapshotStoreErrorCode =
  | "connection_release_failed"
  | "connection_unavailable"
  | "invalid_input"
  | "not_found"
  | "pool_close_failed"
  | "projection_rejected"
  | "query_failed"
  | "runtime_boundary_mismatch"
  | "snapshot_unavailable";

export class PublicSnapshotStoreError extends Error {
  readonly code: PublicSnapshotStoreErrorCode;

  constructor(code: PublicSnapshotStoreErrorCode) {
    super("Public snapshot data is unavailable.");
    this.name = "PublicSnapshotStoreError";
    this.code = code;
  }
}

export interface PublicSnapshotRecord {
  readonly canonicalPayload: string;
  readonly etag: string;
  readonly finalized: boolean;
  readonly generatedAt: string;
}

export interface PublicSnapshotStore {
  readonly readCurrentLeaderboard: (page: unknown) => Promise<PublicSnapshotRecord>;
  readonly readCurrentProfile: (handle: unknown) => Promise<PublicSnapshotRecord>;
  readonly readSeasonLeaderboard: (
    seasonStart: unknown,
    page: unknown,
  ) => Promise<PublicSnapshotRecord>;
}

export interface ConfiguredPublicSnapshotStore extends PublicSnapshotStore {
  close(): Promise<void>;
}

function fail(code: PublicSnapshotStoreErrorCode): never {
  throw new PublicSnapshotStoreError(code);
}

function ownDataValue(object: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor !== undefined && "value" in descriptor && descriptor.enumerable
    ? (descriptor.value as unknown)
    : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasExactKeys(
  value: object,
  expected: ReadonlySet<string>,
  expectedLength: number,
): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expectedLength &&
    keys.every((key) => typeof key === "string" && expected.has(key))
  );
}

function validRuntimeBoundary(value: unknown): boolean {
  try {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      value.length !== 1 ||
      Reflect.ownKeys(value).length !== 2
    ) {
      return false;
    }
    const row = ownDataValue(value, "0");
    return (
      isPlainRecord(row) &&
      hasExactKeys(row, runtimeBoundaryColumnSet, runtimeBoundaryColumns.length) &&
      runtimeBoundaryColumns.every((column) => ownDataValue(row, column) === true)
    );
  } catch {
    return false;
  }
}

function releaseClient(client: PublicSnapshotDatabaseClient, destroy: boolean): void {
  try {
    client.release(destroy);
  } catch {
    fail("connection_release_failed");
  }
}

async function readRows(
  pool: PublicSnapshotDatabasePool,
  query: string,
  values: readonly unknown[],
): Promise<unknown> {
  let client: PublicSnapshotDatabaseClient;
  try {
    client = await pool.connect();
  } catch {
    fail("connection_unavailable");
  }

  let destroyClient = true;
  let pendingError: PublicSnapshotStoreErrorCode | undefined;
  let rows: unknown;
  try {
    const boundary = await client.query(runtimeBoundaryQuery);
    if (!validRuntimeBoundary(boundary)) {
      fail("runtime_boundary_mismatch");
    }
    rows = await client.query(query, values);
    destroyClient = false;
  } catch (error) {
    pendingError = error instanceof PublicSnapshotStoreError ? error.code : "query_failed";
  }
  releaseClient(client, destroyClient);
  if (pendingError !== undefined) {
    fail(pendingError);
  }
  return rows;
}

function readOneRow(rows: unknown): Record<string, unknown> | undefined {
  try {
    if (
      !Array.isArray(rows) ||
      Object.getPrototypeOf(rows) !== Array.prototype ||
      Reflect.ownKeys(rows).length !== rows.length + 1
    ) {
      fail("projection_rejected");
    }
    if (rows.length === 0) {
      return undefined;
    }
    const row = ownDataValue(rows, "0");
    if (
      rows.length !== 1 ||
      !isPlainRecord(row) ||
      !hasExactKeys(row, snapshotRowColumnSet, snapshotRowColumns.length)
    ) {
      fail("projection_rejected");
    }
    return row;
  } catch (error) {
    if (error instanceof PublicSnapshotStoreError) {
      throw error;
    }
    fail("projection_rejected");
  }
}

function mapSnapshotRow<T>(
  row: Record<string, unknown>,
  maximumPayloadBytes: number,
  validate: (value: unknown) => { readonly ok: false } | { readonly ok: true; readonly value: T },
  verifyValue: (value: T) => boolean,
): PublicSnapshotRecord {
  try {
    const canonicalPayload = ownDataValue(row, "canonical_payload");
    const payloadDigest = ownDataValue(row, "payload_digest");
    const etag = ownDataValue(row, "etag");
    const generatedAt = ownDataValue(row, "generated_at");
    const finalized = ownDataValue(row, "finalized");
    if (
      typeof canonicalPayload !== "string" ||
      Buffer.byteLength(canonicalPayload, "utf8") < 2 ||
      Buffer.byteLength(canonicalPayload, "utf8") > maximumPayloadBytes ||
      !Buffer.isBuffer(payloadDigest) ||
      payloadDigest.byteLength !== 32 ||
      typeof etag !== "string" ||
      !etagPattern.test(etag) ||
      typeof generatedAt !== "string" ||
      !generatedAtPattern.test(generatedAt) ||
      !Number.isFinite(Date.parse(generatedAt)) ||
      typeof finalized !== "boolean"
    ) {
      fail("projection_rejected");
    }
    const calculatedDigest = createHash("sha256").update(canonicalPayload, "utf8").digest();
    if (
      !timingSafeEqual(calculatedDigest, payloadDigest) ||
      etag !== `"${calculatedDigest.toString("hex")}"`
    ) {
      fail("projection_rejected");
    }
    const validation = validate(JSON.parse(canonicalPayload) as unknown);
    if (!validation.ok || !verifyValue(validation.value)) {
      fail("projection_rejected");
    }
    return Object.freeze({
      canonicalPayload,
      etag,
      finalized,
      generatedAt,
    });
  } catch (error) {
    if (error instanceof PublicSnapshotStoreError) {
      throw error;
    }
    fail("projection_rejected");
  }
}

async function readCurrentLeaderboardRecord(
  pool: PublicSnapshotDatabasePool,
  page: number,
): Promise<PublicSnapshotRecord | undefined> {
  const row = readOneRow(await readRows(pool, currentLeaderboardQuery, [page]));
  return row === undefined
    ? undefined
    : mapSnapshotRow(
        row,
        maximumLeaderboardPayloadBytes,
        validateLeaderboardSnapshotV1,
        (value) => value.page === page,
      );
}

async function requireCurrentSnapshot(pool: PublicSnapshotDatabasePool): Promise<void> {
  if ((await readCurrentLeaderboardRecord(pool, 1)) === undefined) {
    fail("snapshot_unavailable");
  }
}

export function createPublicSnapshotStore(pool: PublicSnapshotDatabasePool): PublicSnapshotStore {
  return Object.freeze({
    async readCurrentLeaderboard(page: unknown): Promise<PublicSnapshotRecord> {
      const query = validateLeaderboardQueryV1({ page, trustTier: "community" });
      if (!query.ok) {
        fail("invalid_input");
      }
      const record = await readCurrentLeaderboardRecord(pool, query.value.page);
      if (record !== undefined) {
        return record;
      }
      if (query.value.page === 1) {
        fail("snapshot_unavailable");
      }
      await requireCurrentSnapshot(pool);
      fail("not_found");
    },

    async readCurrentProfile(handle: unknown): Promise<PublicSnapshotRecord> {
      const path = validatePublicProfilePathV1({ handle });
      if (!path.ok) {
        fail("invalid_input");
      }
      const row = readOneRow(await readRows(pool, currentProfileQuery, [path.value.handle]));
      if (row === undefined) {
        await requireCurrentSnapshot(pool);
        fail("not_found");
      }
      return mapSnapshotRow(
        row,
        maximumProfilePayloadBytes,
        validatePublicProfileSummaryV1,
        (value) => value.handle === path.value.handle,
      );
    },

    async readSeasonLeaderboard(
      seasonStart: unknown,
      page: unknown,
    ): Promise<PublicSnapshotRecord> {
      const path = validateLeaderboardSeasonPathV1({ seasonStart });
      const query = validateLeaderboardQueryV1({ page, trustTier: "community" });
      if (!path.ok || !query.ok) {
        fail("invalid_input");
      }
      const row = readOneRow(
        await readRows(pool, seasonLeaderboardQuery, [path.value.seasonStart, query.value.page]),
      );
      if (row === undefined) {
        fail("not_found");
      }
      return mapSnapshotRow(
        row,
        maximumLeaderboardPayloadBytes,
        validateLeaderboardSnapshotV1,
        (value) => value.seasonStart === path.value.seasonStart && value.page === query.value.page,
      );
    },
  });
}

export function createCloseablePublicSnapshotStore(
  pool: PublicSnapshotDatabasePool,
): ConfiguredPublicSnapshotStore {
  const store = createPublicSnapshotStore(pool);
  return Object.freeze({
    async close(): Promise<void> {
      try {
        await pool.close();
      } catch {
        fail("pool_close_failed");
      }
    },
    readCurrentLeaderboard: store.readCurrentLeaderboard,
    readCurrentProfile: store.readCurrentProfile,
    readSeasonLeaderboard: store.readSeasonLeaderboard,
  });
}

export function createConfiguredPublicSnapshotStore(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  signalSink?: PublicSnapshotDatabasePoolSignalSink,
): ConfiguredPublicSnapshotStore {
  return createCloseablePublicSnapshotStore(
    createPublicSnapshotDatabasePool(resolvePublicSnapshotDatabaseConfig(environment), signalSink),
  );
}

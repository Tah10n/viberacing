import "server-only";

import type { CommunityRacePageV1, CommunityScorePageV1 } from "@viberacing/contracts";

import {
  mapPublicCommunityRaceRows,
  mapPublicCommunityScoreRows,
  publicCommunityRacePageSize,
  publicCommunityScorePageSize,
} from "./public-community-score-mapper";
import { resolvePublicScoreDatabaseConfig } from "./public-score-database-config";
import {
  createPublicScoreDatabasePool,
  type PublicScoreDatabaseClient,
  type PublicScoreDatabasePool,
  type PublicScoreDatabasePoolSignalSink,
} from "./public-score-database-pool";

const minimumSeasonStart = "1999-12-27";
const maximumSeasonStart = "2099-12-28";
const runtimeBoundaryColumns = [
  "role_ok",
  "login_scope_ok",
  "search_path_ok",
  "read_only_ok",
] as const;
const runtimeBoundaryColumnSet = new Set<string>(runtimeBoundaryColumns);

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

const publicScoreQuery = `SELECT
  score.season_start::text AS season_start,
  score.season_end::text AS season_end,
  score.score_version AS score_version,
  score.season_finalized AS season_finalized,
  score.handle AS handle,
  score.weekly_score AS weekly_score,
  score.active_days AS active_days,
  score.source_count AS source_count,
  score.rank_position AS rank_position,
  score.display_position AS display_position
FROM viberacing_api.list_public_community_scores($1::date, $2::integer) AS score
ORDER BY score.display_position`;

const publicRaceQuery = `SELECT
  race.season_start::text AS season_start,
  race.season_end::text AS season_end,
  race.score_version AS score_version,
  race.season_finalized AS season_finalized,
  race.handle AS handle,
  race.weekly_score AS weekly_score,
  race.active_days AS active_days,
  race.source_count AS source_count,
  race.rank_position AS rank_position,
  race.display_position AS display_position,
  race.car_recipe AS car_recipe
FROM viberacing_api.list_public_community_race($1::date, $2::integer) AS race
ORDER BY race.display_position`;

export type PublicCommunityScoreStoreErrorCode =
  | "connection_release_failed"
  | "connection_unavailable"
  | "invalid_season"
  | "pool_close_failed"
  | "projection_rejected"
  | "query_failed"
  | "runtime_boundary_mismatch";

export class PublicCommunityScoreStoreError extends Error {
  readonly code: PublicCommunityScoreStoreErrorCode;

  constructor(code: PublicCommunityScoreStoreErrorCode) {
    super("Community score data is unavailable.");
    this.name = "PublicCommunityScoreStoreError";
    this.code = code;
  }
}

export interface PublicCommunityScoreStore {
  readonly read: (seasonStart: unknown) => Promise<CommunityScorePageV1>;
}

export interface ConfiguredPublicCommunityScoreStore extends PublicCommunityScoreStore {
  close(): Promise<void>;
}

export interface PublicCommunityRaceStore {
  readonly read: (seasonStart: unknown) => Promise<CommunityRacePageV1>;
}

export interface ConfiguredPublicCommunityRaceStore extends PublicCommunityRaceStore {
  close(): Promise<void>;
}

function fail(code: PublicCommunityScoreStoreErrorCode): never {
  throw new PublicCommunityScoreStoreError(code);
}

function validSeasonStart(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < minimumSeasonStart ||
    value > maximumSeasonStart
  ) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.valueOf()) &&
    date.toISOString().slice(0, 10) === value &&
    date.getUTCDay() === 1
  );
}

function ownDataValue(object: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor !== undefined && "value" in descriptor && descriptor.enumerable
    ? (descriptor.value as unknown)
    : undefined;
}

function validRuntimeBoundary(value: unknown): boolean {
  try {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      value.length !== 1
    ) {
      return false;
    }
    const arrayKeys = Reflect.ownKeys(value);
    if (arrayKeys.length !== 2 || !arrayKeys.includes("0") || !arrayKeys.includes("length")) {
      return false;
    }
    const row = ownDataValue(value, "0");
    if (
      row === null ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      Object.getPrototypeOf(row) !== Object.prototype
    ) {
      return false;
    }
    const rowKeys = Reflect.ownKeys(row);
    if (
      rowKeys.length !== runtimeBoundaryColumns.length ||
      rowKeys.some((key) => typeof key !== "string" || !runtimeBoundaryColumnSet.has(key))
    ) {
      return false;
    }
    return runtimeBoundaryColumns.every((column) => ownDataValue(row, column) === true);
  } catch {
    return false;
  }
}

function releaseClient(client: PublicScoreDatabaseClient, destroy: boolean): void {
  try {
    client.release(destroy);
  } catch {
    fail("connection_release_failed");
  }
}

async function readRows(
  pool: PublicScoreDatabasePool,
  seasonStart: string,
  query: string,
  pageSize: number,
): Promise<unknown> {
  let client: PublicScoreDatabaseClient;
  try {
    client = await pool.connect();
  } catch {
    fail("connection_unavailable");
  }

  let destroyClient = true;
  let pendingError: PublicCommunityScoreStoreErrorCode | undefined;
  let rows: unknown;
  try {
    const runtimeBoundary = await client.query(runtimeBoundaryQuery);
    if (!validRuntimeBoundary(runtimeBoundary)) {
      fail("runtime_boundary_mismatch");
    }
    rows = await client.query(query, [seasonStart, pageSize]);
    destroyClient = false;
  } catch (error) {
    pendingError = error instanceof PublicCommunityScoreStoreError ? error.code : "query_failed";
  }

  releaseClient(client, destroyClient);
  if (pendingError !== undefined) {
    fail(pendingError);
  }
  return rows;
}

export function createPublicCommunityScoreStore(
  pool: PublicScoreDatabasePool,
): PublicCommunityScoreStore {
  return Object.freeze({
    async read(seasonStart: unknown): Promise<CommunityScorePageV1> {
      if (!validSeasonStart(seasonStart)) {
        fail("invalid_season");
      }
      const rows = await readRows(
        pool,
        seasonStart,
        publicScoreQuery,
        publicCommunityScorePageSize,
      );
      try {
        return mapPublicCommunityScoreRows(rows);
      } catch {
        fail("projection_rejected");
      }
    },
  });
}

export function createPublicCommunityRaceStore(
  pool: PublicScoreDatabasePool,
): PublicCommunityRaceStore {
  return Object.freeze({
    async read(seasonStart: unknown): Promise<CommunityRacePageV1> {
      if (!validSeasonStart(seasonStart)) {
        fail("invalid_season");
      }
      const rows = await readRows(pool, seasonStart, publicRaceQuery, publicCommunityRacePageSize);
      try {
        return mapPublicCommunityRaceRows(rows);
      } catch {
        fail("projection_rejected");
      }
    },
  });
}

export function createCloseablePublicCommunityScoreStore(
  pool: PublicScoreDatabasePool,
): ConfiguredPublicCommunityScoreStore {
  const store = createPublicCommunityScoreStore(pool);
  return Object.freeze({
    async close(): Promise<void> {
      try {
        await pool.close();
      } catch {
        fail("pool_close_failed");
      }
    },
    read: store.read,
  });
}

export function createCloseablePublicCommunityRaceStore(
  pool: PublicScoreDatabasePool,
): ConfiguredPublicCommunityRaceStore {
  const store = createPublicCommunityRaceStore(pool);
  return Object.freeze({
    async close(): Promise<void> {
      try {
        await pool.close();
      } catch {
        fail("pool_close_failed");
      }
    },
    read: store.read,
  });
}

export function createConfiguredPublicCommunityScoreStore(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  signalSink?: PublicScoreDatabasePoolSignalSink,
): ConfiguredPublicCommunityScoreStore {
  const pool = createPublicScoreDatabasePool(
    resolvePublicScoreDatabaseConfig(environment),
    signalSink,
  );
  return createCloseablePublicCommunityScoreStore(pool);
}

export function createConfiguredPublicCommunityRaceStore(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  signalSink?: PublicScoreDatabasePoolSignalSink,
): ConfiguredPublicCommunityRaceStore {
  const pool = createPublicScoreDatabasePool(
    resolvePublicScoreDatabaseConfig(environment),
    signalSink,
  );
  return createCloseablePublicCommunityRaceStore(pool);
}

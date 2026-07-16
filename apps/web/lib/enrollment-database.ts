import "server-only";

import { resolvePairingDatabaseConfig } from "./pairing-database-config";
import {
  createPairingDatabasePool,
  type EnrollmentDatabaseClient,
  type EnrollmentDatabaseInitialPasskey,
  type EnrollmentDatabasePasskeyChallenge,
  type EnrollmentDatabasePool,
  type EnrollmentDatabaseProfile,
  type EnrollmentDatabaseSessionRevocation,
  type PairingDatabasePoolSignalSink,
} from "./pairing-database-pool";

const runtimeColumns = new Set(["login_scope_ok", "read_write_ok", "role_ok", "search_path_ok"]);

export type EnrollmentDatabaseErrorCode =
  | "connection_release_failed"
  | "connection_unavailable"
  | "pool_close_failed"
  | "query_failed"
  | "result_invalid"
  | "runtime_boundary_mismatch";

export class EnrollmentDatabaseError extends Error {
  readonly code: EnrollmentDatabaseErrorCode;

  constructor(code: EnrollmentDatabaseErrorCode) {
    super("Enrollment is unavailable.");
    this.name = "EnrollmentDatabaseError";
    this.code = code;
  }
}

export interface EnrollmentDatabase {
  completeInitialPasskey(input: EnrollmentDatabaseInitialPasskey): Promise<boolean>;
  createPasskeyChallenge(input: EnrollmentDatabasePasskeyChallenge): Promise<boolean>;
  enrollProfile(input: EnrollmentDatabaseProfile): Promise<boolean>;
  revokeSession(input: EnrollmentDatabaseSessionRevocation): Promise<boolean>;
}

export interface ConfiguredEnrollmentDatabase extends EnrollmentDatabase {
  close(): Promise<void>;
}

function fail(code: EnrollmentDatabaseErrorCode): never {
  throw new EnrollmentDatabaseError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactBooleanRow(value: unknown, key: string): boolean {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    fail("result_invalid");
  }
  const row = value[0];
  const keys = Object.keys(row);
  if (keys.length !== 1 || keys[0] !== key || typeof row[key] !== "boolean") {
    fail("result_invalid");
  }
  return row[key];
}

function verifyRuntimeBoundary(value: unknown): void {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    fail("runtime_boundary_mismatch");
  }
  const row = value[0];
  const keys = Object.keys(row);
  if (
    keys.length !== runtimeColumns.size ||
    keys.some((key) => !runtimeColumns.has(key)) ||
    keys.some((key) => row[key] !== true)
  ) {
    fail("runtime_boundary_mismatch");
  }
}

function releaseClient(client: EnrollmentDatabaseClient, destroy: boolean): void {
  try {
    client.release(destroy);
  } catch {
    fail("connection_release_failed");
  }
}

export function createEnrollmentDatabase(pool: EnrollmentDatabasePool): EnrollmentDatabase {
  async function execute(
    operation: (client: EnrollmentDatabaseClient) => Promise<unknown>,
    resultKey: string,
  ): Promise<boolean> {
    let client: EnrollmentDatabaseClient;
    try {
      client = await pool.connect();
    } catch {
      fail("connection_unavailable");
    }
    let destroy = false;
    try {
      verifyRuntimeBoundary(await client.verifyRuntimeBoundary());
      return exactBooleanRow(await operation(client), resultKey);
    } catch (error) {
      destroy = true;
      if (error instanceof EnrollmentDatabaseError) {
        throw error;
      }
      fail("query_failed");
    } finally {
      releaseClient(client, destroy);
    }
  }

  return Object.freeze({
    completeInitialPasskey(input: EnrollmentDatabaseInitialPasskey): Promise<boolean> {
      return execute((client) => client.completeInitialPasskey(input), "registered");
    },
    createPasskeyChallenge(input: EnrollmentDatabasePasskeyChallenge): Promise<boolean> {
      return execute((client) => client.createPasskeyChallenge(input), "created");
    },
    enrollProfile(input: EnrollmentDatabaseProfile): Promise<boolean> {
      return execute((client) => client.enrollProfile(input), "enrolled");
    },
    revokeSession(input: EnrollmentDatabaseSessionRevocation): Promise<boolean> {
      return execute((client) => client.revokeEnrollmentSession(input), "revoked");
    },
  });
}

export function createConfiguredEnrollmentDatabase(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  signalSink?: PairingDatabasePoolSignalSink,
): ConfiguredEnrollmentDatabase {
  const pool = createPairingDatabasePool(resolvePairingDatabaseConfig(environment), signalSink);
  const database = createEnrollmentDatabase(pool);
  return Object.freeze({
    ...database,
    async close(): Promise<void> {
      try {
        await pool.close();
      } catch {
        fail("pool_close_failed");
      }
    },
  });
}

import { Buffer } from "node:buffer";

import {
  type AdminDatabaseClient,
  type AdminDatabasePool,
  type AdminInviteDatabaseInput,
} from "./database-pool.js";

const inputKeys = new Set([
  "auditEventId",
  "expiresAt",
  "inviteId",
  "reasonCode",
  "requestId",
  "verifierDigest",
]);
const capabilityBoundaryKeys = new Set([
  "capability_scope_ok",
  "read_write_ok",
  "role_ok",
  "search_path_ok",
]);
const loginBoundaryKeys = new Set([
  "login_ok",
  "login_scope_ok",
  "read_write_ok",
  "search_path_ok",
  "transport_ok",
]);
const issueResultKeys = new Set(["issued"]);
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const requestIdPattern = /^req_[A-Za-z0-9_-]{21}[AQgw]$/;

export type AdminInviteStoreErrorCode =
  | "connection_release_failed"
  | "connection_unavailable"
  | "input_invalid"
  | "query_failed"
  | "result_invalid"
  | "runtime_boundary_mismatch";

export class AdminInviteStoreError extends Error {
  readonly code: AdminInviteStoreErrorCode;

  constructor(code: AdminInviteStoreErrorCode) {
    super("Admin invitation storage operation failed.");
    this.name = "AdminInviteStoreError";
    this.code = code;
  }
}

export interface AdminInviteStore {
  issueInvite(input: unknown): Promise<void>;
}

function fail(code: AdminInviteStoreErrorCode): never {
  throw new AdminInviteStoreError(code);
}

function isPlainRecord(value: unknown): value is object {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: object, expected: ReadonlySet<string>): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expected.size &&
    keys.every((key) => typeof key === "string" && expected.has(key))
  );
}

function ownDataValue(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor && descriptor.enumerable
    ? (descriptor.value as unknown)
    : undefined;
}

function readExactDateValue(value: unknown): number | undefined {
  if (
    !(value instanceof Date) ||
    Object.getPrototypeOf(value) !== Date.prototype ||
    Reflect.ownKeys(value).length !== 0
  ) {
    return undefined;
  }
  const timestamp = Date.prototype.valueOf.call(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function readInput(value: unknown): AdminInviteDatabaseInput & { verifierDigest: Buffer } {
  try {
    if (!isPlainRecord(value) || !hasExactKeys(value, inputKeys)) {
      fail("input_invalid");
    }
    const auditEventId = ownDataValue(value, "auditEventId");
    const expiresAt = ownDataValue(value, "expiresAt");
    const inviteId = ownDataValue(value, "inviteId");
    const reasonCode = ownDataValue(value, "reasonCode");
    const requestId = ownDataValue(value, "requestId");
    const verifierDigest = ownDataValue(value, "verifierDigest");
    const expiresAtValue = readExactDateValue(expiresAt);
    if (
      typeof auditEventId !== "string" ||
      !uuidV4Pattern.test(auditEventId) ||
      expiresAtValue === undefined ||
      typeof inviteId !== "string" ||
      !uuidV4Pattern.test(inviteId) ||
      reasonCode !== "BETA_ADMISSION" ||
      typeof requestId !== "string" ||
      !requestIdPattern.test(requestId) ||
      (!(verifierDigest instanceof Uint8Array) && !Buffer.isBuffer(verifierDigest)) ||
      verifierDigest.byteLength !== 32
    ) {
      fail("input_invalid");
    }
    return Object.freeze({
      auditEventId,
      expiresAt: new Date(expiresAtValue),
      inviteId,
      reasonCode,
      requestId,
      verifierDigest: Buffer.from(verifierDigest),
    });
  } catch (error) {
    if (error instanceof AdminInviteStoreError) {
      throw error;
    }
    fail("input_invalid");
  }
}

function readSingleRow(value: unknown, expectedKeys: ReadonlySet<string>): object {
  try {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      value.length !== 1 ||
      Reflect.ownKeys(value).length !== 2
    ) {
      fail("result_invalid");
    }
    const row = ownDataValue(value, "0");
    if (!isPlainRecord(row) || !hasExactKeys(row, expectedKeys)) {
      fail("result_invalid");
    }
    return row;
  } catch (error) {
    if (error instanceof AdminInviteStoreError) {
      throw error;
    }
    fail("result_invalid");
  }
}

function validateBoundary(value: unknown, expectedKeys: ReadonlySet<string>): void {
  const row = readSingleRow(value, expectedKeys);
  for (const key of expectedKeys) {
    if (ownDataValue(row, key) !== true) {
      fail("runtime_boundary_mismatch");
    }
  }
}

function validateIssueResult(value: unknown): void {
  const row = readSingleRow(value, issueResultKeys);
  if (ownDataValue(row, "issued") !== true) {
    fail("result_invalid");
  }
}

function releaseClient(client: AdminDatabaseClient, destroy: boolean): void {
  try {
    client.release(destroy);
  } catch {
    fail("connection_release_failed");
  }
}

export function createAdminInviteStore(pool: AdminDatabasePool): AdminInviteStore {
  return Object.freeze({
    async issueInvite(value: unknown): Promise<void> {
      const input = readInput(value);
      let client: AdminDatabaseClient;
      try {
        client = await pool.connect();
      } catch {
        input.verifierDigest.fill(0);
        fail("connection_unavailable");
      }

      let destroy = true;
      try {
        let loginBoundary: unknown;
        try {
          loginBoundary = await client.verifyLoginBoundary();
        } catch {
          fail("query_failed");
        }
        validateBoundary(loginBoundary, loginBoundaryKeys);

        try {
          await client.assumeAdminRole();
        } catch {
          fail("query_failed");
        }

        let capabilityBoundary: unknown;
        try {
          capabilityBoundary = await client.verifyCapabilityBoundary();
        } catch {
          fail("query_failed");
        }
        validateBoundary(capabilityBoundary, capabilityBoundaryKeys);

        let result: unknown;
        try {
          result = await client.issueInvite(input);
        } catch {
          fail("query_failed");
        }
        validateIssueResult(result);

        try {
          await client.resetAdminRole();
        } catch {
          fail("query_failed");
        }

        let resetBoundary: unknown;
        try {
          resetBoundary = await client.verifyLoginBoundary();
        } catch {
          fail("query_failed");
        }
        validateBoundary(resetBoundary, loginBoundaryKeys);
        destroy = false;
      } finally {
        input.verifierDigest.fill(0);
        releaseClient(client, destroy);
      }
    },
  });
}

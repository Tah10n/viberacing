import "server-only";

import { Buffer } from "node:buffer";

import { resolvePairingDatabaseConfig } from "./pairing-database-config";
import {
  createPairingDatabasePool,
  type EnrollmentDatabaseClient,
  type EnrollmentDatabaseDeviceRevocation,
  type EnrollmentDatabaseInitialPasskey,
  type EnrollmentDatabaseLoginCompletion,
  type EnrollmentDatabasePasskeyAddition,
  type EnrollmentDatabasePasskeyAddChallenge,
  type EnrollmentDatabasePasskeyChallenge,
  type EnrollmentDatabasePasskeyInventoryRequest,
  type EnrollmentDatabasePasskeyRevocation,
  type EnrollmentDatabasePasskeyRevokeChallenge,
  type EnrollmentDatabasePool,
  type EnrollmentDatabaseProfile,
  type EnrollmentDatabaseProfileDeletion,
  type EnrollmentDatabaseProfileDeletionChallenge,
  type EnrollmentDatabaseProfileVisibilityRequest,
  type EnrollmentDatabaseProfileVisibilityUpdate,
  type EnrollmentDatabaseSessionRevocation,
  type EnrollmentDatabaseSourceDeviceInventoryRequest,
  type PairingDatabasePoolSignalSink,
} from "./pairing-database-pool";
import { enrollmentPatterns } from "./enrollment-domain";

const runtimeColumns = new Set(["login_scope_ok", "read_write_ok", "role_ok", "search_path_ok"]);
const loginMaterialColumns = new Set([
  "backup_eligible",
  "backup_state",
  "cose_public_key",
  "passkey_id",
  "sign_count",
]);
const loginProfileColumns = new Set(["handle", "locale", "profile_id"]);
const passkeyInventoryColumns = new Set([
  "created_on",
  "current_authenticator",
  "label",
  "passkey_id",
  "state",
]);
const activeDeviceInventoryColumns = new Set([
  "activated_on",
  "architecture",
  "connector_version",
  "device_id",
  "device_label",
  "device_state",
  "os_family",
  "source_id",
  "source_state",
]);
const canonicalDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const sourceIdPattern = /^src_[A-Za-z0-9_-]{22}$/;
const deviceIdPattern = /^dev_[A-Za-z0-9_-]{22}$/;
const connectorVersionPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const unsafeLabelPattern = /[\p{Cc}\p{Cf}\p{Cs}]/u;

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
  completePasskeyAddition(input: EnrollmentDatabasePasskeyAddition): Promise<boolean>;
  completePasskeyLogin(input: EnrollmentDatabaseLoginCompletion): Promise<PasskeyLoginProfile>;
  completePasskeyRevocation(input: EnrollmentDatabasePasskeyRevocation): Promise<boolean>;
  completeProfileDeletion(input: EnrollmentDatabaseProfileDeletion): Promise<boolean>;
  createPasskeyAddChallenge(input: EnrollmentDatabasePasskeyAddChallenge): Promise<boolean>;
  createPasskeyChallenge(input: EnrollmentDatabasePasskeyChallenge): Promise<boolean>;
  createPasskeyRevokeChallenge(input: EnrollmentDatabasePasskeyRevokeChallenge): Promise<boolean>;
  createProfileDeletionChallenge(
    input: EnrollmentDatabaseProfileDeletionChallenge,
  ): Promise<boolean>;
  enrollProfile(input: EnrollmentDatabaseProfile): Promise<boolean>;
  readActiveDeviceInventory(
    input: EnrollmentDatabaseSourceDeviceInventoryRequest,
  ): Promise<readonly SourceDeviceInventoryItem[]>;
  readPasskeyInventory(
    input: EnrollmentDatabasePasskeyInventoryRequest,
  ): Promise<readonly PasskeyInventoryItem[]>;
  readPasskeyLoginMaterial(credentialId: Uint8Array): Promise<PasskeyLoginMaterial | undefined>;
  readProfileVisibility(
    input: EnrollmentDatabaseProfileVisibilityRequest,
  ): Promise<ProfileVisibility>;
  revokeDevice(input: EnrollmentDatabaseDeviceRevocation): Promise<boolean>;
  revokeSession(input: EnrollmentDatabaseSessionRevocation): Promise<boolean>;
  setProfileVisibility(
    input: EnrollmentDatabaseProfileVisibilityUpdate,
  ): Promise<ProfileVisibility>;
}

export type ProfileVisibility = "hidden" | "public";

export interface PasskeyLoginMaterial {
  readonly backupEligible: boolean;
  readonly backupState: boolean;
  readonly cosePublicKey: Buffer;
  readonly passkeyId: string;
  readonly signCount: number;
}

export interface PasskeyLoginProfile {
  readonly handle: string;
  readonly locale: "en" | "ru";
  readonly profileId: string;
}

export interface PasskeyInventoryItem {
  readonly createdOn: string;
  readonly currentAuthenticator: boolean;
  readonly label: string;
  readonly passkeyId: string;
  readonly state: "active" | "revoked";
}

export type SourceState = "active" | "paused" | "quarantined" | "unlinked";

export interface ActiveDeviceInventoryItem {
  readonly activatedOn: string;
  readonly architecture: "aarch64" | "x86_64";
  readonly connectorVersion: string;
  readonly deviceId: string;
  readonly label: string;
  readonly osFamily: "linux" | "macos" | "windows";
}

export interface SourceDeviceInventoryItem {
  readonly devices: readonly ActiveDeviceInventoryItem[];
  readonly sourceId: string;
  readonly state: SourceState;
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

function exactProfileVisibility(value: unknown): ProfileVisibility {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    fail("result_invalid");
  }
  const row = value[0];
  const keys = Object.keys(row);
  if (
    keys.length !== 1 ||
    keys[0] !== "visibility" ||
    (row.visibility !== "hidden" && row.visibility !== "public")
  ) {
    fail("result_invalid");
  }
  return row.visibility;
}

function copyBoundedBytes(value: unknown, minimum: number, maximum: number): Buffer | undefined {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    return undefined;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (
    (prototype !== Uint8Array.prototype && prototype !== Buffer.prototype) ||
    value.byteLength < minimum ||
    value.byteLength > maximum
  ) {
    return undefined;
  }
  return Buffer.from(value);
}

function exactLoginMaterial(value: unknown): PasskeyLoginMaterial | undefined {
  let publicKey: Buffer | undefined;
  try {
    if (!Array.isArray(value) || value.length > 1) {
      fail("result_invalid");
    }
    if (value.length === 0) {
      return undefined;
    }
    const row: unknown = value[0];
    if (!isRecord(row)) {
      fail("result_invalid");
    }
    const keys = Object.keys(row);
    publicKey = copyBoundedBytes(row.cose_public_key, 32, 4096);
    if (
      keys.length !== loginMaterialColumns.size ||
      keys.some((key) => !loginMaterialColumns.has(key)) ||
      typeof row.passkey_id !== "string" ||
      !enrollmentPatterns.uuidV4.test(row.passkey_id) ||
      typeof row.sign_count !== "string" ||
      !/^(?:0|[1-9]\d{0,15})$/.test(row.sign_count) ||
      !Number.isSafeInteger(Number(row.sign_count)) ||
      typeof row.backup_eligible !== "boolean" ||
      typeof row.backup_state !== "boolean" ||
      (row.backup_state && !row.backup_eligible) ||
      publicKey === undefined
    ) {
      fail("result_invalid");
    }
    return Object.freeze({
      backupEligible: row.backup_eligible,
      backupState: row.backup_state,
      cosePublicKey: publicKey,
      passkeyId: row.passkey_id,
      signCount: Number(row.sign_count),
    });
  } catch (error) {
    publicKey?.fill(0);
    if (error instanceof EnrollmentDatabaseError) {
      throw error;
    }
    fail("result_invalid");
  }
}

function exactLoginProfile(value: unknown): PasskeyLoginProfile {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    fail("result_invalid");
  }
  const row = value[0];
  const keys = Object.keys(row);
  if (
    keys.length !== loginProfileColumns.size ||
    keys.some((key) => !loginProfileColumns.has(key)) ||
    typeof row.profile_id !== "string" ||
    !enrollmentPatterns.uuidV4.test(row.profile_id) ||
    typeof row.handle !== "string" ||
    !enrollmentPatterns.handle.test(row.handle) ||
    (row.locale !== "en" && row.locale !== "ru")
  ) {
    fail("result_invalid");
  }
  return Object.freeze({ handle: row.handle, locale: row.locale, profileId: row.profile_id });
}

function canonicalDate(value: unknown): value is string {
  if (typeof value !== "string" || !canonicalDatePattern.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function exactPasskeyInventory(value: unknown): readonly PasskeyInventoryItem[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    fail("result_invalid");
  }
  const passkeyIds = new Set<string>();
  let currentCount = 0;
  let previousSortKey: string | undefined;
  const result = value.map((row: unknown) => {
    if (!isRecord(row)) {
      fail("result_invalid");
    }
    const keys = Object.keys(row);
    const labelLength = typeof row.label === "string" ? Array.from(row.label).length : 0;
    if (
      keys.length !== passkeyInventoryColumns.size ||
      keys.some((key) => !passkeyInventoryColumns.has(key)) ||
      typeof row.passkey_id !== "string" ||
      !enrollmentPatterns.uuidV4.test(row.passkey_id) ||
      passkeyIds.has(row.passkey_id) ||
      typeof row.label !== "string" ||
      labelLength < 1 ||
      labelLength > 64 ||
      row.label !== row.label.trim() ||
      row.label !== row.label.normalize("NFC") ||
      unsafeLabelPattern.test(row.label) ||
      (row.state !== "active" && row.state !== "revoked") ||
      !canonicalDate(row.created_on) ||
      typeof row.current_authenticator !== "boolean" ||
      (row.current_authenticator && row.state !== "active")
    ) {
      fail("result_invalid");
    }
    const sortKey = `${row.created_on}\n${row.passkey_id}`;
    if (previousSortKey !== undefined && sortKey <= previousSortKey) {
      fail("result_invalid");
    }
    passkeyIds.add(row.passkey_id);
    previousSortKey = sortKey;
    if (row.current_authenticator) {
      currentCount += 1;
    }
    return Object.freeze({
      createdOn: row.created_on,
      currentAuthenticator: row.current_authenticator,
      label: row.label,
      passkeyId: row.passkey_id,
      state: row.state,
    });
  });
  if (currentCount !== 1) {
    fail("result_invalid");
  }
  return Object.freeze(result);
}

function exactActiveDeviceInventory(value: unknown): readonly SourceDeviceInventoryItem[] {
  if (!Array.isArray(value) || value.length > 64) {
    fail("result_invalid");
  }
  const deviceIds = new Set<string>();
  const sources: {
    devices: ActiveDeviceInventoryItem[];
    sourceId: string;
    state: SourceState;
  }[] = [];
  let currentSource:
    | {
        devices: ActiveDeviceInventoryItem[];
        sourceId: string;
        state: SourceState;
      }
    | undefined;
  for (const row of value as unknown[]) {
    if (!isRecord(row)) {
      fail("result_invalid");
    }
    const keys = Object.keys(row);
    const labelLength =
      typeof row.device_label === "string" ? Array.from(row.device_label).length : 0;
    if (
      keys.length !== activeDeviceInventoryColumns.size ||
      keys.some((key) => !activeDeviceInventoryColumns.has(key)) ||
      typeof row.source_id !== "string" ||
      !sourceIdPattern.test(row.source_id) ||
      (row.source_state !== "active" &&
        row.source_state !== "paused" &&
        row.source_state !== "quarantined" &&
        row.source_state !== "unlinked") ||
      typeof row.device_id !== "string" ||
      !deviceIdPattern.test(row.device_id) ||
      deviceIds.has(row.device_id) ||
      typeof row.device_label !== "string" ||
      labelLength < 1 ||
      labelLength > 64 ||
      row.device_label !== row.device_label.trim() ||
      row.device_label !== row.device_label.normalize("NFC") ||
      unsafeLabelPattern.test(row.device_label) ||
      typeof row.connector_version !== "string" ||
      row.connector_version.length < 5 ||
      row.connector_version.length > 64 ||
      !connectorVersionPattern.test(row.connector_version) ||
      (row.os_family !== "linux" && row.os_family !== "macos" && row.os_family !== "windows") ||
      (row.architecture !== "aarch64" && row.architecture !== "x86_64") ||
      row.device_state !== "active" ||
      !canonicalDate(row.activated_on)
    ) {
      fail("result_invalid");
    }
    if (currentSource?.sourceId !== row.source_id) {
      if (currentSource !== undefined && row.source_id <= currentSource.sourceId) {
        fail("result_invalid");
      }
      currentSource = {
        devices: [],
        sourceId: row.source_id,
        state: row.source_state,
      };
      sources.push(currentSource);
      if (sources.length > 32) {
        fail("result_invalid");
      }
    } else if (currentSource.state !== row.source_state) {
      fail("result_invalid");
    }
    deviceIds.add(row.device_id);
    currentSource.devices.push(
      Object.freeze({
        activatedOn: row.activated_on,
        architecture: row.architecture,
        connectorVersion: row.connector_version,
        deviceId: row.device_id,
        label: row.device_label,
        osFamily: row.os_family,
      }),
    );
  }
  return Object.freeze(
    sources.map((source) =>
      Object.freeze({
        devices: Object.freeze(source.devices),
        sourceId: source.sourceId,
        state: source.state,
      }),
    ),
  );
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
  async function execute<Result>(
    operation: (client: EnrollmentDatabaseClient) => Promise<unknown>,
    readResult: (value: unknown) => Result,
  ): Promise<Result> {
    let client: EnrollmentDatabaseClient;
    try {
      client = await pool.connect();
    } catch {
      fail("connection_unavailable");
    }
    let destroy = false;
    try {
      verifyRuntimeBoundary(await client.verifyRuntimeBoundary());
      return readResult(await operation(client));
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
      return execute(
        (client) => client.completeInitialPasskey(input),
        (value) => exactBooleanRow(value, "registered"),
      );
    },
    completePasskeyAddition(input: EnrollmentDatabasePasskeyAddition): Promise<boolean> {
      return execute(
        (client) => client.completePasskeyAddition(input),
        (value) => exactBooleanRow(value, "added"),
      );
    },
    completePasskeyLogin(input: EnrollmentDatabaseLoginCompletion): Promise<PasskeyLoginProfile> {
      return execute((client) => client.completePasskeyLogin(input), exactLoginProfile);
    },
    completePasskeyRevocation(input: EnrollmentDatabasePasskeyRevocation): Promise<boolean> {
      return execute(
        (client) => client.completePasskeyRevocation(input),
        (value) => exactBooleanRow(value, "revoked"),
      );
    },
    completeProfileDeletion(input: EnrollmentDatabaseProfileDeletion): Promise<boolean> {
      return execute(
        (client) => client.completeProfileDeletion(input),
        (value) => exactBooleanRow(value, "deleted"),
      );
    },
    createPasskeyAddChallenge(input: EnrollmentDatabasePasskeyAddChallenge): Promise<boolean> {
      return execute(
        (client) => client.createPasskeyAddChallenge(input),
        (value) => exactBooleanRow(value, "created"),
      );
    },
    createPasskeyChallenge(input: EnrollmentDatabasePasskeyChallenge): Promise<boolean> {
      return execute(
        (client) => client.createPasskeyChallenge(input),
        (value) => exactBooleanRow(value, "created"),
      );
    },
    createPasskeyRevokeChallenge(
      input: EnrollmentDatabasePasskeyRevokeChallenge,
    ): Promise<boolean> {
      return execute(
        (client) => client.createPasskeyRevokeChallenge(input),
        (value) => exactBooleanRow(value, "created"),
      );
    },
    createProfileDeletionChallenge(
      input: EnrollmentDatabaseProfileDeletionChallenge,
    ): Promise<boolean> {
      return execute(
        (client) => client.createProfileDeletionChallenge(input),
        (value) => exactBooleanRow(value, "created"),
      );
    },
    enrollProfile(input: EnrollmentDatabaseProfile): Promise<boolean> {
      return execute(
        (client) => client.enrollProfile(input),
        (value) => exactBooleanRow(value, "enrolled"),
      );
    },
    readActiveDeviceInventory(
      input: EnrollmentDatabaseSourceDeviceInventoryRequest,
    ): Promise<readonly SourceDeviceInventoryItem[]> {
      return execute(
        (client) => client.readActiveDeviceInventory(input),
        exactActiveDeviceInventory,
      );
    },
    readPasskeyInventory(
      input: EnrollmentDatabasePasskeyInventoryRequest,
    ): Promise<readonly PasskeyInventoryItem[]> {
      return execute((client) => client.readPasskeyInventory(input), exactPasskeyInventory);
    },
    readPasskeyLoginMaterial(credentialId: Uint8Array): Promise<PasskeyLoginMaterial | undefined> {
      return execute((client) => client.readPasskeyLoginMaterial(credentialId), exactLoginMaterial);
    },
    readProfileVisibility(
      input: EnrollmentDatabaseProfileVisibilityRequest,
    ): Promise<ProfileVisibility> {
      return execute((client) => client.readProfileVisibility(input), exactProfileVisibility);
    },
    revokeDevice(input: EnrollmentDatabaseDeviceRevocation): Promise<boolean> {
      return execute(
        (client) => client.revokeDevice(input),
        (value) => exactBooleanRow(value, "revoked"),
      );
    },
    revokeSession(input: EnrollmentDatabaseSessionRevocation): Promise<boolean> {
      return execute(
        (client) => client.revokeEnrollmentSession(input),
        (value) => exactBooleanRow(value, "revoked"),
      );
    },
    setProfileVisibility(
      input: EnrollmentDatabaseProfileVisibilityUpdate,
    ): Promise<ProfileVisibility> {
      return execute(
        (client) => client.setProfileVisibility(input),
        (value) => {
          const visibility = exactProfileVisibility(value);
          if ((visibility === "public") !== input.publiclyVisible) {
            fail("result_invalid");
          }
          return visibility;
        },
      );
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

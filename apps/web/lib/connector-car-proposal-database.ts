import "server-only";

import { Buffer } from "node:buffer";

import { validateCarRecipeV1, type CarRecipeV1 } from "@viberacing/contracts";

import type {
  ConnectorCarProposalDatabaseClient,
  ConnectorCarProposalDatabasePool,
} from "./pairing-database-pool";

const deviceIdPattern = /^dev_[A-Za-z0-9_-]{22}$/;
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const timestampPattern = /^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const runtimeColumns = ["role_ok", "login_scope_ok", "search_path_ok", "read_write_ok"] as const;
const runtimeColumnSet = new Set<string>(runtimeColumns);
const materialKeys = new Set(["device_key_id", "public_key"]);
const mutationKeys = new Set([
  "deviceId",
  "deviceKeyId",
  "nonceDigest",
  "observedAt",
  "proposalId",
  "recipe",
]);

export type ConnectorCarProposalDatabaseErrorCode =
  | "connection_release_failed"
  | "connection_unavailable"
  | "input_invalid"
  | "query_failed"
  | "result_invalid"
  | "runtime_boundary_mismatch";

export class ConnectorCarProposalDatabaseError extends Error {
  readonly code: ConnectorCarProposalDatabaseErrorCode;

  constructor(code: ConnectorCarProposalDatabaseErrorCode) {
    super("Connector car proposal database is unavailable.");
    this.name = "ConnectorCarProposalDatabaseError";
    this.code = code;
  }
}

export interface ConnectorCarProposalDeviceMaterial {
  readonly deviceKeyId: string;
  readonly publicKey: Uint8Array;
}

export interface ConnectorCarProposalMutation {
  readonly deviceId: string;
  readonly deviceKeyId: string;
  readonly nonceDigest: Uint8Array;
  readonly observedAt: string;
  readonly proposalId: string;
  readonly recipe: CarRecipeV1;
}

export interface ConnectorCarProposalDatabase {
  propose(input: unknown): Promise<boolean>;
  readDeviceMaterial(deviceId: unknown): Promise<ConnectorCarProposalDeviceMaterial | null>;
}

interface ValidatedMutation extends Omit<ConnectorCarProposalMutation, "nonceDigest"> {
  readonly nonceDigest: Buffer;
}

function fail(code: ConnectorCarProposalDatabaseErrorCode): never {
  throw new ConnectorCarProposalDatabaseError(code);
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

function readRows(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    fail("result_invalid");
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes("length")) {
    fail("result_invalid");
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      fail("result_invalid");
    }
  }
  return value;
}

function copyBytes(value: unknown, length: number): Buffer | undefined {
  if (!(value instanceof Uint8Array)) {
    return undefined;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (
    (prototype !== Uint8Array.prototype && prototype !== Buffer.prototype) ||
    !(value.buffer instanceof ArrayBuffer) ||
    value.byteLength !== length
  ) {
    return undefined;
  }
  return Buffer.from(value);
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !timestampPattern.test(value)) {
    return false;
  }
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function readMutation(value: unknown): ValidatedMutation {
  let nonceDigest: Buffer | undefined;
  try {
    if (!isPlainRecord(value) || !hasExactKeys(value, mutationKeys)) {
      fail("input_invalid");
    }
    const deviceId = ownDataValue(value, "deviceId");
    const deviceKeyId = ownDataValue(value, "deviceKeyId");
    nonceDigest = copyBytes(ownDataValue(value, "nonceDigest"), 32);
    const observedAt = ownDataValue(value, "observedAt");
    const proposalId = ownDataValue(value, "proposalId");
    const recipe = validateCarRecipeV1(ownDataValue(value, "recipe"));
    if (
      typeof deviceId !== "string" ||
      !deviceIdPattern.test(deviceId) ||
      typeof deviceKeyId !== "string" ||
      !uuidV4Pattern.test(deviceKeyId) ||
      nonceDigest === undefined ||
      typeof proposalId !== "string" ||
      !uuidV4Pattern.test(proposalId) ||
      !validTimestamp(observedAt) ||
      !recipe.ok
    ) {
      nonceDigest?.fill(0);
      fail("input_invalid");
    }
    return Object.freeze({
      deviceId,
      deviceKeyId,
      nonceDigest,
      observedAt,
      proposalId,
      recipe: recipe.value,
    });
  } catch (error) {
    if (error instanceof ConnectorCarProposalDatabaseError) {
      throw error;
    }
    nonceDigest?.fill(0);
    fail("input_invalid");
  }
}

function validRuntimeBoundary(value: unknown): boolean {
  try {
    const rows = readRows(value, 1);
    if (rows.length !== 1) {
      return false;
    }
    const row = rows[0];
    return (
      isPlainRecord(row) &&
      hasExactKeys(row, runtimeColumnSet) &&
      runtimeColumns.every((column) => ownDataValue(row, column) === true)
    );
  } catch {
    return false;
  }
}

async function connect(
  pool: ConnectorCarProposalDatabasePool,
): Promise<ConnectorCarProposalDatabaseClient> {
  try {
    return await pool.connect();
  } catch {
    fail("connection_unavailable");
  }
}

function release(client: ConnectorCarProposalDatabaseClient | undefined, destroy: boolean): void {
  try {
    client?.release(destroy);
  } catch {
    fail("connection_release_failed");
  }
}

async function verifiedClient(
  pool: ConnectorCarProposalDatabasePool,
): Promise<ConnectorCarProposalDatabaseClient> {
  const client = await connect(pool);
  try {
    if (!validRuntimeBoundary(await client.verifyRuntimeBoundary())) {
      release(client, true);
      fail("runtime_boundary_mismatch");
    }
    return client;
  } catch (error) {
    if (error instanceof ConnectorCarProposalDatabaseError) {
      throw error;
    }
    release(client, true);
    fail("query_failed");
  }
}

export function createConnectorCarProposalDatabase(
  pool: ConnectorCarProposalDatabasePool,
): ConnectorCarProposalDatabase {
  return Object.freeze({
    async propose(input: unknown): Promise<boolean> {
      const mutation = readMutation(input);
      let client: ConnectorCarProposalDatabaseClient | undefined;
      let destroy = false;
      try {
        client = await verifiedClient(pool);
        let result: unknown;
        try {
          result = await client.proposeCarRecipeFromDevice(mutation);
        } catch {
          destroy = true;
          fail("query_failed");
        }
        const rows = readRows(result, 1);
        const row = rows[0];
        if (
          rows.length !== 1 ||
          !isPlainRecord(row) ||
          !hasExactKeys(row, new Set(["proposed"])) ||
          ownDataValue(row, "proposed") !== true
        ) {
          destroy = true;
          fail("result_invalid");
        }
        return true;
      } finally {
        mutation.nonceDigest.fill(0);
        release(client, destroy);
      }
    },
    async readDeviceMaterial(
      deviceId: unknown,
    ): Promise<ConnectorCarProposalDeviceMaterial | null> {
      if (typeof deviceId !== "string" || !deviceIdPattern.test(deviceId)) {
        fail("input_invalid");
      }
      let client: ConnectorCarProposalDatabaseClient | undefined;
      let destroy = false;
      try {
        client = await verifiedClient(pool);
        let result: unknown;
        try {
          result = await client.readCarProposalDeviceMaterial(deviceId);
        } catch {
          destroy = true;
          fail("query_failed");
        }
        const rows = readRows(result, 1);
        if (rows.length === 0) {
          return null;
        }
        const row = rows[0];
        if (!isPlainRecord(row) || !hasExactKeys(row, materialKeys)) {
          destroy = true;
          fail("result_invalid");
        }
        const deviceKeyId = ownDataValue(row, "device_key_id");
        const rawPublicKey = ownDataValue(row, "public_key");
        const publicKey = copyBytes(rawPublicKey, 32);
        if (rawPublicKey instanceof Uint8Array) {
          rawPublicKey.fill(0);
        }
        if (
          typeof deviceKeyId !== "string" ||
          !uuidV4Pattern.test(deviceKeyId) ||
          publicKey === undefined
        ) {
          publicKey?.fill(0);
          destroy = true;
          fail("result_invalid");
        }
        return Object.freeze({ deviceKeyId, publicKey });
      } finally {
        release(client, destroy);
      }
    },
  });
}

import { timingSafeEqual } from "node:crypto";

import {
  CommunitySyncVerifierConfigurationError,
  createCommunitySyncVerifier,
  type CommunitySyncVerifier,
  type CommunitySyncVerifierOptions,
} from "./community-sync-verifier.js";
import { decodeCanonicalBase64Url, originKeyIdPattern, originProofKeyBytes } from "./protocol.js";

const environmentKeys = {
  primaryKeyId: "VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_ID",
  primaryKeyValue: "VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_BASE64URL",
  secondaryKeyId: "VIBERACING_INGEST_ORIGIN_SECONDARY_KEY_ID",
  secondaryKeyValue: "VIBERACING_INGEST_ORIGIN_SECONDARY_KEY_BASE64URL",
} as const;
const dependencyKeys = new Set(["now", "readDeviceVerificationMaterial"]);

export type OriginProofConfigurationErrorCode =
  | "duplicate_key_id"
  | "duplicate_key_material"
  | "environment_unreadable"
  | "primary_key_id_invalid"
  | "primary_key_invalid"
  | "secondary_key_id_invalid"
  | "secondary_key_invalid"
  | "secondary_pair_invalid";

export class OriginProofConfigurationError extends Error {
  readonly code: OriginProofConfigurationErrorCode;

  constructor(code: OriginProofConfigurationErrorCode) {
    super("Ingest origin proof configuration is invalid.");
    this.name = "OriginProofConfigurationError";
    this.code = code;
  }
}

export type ConfiguredCommunitySyncVerifierDependencies = Readonly<
  Pick<CommunitySyncVerifierOptions, "now" | "readDeviceVerificationMaterial">
>;

type Environment = Readonly<Record<string, unknown>>;

interface DecodedOriginKey {
  readonly keyId: string;
  readonly key: Buffer;
}

function fail(code: OriginProofConfigurationErrorCode): never {
  throw new OriginProofConfigurationError(code);
}

function dependencyFail(): never {
  throw new CommunitySyncVerifierConfigurationError();
}

function isPlainRecord(value: unknown): value is object {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function readDependencies(value: unknown): ConfiguredCommunitySyncVerifierDependencies {
  try {
    if (!isPlainRecord(value)) {
      dependencyFail();
    }
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== dependencyKeys.size ||
      !keys.every((key) => typeof key === "string" && dependencyKeys.has(key))
    ) {
      dependencyFail();
    }

    const values = Object.fromEntries(
      [...dependencyKeys].map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
          dependencyFail();
        }
        return [key, descriptor.value as unknown];
      }),
    );
    const now = values.now;
    const readDeviceVerificationMaterial = values.readDeviceVerificationMaterial;
    if (typeof now !== "function" || typeof readDeviceVerificationMaterial !== "function") {
      dependencyFail();
    }
    return Object.freeze({
      now: now as ConfiguredCommunitySyncVerifierDependencies["now"],
      readDeviceVerificationMaterial:
        readDeviceVerificationMaterial as ConfiguredCommunitySyncVerifierDependencies["readDeviceVerificationMaterial"],
    });
  } catch (error) {
    if (error instanceof CommunitySyncVerifierConfigurationError) {
      throw error;
    }
    dependencyFail();
  }
}

function readEnvironmentValue(environment: Environment, key: string): unknown {
  return environment[key];
}

function decodeOriginKey(value: unknown): Buffer | undefined {
  return typeof value === "string"
    ? decodeCanonicalBase64Url(value, originProofKeyBytes)
    : undefined;
}

function clearKey(key: Buffer | undefined): void {
  key?.fill(0);
}

function readOriginKeys(environment: Environment): DecodedOriginKey[] {
  let primaryKey: Buffer | undefined;
  let secondaryKey: Buffer | undefined;
  try {
    const primaryKeyId = readEnvironmentValue(environment, environmentKeys.primaryKeyId);
    const primaryKeyValue = readEnvironmentValue(environment, environmentKeys.primaryKeyValue);
    const secondaryKeyId = readEnvironmentValue(environment, environmentKeys.secondaryKeyId);
    const secondaryKeyValue = readEnvironmentValue(environment, environmentKeys.secondaryKeyValue);

    if (typeof primaryKeyId !== "string" || !originKeyIdPattern.test(primaryKeyId)) {
      fail("primary_key_id_invalid");
    }
    primaryKey = decodeOriginKey(primaryKeyValue);
    if (primaryKey === undefined) {
      fail("primary_key_invalid");
    }

    const secondaryIdPresent = secondaryKeyId !== undefined;
    const secondaryValuePresent = secondaryKeyValue !== undefined;
    if (secondaryIdPresent !== secondaryValuePresent) {
      fail("secondary_pair_invalid");
    }
    if (!secondaryIdPresent) {
      return [{ key: primaryKey, keyId: primaryKeyId }];
    }
    if (typeof secondaryKeyId !== "string" || !originKeyIdPattern.test(secondaryKeyId)) {
      fail("secondary_key_id_invalid");
    }
    secondaryKey = decodeOriginKey(secondaryKeyValue);
    if (secondaryKey === undefined) {
      fail("secondary_key_invalid");
    }
    if (primaryKeyId === secondaryKeyId) {
      fail("duplicate_key_id");
    }
    if (timingSafeEqual(primaryKey, secondaryKey)) {
      fail("duplicate_key_material");
    }
    return [
      { key: primaryKey, keyId: primaryKeyId },
      { key: secondaryKey, keyId: secondaryKeyId },
    ];
  } catch (error) {
    clearKey(primaryKey);
    clearKey(secondaryKey);
    if (error instanceof OriginProofConfigurationError) {
      throw error;
    }
    fail("environment_unreadable");
  }
}

export function createConfiguredCommunitySyncVerifier(
  dependencies: unknown,
  environment: Environment = process.env,
): CommunitySyncVerifier {
  const validatedDependencies = readDependencies(dependencies);
  const originKeys = readOriginKeys(environment);
  try {
    return createCommunitySyncVerifier({
      now: validatedDependencies.now,
      originKeys: originKeys.map(({ key, keyId }) => ({ keyId, secret: key })),
      readDeviceVerificationMaterial: validatedDependencies.readDeviceVerificationMaterial,
    });
  } finally {
    for (const { key } of originKeys) {
      clearKey(key);
    }
  }
}

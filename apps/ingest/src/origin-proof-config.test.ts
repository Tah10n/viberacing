import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CommunitySyncVerifierConfigurationError,
  type CommunitySyncVerificationError,
  type CommunitySyncVerifierOptions,
} from "./community-sync-verifier";
import {
  OriginProofConfigurationError,
  createConfiguredCommunitySyncVerifier,
  type ConfiguredCommunitySyncVerifierDependencies,
  type OriginProofConfigurationErrorCode,
} from "./origin-proof-config";
import {
  communitySyncMediaType,
  communitySyncMethod,
  communitySyncRequestTarget,
  createOriginProofMessage,
  digestBody,
  headerNames,
} from "./protocol";

const nowMilliseconds = Date.UTC(2026, 6, 15, 18);
const timestamp = "2026-07-15T18:00:00.000Z";
const primaryKeyId = "edge_primary";
const secondaryKeyId = "edge_previous";
const primaryKey = Buffer.alloc(32, 0x31);
const secondaryKey = Buffer.alloc(32, 0x42);
const originNonce = Buffer.alloc(16, 0x53).toString("base64url");
const deviceNonce = Buffer.alloc(16, 0x64).toString("base64url");
const deviceSignature = Buffer.alloc(64, 0x75).toString("base64url");
const environmentKeys = {
  primaryKeyId: "VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_ID",
  primaryKeyValue: "VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_BASE64URL",
  secondaryKeyId: "VIBERACING_INGEST_ORIGIN_SECONDARY_KEY_ID",
  secondaryKeyValue: "VIBERACING_INGEST_ORIGIN_SECONDARY_KEY_BASE64URL",
} as const;

const primaryEnvironment = Object.freeze({
  [environmentKeys.primaryKeyId]: primaryKeyId,
  [environmentKeys.primaryKeyValue]: primaryKey.toString("base64url"),
});
const rotationEnvironment = Object.freeze({
  ...primaryEnvironment,
  [environmentKeys.secondaryKeyId]: secondaryKeyId,
  [environmentKeys.secondaryKeyValue]: secondaryKey.toString("base64url"),
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function createDependencies(): ConfiguredCommunitySyncVerifierDependencies & {
  readonly consumeOriginNonce: ReturnType<
    typeof vi.fn<CommunitySyncVerifierOptions["consumeOriginNonce"]>
  >;
} {
  const consumeOriginNonce = vi.fn<CommunitySyncVerifierOptions["consumeOriginNonce"]>(() => true);
  return {
    consumeOriginNonce,
    now: () => nowMilliseconds,
    readDeviceVerificationMaterial: () => null,
  };
}

function originAuthenticatedInvalidBodyRequest(keyId: string, key: Uint8Array): unknown {
  const body = Buffer.from("{", "utf8");
  const bodyDigestBase64Url = digestBody(body).base64Url;
  const proof = createHmac("sha256", key)
    .update(
      createOriginProofMessage({
        bodyDigestBase64Url,
        keyId,
        nonce: originNonce,
        timestamp,
      }),
    )
    .digest("base64url");
  return {
    method: communitySyncMethod,
    rawBody: body,
    rawHeaders: [
      headerNames.contentType,
      communitySyncMediaType,
      headerNames.deviceId,
      "dev_AAAAAAAAAAAAAAAAAAAAAA",
      headerNames.deviceNonce,
      deviceNonce,
      headerNames.deviceSignature,
      deviceSignature,
      headerNames.deviceTimestamp,
      timestamp,
      headerNames.idempotencyKey,
      "syn_CCCCCCCCCCCCCCCCCCCCCC",
      headerNames.originKeyId,
      keyId,
      headerNames.originNonce,
      originNonce,
      headerNames.originProof,
      proof,
      headerNames.originTimestamp,
      timestamp,
    ],
    requestTarget: communitySyncRequestTarget,
  };
}

function expectConfigurationError(
  environment: Readonly<Record<string, unknown>>,
  code: OriginProofConfigurationErrorCode,
): void {
  try {
    createConfiguredCommunitySyncVerifier(createDependencies(), environment);
    throw new Error("Expected origin configuration rejection.");
  } catch (error) {
    expect(error).toBeInstanceOf(OriginProofConfigurationError);
    expect(error).toMatchObject({
      code,
      message: "Ingest origin proof configuration is invalid.",
      name: "OriginProofConfigurationError",
    });
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
  }
}

describe("configured Community sync verifier", () => {
  it.each([
    [primaryKeyId, primaryKey],
    [secondaryKeyId, secondaryKey],
  ] as const)("accepts the configured %s rotation key without exposing it", async (keyId, key) => {
    const dependencies = createDependencies();
    const verifier = createConfiguredCommunitySyncVerifier(dependencies, rotationEnvironment);

    await expect(
      verifier.verify(originAuthenticatedInvalidBodyRequest(keyId, key)),
    ).rejects.toEqual(
      expect.objectContaining<Partial<CommunitySyncVerificationError>>({
        code: "invalid_body",
        message: "Community sync request rejected.",
      }),
    );
    expect(dependencies.consumeOriginNonce).toHaveBeenCalledOnce();
    expect(dependencies.consumeOriginNonce).toHaveBeenCalledWith(
      expect.objectContaining({ expiresAtMilliseconds: nowMilliseconds + 60_000, keyId }),
    );
    expect(Reflect.ownKeys(verifier)).toEqual([]);
    expect(JSON.stringify(verifier)).toBe("{}");
  });

  it("reads the mandatory primary key from the default process environment", async () => {
    for (const [key, value] of Object.entries(primaryEnvironment)) {
      vi.stubEnv(key, value);
    }
    const dependencies = createDependencies();
    const verifier = createConfiguredCommunitySyncVerifier(dependencies);

    await expect(
      verifier.verify(originAuthenticatedInvalidBodyRequest(primaryKeyId, primaryKey)),
    ).rejects.toMatchObject({ code: "invalid_body" });
    expect(dependencies.consumeOriginNonce).toHaveBeenCalledOnce();
  });

  it("accepts an exact null-prototype dependency record", async () => {
    const dependencies = createDependencies();
    const nullPrototypeDependencies = Object.assign(Object.create(null) as object, dependencies);
    const verifier = createConfiguredCommunitySyncVerifier(
      nullPrototypeDependencies,
      primaryEnvironment,
    );

    await expect(
      verifier.verify(originAuthenticatedInvalidBodyRequest(primaryKeyId, primaryKey)),
    ).rejects.toMatchObject({ code: "invalid_body" });
    expect(dependencies.consumeOriginNonce).toHaveBeenCalledOnce();
  });

  it("overwrites both temporary decoded rotation keys after verifier construction", () => {
    const fill = vi.spyOn(Buffer.prototype, "fill");

    createConfiguredCommunitySyncVerifier(createDependencies(), rotationEnvironment);

    expect(fill).toHaveBeenCalledTimes(2);
    for (const instance of fill.mock.instances) {
      expect(Buffer.isBuffer(instance)).toBe(true);
      expect((instance as Buffer).every((value) => value === 0)).toBe(true);
    }
  });

  it("overwrites a decoded primary key when secondary configuration fails", () => {
    const fill = vi.spyOn(Buffer.prototype, "fill");

    expectConfigurationError(
      { ...primaryEnvironment, [environmentKeys.secondaryKeyId]: secondaryKeyId },
      "secondary_pair_invalid",
    );

    expect(fill).toHaveBeenCalledOnce();
    for (const instance of fill.mock.instances) {
      expect(Buffer.isBuffer(instance)).toBe(true);
      expect((instance as Buffer).every((value) => value === 0)).toBe(true);
    }
  });

  it.each([
    [
      { [environmentKeys.primaryKeyValue]: primaryEnvironment[environmentKeys.primaryKeyValue] },
      "primary_key_id_invalid",
    ],
    [{ ...primaryEnvironment, [environmentKeys.primaryKeyId]: "edge_" }, "primary_key_id_invalid"],
    [{ [environmentKeys.primaryKeyId]: primaryKeyId }, "primary_key_invalid"],
    [
      {
        ...primaryEnvironment,
        [environmentKeys.primaryKeyValue]: `${primaryEnvironment[environmentKeys.primaryKeyValue]}=`,
      },
      "primary_key_invalid",
    ],
    [
      { ...primaryEnvironment, [environmentKeys.secondaryKeyId]: secondaryKeyId },
      "secondary_pair_invalid",
    ],
    [
      {
        ...primaryEnvironment,
        [environmentKeys.secondaryKeyValue]: secondaryKey.toString("base64url"),
      },
      "secondary_pair_invalid",
    ],
    [
      { ...rotationEnvironment, [environmentKeys.secondaryKeyId]: "previous" },
      "secondary_key_id_invalid",
    ],
    [
      {
        ...rotationEnvironment,
        [environmentKeys.secondaryKeyId]: {
          [Symbol.toPrimitive]() {
            throw new Error("synthetic coercion detail");
          },
        },
      },
      "secondary_key_id_invalid",
    ],
    [
      { ...rotationEnvironment, [environmentKeys.secondaryKeyValue]: "invalid" },
      "secondary_key_invalid",
    ],
    [
      {
        ...rotationEnvironment,
        [environmentKeys.secondaryKeyValue]: {
          [Symbol.toPrimitive]() {
            throw new Error("synthetic key coercion detail");
          },
        },
      },
      "secondary_key_invalid",
    ],
    [
      { ...rotationEnvironment, [environmentKeys.secondaryKeyId]: primaryKeyId },
      "duplicate_key_id",
    ],
    [
      {
        ...rotationEnvironment,
        [environmentKeys.secondaryKeyValue]: primaryKey.toString("base64url"),
      },
      "duplicate_key_material",
    ],
  ] as const)("rejects invalid protected configuration as %s", (environment, code) => {
    expectConfigurationError(environment, code);
  });

  it("contains unreadable environment objects without reflecting their exception", () => {
    const environment = new Proxy(primaryEnvironment, {
      get() {
        throw new Error("synthetic environment detail");
      },
    });

    expectConfigurationError(environment, "environment_unreadable");
  });

  it.each([
    null,
    [],
    { consumeOriginNonce: () => true, now: () => nowMilliseconds },
    {
      consumeOriginNonce: () => true,
      extra: true,
      now: () => nowMilliseconds,
      readDeviceVerificationMaterial: () => null,
    },
    {
      get consumeOriginNonce() {
        throw new Error("synthetic accessor detail");
      },
      now: () => nowMilliseconds,
      readDeviceVerificationMaterial: () => null,
    },
    {
      consumeOriginNonce: true,
      now: () => nowMilliseconds,
      readDeviceVerificationMaterial: () => null,
    },
    new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error("synthetic proxy detail");
        },
      },
    ),
  ])("rejects malformed verifier dependencies before reading protected keys", (dependencies) => {
    expect(() => createConfiguredCommunitySyncVerifier(dependencies, rotationEnvironment)).toThrow(
      CommunitySyncVerifierConfigurationError,
    );
  });
});

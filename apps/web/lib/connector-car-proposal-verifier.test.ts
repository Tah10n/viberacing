// @vitest-environment node

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import vector from "../../../contracts/v1/connector-car-proposal-device-request.test-vector.json";
import { describe, expect, it, vi } from "vitest";

import {
  ConnectorCarProposalVerificationError,
  createConnectorCarProposalVerifier,
  type ConnectorCarProposalVerifierOptions,
} from "./connector-car-proposal-verifier";

const deviceKeyId = "00000000-0000-4000-8000-000000000801";
const vectorTime = Date.parse(vector.deviceTimestamp);

function request(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    deviceId: vector.deviceId,
    deviceNonce: vector.deviceNonceBase64Url,
    deviceSignature: vector.deviceSignatureBase64Url,
    deviceTimestamp: vector.deviceTimestamp,
    rawBody: Buffer.from(vector.body),
    ...overrides,
  });
}

function material() {
  return {
    deviceKeyId,
    publicKey: Buffer.from(vector.devicePublicKeyBase64Url, "base64url"),
  };
}

async function errorCode(
  input: unknown,
  options: {
    readonly now?: number;
    readonly readDeviceMaterial?: ConnectorCarProposalVerifierOptions["readDeviceMaterial"];
  } = {},
): Promise<string> {
  try {
    await createConnectorCarProposalVerifier({
      now: () => options.now ?? vectorTime,
      readDeviceMaterial: options.readDeviceMaterial ?? material,
    }).verify(input);
    throw new Error("expected verification failure");
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectorCarProposalVerificationError);
    return (error as ConnectorCarProposalVerificationError).code;
  }
}

describe("connector car proposal verifier", () => {
  it("verifies the shared exact-body signature and returns only bounded mutation material", async () => {
    const rawPublicKey = Buffer.from(vector.devicePublicKeyBase64Url, "base64url");
    const readDeviceMaterial = vi.fn(() => ({ deviceKeyId, publicKey: rawPublicKey }));
    const verified = await createConnectorCarProposalVerifier({
      now: () => vectorTime,
      readDeviceMaterial,
    }).verify(request());

    expect(readDeviceMaterial).toHaveBeenCalledWith(vector.deviceId);
    expect(verified).toMatchObject({
      deviceId: vector.deviceId,
      deviceKeyId,
      observedAt: vector.deviceTimestamp,
      recipe: {
        schemaVersion: 1,
        chassis: "formula",
        nose: "wedge",
        cockpit: "canopy",
        wing: "high",
        wheels: "slick",
        palette: "turbo-blue",
        trail: "spark",
        seed: 4242,
      },
    });
    expect(Buffer.from(verified.nonceDigest)).toEqual(
      createHash("sha256")
        .update("viberacing-car-proposal-nonce-v1\0", "utf8")
        .update(Buffer.from(vector.deviceNonceBytes))
        .digest(),
    );
    expect(Object.isFrozen(verified)).toBe(true);
    expect(Object.isFrozen(verified.recipe)).toBe(true);
    expect(rawPublicKey).toEqual(Buffer.alloc(32));
    verified.nonceDigest.fill(0);
  });

  it("enforces the exact exclusive-age and inclusive-future boundaries", async () => {
    await expect(
      createConnectorCarProposalVerifier({
        now: () => vectorTime + 299_999,
        readDeviceMaterial: material,
      }).verify(request()),
    ).resolves.toMatchObject({ deviceId: vector.deviceId });
    expect(await errorCode(request(), { now: vectorTime + 300_000 })).toBe("device_rejected");
    await expect(
      createConnectorCarProposalVerifier({
        now: () => vectorTime - 120_000,
        readDeviceMaterial: material,
      }).verify(request()),
    ).resolves.toMatchObject({ deviceId: vector.deviceId });
    expect(await errorCode(request(), { now: vectorTime - 120_001 })).toBe("device_rejected");
  });

  it("collapses unknown devices and invalid signatures into one non-reflective rejection", async () => {
    expect(await errorCode(request(), { readDeviceMaterial: () => null })).toBe("device_rejected");
    const invalidSignature = `${vector.deviceSignatureBase64Url.slice(0, -1)}A`;
    expect(await errorCode(request({ deviceSignature: invalidSignature }))).toBe("device_rejected");
  });

  it.each([
    '{"schemaVersion":1,"schemaVersion":1}',
    JSON.stringify({ ...JSON.parse(vector.body), conversation: "private prompt" }),
    JSON.stringify({ ...JSON.parse(vector.body), palette: "#ffffff" }),
    JSON.stringify({ ...JSON.parse(vector.body), seed: { value: 1 } }),
    "[]",
  ])("rejects non-contract body %s before signature interpretation", async (body) => {
    expect(await errorCode(request({ rawBody: Buffer.from(body) }))).toBe("invalid_body");
  });

  it("rejects malformed headers, timestamp, byte containers, and accessor-backed input", async () => {
    expect(await errorCode(request({ deviceNonce: "short" }))).toBe("invalid_request");
    expect(await errorCode(request({ deviceTimestamp: "2026-02-30T00:00:00.000Z" }))).toBe(
      "invalid_request",
    );
    expect(await errorCode(request({ rawBody: new DataView(new ArrayBuffer(8)) }))).toBe(
      "invalid_request",
    );
    const accessor = { ...request() };
    let reads = 0;
    Object.defineProperty(accessor, "deviceId", {
      enumerable: true,
      get() {
        reads += 1;
        return vector.deviceId;
      },
    });
    expect(await errorCode(accessor)).toBe("invalid_request");
    expect(reads).toBe(0);
  });

  it("contains dependency failures and malformed database material", async () => {
    expect(
      await errorCode(request(), { readDeviceMaterial: () => Promise.reject(new Error("x")) }),
    ).toBe("dependency_unavailable");
    expect(
      await errorCode(request(), {
        readDeviceMaterial: () => ({ deviceKeyId: "private", publicKey: Buffer.alloc(32) }),
      }),
    ).toBe("dependency_unavailable");
    expect(
      await errorCode(request(), {
        readDeviceMaterial: () => ({ deviceKeyId, publicKey: Buffer.alloc(31) }),
      }),
    ).toBe("dependency_unavailable");
  });
});

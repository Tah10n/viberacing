// @vitest-environment node

import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";

import {
  ConnectorCarProposalDatabaseError,
  createConnectorCarProposalDatabase,
} from "./connector-car-proposal-database";
import type {
  ConnectorCarProposalDatabaseClient,
  ConnectorCarProposalDatabasePool,
} from "./pairing-database-pool";

const deviceId = "dev_AAAAAAAAAAAAAAAAAAAAAA";
const deviceKeyId = "00000000-0000-4000-8000-000000000801";
const proposalId = "00000000-0000-4000-8000-000000000802";
const runtime = [
  { login_scope_ok: true, read_write_ok: true, role_ok: true, search_path_ok: true },
];
const recipe = Object.freeze({
  schemaVersion: 1 as const,
  chassis: "formula" as const,
  nose: "wedge" as const,
  cockpit: "canopy" as const,
  wing: "high" as const,
  wheels: "slick" as const,
  palette: "turbo-blue" as const,
  trail: "spark" as const,
  seed: 4242,
});

function mutation(nonceDigest: Uint8Array = Buffer.alloc(32, 0x71)) {
  return {
    deviceId,
    deviceKeyId,
    nonceDigest,
    observedAt: "2026-07-17T12:34:56.789Z",
    proposalId,
    recipe,
  };
}

function boundary(options: {
  readonly material?: unknown;
  readonly proposed?: unknown;
  readonly runtimeResult?: unknown;
}) {
  const releases: boolean[] = [];
  const proposeCarRecipeFromDevice = vi.fn((input: unknown) => {
    void input;
    return Promise.resolve(options.proposed ?? [{ proposed: true }]);
  });
  const readCarProposalDeviceMaterial = vi.fn((requestedDeviceId: string) => {
    void requestedDeviceId;
    return Promise.resolve(options.material ?? []);
  });
  const client = {
    proposeCarRecipeFromDevice,
    readCarProposalDeviceMaterial,
    release(destroy = false) {
      releases.push(destroy);
    },
    verifyRuntimeBoundary: () => Promise.resolve(options.runtimeResult ?? runtime),
  } as ConnectorCarProposalDatabaseClient;
  const connect = vi.fn(() => Promise.resolve(client));
  const pool = { close: () => Promise.resolve(), connect } as ConnectorCarProposalDatabasePool;
  return { connect, pool, proposeCarRecipeFromDevice, readCarProposalDeviceMaterial, releases };
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    throw new Error("expected database rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectorCarProposalDatabaseError);
    expect((error as ConnectorCarProposalDatabaseError).code).toBe(code);
  }
}

describe("connector car proposal database boundary", () => {
  it("probes every checkout, submits one exact mutation, and wipes the query digest", async () => {
    const current = boundary({});
    const originalDigest = Buffer.alloc(32, 0x71);
    await expect(
      createConnectorCarProposalDatabase(current.pool).propose(mutation(originalDigest)),
    ).resolves.toBe(true);

    expect(current.connect).toHaveBeenCalledTimes(1);
    expect(current.proposeCarRecipeFromDevice).toHaveBeenCalledTimes(1);
    const submitted = current.proposeCarRecipeFromDevice.mock.calls[0]?.[0] as
      { readonly nonceDigest: Uint8Array } | undefined;
    expect(submitted).toMatchObject({ deviceId, deviceKeyId, proposalId, recipe });
    expect(submitted?.nonceDigest).toEqual(Buffer.alloc(32));
    expect(originalDigest).toEqual(Buffer.alloc(32, 0x71));
    expect(current.releases).toEqual([false]);
  });

  it("returns only copied active device proof material and wipes the driver buffer", async () => {
    const rawPublicKey = Buffer.alloc(32, 0x44);
    const current = boundary({
      material: [{ device_key_id: deviceKeyId, public_key: rawPublicKey }],
    });
    const result = await createConnectorCarProposalDatabase(current.pool).readDeviceMaterial(
      deviceId,
    );

    expect(result).toEqual({ deviceKeyId, publicKey: Buffer.alloc(32, 0x44) });
    expect(rawPublicKey).toEqual(Buffer.alloc(32));
    expect(current.readCarProposalDeviceMaterial).toHaveBeenCalledWith(deviceId);
    expect(current.releases).toEqual([false]);
    result?.publicKey.fill(0);
  });

  it("represents a non-active device only as absence", async () => {
    const current = boundary({ material: [] });
    await expect(
      createConnectorCarProposalDatabase(current.pool).readDeviceMaterial(deviceId),
    ).resolves.toBeNull();
    expect(current.releases).toEqual([false]);
  });

  it("destroys a checkout after malformed results, query failure, or runtime mismatch", async () => {
    const malformed = boundary({ proposed: [{ proposed: false }] });
    await expectCode(
      createConnectorCarProposalDatabase(malformed.pool).propose(mutation()),
      "result_invalid",
    );
    expect(malformed.releases).toEqual([true]);

    const failed = boundary({});
    failed.proposeCarRecipeFromDevice.mockRejectedValueOnce(new Error("private query failure"));
    await expectCode(
      createConnectorCarProposalDatabase(failed.pool).propose(mutation()),
      "query_failed",
    );
    expect(failed.releases).toEqual([true]);

    const mismatched = boundary({ runtimeResult: [{ ...runtime[0], role_ok: false }] });
    await expectCode(
      createConnectorCarProposalDatabase(mismatched.pool).readDeviceMaterial(deviceId),
      "runtime_boundary_mismatch",
    );
    expect(mismatched.releases).toEqual([true]);

    const rawPublicKey = Buffer.alloc(32, 0x45);
    const malformedMaterial = boundary({
      material: [{ device_key_id: "private", public_key: rawPublicKey }],
    });
    await expectCode(
      createConnectorCarProposalDatabase(malformedMaterial.pool).readDeviceMaterial(deviceId),
      "result_invalid",
    );
    expect(rawPublicKey).toEqual(Buffer.alloc(32));
    expect(malformedMaterial.releases).toEqual([true]);
  });

  it("rejects unknown, malformed, and accessor-backed input before checkout", async () => {
    const current = boundary({});
    await expectCode(
      createConnectorCarProposalDatabase(current.pool).propose({ ...mutation(), private: true }),
      "input_invalid",
    );
    await expectCode(
      createConnectorCarProposalDatabase(current.pool).readDeviceMaterial("dev_short"),
      "input_invalid",
    );
    const accessor = mutation() as Record<string, unknown>;
    let reads = 0;
    Object.defineProperty(accessor, "deviceId", {
      enumerable: true,
      get() {
        reads += 1;
        return deviceId;
      },
    });
    await expectCode(
      createConnectorCarProposalDatabase(current.pool).propose(accessor),
      "input_invalid",
    );
    expect(reads).toBe(0);
    expect(current.connect).not.toHaveBeenCalled();
  });
});

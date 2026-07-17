// @vitest-environment node

import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";

import {
  ConnectorCarProposalApplicationConfigurationError,
  createConnectorCarProposalApplication,
} from "./connector-car-proposal-application";
import type { ConnectorCarProposalDatabase } from "./connector-car-proposal-database";
import {
  ConnectorCarProposalVerificationError,
  type ConnectorCarProposalVerifier,
} from "./connector-car-proposal-verifier";

const requestId = "req_AAAAAAAAAAAAAAAAAAAAAA";
const deviceId = "dev_BBBBBBBBBBBBBBBBBBBBBB";
const deviceKeyId = "00000000-0000-4000-8000-000000000801";
const observedAt = "2026-07-17T12:34:56.789Z";
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

function input(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    deviceId,
    deviceNonce: "A".repeat(22),
    deviceSignature: "A".repeat(86),
    deviceTimestamp: observedAt,
    rawBody: Buffer.from("{}"),
  });
}

function dependencies(
  options: { readonly proposed?: boolean; readonly verifierError?: Error } = {},
) {
  const nonceDigest = Buffer.alloc(32, 0x71);
  const verify = vi.fn(() =>
    options.verifierError === undefined
      ? Promise.resolve({ deviceId, deviceKeyId, nonceDigest, observedAt, recipe })
      : Promise.reject(options.verifierError),
  );
  const propose = vi.fn(() => Promise.resolve(options.proposed ?? true));
  return {
    database: { propose, readDeviceMaterial: vi.fn() } satisfies ConnectorCarProposalDatabase,
    nonceDigest,
    propose,
    verifier: { verify } satisfies ConnectorCarProposalVerifier,
    verify,
  };
}

describe("connector car proposal application", () => {
  it("generates a server-owned proposal id and settles one verified mutation", async () => {
    const current = dependencies();
    const application = createConnectorCarProposalApplication({
      database: current.database,
      randomBytes: (size) => Uint8Array.from({ length: size }, (_, index) => index),
      verifier: current.verifier,
    });

    await expect(application.execute(input(), requestId)).resolves.toEqual({
      outcome: "accepted",
      requestId,
    });
    expect(current.propose).toHaveBeenCalledTimes(1);
    expect(current.propose).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId,
        deviceKeyId,
        observedAt,
        proposalId: "00010203-0405-4607-8809-0a0b0c0d0e0f",
        recipe,
      }),
    );
    expect(current.nonceDigest).toEqual(Buffer.alloc(32));
  });

  it.each([
    ["device_rejected", "unauthorized"],
    ["invalid_body", "validation_failed"],
    ["invalid_request", "invalid_request"],
    ["dependency_unavailable", "temporarily_unavailable"],
  ] as const)("maps %s to the closed %s decision", async (code, problem) => {
    const current = dependencies({
      verifierError: new ConnectorCarProposalVerificationError(code),
    });
    await expect(
      createConnectorCarProposalApplication(current).execute(input(), requestId),
    ).resolves.toEqual({ outcome: "rejected", problem, requestId });
    expect(current.propose).not.toHaveBeenCalled();
  });

  it("contains database rejection, database failure, and invalid entropy", async () => {
    const rejected = dependencies({ proposed: false });
    await expect(
      createConnectorCarProposalApplication(rejected).execute(input(), requestId),
    ).resolves.toMatchObject({ outcome: "rejected", problem: "temporarily_unavailable" });

    const failed = dependencies();
    failed.propose.mockRejectedValueOnce(new Error("private database failure"));
    await expect(
      createConnectorCarProposalApplication(failed).execute(input(), requestId),
    ).resolves.toMatchObject({ outcome: "rejected", problem: "temporarily_unavailable" });

    const entropy = dependencies();
    await expect(
      createConnectorCarProposalApplication({
        ...entropy,
        randomBytes: () => new Uint8Array(15),
      }).execute(input(), requestId),
    ).resolves.toMatchObject({ outcome: "rejected", problem: "temporarily_unavailable" });
    expect(entropy.propose).not.toHaveBeenCalled();
    expect(entropy.nonceDigest).toEqual(Buffer.alloc(32));
  });

  it("rejects non-exact requests before verification and rejects invalid server request ids", async () => {
    const current = dependencies();
    await expect(
      createConnectorCarProposalApplication(current).execute(
        { ...input(), private: true },
        requestId,
      ),
    ).resolves.toEqual({ outcome: "rejected", problem: "invalid_request", requestId });
    expect(current.verify).not.toHaveBeenCalled();

    await expect(
      createConnectorCarProposalApplication(current).execute(input(), "private-request"),
    ).rejects.toBeInstanceOf(ConnectorCarProposalApplicationConfigurationError);
  });
});

import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import {
  createPairingActivationTiming,
  pairingActivationMinimumSettlementMs,
  PairingActivationTimingError,
} from "./pairing-activation-timing";

describe("pairing activation timing", () => {
  it("holds a fresh attempt through the fixed minimum settlement floor", async () => {
    const timing = createPairingActivationTiming();
    const startedAt = timing.start();
    const before = performance.now();

    await timing.settle(startedAt);

    expect(performance.now() - before).toBeGreaterThanOrEqual(
      pairingActivationMinimumSettlementMs - 20,
    );
    expect(Object.isFrozen(timing)).toBe(true);
  });

  it("does not add delay after work already exceeded the floor", async () => {
    const timing = createPairingActivationTiming();

    await expect(
      timing.settle(performance.now() - pairingActivationMinimumSettlementMs - 1),
    ).resolves.toBeUndefined();
  });

  it.each([undefined, null, "0", Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid start marker: %o",
    async (startedAt) => {
      await expect(createPairingActivationTiming().settle(startedAt)).rejects.toBeInstanceOf(
        PairingActivationTimingError,
      );
    },
  );
});

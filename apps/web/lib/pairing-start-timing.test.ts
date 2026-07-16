import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import {
  createPairingStartTiming,
  pairingStartMinimumSettlementMs,
  PairingStartTimingError,
} from "./pairing-start-timing";

describe("pairing start timing", () => {
  it("holds a fresh admitted attempt through the fixed settlement floor", async () => {
    const timing = createPairingStartTiming();
    const startedAt = timing.start();
    const before = performance.now();

    await timing.settle(startedAt);

    expect(performance.now() - before).toBeGreaterThanOrEqual(pairingStartMinimumSettlementMs - 20);
    expect(Object.isFrozen(timing)).toBe(true);
  });

  it("settles immediately after prior work exceeds the floor", async () => {
    await expect(
      createPairingStartTiming().settle(performance.now() - pairingStartMinimumSettlementMs - 1),
    ).resolves.toBeUndefined();
  });

  it.each([undefined, null, "0", Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid start marker: %o",
    async (startedAt) => {
      await expect(createPairingStartTiming().settle(startedAt)).rejects.toBeInstanceOf(
        PairingStartTimingError,
      );
    },
  );
});

import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import { createRecoveryTiming } from "./recovery-timing";

describe("recovery timing", () => {
  it("holds an admitted attempt through the configured minimum floor", async () => {
    const timing = createRecoveryTiming(100);
    const startedAt = timing.start();
    const before = performance.now();

    await timing.settle(startedAt);

    expect(performance.now() - before).toBeGreaterThanOrEqual(80);
    expect(Object.isFrozen(timing)).toBe(true);
  });

  it("adds no delay after work has already exceeded the floor", async () => {
    const timing = createRecoveryTiming(100);

    await expect(timing.settle(performance.now() - 101)).resolves.toBeUndefined();
  });

  it.each([99, 5_001, 100.5, Number.NaN])("rejects an unsafe floor: %o", (value) => {
    expect(() => createRecoveryTiming(value)).toThrow("Recovery timing is unavailable.");
  });
});

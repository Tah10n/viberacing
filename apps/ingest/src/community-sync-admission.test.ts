import { describe, expect, it } from "vitest";

import {
  CommunitySyncAdmissionConfigurationError,
  createCommunitySyncAdmission,
  createCommunitySyncKeyedAdmission,
} from "./community-sync-admission.js";

describe("Community sync admission", () => {
  it.each([0, -1, 1.5, 33, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an unsafe concurrency limit: %o",
    (limit) => {
      expect(() => createCommunitySyncAdmission(limit)).toThrow(
        CommunitySyncAdmissionConfigurationError,
      );
    },
  );

  it("admits only the active budget and releases leases idempotently", () => {
    const admission = createCommunitySyncAdmission(2);
    const first = admission.tryAcquire();
    const second = admission.tryAcquire();

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(admission.tryAcquire()).toBeUndefined();
    expect(Object.isFrozen(admission)).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(second)).toBe(true);

    first?.release();
    first?.release();
    const replacement = admission.tryAcquire();
    expect(replacement).toBeDefined();
    expect(admission.tryAcquire()).toBeUndefined();

    second?.release();
    replacement?.release();
    expect(admission.tryAcquire()).toBeDefined();
  });

  it.each([
    [0, 1],
    [1, 0],
    [33, 1],
    [1, 33],
    [1.5, 1],
    [1, Number.NaN],
  ])("rejects unsafe keyed admission limits: %o/%o", (limit, maximumKeys) => {
    expect(() => createCommunitySyncKeyedAdmission(limit, maximumKeys)).toThrow(
      CommunitySyncAdmissionConfigurationError,
    );
  });

  it("bounds each key and the active key inventory without retaining released keys", () => {
    const admission = createCommunitySyncKeyedAdmission(2, 2);
    const firstA = admission.tryAcquire("device-a");
    const secondA = admission.tryAcquire("device-a");
    const firstB = admission.tryAcquire("device-b");

    expect(firstA).toBeDefined();
    expect(secondA).toBeDefined();
    expect(firstB).toBeDefined();
    expect(admission.tryAcquire("device-a")).toBeUndefined();
    expect(admission.tryAcquire("device-c")).toBeUndefined();
    expect(admission.tryAcquire("")).toBeUndefined();
    expect(admission.tryAcquire("x".repeat(65))).toBeUndefined();
    expect(admission.tryAcquire(42 as never)).toBeUndefined();

    firstA?.release();
    firstA?.release();
    expect(admission.tryAcquire("device-a")).toBeDefined();
    firstB?.release();
    expect(admission.tryAcquire("device-c")).toBeDefined();
    secondA?.release();
  });
});

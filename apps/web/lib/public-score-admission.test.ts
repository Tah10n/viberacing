import { describe, expect, it } from "vitest";

import {
  createPublicScoreAdmission,
  PublicScoreAdmissionConfigurationError,
} from "./public-score-admission";

describe("public score admission", () => {
  it.each([0, -1, 1.5, 33, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an unsafe concurrency limit: %o",
    (limit) => {
      expect(() => createPublicScoreAdmission(limit)).toThrow(
        PublicScoreAdmissionConfigurationError,
      );
    },
  );

  it("admits only the fixed active budget and releases leases idempotently", () => {
    const admission = createPublicScoreAdmission(2);
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
});

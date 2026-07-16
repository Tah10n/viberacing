import { describe, expect, it } from "vitest";

import { createEnrollmentAdmission } from "./enrollment-admission";

describe("enrollment admission", () => {
  it("admits a bounded number without a queue and releases idempotently", () => {
    const admission = createEnrollmentAdmission(2);
    const first = admission.tryAcquire();
    const second = admission.tryAcquire();
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(admission.tryAcquire()).toBeUndefined();
    first?.release();
    first?.release();
    expect(admission.tryAcquire()).toBeDefined();
  });

  it.each([0, 33, 1.5, Number.NaN])("rejects invalid limit %s", (limit) => {
    expect(() => createEnrollmentAdmission(limit)).toThrow(
      "Enrollment admission configuration is invalid.",
    );
  });
});

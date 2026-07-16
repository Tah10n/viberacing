import { describe, expect, it } from "vitest";

import {
  createPairingStartAdmission,
  pairingStartConcurrencyLimit,
  PairingStartAdmissionConfigurationError,
} from "./pairing-start-admission";

describe("pairing start admission", () => {
  it.each([0, -1, 1.5, 33, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an unsafe concurrency limit: %o",
    (limit) => {
      expect(() => createPairingStartAdmission(limit)).toThrow(
        PairingStartAdmissionConfigurationError,
      );
    },
  );

  it("enforces the exact default budget and releases leases idempotently", () => {
    const admission = createPairingStartAdmission();
    const leases = Array.from({ length: pairingStartConcurrencyLimit }, () =>
      admission.tryAcquire(),
    );

    expect(leases.every((lease) => lease !== undefined)).toBe(true);
    expect(admission.tryAcquire()).toBeUndefined();
    leases[0]?.release();
    leases[0]?.release();
    const replacement = admission.tryAcquire();
    expect(replacement).toBeDefined();
    expect(admission.tryAcquire()).toBeUndefined();

    for (const lease of leases.slice(1)) {
      lease?.release();
    }
    replacement?.release();
    expect(admission.tryAcquire()).toBeDefined();
    expect(Object.isFrozen(admission)).toBe(true);
  });
});

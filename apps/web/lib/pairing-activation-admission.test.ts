import { describe, expect, it } from "vitest";

import {
  createPairingActivationAdmission,
  pairingActivationConcurrencyLimit,
  PairingActivationAdmissionConfigurationError,
} from "./pairing-activation-admission";

describe("pairing activation admission", () => {
  it.each([0, -1, 1.5, 33, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an unsafe concurrency limit: %o",
    (limit) => {
      expect(() => createPairingActivationAdmission(limit)).toThrow(
        PairingActivationAdmissionConfigurationError,
      );
    },
  );

  it("enforces the exact default budget and releases leases idempotently", () => {
    const admission = createPairingActivationAdmission();
    const leases = Array.from({ length: pairingActivationConcurrencyLimit }, () =>
      admission.tryAcquire(),
    );

    expect(leases.every((lease) => lease !== undefined)).toBe(true);
    expect(admission.tryAcquire()).toBeUndefined();
    expect(Object.isFrozen(admission)).toBe(true);
    expect(leases.every((lease) => Object.isFrozen(lease))).toBe(true);

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
  });
});

import "server-only";

const maximumAdmissionLimit = 32;

export const pairingActivationConcurrencyLimit = 4;

export class PairingActivationAdmissionConfigurationError extends Error {
  constructor() {
    super("Pairing activation admission configuration is invalid.");
    this.name = "PairingActivationAdmissionConfigurationError";
  }
}

export interface PairingActivationAdmissionLease {
  release(): void;
}

export interface PairingActivationAdmission {
  tryAcquire(): PairingActivationAdmissionLease | undefined;
}

export function createPairingActivationAdmission(
  limit: number = pairingActivationConcurrencyLimit,
): PairingActivationAdmission {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumAdmissionLimit) {
    throw new PairingActivationAdmissionConfigurationError();
  }

  let active = 0;
  return Object.freeze({
    tryAcquire(): PairingActivationAdmissionLease | undefined {
      if (active >= limit) {
        return undefined;
      }
      active += 1;
      let released = false;
      return Object.freeze({
        release(): void {
          if (!released) {
            released = true;
            active -= 1;
          }
        },
      });
    },
  });
}

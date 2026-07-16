import "server-only";

const maximumAdmissionLimit = 32;

export const pairingStartConcurrencyLimit = 4;

export class PairingStartAdmissionConfigurationError extends Error {
  constructor() {
    super("Pairing start admission configuration is invalid.");
    this.name = "PairingStartAdmissionConfigurationError";
  }
}

export interface PairingStartAdmissionLease {
  release(): void;
}

export interface PairingStartAdmission {
  tryAcquire(): PairingStartAdmissionLease | undefined;
}

export function createPairingStartAdmission(
  limit: number = pairingStartConcurrencyLimit,
): PairingStartAdmission {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumAdmissionLimit) {
    throw new PairingStartAdmissionConfigurationError();
  }

  let active = 0;
  return Object.freeze({
    tryAcquire(): PairingStartAdmissionLease | undefined {
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

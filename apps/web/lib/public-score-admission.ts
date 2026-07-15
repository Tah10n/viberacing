import "server-only";

const maximumAdmissionLimit = 32;

export class PublicScoreAdmissionConfigurationError extends Error {
  constructor() {
    super("Public score admission configuration is invalid.");
    this.name = "PublicScoreAdmissionConfigurationError";
  }
}

export interface PublicScoreAdmissionLease {
  release(): void;
}

export interface PublicScoreAdmission {
  tryAcquire(): PublicScoreAdmissionLease | undefined;
}

export function createPublicScoreAdmission(limit: number): PublicScoreAdmission {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumAdmissionLimit) {
    throw new PublicScoreAdmissionConfigurationError();
  }

  let active = 0;
  return Object.freeze({
    tryAcquire(): PublicScoreAdmissionLease | undefined {
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

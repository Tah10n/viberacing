import "server-only";

const maximumAdmissionLimit = 32;

export class PublicSnapshotAdmissionConfigurationError extends Error {
  constructor() {
    super("Public snapshot admission configuration is invalid.");
    this.name = "PublicSnapshotAdmissionConfigurationError";
  }
}

export interface PublicSnapshotAdmissionLease {
  release(): void;
}

export interface PublicSnapshotAdmission {
  tryAcquire(): PublicSnapshotAdmissionLease | undefined;
}

export function createPublicSnapshotAdmission(limit: number): PublicSnapshotAdmission {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumAdmissionLimit) {
    throw new PublicSnapshotAdmissionConfigurationError();
  }

  let active = 0;
  return Object.freeze({
    tryAcquire(): PublicSnapshotAdmissionLease | undefined {
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

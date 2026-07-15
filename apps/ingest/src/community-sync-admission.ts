const maximumAdmissionLimit = 32;

export class CommunitySyncAdmissionConfigurationError extends Error {
  constructor() {
    super("Community sync admission configuration is invalid.");
    this.name = "CommunitySyncAdmissionConfigurationError";
  }
}

export interface CommunitySyncAdmissionLease {
  release(): void;
}

export interface CommunitySyncAdmission {
  tryAcquire(): CommunitySyncAdmissionLease | undefined;
}

export function createCommunitySyncAdmission(limit: number): CommunitySyncAdmission {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumAdmissionLimit) {
    throw new CommunitySyncAdmissionConfigurationError();
  }

  let active = 0;
  return Object.freeze({
    tryAcquire(): CommunitySyncAdmissionLease | undefined {
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

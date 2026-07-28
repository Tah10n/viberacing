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

export interface CommunitySyncKeyedAdmission {
  tryAcquire(key: string): CommunitySyncAdmissionLease | undefined;
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

export function createCommunitySyncKeyedAdmission(
  limitPerKey: number,
  maximumActiveKeys: number,
): CommunitySyncKeyedAdmission {
  if (
    !Number.isSafeInteger(limitPerKey) ||
    limitPerKey < 1 ||
    limitPerKey > maximumAdmissionLimit ||
    !Number.isSafeInteger(maximumActiveKeys) ||
    maximumActiveKeys < 1 ||
    maximumActiveKeys > maximumAdmissionLimit
  ) {
    throw new CommunitySyncAdmissionConfigurationError();
  }

  const activeByKey = new Map<string, { count: number }>();
  return Object.freeze({
    tryAcquire(key: string): CommunitySyncAdmissionLease | undefined {
      if (typeof key !== "string" || key.length < 1 || key.length > 64) {
        return undefined;
      }
      const existingEntry = activeByKey.get(key);
      const active = existingEntry?.count ?? 0;
      if (
        active >= limitPerKey ||
        (active === 0 && activeByKey.size >= maximumActiveKeys)
      ) {
        return undefined;
      }
      const entry = existingEntry ?? { count: 0 };
      entry.count += 1;
      activeByKey.set(key, entry);
      let released = false;
      return Object.freeze({
        release(): void {
          if (released) {
            return;
          }
          released = true;
          entry.count -= 1;
          if (entry.count === 0) {
            activeByKey.delete(key);
          }
        },
      });
    },
  });
}

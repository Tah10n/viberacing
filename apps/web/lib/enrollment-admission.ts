import "server-only";

export interface EnrollmentAdmissionLease {
  release(): void;
}

export interface EnrollmentAdmission {
  tryAcquire(): EnrollmentAdmissionLease | undefined;
}

export function createEnrollmentAdmission(limit = 4): EnrollmentAdmission {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32) {
    throw new Error("Enrollment admission configuration is invalid.");
  }
  let active = 0;
  return Object.freeze({
    tryAcquire(): EnrollmentAdmissionLease | undefined {
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

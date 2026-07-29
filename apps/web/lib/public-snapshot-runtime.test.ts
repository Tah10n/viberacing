import { describe, expect, it } from "vitest";

import { publicSnapshotAdmission } from "./public-snapshot-runtime";

describe("public snapshot runtime", () => {
  it("shares one four-call no-queue budget across every public snapshot consumer", () => {
    const leases = Array.from({ length: 4 }, () => publicSnapshotAdmission.tryAcquire());

    expect(leases.every((lease) => lease !== undefined)).toBe(true);
    expect(publicSnapshotAdmission.tryAcquire()).toBeUndefined();

    for (const lease of leases) {
      lease?.release();
    }
    const recovered = publicSnapshotAdmission.tryAcquire();
    expect(recovered).toBeDefined();
    recovered?.release();
  });
});

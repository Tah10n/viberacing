// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  ConnectorCarProposalAdmissionConfigurationError,
  createConnectorCarProposalAdmission,
} from "./connector-car-proposal-admission";

describe("connector car proposal admission", () => {
  it("admits only the fixed in-flight budget and makes release idempotent", () => {
    const admission = createConnectorCarProposalAdmission(2);
    const first = admission.tryAcquire();
    const second = admission.tryAcquire();
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(admission.tryAcquire()).toBeUndefined();

    first?.release();
    first?.release();
    expect(admission.tryAcquire()).toBeDefined();
    expect(admission.tryAcquire()).toBeUndefined();
  });

  it.each([0, 33, 1.5, Number.NaN])("rejects invalid concurrency limit %s", (limit) => {
    expect(() => createConnectorCarProposalAdmission(limit)).toThrow(
      ConnectorCarProposalAdmissionConfigurationError,
    );
  });
});

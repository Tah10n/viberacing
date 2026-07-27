import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProblemDetailsV1, UsageSyncResultV1, ValidationResult } from "@viberacing/contracts";

interface ContractsModule extends Record<string, unknown> {
  validateProblemDetailsV1(value: unknown): ValidationResult<ProblemDetailsV1>;
  validateUsageSyncResultV1(value: unknown): ValidationResult<UsageSyncResultV1>;
}

const validationControl = vi.hoisted(() => ({
  rejectProblem: false,
  rejectResult: false,
}));

vi.mock("@viberacing/contracts", async (importOriginal) => {
  const actual = await importOriginal<ContractsModule>();
  return {
    ...actual,
    validateUsageSyncResultV1: (value: unknown) =>
      validationControl.rejectResult
        ? { issues: [{ code: "type", path: "$" }], ok: false as const }
        : actual.validateUsageSyncResultV1(value),
    validateProblemDetailsV1: (value: unknown) =>
      validationControl.rejectProblem
        ? { issues: [{ code: "type", path: "$" }], ok: false as const }
        : actual.validateProblemDetailsV1(value),
  };
});

import {
  createCommunitySyncHttpServer,
  writeCommunitySyncClientError,
} from "./community-sync-http-server.js";
import { usageSyncRequestTarget } from "./protocol.js";

function frozenRecord<T extends object>(values: T): T {
  return Object.freeze(Object.assign(Object.create(null) as object, values));
}

function successDecision(): unknown {
  return Object.freeze({
    body: frozenRecord({
      schemaVersion: 1,
      requestId: "req_AAAAAAAAAAAAAAAAAAAAAA",
      syncId: "syn_CCCCCCCCCCCCCCCCCCCCCC",
      outcome: "accepted",
      acceptedEntries: 1,
    }),
    ok: true,
    status: 200,
  });
}

beforeEach(() => {
  validationControl.rejectProblem = false;
  validationControl.rejectResult = false;
});

describe("Community sync HTTP contract fail-closed paths", () => {
  it("replaces a result rejected by the generated validator", async () => {
    validationControl.rejectResult = true;
    const server = createCommunitySyncHttpServer(
      Object.freeze({ execute: () => Promise.resolve(successDecision()) }),
      true,
    );
    const response = await server.inject({
      headers: { accept: "application/json", "content-type": "application/json" },
      method: "POST",
      payload: "{}",
      url: usageSyncRequestTarget,
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ errorCode: "internal_error", status: 500 });
    await server.close();
  });

  it("destroys a client-error socket when the generated problem validator rejects", () => {
    validationControl.rejectProblem = true;
    const destroy = vi.fn();
    const end = vi.fn();

    writeCommunitySyncClientError({ destroy, end });

    expect(end).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

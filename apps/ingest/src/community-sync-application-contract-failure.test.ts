import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ConnectorSyncResultV1,
  ProblemDetailsV1,
  ValidationResult,
} from "@viberacing/contracts";

interface ContractsModule extends Record<string, unknown> {
  validateConnectorSyncResultV1(value: unknown): ValidationResult<ConnectorSyncResultV1>;
  validateProblemDetailsV1(value: unknown): ValidationResult<ProblemDetailsV1>;
}

const validationControl = vi.hoisted(() => ({
  rejectProblem: false,
  rejectResult: false,
}));

vi.mock("@viberacing/contracts", async (importOriginal) => {
  const actual = await importOriginal<ContractsModule>();
  return {
    ...actual,
    validateConnectorSyncResultV1: (value: unknown) =>
      validationControl.rejectResult
        ? { issues: [{ code: "type", path: "$" }], ok: false as const }
        : actual.validateConnectorSyncResultV1(value),
    validateProblemDetailsV1: (value: unknown) =>
      validationControl.rejectProblem
        ? { issues: [{ code: "type", path: "$" }], ok: false as const }
        : actual.validateProblemDetailsV1(value),
  };
});

import {
  createCommunitySyncApplication,
  type CommunitySyncApplicationError,
} from "./community-sync-application.js";
import {
  CommunitySyncVerificationError,
  type VerifiedCommunitySync,
} from "./community-sync-verifier.js";

const submission = Object.freeze({
  bodyDigestHex: "11".repeat(32),
  deviceId: "dev_AAAAAAAAAAAAAAAAAAAAAA",
  deviceKeyId: "11111111-2222-4333-8444-555555555555",
  idempotencyKey: "syn_CCCCCCCCCCCCCCCCCCCCCC",
  nonceDigestHex: "22".repeat(32),
  payload: Object.freeze({
    schemaVersion: 1,
    sourceId: "src_BBBBBBBBBBBBBBBBBBBBBB",
    syncId: "syn_CCCCCCCCCCCCCCCCCCCCCC",
    observedAt: "2026-07-15T18:00:00.000Z",
    connectorVersion: "1.2.3",
    codexVersion: "2.3.4",
    dailyEntries: Object.freeze([Object.freeze({ codexReportedDate: "2026-07-15", tokens: 123 })]),
  }),
  signatureBase64Url: Buffer.alloc(64, 0x44).toString("base64url"),
}) satisfies VerifiedCommunitySync;

beforeEach(() => {
  validationControl.rejectProblem = false;
  validationControl.rejectResult = false;
});

describe("Community sync application contract fail-closed paths", () => {
  it("rejects a success body when the generated result contract rejects it", async () => {
    validationControl.rejectResult = true;
    const application = createCommunitySyncApplication({
      submit: () => Promise.resolve({ acceptedEntries: 1, outcome: "accepted" }),
      verify: () => Promise.resolve(submission),
    });

    await expect(application.execute({})).rejects.toEqual(
      expect.objectContaining<Partial<CommunitySyncApplicationError>>({
        code: "contract_rejected",
        message: "Community sync application response construction failed.",
      }),
    );
  });

  it("rejects an error body when the generated problem contract rejects it", async () => {
    validationControl.rejectProblem = true;
    const application = createCommunitySyncApplication({
      submit: () => Promise.resolve({ acceptedEntries: 1, outcome: "accepted" }),
      verify: () => Promise.reject(new CommunitySyncVerificationError("invalid_request")),
    });

    await expect(application.execute({})).rejects.toEqual(
      expect.objectContaining<Partial<CommunitySyncApplicationError>>({
        code: "contract_rejected",
        message: "Community sync application response construction failed.",
      }),
    );
  });
});

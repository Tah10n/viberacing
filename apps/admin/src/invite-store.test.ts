import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";

import {
  AdminInviteStoreError,
  createAdminInviteStore,
  type AdminInviteStoreErrorCode,
} from "./invite-store.js";

const boundaryRow = Object.freeze({
  capability_scope_ok: true,
  login_scope_ok: true,
  read_write_ok: true,
  role_ok: true,
  search_path_ok: true,
  transport_ok: true,
});
const goodInput = Object.freeze({
  auditEventId: "00000000-0000-4000-8000-000000000202",
  expiresAt: new Date("2026-07-28T12:00:00.000Z"),
  inviteId: "00000000-0000-4000-8000-000000000201",
  reasonCode: "BETA_ADMISSION",
  requestId: `req_${"A".repeat(22)}`,
  verifierDigest: Buffer.alloc(32, 0x41),
});

function expectStoreError(
  promise: Promise<unknown>,
  code: AdminInviteStoreErrorCode,
): Promise<void> {
  return expect(promise).rejects.toMatchObject({
    code,
    message: "Admin invitation storage operation failed.",
    name: "AdminInviteStoreError",
  });
}

function createHarness(boundary: unknown = [boundaryRow], result: unknown = [{ issued: true }]) {
  let receivedDigest: Buffer | undefined;
  const verifyRuntimeBoundary = vi.fn(() => Promise.resolve(boundary));
  const issueInvite = vi.fn((input: unknown) => {
    if (typeof input === "object" && input !== null && "verifierDigest" in input) {
      receivedDigest = input.verifierDigest as Buffer;
    }
    return Promise.resolve(result);
  });
  const release = vi.fn();
  const client = { issueInvite, release, verifyRuntimeBoundary };
  const connect = vi.fn(() => Promise.resolve(client));
  const pool = { close: vi.fn(() => Promise.resolve()), connect };
  return { client, connect, issueInvite, pool, receivedDigest: () => receivedDigest, release };
}

describe("Admin invitation store", () => {
  it("checks the narrow runtime boundary, issues once, clears its copy, and releases reusable", async () => {
    const harness = createHarness();
    const store = createAdminInviteStore(harness.pool);

    await expect(store.issueInvite(goodInput)).resolves.toBeUndefined();
    expect(Object.isFrozen(store)).toBe(true);
    expect(harness.connect).toHaveBeenCalledOnce();
    expect(harness.client.verifyRuntimeBoundary).toHaveBeenCalledOnce();
    expect(harness.issueInvite).toHaveBeenCalledOnce();
    expect(harness.issueInvite.mock.invocationCallOrder[0]).toBeGreaterThan(
      harness.client.verifyRuntimeBoundary.mock.invocationCallOrder[0]!,
    );
    const received = harness.issueInvite.mock.calls[0]![0] as Record<string, unknown>;
    expect(received).toMatchObject({
      auditEventId: goodInput.auditEventId,
      expiresAt: goodInput.expiresAt,
      inviteId: goodInput.inviteId,
      reasonCode: "BETA_ADMISSION",
      requestId: goodInput.requestId,
    });
    expect(received).not.toBe(goodInput);
    expect(received.verifierDigest).not.toBe(goodInput.verifierDigest);
    expect(harness.receivedDigest()).toEqual(Buffer.alloc(32));
    expect(goodInput.verifierDigest).toEqual(Buffer.alloc(32, 0x41));
    expect(harness.release).toHaveBeenCalledWith(false);
  });

  it.each([
    null,
    [],
    {},
    { ...goodInput, extra: true },
    { ...goodInput, auditEventId: "not-a-uuid" },
    { ...goodInput, expiresAt: new Date("invalid") },
    { ...goodInput, expiresAt: "2026-07-28T12:00:00.000Z" },
    { ...goodInput, inviteId: "00000000-0000-1000-8000-000000000201" },
    { ...goodInput, reasonCode: "SECURITY_REVIEW" },
    { ...goodInput, requestId: "req_short" },
    { ...goodInput, requestId: `req_${"A".repeat(21)}B` },
    { ...goodInput, verifierDigest: Buffer.alloc(31) },
    { ...goodInput, verifierDigest: "private-digest" },
    Object.defineProperty({ ...goodInput }, "inviteId", {
      enumerable: true,
      get() {
        throw new Error("private accessor detail");
      },
    }),
  ])("rejects malformed or reflective input before connecting", async (input) => {
    const harness = createHarness();
    const store = createAdminInviteStore(harness.pool);

    await expectStoreError(store.issueInvite(input), "input_invalid");
    expect(harness.connect).not.toHaveBeenCalled();
  });

  it("rejects a Date subclass, a Date override, and a symbol-keyed input", async () => {
    class UnsafeDate extends Date {}
    const harness = createHarness();
    const store = createAdminInviteStore(harness.pool);
    const overriddenDate = new Date(goodInput.expiresAt);
    Object.defineProperty(overriddenDate, "valueOf", {
      value() {
        throw new Error("private Date override detail");
      },
    });

    await expectStoreError(
      store.issueInvite({ ...goodInput, expiresAt: new UnsafeDate(goodInput.expiresAt) }),
      "input_invalid",
    );
    await expectStoreError(
      store.issueInvite({ ...goodInput, expiresAt: overriddenDate }),
      "input_invalid",
    );
    await expectStoreError(
      store.issueInvite(Object.assign({ ...goodInput }, { [Symbol("extra")]: true })),
      "input_invalid",
    );
    expect(harness.connect).not.toHaveBeenCalled();
  });

  it("contains input and result proxy reflection failures", async () => {
    const inputHarness = createHarness();
    const input = new Proxy(goodInput, {
      getPrototypeOf() {
        throw new Error("private input proxy detail");
      },
    });
    await expectStoreError(
      createAdminInviteStore(inputHarness.pool).issueInvite(input),
      "input_invalid",
    );
    expect(inputHarness.connect).not.toHaveBeenCalled();

    const result = new Proxy([boundaryRow], {
      getPrototypeOf() {
        throw new Error("private result proxy detail");
      },
    });
    const resultHarness = createHarness(result);
    await expectStoreError(
      createAdminInviteStore(resultHarness.pool).issueInvite(goodInput),
      "result_invalid",
    );
    expect(resultHarness.release).toHaveBeenCalledWith(true);
  });

  it.each([
    null,
    [],
    [],
    [null],
    [{ ...boundaryRow, extra: true }],
    [{ ...boundaryRow, role_ok: false }],
    [{ ...boundaryRow, capability_scope_ok: 1 }],
  ])("destroys the session when the runtime boundary result is invalid", async (boundary) => {
    const harness = createHarness(boundary);
    const store = createAdminInviteStore(harness.pool);

    await expectStoreError(
      store.issueInvite(goodInput),
      Array.isArray(boundary) && boundary.length === 1 && boundary[0]?.role_ok === false
        ? "runtime_boundary_mismatch"
        : Array.isArray(boundary) && boundary.length === 1 && boundary[0]?.capability_scope_ok === 1
          ? "runtime_boundary_mismatch"
          : "result_invalid",
    );
    expect(harness.issueInvite).not.toHaveBeenCalled();
    expect(harness.release).toHaveBeenCalledWith(true);
  });

  it("requires every exact runtime boolean", async () => {
    for (const key of Object.keys(boundaryRow)) {
      const harness = createHarness([{ ...boundaryRow, [key]: false }]);
      await expectStoreError(
        createAdminInviteStore(harness.pool).issueInvite(goodInput),
        "runtime_boundary_mismatch",
      );
      expect(harness.release).toHaveBeenCalledWith(true);
    }
  });

  it.each([null, [], [{ issued: false }], [{ issued: true, extra: true }], [{ issued: 1 }]])(
    "treats an invalid issuance result as ambiguous and destroys the session",
    async (result) => {
      const harness = createHarness([boundaryRow], result);
      const store = createAdminInviteStore(harness.pool);

      await expectStoreError(store.issueInvite(goodInput), "result_invalid");
      expect(harness.issueInvite).toHaveBeenCalledOnce();
      expect(harness.release).toHaveBeenCalledWith(true);
      expect(harness.receivedDigest()).toEqual(Buffer.alloc(32));
    },
  );

  it("maps connection, probe, query, and release failures without reflecting details", async () => {
    const connectionPool = {
      close: vi.fn(),
      connect: vi.fn(() => Promise.reject(new Error("private connection detail"))),
    };
    await expectStoreError(
      createAdminInviteStore(connectionPool).issueInvite(goodInput),
      "connection_unavailable",
    );

    const probeHarness = createHarness();
    probeHarness.client.verifyRuntimeBoundary.mockRejectedValueOnce(
      new Error("private probe detail"),
    );
    await expectStoreError(
      createAdminInviteStore(probeHarness.pool).issueInvite(goodInput),
      "query_failed",
    );
    expect(probeHarness.release).toHaveBeenCalledWith(true);

    const queryHarness = createHarness();
    queryHarness.issueInvite.mockRejectedValueOnce(new Error("private query detail"));
    await expectStoreError(
      createAdminInviteStore(queryHarness.pool).issueInvite(goodInput),
      "query_failed",
    );
    expect(queryHarness.release).toHaveBeenCalledWith(true);
    const releaseHarness = createHarness();
    releaseHarness.release.mockImplementationOnce(() => {
      throw new Error("private release detail");
    });
    await expectStoreError(
      createAdminInviteStore(releaseHarness.pool).issueInvite(goodInput),
      "connection_release_failed",
    );
  });

  it("uses a stable non-reflective error shape", () => {
    const error = new AdminInviteStoreError("query_failed");
    expect(error.name).toBe("AdminInviteStoreError");
    expect(error.message).toBe("Admin invitation storage operation failed.");
    expect(error.code).toBe("query_failed");
  });
});

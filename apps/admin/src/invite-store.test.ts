import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";

import {
  AdminInviteStoreError,
  createAdminInviteStore,
  type AdminInviteStoreErrorCode,
} from "./invite-store.js";

const capabilityBoundaryRow = Object.freeze({
  capability_scope_ok: true,
  read_write_ok: true,
  role_ok: true,
  search_path_ok: true,
});
const loginBoundaryRow = Object.freeze({
  login_ok: true,
  login_scope_ok: true,
  read_write_ok: true,
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

function createHarness({
  capabilityBoundary = [capabilityBoundaryRow],
  loginBoundary = [loginBoundaryRow],
  result = [{ issued: true }],
}: {
  capabilityBoundary?: unknown;
  loginBoundary?: unknown;
  result?: unknown;
} = {}) {
  let receivedDigest: Buffer | undefined;
  const assumeAdminRole = vi.fn(() => Promise.resolve());
  const resetAdminRole = vi.fn(() => Promise.resolve());
  const verifyCapabilityBoundary = vi.fn(() => Promise.resolve(capabilityBoundary));
  const verifyLoginBoundary = vi.fn(() => Promise.resolve(loginBoundary));
  const issueInvite = vi.fn((input: unknown) => {
    if (typeof input === "object" && input !== null && "verifierDigest" in input) {
      receivedDigest = input.verifierDigest as Buffer;
    }
    return Promise.resolve(result);
  });
  const release = vi.fn();
  const client = {
    assumeAdminRole,
    issueInvite,
    release,
    resetAdminRole,
    verifyCapabilityBoundary,
    verifyLoginBoundary,
  };
  const connect = vi.fn(() => Promise.resolve(client));
  const pool = { close: vi.fn(() => Promise.resolve()), connect };
  return {
    assumeAdminRole,
    client,
    connect,
    issueInvite,
    pool,
    receivedDigest: () => receivedDigest,
    release,
    resetAdminRole,
    verifyCapabilityBoundary,
    verifyLoginBoundary,
  };
}

describe("Admin invitation store", () => {
  it("checks login, assumes capability, issues, resets, and releases reusable", async () => {
    const harness = createHarness();
    const store = createAdminInviteStore(harness.pool);

    await expect(store.issueInvite(goodInput)).resolves.toBeUndefined();
    expect(Object.isFrozen(store)).toBe(true);
    expect(harness.connect).toHaveBeenCalledOnce();
    expect(harness.verifyLoginBoundary).toHaveBeenCalledTimes(2);
    expect(harness.assumeAdminRole).toHaveBeenCalledOnce();
    expect(harness.verifyCapabilityBoundary).toHaveBeenCalledOnce();
    expect(harness.issueInvite).toHaveBeenCalledOnce();
    expect(harness.resetAdminRole).toHaveBeenCalledOnce();
    expect(harness.verifyLoginBoundary.mock.invocationCallOrder[0]).toBeLessThan(
      harness.assumeAdminRole.mock.invocationCallOrder[0]!,
    );
    expect(harness.assumeAdminRole.mock.invocationCallOrder[0]).toBeLessThan(
      harness.verifyCapabilityBoundary.mock.invocationCallOrder[0]!,
    );
    expect(harness.verifyCapabilityBoundary.mock.invocationCallOrder[0]).toBeLessThan(
      harness.issueInvite.mock.invocationCallOrder[0]!,
    );
    expect(harness.issueInvite.mock.invocationCallOrder[0]).toBeLessThan(
      harness.resetAdminRole.mock.invocationCallOrder[0]!,
    );
    expect(harness.resetAdminRole.mock.invocationCallOrder[0]).toBeLessThan(
      harness.verifyLoginBoundary.mock.invocationCallOrder[1]!,
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

    const result = new Proxy([loginBoundaryRow], {
      getPrototypeOf() {
        throw new Error("private result proxy detail");
      },
    });
    const resultHarness = createHarness({ loginBoundary: result });
    await expectStoreError(
      createAdminInviteStore(resultHarness.pool).issueInvite(goodInput),
      "result_invalid",
    );
    expect(resultHarness.release).toHaveBeenCalledWith(true);
  });

  it.each([
    [null, "result_invalid"],
    [[], "result_invalid"],
    [[null], "result_invalid"],
    [[{ ...loginBoundaryRow, extra: true }], "result_invalid"],
    [[{ ...loginBoundaryRow, login_ok: false }], "runtime_boundary_mismatch"],
    [[{ ...loginBoundaryRow, transport_ok: 1 }], "runtime_boundary_mismatch"],
  ] as const)("destroys the session for an invalid login boundary", async (boundary, code) => {
    const harness = createHarness({ loginBoundary: boundary });

    await expectStoreError(createAdminInviteStore(harness.pool).issueInvite(goodInput), code);
    expect(harness.assumeAdminRole).not.toHaveBeenCalled();
    expect(harness.issueInvite).not.toHaveBeenCalled();
    expect(harness.release).toHaveBeenCalledWith(true);
  });

  it.each([
    [null, "result_invalid"],
    [[], "result_invalid"],
    [[null], "result_invalid"],
    [[{ ...capabilityBoundaryRow, extra: true }], "result_invalid"],
    [[{ ...capabilityBoundaryRow, role_ok: false }], "runtime_boundary_mismatch"],
    [[{ ...capabilityBoundaryRow, capability_scope_ok: 1 }], "runtime_boundary_mismatch"],
  ] as const)(
    "destroys the assumed-role session for an invalid capability boundary",
    async (boundary, code) => {
      const harness = createHarness({ capabilityBoundary: boundary });

      await expectStoreError(createAdminInviteStore(harness.pool).issueInvite(goodInput), code);
      expect(harness.assumeAdminRole).toHaveBeenCalledOnce();
      expect(harness.issueInvite).not.toHaveBeenCalled();
      expect(harness.release).toHaveBeenCalledWith(true);
    },
  );

  it("requires every exact boundary boolean before and after capability use", async () => {
    for (const key of Object.keys(loginBoundaryRow)) {
      const harness = createHarness({
        loginBoundary: [{ ...loginBoundaryRow, [key]: false }],
      });
      await expectStoreError(
        createAdminInviteStore(harness.pool).issueInvite(goodInput),
        "runtime_boundary_mismatch",
      );
      expect(harness.release).toHaveBeenCalledWith(true);
    }
    for (const key of Object.keys(capabilityBoundaryRow)) {
      const harness = createHarness({
        capabilityBoundary: [{ ...capabilityBoundaryRow, [key]: false }],
      });
      await expectStoreError(
        createAdminInviteStore(harness.pool).issueInvite(goodInput),
        "runtime_boundary_mismatch",
      );
      expect(harness.release).toHaveBeenCalledWith(true);
    }

    const resetHarness = createHarness();
    resetHarness.verifyLoginBoundary
      .mockResolvedValueOnce([loginBoundaryRow])
      .mockResolvedValueOnce([{ ...loginBoundaryRow, login_ok: false }]);
    await expectStoreError(
      createAdminInviteStore(resetHarness.pool).issueInvite(goodInput),
      "runtime_boundary_mismatch",
    );
    expect(resetHarness.issueInvite).toHaveBeenCalledOnce();
    expect(resetHarness.resetAdminRole).toHaveBeenCalledOnce();
    expect(resetHarness.release).toHaveBeenCalledWith(true);
  });

  it.each([null, [], [{ issued: false }], [{ issued: true, extra: true }], [{ issued: 1 }]])(
    "treats an invalid issuance result as ambiguous and destroys the session",
    async (result) => {
      const harness = createHarness({ result });
      const store = createAdminInviteStore(harness.pool);

      await expectStoreError(store.issueInvite(goodInput), "result_invalid");
      expect(harness.issueInvite).toHaveBeenCalledOnce();
      expect(harness.release).toHaveBeenCalledWith(true);
      expect(harness.receivedDigest()).toEqual(Buffer.alloc(32));
    },
  );

  it("maps connection, boundary, role, query, reset, and release failures", async () => {
    const connectionPool = {
      close: vi.fn(),
      connect: vi.fn(() => Promise.reject(new Error("private connection detail"))),
    };
    await expectStoreError(
      createAdminInviteStore(connectionPool).issueInvite(goodInput),
      "connection_unavailable",
    );

    const probeHarness = createHarness();
    probeHarness.verifyLoginBoundary.mockRejectedValueOnce(new Error("private probe detail"));
    await expectStoreError(
      createAdminInviteStore(probeHarness.pool).issueInvite(goodInput),
      "query_failed",
    );
    expect(probeHarness.release).toHaveBeenCalledWith(true);

    const assumeHarness = createHarness();
    assumeHarness.assumeAdminRole.mockRejectedValueOnce(new Error("private role detail"));
    await expectStoreError(
      createAdminInviteStore(assumeHarness.pool).issueInvite(goodInput),
      "query_failed",
    );
    expect(assumeHarness.release).toHaveBeenCalledWith(true);

    const capabilityHarness = createHarness();
    capabilityHarness.verifyCapabilityBoundary.mockRejectedValueOnce(
      new Error("private capability detail"),
    );
    await expectStoreError(
      createAdminInviteStore(capabilityHarness.pool).issueInvite(goodInput),
      "query_failed",
    );
    expect(capabilityHarness.release).toHaveBeenCalledWith(true);

    const queryHarness = createHarness();
    queryHarness.issueInvite.mockRejectedValueOnce(new Error("private query detail"));
    await expectStoreError(
      createAdminInviteStore(queryHarness.pool).issueInvite(goodInput),
      "query_failed",
    );
    expect(queryHarness.release).toHaveBeenCalledWith(true);

    const resetHarness = createHarness();
    resetHarness.resetAdminRole.mockRejectedValueOnce(new Error("private reset detail"));
    await expectStoreError(
      createAdminInviteStore(resetHarness.pool).issueInvite(goodInput),
      "query_failed",
    );
    expect(resetHarness.issueInvite).toHaveBeenCalledOnce();
    expect(resetHarness.release).toHaveBeenCalledWith(true);

    const resetProbeHarness = createHarness();
    resetProbeHarness.verifyLoginBoundary
      .mockResolvedValueOnce([loginBoundaryRow])
      .mockRejectedValueOnce(new Error("private reset probe detail"));
    await expectStoreError(
      createAdminInviteStore(resetProbeHarness.pool).issueInvite(goodInput),
      "query_failed",
    );
    expect(resetProbeHarness.issueInvite).toHaveBeenCalledOnce();
    expect(resetProbeHarness.release).toHaveBeenCalledWith(true);

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

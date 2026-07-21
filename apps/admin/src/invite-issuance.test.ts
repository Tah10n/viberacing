import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  AdminInviteIssuanceError,
  adminInviteLifetimeDays,
  adminInviteReasonCode,
  createAdminInviteIssuer,
  type AdminInviteAuditEvent,
  type AdminInviteIssuanceErrorCode,
} from "./invite-issuance.js";

const now = Date.parse("2026-07-21T12:00:00.000Z");
const inviteId = "00000000-0000-4000-8000-000000000101";
const auditEventId = "00000000-0000-4000-8000-000000000102";
const actorReference = `adm_${"A".repeat(22)}`;
const requestEntropy = Buffer.alloc(16, 0x21);
const secret = Buffer.alloc(32, 0x41);

function authorization(override: Readonly<Record<string, unknown>> = {}): Readonly<object> {
  return Object.freeze({
    accessVerifiedAtMs: now - 2_000,
    actorReference,
    decision: "allow",
    passkeyVerifiedAtMs: now - 1_000,
    purpose: "invite_issue",
    validUntilMs: now - 1_000 + 5 * 60 * 1_000,
    version: 1,
    ...override,
  });
}

function acknowledgement(event: AdminInviteAuditEvent): Readonly<object> {
  return Object.freeze({
    accepted: true,
    phase: event.phase,
    requestId: event.requestId,
    version: 1,
  });
}

function createHarness(
  options: {
    readonly authorization?: unknown;
    readonly clock?: () => number;
    readonly randomBytes?: (size: number) => Buffer;
    readonly randomUuid?: () => string;
  } = {},
) {
  const order: string[] = [];
  const entropyBuffers: Buffer[] = [];
  const uuids = [inviteId, auditEventId];
  const authorize = vi.fn(() => {
    order.push("authorize");
    return Promise.resolve(
      Object.prototype.hasOwnProperty.call(options, "authorization")
        ? options.authorization
        : authorization(),
    );
  });
  const appendAudit = vi.fn((event: AdminInviteAuditEvent): Promise<unknown> => {
    order.push(`audit:${event.phase}`);
    return Promise.resolve(acknowledgement(event));
  });
  let databaseDigestCopy: Buffer | undefined;
  let databaseInput: unknown;
  const issueInvite = vi.fn((input: unknown) => {
    order.push("database");
    databaseInput = input;
    if (typeof input === "object" && input !== null && "verifierDigest" in input) {
      databaseDigestCopy = Buffer.from(input.verifierDigest as Uint8Array);
    }
    return Promise.resolve();
  });
  const clock = vi.fn(
    options.clock ??
      (() => {
        order.push("clock");
        return now;
      }),
  );
  const randomBytes = vi.fn(
    options.randomBytes ??
      ((size: number) => {
        order.push(`entropy:${String(size)}`);
        const buffer = Buffer.from(size === 16 ? requestEntropy : secret);
        entropyBuffers.push(buffer);
        return buffer;
      }),
  );
  const randomUuid = vi.fn(
    options.randomUuid ??
      (() => {
        order.push("uuid");
        return uuids.shift() ?? "";
      }),
  );
  const issuer = createAdminInviteIssuer(
    { appendAudit, authorize, issueInvite },
    { clock, randomBytes, randomUuid },
  );
  return {
    appendAudit,
    authorize,
    clock,
    databaseDigestCopy: () => databaseDigestCopy,
    databaseInput: () => databaseInput,
    entropyBuffers,
    issueInvite,
    issuer,
    order,
    randomBytes,
    randomUuid,
  };
}

async function expectIssuanceError(
  promise: Promise<unknown>,
  code: AdminInviteIssuanceErrorCode,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    code,
    message: "Admin invitation issuance failed.",
    name: "AdminInviteIssuanceError",
  });
}

describe("Admin invitation issuance application", () => {
  it("authorizes, externally audits both phases, writes once, and returns the exact Web code", async () => {
    const harness = createHarness();

    await expect(harness.issuer.issueBetaInvite()).resolves.toBe(
      `vri_${inviteId}_${secret.toString("base64url")}`,
    );
    expect(Object.isFrozen(harness.issuer)).toBe(true);
    expect(adminInviteReasonCode).toBe("BETA_ADMISSION");
    expect(adminInviteLifetimeDays).toBe(7);
    expect(harness.order).toEqual([
      "authorize",
      "clock",
      "uuid",
      "uuid",
      "entropy:16",
      "audit:authorized",
      "clock",
      "entropy:32",
      "database",
      "audit:committed",
    ]);
    expect(harness.authorize).toHaveBeenCalledOnce();
    expect(harness.clock).toHaveBeenCalledTimes(2);
    expect(harness.randomUuid).toHaveBeenCalledTimes(2);
    expect(harness.randomBytes.mock.calls.map(([size]) => size)).toEqual([16, 32]);
    expect(harness.issueInvite).toHaveBeenCalledOnce();

    const requestId = `req_${requestEntropy.toString("base64url")}`;
    const expectedDigest = createHash("sha256").update(secret).digest();
    expect(harness.databaseDigestCopy()).toEqual(expectedDigest);
    const input = harness.databaseInput() as Record<string, unknown>;
    expect(Reflect.ownKeys(input).sort()).toEqual([
      "auditEventId",
      "expiresAt",
      "inviteId",
      "reasonCode",
      "requestId",
      "verifierDigest",
    ]);
    expect(input).toMatchObject({
      auditEventId,
      expiresAt: new Date("2026-07-28T12:00:00.000Z"),
      inviteId,
      reasonCode: "BETA_ADMISSION",
      requestId,
    });
    expect(input.verifierDigest).toEqual(Buffer.alloc(32));

    expect(harness.appendAudit).toHaveBeenCalledTimes(2);
    const events = harness.appendAudit.mock.calls.map(([event]) => event);
    expect(events).toEqual([
      {
        action: "invite.issue",
        actorReference,
        auditEventId,
        inviteExpiresAt: "2026-07-28T12:00:00.000Z",
        occurredAt: "2026-07-21T12:00:00.000Z",
        phase: "authorized",
        reasonCode: "BETA_ADMISSION",
        requestId,
        version: 1,
      },
      {
        action: "invite.issue",
        actorReference,
        auditEventId,
        inviteExpiresAt: "2026-07-28T12:00:00.000Z",
        occurredAt: "2026-07-21T12:00:00.000Z",
        phase: "committed",
        reasonCode: "BETA_ADMISSION",
        requestId,
        version: 1,
      },
    ]);
    for (const event of events) {
      expect(Object.isFrozen(event)).toBe(true);
      expect(Object.getPrototypeOf(event)).toBeNull();
      expect(Reflect.ownKeys(event)).not.toEqual(
        expect.arrayContaining(["inviteId", "secret", "verifierDigest"]),
      );
      expect(JSON.stringify(event)).not.toContain(inviteId);
      expect(JSON.stringify(event)).not.toContain(secret.toString("base64url"));
      expect(JSON.stringify(event)).not.toContain(expectedDigest.toString("base64url"));
    }
    expect(harness.entropyBuffers).toHaveLength(2);
    expect(harness.entropyBuffers[0]).toEqual(Buffer.alloc(16));
    expect(harness.entropyBuffers[1]).toEqual(Buffer.alloc(32));
  });

  it.each([
    null,
    {},
    { appendAudit: vi.fn(), authorize: vi.fn() },
    { appendAudit: vi.fn(), authorize: vi.fn(), issueInvite: vi.fn(), extra: true },
    Object.defineProperty(
      { appendAudit: vi.fn(), authorize: vi.fn(), issueInvite: vi.fn() },
      "authorize",
      {
        enumerable: true,
        get() {
          throw new Error("private accessor detail");
        },
      },
    ),
  ])("rejects an open, incomplete, or reflective dependency set", (dependencies) => {
    expect(() => createAdminInviteIssuer(dependencies)).toThrow(
      expect.objectContaining({ code: "dependency_invalid" }),
    );
  });

  it("contains dependency and runtime proxy reflection failures", () => {
    const dependencies = new Proxy(
      { appendAudit: vi.fn(), authorize: vi.fn(), issueInvite: vi.fn() },
      {
        getPrototypeOf() {
          throw new Error("private dependency proxy detail");
        },
      },
    );
    expect(() => createAdminInviteIssuer(dependencies)).toThrow(
      expect.objectContaining({ code: "dependency_invalid" }),
    );

    const runtime = new Proxy(
      { clock: vi.fn(), randomBytes: vi.fn(), randomUuid: vi.fn() },
      {
        getPrototypeOf() {
          throw new Error("private runtime proxy detail");
        },
      },
    );
    expect(() =>
      createAdminInviteIssuer(
        { appendAudit: vi.fn(), authorize: vi.fn(), issueInvite: vi.fn() },
        runtime,
      ),
    ).toThrow(expect.objectContaining({ code: "dependency_invalid" }));
  });

  it.each([
    null,
    {},
    { clock: vi.fn(), randomBytes: vi.fn() },
    { clock: vi.fn(), randomBytes: vi.fn(), randomUuid: vi.fn(), extra: true },
    Object.defineProperty({ clock: vi.fn(), randomBytes: vi.fn(), randomUuid: vi.fn() }, "clock", {
      enumerable: true,
      get() {
        throw new Error("private accessor detail");
      },
    }),
  ])("rejects an open, incomplete, or reflective runtime", (runtime) => {
    expect(() =>
      createAdminInviteIssuer(
        { appendAudit: vi.fn(), authorize: vi.fn(), issueInvite: vi.fn() },
        runtime,
      ),
    ).toThrow(expect.objectContaining({ code: "dependency_invalid" }));
  });

  it.each([
    null,
    {},
    authorization({ decision: "deny" }),
    authorization({ purpose: "profile_delete" }),
    authorization({ version: 2 }),
    authorization({ actorReference: "shared-admin" }),
    authorization({ actorReference: `adm_${"A".repeat(21)}B` }),
    authorization({ accessVerifiedAtMs: now + 1 }),
    authorization({ accessVerifiedAtMs: now - 5 * 60 * 1_000 - 1 }),
    authorization({ passkeyVerifiedAtMs: now + 1 }),
    authorization({ passkeyVerifiedAtMs: now - 5 * 60 * 1_000 - 1 }),
    authorization({ validUntilMs: now + 1 }),
    authorization({ validUntilMs: now - 1 }),
    authorization({ accessVerifiedAtMs: 1.5 }),
    authorization({ passkeyVerifiedAtMs: Number.MAX_SAFE_INTEGER + 1 }),
    authorization({ validUntilMs: -1 }),
    Object.freeze({ ...authorization(), extra: true }),
    { ...authorization() },
    Object.defineProperty({ ...authorization() }, "actorReference", {
      enumerable: true,
      get() {
        throw new Error("private accessor detail");
      },
    }),
  ])(
    "rejects a malformed, stale, wrong-purpose, or unsealed authorization %#",
    async (decision) => {
      const harness = createHarness({ authorization: decision });

      await expectIssuanceError(harness.issuer.issueBetaInvite(), "authorization_rejected");
      expect(harness.appendAudit).not.toHaveBeenCalled();
      expect(harness.issueInvite).not.toHaveBeenCalled();
      expect(harness.randomBytes).not.toHaveBeenCalled();
    },
  );

  it("maps authorization gateway failure before clock, entropy, audit, or storage", async () => {
    const harness = createHarness();
    harness.authorize.mockRejectedValueOnce(new Error("private Access detail"));

    await expectIssuanceError(harness.issuer.issueBetaInvite(), "authorization_rejected");
    expect(harness.clock).not.toHaveBeenCalled();
    expect(harness.randomUuid).not.toHaveBeenCalled();
    expect(harness.appendAudit).not.toHaveBeenCalled();
    expect(harness.issueInvite).not.toHaveBeenCalled();
  });

  it("contains authorization reflection failures before entropy, audit, or storage", async () => {
    const decision = new Proxy(authorization(), {
      getPrototypeOf() {
        throw new Error("private authorization proxy detail");
      },
    });
    const harness = createHarness({ authorization: decision });

    await expectIssuanceError(harness.issuer.issueBetaInvite(), "authorization_rejected");
    expect(harness.randomBytes).not.toHaveBeenCalled();
    expect(harness.appendAudit).not.toHaveBeenCalled();
    expect(harness.issueInvite).not.toHaveBeenCalled();
  });

  it.each([Number.NaN, -1, 1.5, Number.MAX_SAFE_INTEGER])(
    "rejects invalid application time before generating authority: %s",
    async (value) => {
      const harness = createHarness({ clock: () => value });
      await expectIssuanceError(harness.issuer.issueBetaInvite(), "clock_invalid");
      expect(harness.randomUuid).not.toHaveBeenCalled();
      expect(harness.appendAudit).not.toHaveBeenCalled();
    },
  );

  it("maps a throwing clock without reflecting it", async () => {
    const harness = createHarness({
      clock: () => {
        throw new Error("private clock detail");
      },
    });
    await expectIssuanceError(harness.issuer.issueBetaInvite(), "clock_invalid");
  });

  it.each([
    ["not-a-uuid", auditEventId],
    ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".toUpperCase(), auditEventId],
    [inviteId, "00000000-0000-1000-8000-000000000102"],
    [inviteId, inviteId],
  ])("rejects malformed or colliding generated identifiers", async (first, second) => {
    const values = [first, second];
    const harness = createHarness({ randomUuid: () => values.shift() ?? "" });
    await expectIssuanceError(harness.issuer.issueBetaInvite(), "identifier_invalid");
    expect(harness.appendAudit).not.toHaveBeenCalled();
    expect(harness.issueInvite).not.toHaveBeenCalled();
  });

  it("rejects coercible UUID values and maps a throwing UUID source", async () => {
    const stringify = vi.fn(() => inviteId);
    const coercible = createHarness({
      randomUuid: () => ({ toString: stringify }) as unknown as string,
    });
    await expectIssuanceError(coercible.issuer.issueBetaInvite(), "identifier_invalid");
    expect(stringify).not.toHaveBeenCalled();

    const harness = createHarness({
      randomUuid: () => {
        throw new Error("private UUID detail");
      },
    });
    await expectIssuanceError(harness.issuer.issueBetaInvite(), "identifier_invalid");
  });

  it("rejects unavailable and malformed entropy before audit or storage", async () => {
    const unavailable = createHarness({
      randomBytes: () => {
        throw new Error("private entropy detail");
      },
    });
    await expectIssuanceError(unavailable.issuer.issueBetaInvite(), "entropy_unavailable");

    const wrongLength = Buffer.alloc(15, 0x55);
    const malformed = createHarness({ randomBytes: () => wrongLength });
    await expectIssuanceError(malformed.issuer.issueBetaInvite(), "entropy_invalid");
    expect(wrongLength).toEqual(Buffer.alloc(15));

    const rejectedBytes = new Uint8Array(16).fill(0x66);
    const notBuffer = createHarness({
      randomBytes: (() => rejectedBytes) as unknown as (size: number) => Buffer,
    });
    await expectIssuanceError(notBuffer.issuer.issueBetaInvite(), "entropy_invalid");
    expect(rejectedBytes).toEqual(new Uint8Array(16));

    for (const harness of [unavailable, malformed, notBuffer]) {
      expect(harness.appendAudit).not.toHaveBeenCalled();
      expect(harness.issueInvite).not.toHaveBeenCalled();
    }
  });

  it("clears request entropy when secret generation fails", async () => {
    const first = Buffer.from(requestEntropy);
    const stringify = vi.fn(() => {
      throw new Error("private entropy override detail");
    });
    const fill = vi.fn(() => {
      throw new Error("private zeroization override detail");
    });
    Object.defineProperty(first, "toString", { value: stringify });
    Object.defineProperty(first, "fill", { value: fill });
    let call = 0;
    const harness = createHarness({
      randomBytes: () => {
        call += 1;
        if (call === 1) {
          return first;
        }
        throw new Error("private secret entropy detail");
      },
    });
    await expectIssuanceError(harness.issuer.issueBetaInvite(), "entropy_unavailable");
    expect(first).toEqual(Buffer.alloc(16));
    expect(stringify).not.toHaveBeenCalled();
    expect(fill).not.toHaveBeenCalled();
  });

  it.each([
    null,
    {},
    { accepted: false, phase: "authorized", requestId: "wrong", version: 1 },
    { accepted: true, phase: "committed", requestId: "wrong", version: 1 },
    { accepted: true, phase: "authorized", requestId: "wrong", version: 1 },
    { accepted: true, phase: "authorized", requestId: `req_${"A".repeat(22)}`, version: 2 },
    {
      accepted: true,
      extra: true,
      phase: "authorized",
      requestId: `req_${"A".repeat(22)}`,
      version: 1,
    },
  ])("blocks database work on malformed first audit acknowledgement", async (value) => {
    const harness = createHarness();
    harness.appendAudit.mockResolvedValueOnce(value);

    await expectIssuanceError(harness.issuer.issueBetaInvite(), "audit_rejected");
    expect(harness.issueInvite).not.toHaveBeenCalled();
    expect(harness.randomBytes).toHaveBeenCalledOnce();
    expect(harness.randomBytes).toHaveBeenCalledWith(16);
    expect(harness.entropyBuffers.every((buffer) => buffer.every((byte) => byte === 0))).toBe(true);
  });

  it("blocks database work when the first audit write throws", async () => {
    const harness = createHarness();
    harness.appendAudit.mockRejectedValueOnce(new Error("private audit detail"));

    await expectIssuanceError(harness.issuer.issueBetaInvite(), "audit_rejected");
    expect(harness.issueInvite).not.toHaveBeenCalled();
    expect(harness.randomBytes).toHaveBeenCalledOnce();
    expect(harness.randomBytes).toHaveBeenCalledWith(16);
    expect(harness.entropyBuffers.every((buffer) => buffer.every((byte) => byte === 0))).toBe(true);
  });

  it("contains a reflective audit acknowledgement before database work", async () => {
    const harness = createHarness();
    harness.appendAudit.mockImplementationOnce((event) =>
      Promise.resolve(
        new Proxy(acknowledgement(event), {
          getPrototypeOf() {
            throw new Error("private audit proxy detail");
          },
        }),
      ),
    );

    await expectIssuanceError(harness.issuer.issueBetaInvite(), "audit_rejected");
    expect(harness.issueInvite).not.toHaveBeenCalled();
    expect(harness.randomBytes).toHaveBeenCalledOnce();
    expect(harness.randomBytes).toHaveBeenCalledWith(16);
  });

  it("rechecks authority after the authorized audit and before database work", async () => {
    const cases = [
      { code: "authorization_rejected" as const, secondNow: now + 5 * 60 * 1_000 },
      { code: "clock_invalid" as const, secondNow: now - 1 },
    ];
    for (const { code, secondNow } of cases) {
      const harness = createHarness();
      harness.clock.mockReturnValueOnce(now).mockReturnValueOnce(secondNow);

      await expectIssuanceError(harness.issuer.issueBetaInvite(), code);
      expect(harness.appendAudit).toHaveBeenCalledOnce();
      expect(harness.appendAudit.mock.calls[0]![0].phase).toBe("authorized");
      expect(harness.issueInvite).not.toHaveBeenCalled();
      expect(harness.randomBytes).toHaveBeenCalledOnce();
      expect(harness.randomBytes).toHaveBeenCalledWith(16);
      expect(harness.entropyBuffers.every((buffer) => buffer.every((byte) => byte === 0))).toBe(
        true,
      );
    }
  });

  it("returns no credential and performs no committed audit when storage fails", async () => {
    const harness = createHarness();
    harness.issueInvite.mockRejectedValueOnce(new Error("private database detail"));

    await expectIssuanceError(harness.issuer.issueBetaInvite(), "storage_rejected");
    expect(harness.appendAudit).toHaveBeenCalledOnce();
    expect(harness.appendAudit.mock.calls[0]![0].phase).toBe("authorized");
    expect(harness.entropyBuffers.every((buffer) => buffer.every((byte) => byte === 0))).toBe(true);
  });

  it("returns no credential after a committed database write if final audit is unavailable", async () => {
    const harness = createHarness();
    harness.appendAudit
      .mockImplementationOnce((event) => Promise.resolve(acknowledgement(event)))
      .mockRejectedValueOnce(new Error("private completion audit detail"));

    await expectIssuanceError(harness.issuer.issueBetaInvite(), "audit_rejected");
    expect(harness.issueInvite).toHaveBeenCalledOnce();
    expect(harness.appendAudit).toHaveBeenCalledTimes(2);
    expect(harness.entropyBuffers.every((buffer) => buffer.every((byte) => byte === 0))).toBe(true);
  });

  it("rejects extra call arguments before authorization", async () => {
    const harness = createHarness();

    await expectIssuanceError(harness.issuer.issueBetaInvite("unexpected"), "argument_invalid");
    expect(harness.authorize).not.toHaveBeenCalled();
  });

  it("uses OS-backed defaults without adding a default authorization, audit, or store", async () => {
    const authorize = vi.fn(() => {
      const actualNow = Date.now();
      return Promise.resolve(
        Object.freeze({
          accessVerifiedAtMs: actualNow - 2,
          actorReference,
          decision: "allow",
          passkeyVerifiedAtMs: actualNow - 1,
          purpose: "invite_issue",
          validUntilMs: actualNow - 1 + 5 * 60 * 1_000,
          version: 1,
        }),
      );
    });
    const appendAudit = vi.fn((event: AdminInviteAuditEvent) =>
      Promise.resolve(acknowledgement(event)),
    );
    const issueInvite = vi.fn(() => Promise.resolve());
    const issuer = createAdminInviteIssuer({ appendAudit, authorize, issueInvite });

    await expect(issuer.issueBetaInvite()).resolves.toMatch(
      /^vri_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/,
    );
    expect(issueInvite).toHaveBeenCalledOnce();
  });

  it("uses a stable non-reflective error shape", () => {
    const error = new AdminInviteIssuanceError("audit_rejected");
    expect(error.name).toBe("AdminInviteIssuanceError");
    expect(error.message).toBe("Admin invitation issuance failed.");
    expect(error.code).toBe("audit_rejected");
  });
});

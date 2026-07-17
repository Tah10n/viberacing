import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createEnrollmentCookieCodec } from "./enrollment-cookie";
import type { CarRecipeState, EnrollmentDatabase } from "./enrollment-database";
import type { EnrollmentSession } from "./enrollment-domain";
import { createCarProposalService } from "./car-proposal-service";
import type { CarRecipe } from "./car-recipe";

const now = new Date("2026-07-17T10:00:00.000Z");
const nowSeconds = Math.floor(now.valueOf() / 1000);
const proposalId = "00000000-0000-4000-8000-000000000701";
const sessionVerifier = Buffer.alloc(32, 0x61).toString("base64url");
const recipe: CarRecipe = Object.freeze({
  schemaVersion: 1,
  chassis: "rally",
  nose: "scoop",
  cockpit: "rally",
  wing: "low",
  wheels: "all-terrain",
  palette: "sunburst",
  trail: "spark",
  seed: 42,
});
const session: EnrollmentSession = Object.freeze({
  expiresAt: nowSeconds + 2 * 24 * 60 * 60,
  handle: "pixel_driver",
  locale: "en",
  passkeyRegistered: true,
  profileId: "00000000-0000-4000-8000-000000000101",
  sessionId: "00000000-0000-4000-8000-000000000201",
  sessionVerifier,
  version: 1,
});

type CarDatabase = Pick<
  EnrollmentDatabase,
  "approveCarRecipe" | "proposeCarRecipe" | "readCarRecipeState" | "rejectCarRecipe"
>;

function databaseFixture(state?: CarRecipeState): CarDatabase {
  return {
    approveCarRecipe: vi.fn(() => Promise.resolve(true)),
    proposeCarRecipe: vi.fn(() => Promise.resolve(true)),
    readCarRecipeState: vi.fn(() =>
      Promise.resolve(state ?? Object.freeze({ active: null, proposal: null })),
    ),
    rejectCarRecipe: vi.fn(() => Promise.resolve(true)),
  };
}

function serviceFixture(
  database: CarDatabase,
  overrides: Partial<{
    now: () => Date;
    randomUuid: () => string;
    readSession: (cookie: string) => EnrollmentSession | undefined;
  }> = {},
) {
  let nonce = 0;
  const cookieCodec = createEnrollmentCookieCodec(Buffer.alloc(32, 0x22), (size) =>
    Buffer.alloc(size, (nonce += 1)),
  );
  return {
    cookieCodec,
    service: createCarProposalService({
      cookieCodec,
      database,
      now: overrides.now ?? (() => now),
      randomUuid: overrides.randomUuid ?? (() => proposalId),
      readSession: overrides.readSession ?? (() => session),
    }),
  };
}

describe("car proposal service", () => {
  it("validates and submits only an exact versioned recipe under the passkey session", async () => {
    let digestSnapshot: Buffer | undefined;
    const database = databaseFixture();
    vi.mocked(database.proposeCarRecipe).mockImplementation((input) => {
      digestSnapshot = Buffer.from(input.sessionVerifierDigest);
      return Promise.resolve(true);
    });
    const { service } = serviceFixture(database);

    await expect(service.propose("opaque-session", recipe)).resolves.toBe(true);
    expect(database.proposeCarRecipe).toHaveBeenCalledOnce();
    const proposedInput = vi.mocked(database.proposeCarRecipe).mock.calls[0]?.[0];
    expect(proposedInput).toMatchObject({
      expiresAt: "2026-07-18T10:00:00.000Z",
      proposalId,
      recipe,
      sessionId: session.sessionId,
    });
    expect(digestSnapshot).toEqual(createHash("sha256").update(Buffer.alloc(32, 0x61)).digest());
    const liveDigest = proposedInput?.sessionVerifierDigest;
    expect(liveDigest).toEqual(Buffer.alloc(32));

    for (const invalid of [
      { ...recipe, schemaVersion: 2 },
      { ...recipe, seed: 65_536 },
      { ...recipe, assetUrl: "https://invalid.example/car.svg" },
      { ...recipe, markup: "<svg onload=alert(1)>" },
      { ...recipe, conversation: "make this car faster" },
    ]) {
      await expect(service.propose("opaque-session", invalid)).resolves.toBe(false);
    }
    expect(database.proposeCarRecipe).toHaveBeenCalledOnce();
  });

  it("returns active and pending recipes with an opaque session-bound decision control", async () => {
    const active = Object.freeze({ ...recipe, palette: "mint" as const, seed: 7 });
    const state: CarRecipeState = Object.freeze({
      active,
      proposal: Object.freeze({
        expiresAt: "2026-07-17T11:00:00.000Z",
        proposalId,
        recipe,
      }),
    });
    const database = databaseFixture(state);
    const { cookieCodec, service } = serviceFixture(database);

    const result = await service.read("opaque-session");
    expect(result?.active).toBe(active);
    expect(result?.proposal?.recipe).toBe(recipe);
    expect(result?.proposal?.control).not.toContain(proposalId);
    expect(cookieCodec.open("car-proposal", result?.proposal?.control ?? "missing")).toEqual({
      expiresAt: nowSeconds + 60 * 60,
      proposalId,
      sessionId: session.sessionId,
      version: 1,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result?.proposal)).toBe(true);
    const readInput = vi.mocked(database.readCarRecipeState).mock.calls[0]?.[0];
    expect(readInput?.sessionId).toBe(session.sessionId);
    expect(readInput?.sessionVerifierDigest).toEqual(Buffer.alloc(32));
  });

  it("approves and rejects only a current control for the exact session", async () => {
    const database = databaseFixture({
      active: null,
      proposal: {
        expiresAt: "2026-07-17T11:00:00.000Z",
        proposalId,
        recipe,
      },
    });
    const { service } = serviceFixture(database);
    const control = (await service.read("opaque-session"))?.proposal?.control;
    expect(control).toBeTypeOf("string");

    await expect(service.approve("opaque-session", control ?? "")).resolves.toBe(true);
    await expect(service.reject("opaque-session", control ?? "")).resolves.toBe(true);
    const approveInput = vi.mocked(database.approveCarRecipe).mock.calls[0]?.[0];
    const rejectInput = vi.mocked(database.rejectCarRecipe).mock.calls[0]?.[0];
    expect(approveInput?.proposalId).toBe(proposalId);
    expect(approveInput?.sessionId).toBe(session.sessionId);
    expect(approveInput?.sessionVerifierDigest).toEqual(Buffer.alloc(32));
    expect(rejectInput?.proposalId).toBe(proposalId);
    expect(rejectInput?.sessionId).toBe(session.sessionId);
    expect(rejectInput?.sessionVerifierDigest).toEqual(Buffer.alloc(32));

    const otherSession = Object.freeze({
      ...session,
      sessionId: "00000000-0000-4000-8000-000000000202",
    });
    const other = serviceFixture(database, { readSession: () => otherSession }).service;
    await expect(other.approve("opaque-session", control ?? "")).resolves.toBe(false);
    await expect(service.approve("opaque-session", `${control ?? ""}A`)).resolves.toBe(false);
    await expect(service.reject("opaque-session", "x".repeat(1025))).resolves.toBe(false);
    expect(database.approveCarRecipe).toHaveBeenCalledOnce();
    expect(database.rejectCarRecipe).toHaveBeenCalledOnce();
  });

  it("fails closed for expired state, invalid authority, bad identifiers, and dependency failures", async () => {
    const expiredDatabase = databaseFixture({
      active: null,
      proposal: {
        expiresAt: now.toISOString(),
        proposalId,
        recipe,
      },
    });
    await expect(
      serviceFixture(expiredDatabase).service.read("opaque-session"),
    ).resolves.toBeUndefined();

    const badExpiryDatabase = databaseFixture({
      active: null,
      proposal: { expiresAt: "not-a-date", proposalId, recipe },
    });
    await expect(
      serviceFixture(badExpiryDatabase).service.read("opaque-session"),
    ).resolves.toBeUndefined();

    const database = databaseFixture();
    await expect(
      serviceFixture(database, { readSession: () => undefined }).service.propose(
        "opaque-session",
        recipe,
      ),
    ).resolves.toBe(false);
    await expect(
      serviceFixture(database, {
        readSession: () => ({ ...session, passkeyRegistered: false }),
      }).service.read("opaque-session"),
    ).resolves.toBeUndefined();
    await expect(
      serviceFixture(database, {
        readSession: () => ({ ...session, sessionVerifier: "bad" }),
      }).service.propose("opaque-session", recipe),
    ).resolves.toBe(false);
    await expect(
      serviceFixture(database, { now: () => new Date(Number.NaN) }).service.read("opaque-session"),
    ).resolves.toBeUndefined();
    await expect(
      serviceFixture(database, { randomUuid: () => "not-a-uuid" }).service.propose(
        "opaque-session",
        recipe,
      ),
    ).resolves.toBe(false);

    vi.mocked(database.proposeCarRecipe).mockRejectedValueOnce(
      new Error("private database detail"),
    );
    await expect(serviceFixture(database).service.propose("opaque-session", recipe)).resolves.toBe(
      false,
    );
  });
});

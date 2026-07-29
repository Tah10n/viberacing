import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createPublicRequestId } from "./public-http-problem";
import { createPublicSnapshotAdmission } from "./public-snapshot-admission";
import { PublicSnapshotDatabaseConfigurationError } from "./public-snapshot-database-config";
import {
  acceptsPublicSnapshotJson,
  createCurrentLeaderboardRoute,
  createPublicProfileRoute,
  createSeasonLeaderboardRoute,
  parseCurrentLeaderboardRequest,
  parsePublicProfileRequest,
  parseSeasonLeaderboardRequest,
  publicSnapshotFinalizedCacheControl,
  publicSnapshotOpenCacheControl,
  publicSnapshotRoutePolicy,
} from "./public-snapshot-route";
import { PublicSnapshotStoreError } from "./public-snapshot-store";

const generatedAt = "2026-07-27T12:00:00.000000Z";
const now = () => Date.parse("2026-07-27T12:01:00.000Z");

function leaderboardPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    generatedAt,
    metricVersion: "provider_reported_tokens_v1",
    nextPage: null,
    page: 1,
    pageSize: 100,
    participantCount: 1,
    participants: [
      {
        displayPosition: 1,
        freshnessDays: 0,
        handle: "demo_driver",
        rankPosition: 1,
        weeklyTokenTotal: "12345678",
      },
    ],
    schemaVersion: 1,
    seasonEnd: "2026-08-02",
    seasonStart: "2026-07-27",
    seasonState: "open",
    snapshotRevision: 4,
    trustTier: "community",
    ...overrides,
  };
}

function profilePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    carRecipe: null,
    freshnessDays: 0,
    handle: "demo_driver",
    participantCount: 1,
    rankPosition: 1,
    schemaVersion: 1,
    season: {
      seasonEnd: "2026-08-02",
      seasonStart: "2026-07-27",
      seasonState: "open",
    },
    trustTier: "community",
    weeklyTokenTotal: "12345678",
    ...overrides,
  };
}

function snapshotRecord(
  payload: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const canonicalPayload = JSON.stringify(payload);
  const digest = createHash("sha256").update(canonicalPayload).digest("hex");
  return {
    canonicalPayload,
    etag: `"${digest}"`,
    finalized:
      payload.seasonState === "finalized" ||
      (payload.season as { seasonState?: unknown } | undefined)?.seasonState === "finalized",
    generatedAt,
    ...overrides,
  };
}

function currentRequest(suffix = "?trustTier=community&page=1", init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (!headers.has("accept")) {
    headers.set("accept", "application/json");
  }
  return new Request(`https://viberacing.example/v1/leaderboards/current${suffix}`, {
    ...init,
    headers,
    method: init.method ?? "GET",
  });
}

function currentRoute(
  readCurrentLeaderboard: (page: number) => Promise<unknown>,
  overrides: Partial<Parameters<typeof createCurrentLeaderboardRoute>[0]> = {},
) {
  return createCurrentLeaderboardRoute({
    admission: createPublicSnapshotAdmission(publicSnapshotRoutePolicy.admissionLimit),
    createRequestId: createPublicRequestId,
    enabled: true,
    now,
    readCurrentLeaderboard,
    ...overrides,
  });
}

async function problemCode(response: Response): Promise<string> {
  return ((await response.json()) as { errorCode: string }).errorCode;
}

describe("public snapshot route", () => {
  it.each([
    [null, true],
    ["application/json", true],
    ["application/json; charset=utf-8", true],
    ["text/plain;q=0.1, application/json;q=0.5", true],
    ["*/*", true],
    ["", false],
    ["application/json;q=0", false],
    ["text/plain", false],
    ["*/json", false],
    ["application/json;q=1.0000", false],
    ["application/json\u0001", false],
  ])("negotiates the bounded Accept value %#", (accept, expected) => {
    expect(acceptsPublicSnapshotJson(accept)).toBe(expected);
  });

  it("parses only the exact current path and closed canonical query", () => {
    expect(parseCurrentLeaderboardRequest(currentRequest())).toMatchObject({ page: 1 });
    expect(
      parseCurrentLeaderboardRequest(currentRequest("?page=2&trustTier=community")),
    ).toMatchObject({ page: 2 });

    for (const suffix of [
      "",
      "?trustTier=community",
      "?trustTier=community&page=01",
      "?trustTier=community&page=10001",
      "?trustTier=community&page=1&page=2",
      "?trustTier=verified&page=1",
      "?page=1&trustTier=community&extra=1",
      "?trustTier=community%26page%3D1",
    ]) {
      expect(parseCurrentLeaderboardRequest(currentRequest(suffix))).toBeUndefined();
    }
    expect(
      parseCurrentLeaderboardRequest(
        new Request(
          "https://viberacing.example/v1/leaderboards/current?trustTier=community&page=1#x",
        ),
      ),
    ).toBeUndefined();
  });

  it("parses exact historical and profile path contracts", () => {
    const seasonRequest = new Request(
      "https://viberacing.example/v1/leaderboards/2026-07-20?trustTier=community&page=2",
    );
    expect(
      parseSeasonLeaderboardRequest(seasonRequest, { seasonStart: "2026-07-20" }),
    ).toMatchObject({ page: 2, seasonStart: "2026-07-20" });
    expect(
      parseSeasonLeaderboardRequest(seasonRequest, { seasonStart: "2026-07-21" }),
    ).toBeUndefined();

    const profileRequest = new Request(
      "https://viberacing.example/v1/profiles/demo_driver?trustTier=community",
    );
    expect(parsePublicProfileRequest(profileRequest, { handle: "demo_driver" })).toMatchObject({
      handle: "demo_driver",
    });
    expect(parsePublicProfileRequest(profileRequest, { handle: "../private" })).toBeUndefined();
  });

  it("serves the exact canonical payload with open shared caching and no private headers", async () => {
    const record = snapshotRecord(leaderboardPayload());
    const read = vi.fn(() => Promise.resolve(record));
    const response = await currentRoute(read).get(currentRequest());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(record.canonicalPayload);
    expect(response.headers.get("cache-control")).toBe(publicSnapshotOpenCacheControl);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("etag")).toBe(record.etag);
    expect(response.headers.get("vary")).toBe("Accept");
    expect(response.headers.get("x-request-id")).toMatch(/^req_[A-Za-z0-9_-]{22}$/);
    expect(response.headers.get("x-viberacing-snapshot-freshness")).toBe("fresh");
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
    expect(read).toHaveBeenCalledWith(1);
  });

  it.each([(etag: string) => etag, (etag: string) => `W/${etag}`, () => "*"])(
    "returns bodyless 304 for a matching conditional %#",
    async (conditional) => {
      const record = snapshotRecord(leaderboardPayload());
      const response = await currentRoute(() => Promise.resolve(record)).get(
        currentRequest("?trustTier=community&page=1", {
          headers: {
            accept: "application/json",
            "if-none-match": conditional(String(record.etag)),
          },
        }),
      );

      expect(response.status).toBe(304);
      expect(await response.text()).toBe("");
      expect(response.headers.get("etag")).toBe(record.etag);
      expect(response.headers.has("content-type")).toBe(false);
      expect(response.headers.get("cache-control")).toBe(publicSnapshotOpenCacheControl);
    },
  );

  it("serves a nonmatching conditional normally and rejects malformed conditions", async () => {
    const record = snapshotRecord(leaderboardPayload());
    const nonmatching = `"${"a".repeat(64)}"`;
    const response = await currentRoute(() => Promise.resolve(record)).get(
      currentRequest("?trustTier=community&page=1", {
        headers: { accept: "application/json", "if-none-match": nonmatching },
      }),
    );
    expect(response.status).toBe(200);

    for (const invalid of ['"short"', `W/ ${nonmatching}`, `${nonmatching}, private`, ""]) {
      const rejected = await currentRoute(() => Promise.resolve(record)).get(
        currentRequest("?trustTier=community&page=1", {
          headers: { accept: "application/json", "if-none-match": invalid },
        }),
      );
      expect(rejected.status).toBe(400);
    }
  });

  it.each([
    ["2026-07-27T11:57:30.000000Z", "stale-under-5m"],
    ["2026-07-27T11:30:00.000000Z", "stale-under-1h"],
    ["2026-07-26T13:00:00.000000Z", "stale-under-1d"],
    ["2026-07-25T12:00:00.000000Z", "stale-over-1d"],
  ])("retains and marks one last-good snapshot generated at %s", async (time, freshness) => {
    const payload = leaderboardPayload({ generatedAt: time });
    const record = snapshotRecord(payload, { generatedAt: time });
    const response = await currentRoute(() => Promise.resolve(record)).get(currentRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("x-viberacing-snapshot-freshness")).toBe(freshness);
    expect(response.headers.get("warning")).toBe('110 - "Response is stale"');
  });

  it("uses immutable shared caching only for a finalized historical URL", async () => {
    const payload = leaderboardPayload({
      seasonEnd: "2026-07-26",
      seasonStart: "2026-07-20",
      seasonState: "finalized",
    });
    const record = snapshotRecord(payload);
    const route = createSeasonLeaderboardRoute({
      admission: createPublicSnapshotAdmission(4),
      createRequestId: createPublicRequestId,
      enabled: true,
      now,
      readSeasonLeaderboard: () => Promise.resolve(record),
    });
    const response = await route.get(
      new Request(
        "https://viberacing.example/v1/leaderboards/2026-07-20?trustTier=community&page=1",
        { headers: { accept: "application/json" } },
      ),
      Promise.resolve({ seasonStart: "2026-07-20" }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(publicSnapshotFinalizedCacheControl);
    expect(response.headers.get("x-viberacing-snapshot-freshness")).toBe("finalized");
    expect(response.headers.has("warning")).toBe(false);
  });

  it("serves a validated current public profile with open shared caching", async () => {
    const record = snapshotRecord(profilePayload());
    const read = vi.fn(() => Promise.resolve(record));
    const route = createPublicProfileRoute({
      admission: createPublicSnapshotAdmission(4),
      createRequestId: createPublicRequestId,
      enabled: true,
      now,
      readCurrentProfile: read,
    });
    const response = await route.get(
      new Request("https://viberacing.example/v1/profiles/demo_driver?trustTier=community", {
        headers: { accept: "application/json" },
      }),
      Promise.resolve({ handle: "demo_driver" }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(record.canonicalPayload);
    expect(response.headers.get("cache-control")).toBe(publicSnapshotOpenCacheControl);
    expect(read).toHaveBeenCalledWith("demo_driver");
  });

  it("fails closed while disabled before parsing, admission, or store work", async () => {
    const acquire = vi.fn();
    const read = vi.fn();
    const route = createCurrentLeaderboardRoute({
      admission: { tryAcquire: acquire },
      createRequestId: createPublicRequestId,
      enabled: false,
      readCurrentLeaderboard: read,
    });
    const target = currentRequest();
    const request = new Proxy(target, {
      get(_target, key) {
        if (key === "method") {
          return target.method;
        }
        throw new Error("request must remain unread");
      },
    });
    const response = await route.get(request);

    expect(response.status).toBe(503);
    expect(await problemCode(response)).toBe("temporarily_unavailable");
    expect(acquire).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("returns 405 for non-GET methods and the explicit method boundary", async () => {
    const route = currentRoute(() => Promise.resolve(snapshotRecord(leaderboardPayload())));
    const response = await route.get(
      new Request("https://viberacing.example/v1/leaderboards/current?trustTier=community&page=1", {
        method: "POST",
      }),
    );
    const explicit = route.methodNotAllowed();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    expect(explicit.status).toBe(405);
    expect(explicit.headers.get("allow")).toBe("GET");
  });

  it("returns 406 before admission or store work for an unacceptable representation", async () => {
    const read = vi.fn();
    const acquire = vi.fn();
    const route = createCurrentLeaderboardRoute({
      admission: { tryAcquire: acquire },
      createRequestId: createPublicRequestId,
      enabled: true,
      readCurrentLeaderboard: read,
    });
    const response = await route.get(
      currentRequest("?trustTier=community&page=1", {
        headers: { accept: "text/plain" },
      }),
    );

    expect(response.status).toBe(406);
    expect(await problemCode(response)).toBe("not_acceptable");
    expect(acquire).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("returns generic 503 when the no-queue admission budget is full", async () => {
    const read = vi.fn();
    const route = createCurrentLeaderboardRoute({
      admission: { tryAcquire: () => undefined },
      createRequestId: createPublicRequestId,
      enabled: true,
      readCurrentLeaderboard: read,
    });
    const response = await route.get(currentRequest());

    expect(response.status).toBe(503);
    expect(await problemCode(response)).toBe("temporarily_unavailable");
    expect(read).not.toHaveBeenCalled();
  });

  it("holds and releases admission through store settlement and response validation", async () => {
    let settle: ((value: unknown) => void) | undefined;
    const read = () =>
      new Promise<unknown>((resolve) => {
        settle = resolve;
      });
    const release = vi.fn();
    const route = createCurrentLeaderboardRoute({
      admission: { tryAcquire: () => ({ release }) },
      createRequestId: createPublicRequestId,
      enabled: true,
      now,
      readCurrentLeaderboard: read,
    });
    const pending = route.get(currentRequest());
    await Promise.resolve();
    expect(release).not.toHaveBeenCalled();

    settle?.(snapshotRecord(leaderboardPayload()));
    await expect(pending).resolves.toMatchObject({ status: 200 });
    expect(release).toHaveBeenCalledOnce();
  });

  it.each([
    [new PublicSnapshotStoreError("not_found"), 404, "not_found"],
    [new PublicSnapshotStoreError("snapshot_unavailable"), 503, "temporarily_unavailable"],
    [new PublicSnapshotStoreError("query_failed"), 503, "temporarily_unavailable"],
    [new PublicSnapshotDatabaseConfigurationError("host_invalid"), 503, "temporarily_unavailable"],
    [new PublicSnapshotStoreError("projection_rejected"), 500, "internal_error"],
    [new Error("private internal detail"), 500, "internal_error"],
  ])("maps one opaque dependency failure %#", async (error, status, code) => {
    const response = await currentRoute(() => Promise.reject(error)).get(currentRequest());

    expect(response.status).toBe(status);
    const body = await response.text();
    expect((JSON.parse(body) as { errorCode: string }).errorCode).toBe(code);
    expect(body).not.toContain("private");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    null,
    {},
    snapshotRecord(leaderboardPayload(), { etag: '"deadbeef"' }),
    snapshotRecord(leaderboardPayload({ page: 2 })),
    snapshotRecord(leaderboardPayload(), { privateField: "private" }),
    snapshotRecord(leaderboardPayload(), { generatedAt: "invalid" }),
  ])("rejects a hostile or mismatched store record %#", async (record) => {
    const response = await currentRoute(() => Promise.resolve(record)).get(currentRequest());
    expect(response.status).toBe(500);
    expect(await problemCode(response)).toBe("internal_error");
  });

  it("rejects invalid and rejected dynamic parameters before admission", async () => {
    const read = vi.fn();
    const seasonRoute = createSeasonLeaderboardRoute({
      admission: createPublicSnapshotAdmission(4),
      createRequestId: createPublicRequestId,
      enabled: true,
      readSeasonLeaderboard: read,
    });
    const request = new Request(
      "https://viberacing.example/v1/leaderboards/2026-07-20?trustTier=community&page=1",
    );

    const invalid = await seasonRoute.get(request, Promise.resolve({ seasonStart: "2026-07-21" }));
    const rejected = await seasonRoute.get(
      request,
      Promise.reject(new Error("private router detail")),
    );

    expect(invalid.status).toBe(400);
    expect(rejected.status).toBe(400);
    expect(read).not.toHaveBeenCalled();
  });
});

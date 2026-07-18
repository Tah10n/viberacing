import type {
  CommunityRacePageV1,
  CommunityRaceStatusPageV1,
  CommunityScorePageV1,
} from "@viberacing/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  acceptsPublicCommunityScoreJson,
  createPublicCommunityRaceRoute,
  createPublicCommunityRaceStatusRoute,
  createPublicCommunityScoreRoute,
  parsePublicCommunityRaceQuery,
  parsePublicCommunityRaceStatusQuery,
  parsePublicCommunityScoreQuery,
  publicCommunityRaceRoutePolicy,
  publicCommunityRaceStatusRoutePolicy,
  publicCommunityScoreRoutePolicy,
} from "./public-community-score-route";
import { PublicCommunityScoreStoreError } from "./public-community-score-store";
import { PublicScoreDatabaseConfigurationError } from "./public-score-database-config";
import { createPublicRequestId } from "./public-http-problem";
import { createPublicScoreAdmission } from "./public-score-admission";

const routeUrl = "https://viberacing.invalid/v1/community/scores";
const raceRouteUrl = "https://viberacing.invalid/v1/community/race";
const raceStatusRouteUrl = "https://viberacing.invalid/v1/community/race/status";
const validQuery = "?seasonStart=2026-07-13";
const emptyPage: CommunityScorePageV1 = Object.freeze({
  schemaVersion: 1,
  trustTier: "community",
  selfReported: true,
  participants: Object.freeze([]),
});

function request(query = validQuery, headers?: HeadersInit): Request {
  return new Request(`${routeUrl}${query}`, headers === undefined ? undefined : { headers });
}

function raceRequest(query = validQuery, headers?: HeadersInit): Request {
  return new Request(`${raceRouteUrl}${query}`, headers === undefined ? undefined : { headers });
}

function raceStatusRequest(query = validQuery, headers?: HeadersInit): Request {
  return new Request(
    `${raceStatusRouteUrl}${query}`,
    headers === undefined ? undefined : { headers },
  );
}

function createRoute(readScores: (seasonStart: string) => Promise<unknown>, admissionLimit = 4) {
  return createPublicCommunityScoreRoute({
    admission: createPublicScoreAdmission(admissionLimit),
    createRequestId: createPublicRequestId,
    readScores,
  });
}

function createRaceRoute(readRace: (seasonStart: string) => Promise<unknown>, admissionLimit = 4) {
  return createPublicCommunityRaceRoute({
    admission: createPublicScoreAdmission(admissionLimit),
    createRequestId: createPublicRequestId,
    readRace,
  });
}

function createRaceStatusRoute(
  readRaceStatus: (seasonStart: string) => Promise<unknown>,
  admissionLimit = 4,
) {
  return createPublicCommunityRaceStatusRoute({
    admission: createPublicScoreAdmission(admissionLimit),
    createRequestId: createPublicRequestId,
    readRaceStatus,
  });
}

async function expectProblem(
  response: Response,
  expected: {
    readonly code: string;
    readonly retryable: boolean;
    readonly status: number;
    readonly title: string;
  },
): Promise<void> {
  expect(response.status).toBe(expected.status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-type")).toBe("application/problem+json; charset=utf-8");
  expect(response.headers.get("vary")).toBe("Accept");
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
  const requestId = response.headers.get("x-request-id");
  expect(requestId).toMatch(/^req_[A-Za-z0-9_-]{22}$/);
  await expect(response.json()).resolves.toEqual({
    schemaVersion: 1,
    requestId,
    status: expected.status,
    errorCode: expected.code,
    title: expected.title,
    retryable: expected.retryable,
  });
}

describe("public Community score query parser", () => {
  it.each(["1999-12-27", "2026-07-13", "2099-12-28"])(
    "accepts one canonical Monday at the reviewed boundary: %s",
    (seasonStart) => {
      expect(parsePublicCommunityScoreQuery(request(`?seasonStart=${seasonStart}`))).toEqual({
        seasonStart,
      });
    },
  );

  it.each([
    "",
    "?seasonStart=",
    "?seasonStart=2026-07-13&",
    "?seasonStart=2026-07-13&unknown=value",
    "?seasonStart=2026-07-13&seasonStart=2026-07-20",
    "?seasonStart=2026-07-13=private",
    "?SeasonStart=2026-07-13",
    "?%73easonStart=2026-07-13",
    "?seasonStart=2026-02-30",
    "?seasonStart=2026-07-14",
    "?seasonStart=1999-12-20",
    "?seasonStart=2100-01-04",
    "?seasonStart=2026-07-%ZZ",
  ])("rejects a non-canonical or non-closed query before storage: %s", (query) => {
    expect(parsePublicCommunityScoreQuery(request(query))).toBeUndefined();
  });

  it("rejects a body signal, wrong path, non-HTTP URL, and oversized URL", () => {
    expect(
      parsePublicCommunityScoreQuery(
        request(validQuery, {
          "content-length": "1",
        }),
      ),
    ).toBeUndefined();
    expect(
      parsePublicCommunityScoreQuery(
        new Request(`https://viberacing.invalid/v1/community/results${validQuery}`),
      ),
    ).toBeUndefined();
    expect(
      parsePublicCommunityScoreQuery(
        new Request(`ftp://viberacing.invalid${routeUrl}${validQuery}`),
      ),
    ).toBeUndefined();
    expect(
      parsePublicCommunityScoreQuery(
        new Request(`${routeUrl}${validQuery}&unknown=${"x".repeat(2_048)}`),
      ),
    ).toBeUndefined();
  });

  it("contains reflective request failures without exposing their cause", () => {
    const privateValue = "private-request-value-that-must-not-be-reflected";
    const base = request();
    const hostileUrl = new Proxy(base, {
      get(target, property) {
        if (property === "url") {
          throw new Error(privateValue);
        }
        return Reflect.get(target, property, target) as unknown;
      },
    });
    const bodySignal = new Proxy(base, {
      get(target, property) {
        if (property === "body") {
          return new ReadableStream();
        }
        return Reflect.get(target, property, target) as unknown;
      },
    });

    expect(parsePublicCommunityScoreQuery(hostileUrl)).toBeUndefined();
    expect(parsePublicCommunityScoreQuery(bodySignal)).toBeUndefined();
  });
});

describe("public Community score Accept negotiation", () => {
  it.each([
    null,
    "*/*",
    "application/*",
    "application/json",
    "Application/JSON",
    "application/json; charset=utf-8",
    'application/json; charset="UTF-8"',
    'application/json; q=1; note="a\\"b"',
    'application/json; q=1; note="a\\\\b"',
    "text/plain; q=0.4, application/json; q=0.8",
    'text/plain; note="a,b", application/json',
  ])("accepts a supported bounded representation: %o", (accept) => {
    expect(acceptsPublicCommunityScoreJson(accept)).toBe(true);
  });

  it.each([
    "",
    "text/html",
    "application/problem+json",
    "application/json;q=0",
    "application/json;q=2",
    "application/json;q=.5",
    "application/json;q=1;q=1",
    "application/json;charset=latin1",
    "application",
    "application/json;flag",
    "application/json;=value",
    `application/json;note="${"x".repeat(129)}"`,
    "*/json",
    'application/json; note="unterminated',
    "application/json\u0000",
  ])("rejects an unsupported or malformed representation: %o", (accept) => {
    expect(acceptsPublicCommunityScoreJson(accept)).toBe(false);
  });

  it("rejects oversized or over-segmented header work", () => {
    expect(acceptsPublicCommunityScoreJson(`application/json;note=${"x".repeat(1_024)}`)).toBe(
      false,
    );
    expect(acceptsPublicCommunityScoreJson(Array.from({ length: 33 }, () => "*/*").join(","))).toBe(
      false,
    );
    expect(
      acceptsPublicCommunityScoreJson(
        `application/json;${Array.from({ length: 16 }, (_, index) => `p${String(index)}=v`).join(";")}`,
      ),
    ).toBe(false);
    expect(acceptsPublicCommunityScoreJson(`application/json${String.fromCharCode(8)}`)).toBe(
      false,
    );
    expect(acceptsPublicCommunityScoreJson(`application/json${String.fromCharCode(127)}`)).toBe(
      false,
    );
  });
});

describe("public Community score route", () => {
  it("returns one validated no-store page without CORS or private response fields", async () => {
    const readScores = vi.fn(() => Promise.resolve(emptyPage));
    const inboundRequestId = "inbound-request-id-must-be-ignored";
    const response = await createRoute(readScores).get(
      request(validQuery, { "x-request-id": inboundRequestId }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("vary")).toBe("Accept");
    expect(response.headers.get("x-request-id")).toMatch(/^req_[A-Za-z0-9_-]{22}$/);
    expect(response.headers.get("x-request-id")).not.toBe(inboundRequestId);
    expect(response.headers.get("allow")).toBeNull();
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    await expect(response.json()).resolves.toEqual(emptyPage);
    expect(readScores).toHaveBeenCalledOnce();
    expect(readScores).toHaveBeenCalledWith("2026-07-13");
  });

  it("returns 400 for an invalid query without acquiring store work", async () => {
    const readScores = vi.fn(() => Promise.resolve(emptyPage));
    const response = await createRoute(readScores).get(request("?seasonStart=2026-07-14"));

    await expectProblem(response, {
      code: "invalid_request",
      retryable: false,
      status: 400,
      title: "Invalid request",
    });
    expect(readScores).not.toHaveBeenCalled();
  });

  it("returns 406 before store work when JSON is unacceptable", async () => {
    const readScores = vi.fn(() => Promise.resolve(emptyPage));
    const response = await createRoute(readScores).get(
      request(validQuery, { accept: "text/plain" }),
    );

    await expectProblem(response, {
      code: "not_acceptable",
      retryable: false,
      status: 406,
      title: "Not acceptable",
    });
    expect(readScores).not.toHaveBeenCalled();
  });

  it("contains a late request-header accessor failure as a generic 400", async () => {
    const privateValue = "private-header-value-that-must-not-be-reflected";
    const readScores = vi.fn(() => Promise.resolve(emptyPage));
    let headerReads = 0;
    const hostileRequest = new Proxy(request(), {
      get(target, property) {
        if (property === "headers") {
          headerReads += 1;
          if (headerReads === 3) {
            throw new Error(privateValue);
          }
        }
        return Reflect.get(target, property, target) as unknown;
      },
    });
    const response = await createRoute(readScores).get(hostileRequest);
    const responseCopy = response.clone();

    await expectProblem(response, {
      code: "invalid_request",
      retryable: false,
      status: 400,
      title: "Invalid request",
    });
    expect(await responseCopy.text()).not.toContain(privateValue);
    expect(readScores).not.toHaveBeenCalled();
  });

  it("returns the exact 405 boundary and Allow header for a non-GET dispatch", async () => {
    const readScores = vi.fn(() => Promise.resolve(emptyPage));
    const route = createRoute(readScores);
    const direct = await route.get(new Request(`${routeUrl}${validQuery}`, { method: "POST" }));
    const dispatched = route.methodNotAllowed();

    for (const response of [direct, dispatched]) {
      await expectProblem(response, {
        code: "method_not_allowed",
        retryable: false,
        status: 405,
        title: "Method not allowed",
      });
      expect(response.headers.get("allow")).toBe("GET");
    }
    expect(readScores).not.toHaveBeenCalled();
  });

  it.each([
    "connection_release_failed",
    "connection_unavailable",
    "query_failed",
    "runtime_boundary_mismatch",
  ] as const)("maps the unavailable store code %s to 503", async (code) => {
    const response = await createRoute(() =>
      Promise.reject(new PublicCommunityScoreStoreError(code)),
    ).get(request());

    await expectProblem(response, {
      code: "temporarily_unavailable",
      retryable: true,
      status: 503,
      title: "Temporarily unavailable",
    });
  });

  it("maps invalid deployment configuration to 503", async () => {
    const response = await createRoute(() =>
      Promise.reject(new PublicScoreDatabaseConfigurationError("host_invalid")),
    ).get(request());

    await expectProblem(response, {
      code: "temporarily_unavailable",
      retryable: true,
      status: 503,
      title: "Temporarily unavailable",
    });
  });

  it.each(["invalid_season", "pool_close_failed", "projection_rejected"] as const)(
    "maps the invariant store code %s to a generic 500",
    async (code) => {
      const response = await createRoute(() =>
        Promise.reject(new PublicCommunityScoreStoreError(code)),
      ).get(request());

      await expectProblem(response, {
        code: "internal_error",
        retryable: false,
        status: 500,
        title: "Internal server error",
      });
    },
  );

  it("rejects an invalid page and opaque thrown values without reflection", async () => {
    const privateValue = "private-value-that-must-not-be-reflected";
    const revoked = Proxy.revocable(new Error(privateValue), {});
    revoked.revoke();
    for (const readScores of [
      () => Promise.resolve({ ...emptyPage, privateField: privateValue }),
      () => Promise.reject(new Error(privateValue)),
      () => Promise.reject(revoked.proxy),
    ]) {
      const response = await createRoute(readScores).get(request());
      const text = await response.text();
      expect(response.status).toBe(500);
      expect(text).not.toContain(privateValue);
      expect(text).toContain('"errorCode":"internal_error"');
    }
  });

  it("releases admission after a rejected store operation", async () => {
    const readScores = vi
      .fn<(seasonStart: string) => Promise<unknown>>()
      .mockRejectedValueOnce(new PublicCommunityScoreStoreError("query_failed"))
      .mockResolvedValueOnce(emptyPage);
    const route = createRoute(readScores, 1);

    await expect(route.get(request())).resolves.toMatchObject({ status: 503 });
    await expect(route.get(request())).resolves.toMatchObject({ status: 200 });
    expect(readScores).toHaveBeenCalledTimes(2);
  });

  it("holds a no-queue admission lease until store work settles", async () => {
    let settle: ((page: CommunityScorePageV1) => void) | undefined;
    const pending = new Promise<CommunityScorePageV1>((resolve) => {
      settle = resolve;
    });
    const readScores = vi.fn(() => pending);
    const route = createRoute(readScores, 1);

    const firstPromise = route.get(request());
    await vi.waitFor(() => {
      expect(readScores).toHaveBeenCalledOnce();
    });
    const overloaded = await route.get(request());
    await expectProblem(overloaded, {
      code: "temporarily_unavailable",
      retryable: true,
      status: 503,
      title: "Temporarily unavailable",
    });
    expect(readScores).toHaveBeenCalledOnce();

    settle?.(emptyPage);
    await expect(firstPromise).resolves.toMatchObject({ status: 200 });
    await expect(route.get(request())).resolves.toMatchObject({ status: 200 });
    expect(readScores).toHaveBeenCalledTimes(2);
  });

  it("binds admission and deadline policy to the reviewed database limits", () => {
    expect(publicCommunityScoreRoutePolicy).toEqual({
      admissionLimit: 4,
      connectionTimeoutMs: 2_000,
      queryTimeoutMs: 6_000,
      statementTimeoutMs: 5_000,
    });
    expect(Object.isFrozen(publicCommunityScoreRoutePolicy)).toBe(true);
  });
});

describe("public Community race route", () => {
  const recipe = {
    schemaVersion: 1,
    chassis: "formula",
    nose: "wedge",
    cockpit: "canopy",
    wing: "high",
    wheels: "slick",
    palette: "magenta",
    trail: "spark",
    seed: 101,
  } as const;
  const racePage: CommunityRacePageV1 = {
    schemaVersion: 1,
    trustTier: "community",
    selfReported: true,
    participants: [
      {
        seasonStart: "2026-07-13",
        seasonEnd: "2026-07-19",
        scoreVersion: "community_v1",
        seasonFinalized: false,
        handle: "community_one",
        carRecipe: recipe,
        weeklyScore: 6400,
        activeDays: 7,
        sourceCount: 2,
        rankPosition: 1,
        displayPosition: 1,
      },
    ],
  };

  it("keeps the new and stable score paths exact and independent", () => {
    expect(parsePublicCommunityRaceQuery(raceRequest())).toEqual({ seasonStart: "2026-07-13" });
    expect(parsePublicCommunityRaceStatusQuery(raceStatusRequest())).toEqual({
      seasonStart: "2026-07-13",
    });
    expect(parsePublicCommunityRaceQuery(request())).toBeUndefined();
    expect(parsePublicCommunityRaceQuery(raceStatusRequest())).toBeUndefined();
    expect(parsePublicCommunityRaceStatusQuery(raceRequest())).toBeUndefined();
    expect(parsePublicCommunityScoreQuery(raceRequest())).toBeUndefined();
    expect(parsePublicCommunityScoreQuery(raceStatusRequest())).toBeUndefined();
  });

  it("returns one validated no-store race page with the optional active recipe", async () => {
    const readRace = vi.fn(() => Promise.resolve(racePage));
    const response = await createRaceRoute(readRace).get(raceRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    await expect(response.json()).resolves.toEqual(racePage);
    expect(readRace).toHaveBeenCalledWith("2026-07-13");
  });

  it("rejects arbitrary recipe content and keeps the stable score response closed", async () => {
    const invalidRacePage = {
      ...racePage,
      participants: [
        {
          ...racePage.participants[0],
          carRecipe: { ...recipe, assetUrl: "private-value-that-must-not-be-reflected" },
        },
      ],
    };
    const invalidRaceResponse = await createRaceRoute(() => Promise.resolve(invalidRacePage)).get(
      raceRequest(),
    );
    const stableScoreResponse = await createRoute(() => Promise.resolve(racePage)).get(request());

    for (const response of [invalidRaceResponse, stableScoreResponse]) {
      const text = await response.text();
      expect(response.status).toBe(500);
      expect(text).toContain('"errorCode":"internal_error"');
      expect(text).not.toContain("private-value-that-must-not-be-reflected");
    }
  });

  it("shares the reviewed no-queue and database deadline policy", () => {
    expect(publicCommunityRaceRoutePolicy).toBe(publicCommunityScoreRoutePolicy);
    expect(publicCommunityRaceRoutePolicy).toEqual({
      admissionLimit: 4,
      connectionTimeoutMs: 2_000,
      queryTimeoutMs: 6_000,
      statementTimeoutMs: 5_000,
    });
  });

  it("returns the separately validated race-status page without widening race v1", async () => {
    const statusPage: CommunityRaceStatusPageV1 = {
      ...racePage,
      participants: racePage.participants.map((participant) => ({
        ...participant,
        freshnessDays: 2,
        streakDays: 12,
      })),
    };
    const readRaceStatus = vi.fn(() => Promise.resolve(statusPage));
    const response = await createRaceStatusRoute(readRaceStatus).get(raceStatusRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(statusPage);
    expect(readRaceStatus).toHaveBeenCalledWith("2026-07-13");

    const legacyResponse = await createRaceRoute(() => Promise.resolve(statusPage)).get(
      raceRequest(),
    );
    expect(legacyResponse.status).toBe(500);
  });

  it("shares the same bounded policy for the race-status operation", () => {
    expect(publicCommunityRaceStatusRoutePolicy).toBe(publicCommunityScoreRoutePolicy);
    expect(publicCommunityRaceStatusRoutePolicy).toBe(publicCommunityRaceRoutePolicy);
  });
});

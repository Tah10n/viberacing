import { describe, expect, it, vi } from "vitest";

import startVector from "../../../contracts/v1/connector-pairing-start-possession.test-vector.json";
import { createPairingHttp } from "./pairing-http";
import type {
  PairingPollDecision,
  PairingStartDecision,
  PairingTransportService,
} from "./pairing-transport-service";

const startPath = "https://race.example/v1/connector/pairing/start";
const pollPath = "https://race.example/v1/connector/pairing/poll";

function startBody() {
  return {
    clientRateIdentifier: startVector.clientRateIdentifier,
    discoveryManifest: startVector.manifest,
    installationPossessionProof: {
      nonce: startVector.nonce,
      signature: startVector.possessionSignature,
      signedAt: startVector.signedAt,
    },
    schemaVersion: 1,
  };
}

function request(url: string, body: unknown, headers: HeadersInit = {}): Request {
  const requestHeaders = new Headers({
    accept: "application/json",
    "content-type": "application/json",
  });
  new Headers(headers).forEach((value, name) => {
    requestHeaders.set(name, value);
  });
  return new Request(url, {
    body: JSON.stringify(body),
    headers: requestHeaders,
    method: "POST",
  });
}

function service(
  overrides: Partial<Pick<PairingTransportService, "poll" | "start">> = {},
): Pick<PairingTransportService, "poll" | "start"> {
  return {
    poll: vi.fn((): Promise<PairingPollDecision> =>
      Promise.resolve({
        outcome: "ok",
        result: {
          candidateActivations: [],
          pairingState: "pending",
          requestId: "req_AAAAAAAAAAAAAAAAAAAAAA",
          schemaVersion: 1,
        },
      }),
    ),
    start: vi.fn((): Promise<PairingStartDecision> =>
      Promise.resolve({
        outcome: "created",
        result: {
          approvalUrl: "https://race.example/connect?code=2345-6789-ABCD",
          expiresAt: "2026-07-28T12:43:56.789Z",
          pairingChallenge: "A".repeat(43),
          pairingId: "pair_AAAAAAAAAAAAAAAAAAAAAA",
          pollToken: "B".repeat(43),
          requestId: "req_AAAAAAAAAAAAAAAAAAAAAA",
          schemaVersion: 1,
          userCode: "2345-6789-ABCD",
        },
      }),
    ),
    ...overrides,
  };
}

describe("batch pairing HTTP boundary", () => {
  it("dispatches exact final start and poll contracts without a client-id header", async () => {
    const current = service();
    const http = createPairingHttp({
      enabled: true,
      getService: () => Promise.resolve(current),
    });

    const started = await http.start(request(startPath, startBody()));
    expect(started.status).toBe(200);
    expect(started.headers.get("cache-control")).toBe("no-store");
    expect(started.headers.has("access-control-allow-origin")).toBe(false);
    await expect(started.json()).resolves.toMatchObject({
      pairingId: "pair_AAAAAAAAAAAAAAAAAAAAAA",
      schemaVersion: 1,
    });
    expect(current.start).toHaveBeenCalledWith(startBody());

    const polled = await http.poll(
      request(pollPath, {
        pairingId: "pair_AAAAAAAAAAAAAAAAAAAAAA",
        pollToken: "B".repeat(43),
        possessionSignature: "C".repeat(86),
        schemaVersion: 1,
      }),
    );
    expect(polled.status).toBe(200);
    await expect(polled.json()).resolves.toEqual({
      candidateActivations: [],
      pairingState: "pending",
      requestId: "req_AAAAAAAAAAAAAAAAAAAAAA",
      schemaVersion: 1,
    });
  });

  it("gates before body parsing and rejects wrong path, query, media, accept, and size", async () => {
    const current = service();
    const disabled = createPairingHttp({
      enabled: false,
      getService: () => Promise.resolve(current),
    });
    expect((await disabled.start(request(startPath, startBody()))).status).toBe(503);
    expect(current.start).not.toHaveBeenCalled();

    const http = createPairingHttp({
      enabled: true,
      getService: () => Promise.resolve(current),
    });
    const cases = [
      request(`${startPath}?extra=1`, startBody()),
      request("https://race.example/v1/connector/pairing/other", startBody()),
      request(startPath, startBody(), { accept: "text/html" }),
      new Request(startPath, {
        body: JSON.stringify(startBody()),
        headers: { "content-type": "text/plain" },
        method: "POST",
      }),
      new Request(startPath, {
        body: "x".repeat(32_769),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    ];
    for (const invalid of cases) {
      expect((await http.start(invalid)).status).toBe(400);
    }
    expect(current.start).not.toHaveBeenCalled();
  });

  it("maps only stable invalid/unavailable outcomes and contains thrown details", async () => {
    for (const [outcome, status] of [
      ["invalid", 400],
      ["unavailable", 503],
    ] as const) {
      const http = createPairingHttp({
        enabled: true,
        getService: () =>
          Promise.resolve(service({ start: vi.fn(() => Promise.resolve({ outcome })) })),
      });
      const response = await http.start(request(startPath, startBody()));
      expect(response.status).toBe(status);
      expect(JSON.stringify(await response.json())).not.toContain("private");
    }

    const thrown = createPairingHttp({
      enabled: true,
      getService: () => Promise.reject(new Error("private configuration")),
    });
    expect((await thrown.start(request(startPath, startBody()))).status).toBe(503);
  });

  it("closes every non-POST method with Allow: POST", () => {
    const response = createPairingHttp({
      enabled: true,
      getService: () => Promise.resolve(service()),
    }).methodNotAllowed();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});

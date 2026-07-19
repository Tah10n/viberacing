// @vitest-environment node

import { Buffer } from "node:buffer";

import pairingVector from "../../../contracts/v1/connector-pairing-possession.test-vector.json";
import { describe, expect, it, vi } from "vitest";

import type { PairingActivationDecision } from "./pairing-activation-application";
import { createPairingHttp } from "./pairing-http";
import type { PairingStartDecision } from "./pairing-start-application";

const clientId = Buffer.alloc(16, 0x45).toString("base64url");
const startPath = "https://viberacing.invalid/v1/connector/pairing/start";
const pollPath = "https://viberacing.invalid/v1/connector/pairing/poll";
const requestId = "req_AAAAAAAAAAAAAAAAAAAAAA";
const startBody = Object.freeze({
  schemaVersion: 1,
  devicePublicKeyBase64Url: pairingVector.devicePublicKeyBase64Url,
  deviceLabel: "Synthetic device",
  connectorVersion: "0.0.0-test",
  osFamily: "windows",
  architecture: "x86_64",
});
const pollBody = Object.freeze({
  schemaVersion: 1,
  pollToken: Buffer.alloc(32, 0x33).toString("base64url"),
  possessionSignature: pairingVector.possessionSignatureBase64Url,
});

function request(path: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(path, {
    body,
    headers: {
      accept: "application/json",
      "content-type": "application/json; charset=utf-8",
      "x-viberacing-client-id": clientId,
      ...headers,
    },
    method: "POST",
  });
}

function service(
  options: {
    readonly poll?: unknown;
    readonly pollError?: Error;
    readonly start?: unknown;
    readonly startError?: Error;
  } = {},
) {
  const poll = vi.fn((): Promise<PairingActivationDecision> =>
    options.pollError === undefined
      ? Promise.resolve(
          (options.poll ?? {
            outcome: "pending",
            requestId,
          }) as PairingActivationDecision,
        )
      : Promise.reject(options.pollError),
  );
  const start = vi.fn((): Promise<PairingStartDecision> =>
    options.startError === undefined
      ? Promise.resolve(
          (options.start ?? {
            expiresAt: "2026-07-17T06:09:00.000Z",
            outcome: "created",
            pairingChallengeBase64Url: Buffer.alloc(32, 0x22).toString("base64url"),
            pairingId: "00000000-0000-4000-8000-000000000401",
            pollToken: pollBody.pollToken,
            requestId,
            userCode: "ABCD-EFGH-JKLM",
          }) as PairingStartDecision,
        )
      : Promise.reject(options.startError),
  );
  return { poll, start };
}

describe("connector pairing HTTP boundary", () => {
  it.each([false, undefined, "true", 1])(
    "fails closed before request parsing or service construction for enable value %#",
    async (enabled) => {
      const getService = vi.fn(() => Promise.reject(new Error("service-must-not-run")));
      const http = createPairingHttp({ enabled, getService });
      const makeHostileRequest = () =>
        new Proxy(new Request(startPath, { method: "POST" }), {
          get(_target, key) {
            if (key === "body") {
              return null;
            }
            throw new Error(`request-field-must-not-run:${String(key)}`);
          },
        });

      for (const invoke of [
        (request: Request) => http.start(request),
        (request: Request) => http.poll(request),
      ]) {
        const response = await invoke(makeHostileRequest());
        expect(response.status).toBe(503);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("referrer-policy")).toBe("no-referrer");
        expect(response.headers.get("vary")).toBe("Accept");
        expect(response.headers.has("access-control-allow-origin")).toBe(false);
        await expect(response.json()).resolves.toMatchObject({
          errorCode: "temporarily_unavailable",
          status: 503,
        });
      }
      expect(getService).not.toHaveBeenCalled();
    },
  );

  it("validates and dispatches one bounded start request", async () => {
    const currentService = service();
    const http = createPairingHttp({
      enabled: true,
      getService: () => Promise.resolve(currentService),
    });

    const response = await http.start(request(startPath, JSON.stringify(startBody)));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("vary")).toBe("Accept");
    expect(response.headers.get("x-request-id")).toBe(requestId);
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
    await expect(response.json()).resolves.toMatchObject({
      pairingId: "00000000-0000-4000-8000-000000000401",
      requestId,
      schemaVersion: 1,
    });
    expect(currentService.start).toHaveBeenCalledWith({
      architecture: "x86_64",
      clientIdBase64Url: clientId,
      connectorVersion: "0.0.0-test",
      deviceLabel: "Synthetic device",
      devicePublicKeyBase64Url: pairingVector.devicePublicKeyBase64Url,
      osFamily: "windows",
    });
    expect(currentService.poll).not.toHaveBeenCalled();
  });

  it("returns only an empty pending page or one activated binding", async () => {
    const pendingService = service();
    const pendingHttp = createPairingHttp({
      enabled: true,
      getService: () => Promise.resolve(pendingService),
    });
    const pending = await pendingHttp.poll(request(pollPath, JSON.stringify(pollBody)));
    expect(pending.status).toBe(200);
    await expect(pending.json()).resolves.toEqual({
      schemaVersion: 1,
      requestId,
      deviceBindings: [],
    });

    const activatedService = service({
      poll: {
        deviceId: "dev_AAAAAAAAAAAAAAAAAAAAAA",
        outcome: "activated",
        requestId,
        sourceId: "src_BBBBBBBBBBBBBBBBBBBBBB",
      },
    });
    const activatedHttp = createPairingHttp({
      enabled: true,
      getService: () => Promise.resolve(activatedService),
    });
    const activated = await activatedHttp.poll(request(pollPath, JSON.stringify(pollBody)));
    await expect(activated.json()).resolves.toEqual({
      schemaVersion: 1,
      requestId,
      deviceBindings: [
        {
          deviceId: "dev_AAAAAAAAAAAAAAAAAAAAAA",
          sourceId: "src_BBBBBBBBBBBBBBBBBBBBBB",
        },
      ],
    });
    expect(activatedService.poll).toHaveBeenCalledWith({
      clientIdBase64Url: clientId,
      pollToken: pollBody.pollToken,
      possessionSignature: pollBody.possessionSignature,
    });
  });

  it.each([
    {
      label: "duplicate decoded key",
      make: () =>
        request(
          startPath,
          JSON.stringify(startBody).replace(
            '"schemaVersion":1',
            '"schemaVersion":1,"\\u0073chemaVersion":1',
          ),
        ),
    },
    {
      label: "unknown field",
      make: () => request(startPath, JSON.stringify({ ...startBody, usage: 1 })),
    },
    {
      label: "missing client id",
      make: () =>
        new Request(startPath, {
          body: JSON.stringify(startBody),
          headers: { accept: "application/json", "content-type": "application/json" },
          method: "POST",
        }),
    },
    {
      label: "wrong media type",
      make: () => request(startPath, JSON.stringify(startBody), { "content-type": "text/plain" }),
    },
    {
      label: "query string",
      make: () => request(`${startPath}?extra=1`, JSON.stringify(startBody)),
    },
    {
      label: "encoded body",
      make: () => request(startPath, JSON.stringify(startBody), { "content-encoding": "gzip" }),
    },
    {
      label: "mismatched content length",
      make: () => request(startPath, JSON.stringify(startBody), { "content-length": "1" }),
    },
    {
      label: "nested JSON",
      make: () => request(startPath, JSON.stringify({ ...startBody, deviceLabel: { value: "x" } })),
    },
  ])("rejects $label before service initialization", async ({ make }) => {
    const getService = vi.fn(() => Promise.resolve(service()));
    const response = await createPairingHttp({ enabled: true, getService }).start(make());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ errorCode: "invalid_request" });
    expect(getService).not.toHaveBeenCalled();
  });

  it("rejects unacceptable output negotiation before reading the body", async () => {
    const getService = vi.fn(() => Promise.resolve(service()));
    const response = await createPairingHttp({ enabled: true, getService }).poll(
      request(pollPath, JSON.stringify(pollBody), { accept: "text/html" }),
    );

    expect(response.status).toBe(406);
    await expect(response.json()).resolves.toMatchObject({ errorCode: "not_acceptable" });
    expect(getService).not.toHaveBeenCalled();
  });

  it.each([
    { expected: "rate_limited", result: { outcome: "rate_limited", requestId }, status: 429 },
    {
      expected: "temporarily_unavailable",
      result: { outcome: "not_created", requestId },
      status: 503,
    },
  ])(
    "maps start decisions to the closed problem contract",
    async ({ expected, result, status }) => {
      const response = await createPairingHttp({
        enabled: true,
        getService: () => Promise.resolve(service({ start: result })),
      }).start(request(startPath, JSON.stringify(startBody)));

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toMatchObject({ errorCode: expected });
    },
  );

  it("contains service initialization, execution, and output-contract failures", async () => {
    const unavailable = await createPairingHttp({
      enabled: true,
      getService: () => Promise.reject(new Error("private configuration")),
    }).start(request(startPath, JSON.stringify(startBody)));
    expect(unavailable.status).toBe(503);

    const execution = await createPairingHttp({
      enabled: true,
      getService: () => Promise.resolve(service({ pollError: new Error("private query") })),
    }).poll(request(pollPath, JSON.stringify(pollBody)));
    expect(execution.status).toBe(503);

    const invalidOutput = await createPairingHttp({
      enabled: true,
      getService: () =>
        Promise.resolve(
          service({
            start: {
              expiresAt: "not-a-date",
              outcome: "created",
              pairingChallengeBase64Url: "invalid",
              pairingId: "invalid",
              pollToken: "invalid",
              requestId,
              userCode: "invalid",
            },
          }),
        ),
    }).start(request(startPath, JSON.stringify(startBody)));
    expect(invalidOutput.status).toBe(500);
    await expect(invalidOutput.json()).resolves.toMatchObject({ errorCode: "internal_error" });
  });

  it("closes every non-POST method with one Allow header", async () => {
    const response = createPairingHttp({
      enabled: true,
      getService: () => Promise.resolve(service()),
    }).methodNotAllowed();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    await expect(response.json()).resolves.toMatchObject({ errorCode: "method_not_allowed" });
  });
});

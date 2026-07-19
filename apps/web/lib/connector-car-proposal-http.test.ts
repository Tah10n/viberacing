// @vitest-environment node

import { Buffer } from "node:buffer";

import vector from "../../../contracts/v1/connector-car-proposal-device-request.test-vector.json";
import { describe, expect, it, vi } from "vitest";

import { createConnectorCarProposalAdmission } from "./connector-car-proposal-admission";
import type { ConnectorCarProposalDecision } from "./connector-car-proposal-application";
import {
  createConnectorCarProposalHttp,
  type ConnectorCarProposalHttpDependencies,
} from "./connector-car-proposal-http";

const path = "https://viberacing.invalid/v1/connector/cars/proposals";

function request(
  body = vector.body,
  headers: Readonly<Record<string, string>> = {},
  url = path,
): Request {
  return new Request(url, {
    body,
    headers: {
      accept: "application/json",
      "content-type": "application/json; charset=utf-8",
      "x-viberacing-device-id": vector.deviceId,
      "x-viberacing-device-nonce": vector.deviceNonceBase64Url,
      "x-viberacing-device-signature": vector.deviceSignatureBase64Url,
      "x-viberacing-device-timestamp": vector.deviceTimestamp,
      ...headers,
    },
    method: "POST",
  });
}

function service(
  result?: ConnectorCarProposalDecision,
  capture?: (input: Readonly<Record<string, unknown>>) => void,
) {
  const execute = vi.fn(
    (input: unknown, requestId: string): Promise<ConnectorCarProposalDecision> => {
      capture?.(input as Readonly<Record<string, unknown>>);
      return Promise.resolve(result ?? { outcome: "accepted" as const, requestId });
    },
  );
  return { execute };
}

function createEnabledHttp(
  dependencies: Omit<ConnectorCarProposalHttpDependencies, "carProposalsEnabled">,
) {
  return createConnectorCarProposalHttp({ ...dependencies, carProposalsEnabled: true });
}

describe("connector car proposal HTTP boundary", () => {
  it.each([false, undefined, "true", 1])(
    "fails closed before request parsing or service construction for enable value %#",
    async (carProposalsEnabled) => {
      const getService = vi.fn(() => Promise.reject(new Error("service-must-not-run")));
      const http = createConnectorCarProposalHttp({ carProposalsEnabled, getService });
      const hostileRequest = new Proxy(new Request(path, { method: "POST" }), {
        get(_target, key) {
          if (key === "body") {
            return null;
          }
          throw new Error(`request-field-must-not-run:${String(key)}`);
        },
      });

      const response = await http.post(hostileRequest);
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("vary")).toBe("Accept");
      await expect(response.json()).resolves.toMatchObject({
        errorCode: "temporarily_unavailable",
        status: 503,
      });
      expect(getService).not.toHaveBeenCalled();
    },
  );

  it("dispatches one bounded raw request and returns only a generic acknowledgement", async () => {
    let capturedBody: Buffer | undefined;
    const current = service(undefined, (input) => {
      capturedBody = input.rawBody as Buffer;
      expect(capturedBody.toString("utf8")).toBe(vector.body);
    });
    const response = await createEnabledHttp({
      getService: () => Promise.resolve(current),
    }).post(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("vary")).toBe("Accept");
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
    const requestId = response.headers.get("x-request-id");
    expect(requestId).toMatch(/^req_[A-Za-z0-9_-]{22}$/);
    await expect(response.json()).resolves.toEqual({
      schemaVersion: 1,
      requestId,
      outcome: "accepted",
    });
    expect(current.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: vector.deviceId,
        deviceNonce: vector.deviceNonceBase64Url,
        deviceSignature: vector.deviceSignatureBase64Url,
        deviceTimestamp: vector.deviceTimestamp,
      }),
      requestId,
    );
    expect(capturedBody).toEqual(Buffer.alloc(Buffer.byteLength(vector.body)));
  });

  it.each([
    {
      label: "query string",
      make: () => request(vector.body, {}, `${path}?private=1`),
    },
    {
      label: "wrong media type",
      make: () => request(vector.body, { "content-type": "text/plain" }),
    },
    {
      label: "unknown security header",
      make: () => request(vector.body, { "x-viberacing-profile-id": "private" }),
    },
    {
      label: "missing device id",
      make: () => {
        const current = request();
        current.headers.delete("x-viberacing-device-id");
        return current;
      },
    },
    {
      label: "encoded body",
      make: () => request(vector.body, { "content-encoding": "gzip" }),
    },
    {
      label: "oversized body",
      make: () => request("x".repeat(513)),
    },
  ])("rejects $label before service initialization", async ({ make }) => {
    const getService = vi.fn(() => Promise.resolve(service()));
    const response = await createEnabledHttp({ getService }).post(make());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ errorCode: "invalid_request" });
    expect(getService).not.toHaveBeenCalled();
  });

  it("rejects unacceptable output negotiation before reading the body", async () => {
    const getService = vi.fn(() => Promise.resolve(service()));
    const response = await createEnabledHttp({ getService }).post(
      request(vector.body, { accept: "text/html" }),
    );
    expect(response.status).toBe(406);
    await expect(response.json()).resolves.toMatchObject({ errorCode: "not_acceptable" });
    expect(getService).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid_request", 400],
    ["unauthorized", 401],
    ["validation_failed", 422],
    ["temporarily_unavailable", 503],
  ] as const)("maps %s to status %s", async (problem, status) => {
    const response = await createEnabledHttp({
      getService: () =>
        Promise.resolve(
          service({
            outcome: "rejected",
            problem,
            requestId: "req_replaced-by-execute",
          }),
        ),
    }).post(request());
    expect(response.status).toBe(500);

    const execute = vi.fn((_input: unknown, requestId: string) =>
      Promise.resolve({ outcome: "rejected" as const, problem, requestId }),
    );
    const mapped = await createEnabledHttp({
      getService: () => Promise.resolve({ execute }),
    }).post(request());
    expect(mapped.status).toBe(status);
    await expect(mapped.json()).resolves.toMatchObject({ errorCode: problem, status });
  });

  it("applies the no-queue admission limit without initializing the service", async () => {
    const admission = createConnectorCarProposalAdmission(1);
    const held = admission.tryAcquire();
    const getService = vi.fn(() => Promise.resolve(service()));
    const response = await createEnabledHttp({ admission, getService }).post(request());
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ errorCode: "rate_limited" });
    expect(getService).not.toHaveBeenCalled();
    held?.release();
  });

  it("contains initialization, execution, and response-correlation failures", async () => {
    const unavailable = await createEnabledHttp({
      getService: () => Promise.reject(new Error("private configuration")),
    }).post(request());
    expect(unavailable.status).toBe(503);

    const failed = await createEnabledHttp({
      getService: () =>
        Promise.resolve({ execute: () => Promise.reject(new Error("private query")) }),
    }).post(request());
    expect(failed.status).toBe(500);

    const mismatched = await createEnabledHttp({
      getService: () =>
        Promise.resolve(service({ outcome: "accepted" as const, requestId: "req_private" })),
    }).post(request());
    expect(mismatched.status).toBe(500);
  });

  it("closes every non-POST method with one Allow header", async () => {
    const response = createEnabledHttp({
      getService: () => Promise.resolve(service()),
    }).methodNotAllowed();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    await expect(response.json()).resolves.toMatchObject({ errorCode: "method_not_allowed" });
  });
});

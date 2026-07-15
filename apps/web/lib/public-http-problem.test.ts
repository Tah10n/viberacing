import { Buffer } from "node:buffer";
import crypto from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPublicProblemResponse,
  createPublicRequestId,
  PublicHttpProblemError,
  type PublicHttpProblemErrorCode,
  type PublicRequestId,
} from "./public-http-problem";

const fixedRequestIdValue = "req_AAAAAAAAAAAAAAAAAAAAAA";
const privateValue = "private-value-that-must-not-be-reflected";

interface RandomBytesSpy {
  mockImplementation(implementation: (size: number) => Uint8Array): void;
}

interface BufferFromSpy {
  mockImplementationOnce(
    implementation: (value: Uint8Array) => { toString(encoding: string): string },
  ): void;
  mockRestore(): void;
}

function mockRandomBytes(source: (size: number) => Uint8Array): void {
  const spy = vi.spyOn(crypto, "randomBytes") as unknown as RandomBytesSpy;
  spy.mockImplementation(source);
}

function fixedRequestId(): PublicRequestId {
  mockRandomBytes(() => new Uint8Array(16));
  return createPublicRequestId();
}

function expectBoundaryError(operation: () => unknown, code: PublicHttpProblemErrorCode): void {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(PublicHttpProblemError);
    expect(error).toMatchObject({
      code,
      message: "Public HTTP response construction failed.",
      name: "PublicHttpProblemError",
    });
    expect(String(error)).not.toContain(privateValue);
    return;
  }
  throw new Error("expected public HTTP boundary construction to fail");
}

describe("public HTTP problem boundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a contract-shaped cryptographic request ID from exactly 16 bytes", () => {
    const entropySource = vi.fn(() => new Uint8Array(16));
    mockRandomBytes(entropySource);

    const requestId = createPublicRequestId();

    expect(requestId.value).toBe(fixedRequestIdValue);
    expect(requestId.value).toHaveLength(26);
    expect(Object.isFrozen(requestId)).toBe(true);
    expect(entropySource).toHaveBeenCalledOnce();
    expect(entropySource).toHaveBeenCalledWith(16);
  });

  it("uses the production entropy source without accepting caller-controlled text", () => {
    const first = createPublicRequestId();
    const second = createPublicRequestId();

    expect(first.value).toMatch(/^req_[A-Za-z0-9_-]{22}$/);
    expect(second.value).toMatch(/^req_[A-Za-z0-9_-]{22}$/);
    expect(first.value).not.toBe(second.value);
  });

  it.each([
    ["invalid_request", 400, "Invalid request", false],
    ["unauthorized", 401, "Unauthorized", false],
    ["forbidden", 403, "Forbidden", false],
    ["not_found", 404, "Not found", false],
    ["conflict", 409, "Conflict", false],
    ["validation_failed", 422, "Validation failed", false],
    ["rate_limited", 429, "Rate limited", true],
    ["internal_error", 500, "Internal server error", false],
    ["temporarily_unavailable", 503, "Temporarily unavailable", true],
  ] as const)(
    "maps %s to one closed ProblemDetailsV1 response",
    async (kind, status, title, retryable) => {
      const response = createPublicProblemResponse(kind, fixedRequestId());

      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-type")).toBe("application/problem+json; charset=utf-8");
      expect(response.headers.get("x-request-id")).toBe(fixedRequestIdValue);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      await expect(response.json()).resolves.toEqual({
        schemaVersion: 1,
        requestId: fixedRequestIdValue,
        status,
        errorCode: kind,
        title,
        retryable,
      });
    },
  );

  it("rejects unavailable, malformed, and hostile entropy without reflecting it", () => {
    mockRandomBytes(() => {
      throw new Error(privateValue);
    });
    expectBoundaryError(() => {
      createPublicRequestId();
    }, "entropy_unavailable");

    mockRandomBytes(() => new Uint8Array(15));
    expectBoundaryError(() => createPublicRequestId(), "entropy_invalid");

    const revoked = Proxy.revocable(new Uint8Array(16), {});
    revoked.revoke();
    mockRandomBytes(() => revoked.proxy);
    expectBoundaryError(() => createPublicRequestId(), "entropy_unavailable");

    mockRandomBytes(() => new Uint8Array(16));
    const invalidEncoding = vi.spyOn(Buffer, "from") as unknown as BufferFromSpy;
    invalidEncoding.mockImplementationOnce(() => ({
      toString() {
        return privateValue;
      },
    }));
    expectBoundaryError(() => createPublicRequestId(), "entropy_invalid");
    invalidEncoding.mockRestore();

    const failedEncoding = vi.spyOn(Buffer, "from") as unknown as BufferFromSpy;
    failedEncoding.mockImplementationOnce(() => {
      throw new Error(privateValue);
    });
    expectBoundaryError(() => createPublicRequestId(), "entropy_invalid");
    failedEncoding.mockRestore();
  });

  it("rejects malformed or unbranded request IDs and an unknown problem kind non-reflectively", () => {
    const malformedTokens = [
      null,
      fixedRequestIdValue,
      Object.freeze(Object.assign(Object.create(null) as object, { value: fixedRequestIdValue })),
      { value: fixedRequestIdValue },
      Object.freeze({ value: fixedRequestIdValue }),
      Object.freeze({ extra: true, value: fixedRequestIdValue }),
    ];
    for (const token of malformedTokens) {
      expectBoundaryError(
        () => createPublicProblemResponse("invalid_request", token as unknown as PublicRequestId),
        "request_id_invalid",
      );
    }
    expectBoundaryError(
      () => createPublicProblemResponse(privateValue, fixedRequestId()),
      "problem_kind_invalid",
    );
  });

  it("rejects accessor-backed and revoked request tokens without invoking or reflecting them", () => {
    let reads = 0;
    const accessorToken = {};
    const brandKey = Reflect.ownKeys(fixedRequestId()).find((key) => typeof key === "symbol");
    if (brandKey === undefined) {
      throw new Error("expected an opaque request token brand");
    }
    Object.defineProperty(accessorToken, "value", {
      enumerable: true,
      get() {
        reads += 1;
        return fixedRequestIdValue;
      },
    });
    Object.defineProperty(accessorToken, brandKey, {
      enumerable: false,
      value: true,
    });
    Object.freeze(accessorToken);
    expectBoundaryError(
      () => createPublicProblemResponse("invalid_request", accessorToken as PublicRequestId),
      "request_id_invalid",
    );
    expect(reads).toBe(0);

    const revoked = Proxy.revocable(fixedRequestId(), {});
    revoked.revoke();
    expectBoundaryError(
      () => createPublicProblemResponse("invalid_request", revoked.proxy),
      "request_id_invalid",
    );
  });

  it("keeps the serialized contract closed when Object.prototype has an inherited toJSON", async () => {
    const previousToJSON = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
    let body: string;
    Object.defineProperty(Object.prototype, "toJSON", {
      configurable: true,
      value() {
        return { reflected: privateValue };
      },
    });
    try {
      body = await createPublicProblemResponse("invalid_request", fixedRequestId()).text();
    } finally {
      if (previousToJSON === undefined) {
        Reflect.deleteProperty(Object.prototype, "toJSON");
      } else {
        Object.defineProperty(Object.prototype, "toJSON", previousToJSON);
      }
    }

    expect(body).toBe(
      JSON.stringify({
        schemaVersion: 1,
        requestId: fixedRequestIdValue,
        status: 400,
        errorCode: "invalid_request",
        title: "Invalid request",
        retryable: false,
      }),
    );
    expect(body).not.toContain(privateValue);
  });
});

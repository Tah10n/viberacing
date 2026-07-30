/* eslint-disable @typescript-eslint/unbound-method -- Vitest inspects injected service spies. */

import { describe, expect, it, vi } from "vitest";

import type { BatchPairingBrowserService } from "./batch-pairing-browser-service";
import { createBatchPairingBrowserHttp } from "./batch-pairing-browser-http";

const origin = "https://viberacing.invalid";

function serviceFixture(): BatchPairingBrowserService {
  return {
    beginApproval: vi.fn(() =>
      Promise.resolve({
        approvalCookie: "sealed-approval",
        options: { challenge: "A".repeat(43) },
      } as const),
    ),
    completeApproval: vi.fn(() => Promise.resolve(true)),
    review: vi.fn(() =>
      Promise.resolve({
        approval: {
          manifestDigest: "a".repeat(64),
          pairingId: "pair_AAAAAAAAAAAAAAAAAAAAAA",
          schemaVersion: 1,
        },
        pairing: {
          architecture: "x86_64",
          candidates: [],
          connectorVersion: "0.0.0",
          existingAccounts: [],
          expiresAt: "2026-07-28T12:09:00.000Z",
          installationLabel: "Main workstation",
          osFamily: "windows",
          publicKeyFingerprint: "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        },
      } as const),
    ),
  };
}

function request(
  path: "options" | "review" | "verify",
  body: unknown,
  cookie = "viberacing_session=session",
): Request {
  return new Request(`${origin}/auth/pairing/${path}`, {
    body: JSON.stringify(body),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      cookie,
      origin,
    },
    method: "POST",
  });
}

function httpFixture(enabled: unknown) {
  const service = serviceFixture();
  const release = vi.fn();
  const tryAcquire = vi.fn(() => ({ release }));
  const getService = vi.fn(() => service);
  const http = createBatchPairingBrowserHttp({
    admission: { tryAcquire },
    enabled,
    getService,
    publicOrigin: origin,
    secureCookies: true,
  });
  return { getService, http, release, service, tryAcquire };
}

describe("batch pairing browser HTTP boundary", () => {
  it.each([false, undefined, "true", 1])(
    "fails closed before parsing, admission, or service construction for enable value %#",
    async (enabled) => {
      const { getService, http, tryAcquire } = httpFixture(enabled);
      const target = new Request(`${origin}/auth/pairing/review`, {
        body: "{}",
        method: "POST",
      });
      const response = await http.review(target);

      expect(response.status).toBe(503);
      expect(getService).not.toHaveBeenCalled();
      expect(tryAcquire).not.toHaveBeenCalled();
    },
  );

  it("dispatches review, options, and verification with purpose-separated cookies", async () => {
    const { http, release, service } = httpFixture(true);
    const reviewResponse = await http.review(request("review", { userCode: "7K9M-P2QR-W4XY" }));
    expect(reviewResponse.status).toBe(200);
    expect(await reviewResponse.json()).toMatchObject({
      approval: { pairingId: "pair_AAAAAAAAAAAAAAAAAAAAAA" },
    });
    expect(service.review).toHaveBeenCalledWith("session", {
      userCode: "7K9M-P2QR-W4XY",
    });

    const approval = {
      decisions: [
        {
          action: "skip",
          candidateId: "cand_AAAAAAAAAAAAAAAAAAAAAA",
        },
      ],
      manifestDigest: "a".repeat(64),
      pairingId: "pair_AAAAAAAAAAAAAAAAAAAAAA",
      schemaVersion: 1,
    };
    const optionsResponse = await http.options(request("options", approval));
    expect(optionsResponse.status).toBe(200);
    expect(optionsResponse.headers.get("set-cookie")).toContain(
      "viberacing_pairing_approval=sealed-approval",
    );
    expect(optionsResponse.headers.get("set-cookie")).toContain("Path=/auth/pairing");
    expect(optionsResponse.headers.get("set-cookie")).toContain("Secure");
    expect(await optionsResponse.json()).toEqual({
      options: { challenge: "A".repeat(43) },
    });

    const verifyResponse = await http.verify(
      request(
        "verify",
        { response: { id: "credential" } },
        "viberacing_session=session; viberacing_pairing_approval=sealed-approval",
      ),
    );
    expect(verifyResponse.status).toBe(204);
    expect(verifyResponse.headers.get("set-cookie")).toContain("viberacing_pairing_approval=");
    expect(verifyResponse.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(service.completeApproval).toHaveBeenCalledWith("session", "sealed-approval", {
      response: { id: "credential" },
    });
    expect(release).toHaveBeenCalledTimes(3);
  });

  it("rejects origin, path, media type, body, and duplicate-cookie ambiguity generically", async () => {
    const { getService, http, service } = httpFixture(true);
    const hostile = [
      new Request(`${origin}/auth/pairing/review?code=leak`, {
        body: "{}",
        headers: { "content-type": "application/json", origin },
        method: "POST",
      }),
      new Request(`${origin}/auth/pairing/review`, {
        body: "{}",
        headers: { "content-type": "text/plain", origin },
        method: "POST",
      }),
      new Request(`${origin}/auth/pairing/review`, {
        body: "{}",
        headers: { "content-type": "application/json", origin: "https://attacker.invalid" },
        method: "POST",
      }),
    ];
    for (const target of hostile) {
      await expect(http.review(target)).resolves.toMatchObject({ status: 400 });
    }

    const duplicate = await http.review(
      request(
        "review",
        { userCode: "7K9M-P2QR-W4XY" },
        "viberacing_session=one; viberacing_session=two",
      ),
    );
    expect(duplicate.status).toBe(401);
    expect(service.review).not.toHaveBeenCalled();
    expect(getService).not.toHaveBeenCalled();
  });

  it("rejects before service work when the shared admission budget is exhausted", async () => {
    const service = serviceFixture();
    const getService = vi.fn(() => service);
    const http = createBatchPairingBrowserHttp({
      admission: { tryAcquire: vi.fn(() => undefined) },
      enabled: true,
      getService,
      publicOrigin: origin,
      secureCookies: false,
    });

    await expect(
      http.review(request("review", { userCode: "7K9M-P2QR-W4XY" })),
    ).resolves.toMatchObject({ status: 503 });
    expect(getService).not.toHaveBeenCalled();
  });
});

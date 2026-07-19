import { afterEach, describe, expect, it, vi } from "vitest";

const serviceMock = vi.hoisted(() => {
  const execute = vi.fn((_input: unknown, requestId: string) =>
    Promise.resolve({ outcome: "accepted" as const, requestId }),
  );
  return {
    execute,
    getConnectorCarProposalService: vi.fn(() => Promise.resolve({ execute })),
  };
});

vi.mock("@/lib/connector-car-proposal-service", () => serviceMock);

const path = "https://viberacing.invalid/v1/connector/cars/proposals";

function request(): Request {
  return new Request(path, {
    body: "{}",
    headers: {
      accept: "application/json",
      "content-type": "application/json; charset=utf-8",
      "x-viberacing-device-id": `dev_${"A".repeat(22)}`,
      "x-viberacing-device-nonce": "synthetic-nonce",
      "x-viberacing-device-signature": "synthetic-signature",
      "x-viberacing-device-timestamp": "2026-07-18T10:00:00.000Z",
    },
    method: "POST",
  });
}

describe("connector car proposal Next.js entrypoint", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    serviceMock.execute.mockClear();
    serviceMock.getConnectorCarProposalService.mockClear();
  });

  it("fails closed before proposal service construction when disabled", async () => {
    vi.stubEnv("VIBERACING_CAR_PROPOSALS_ENABLED", "false");
    const route = await import("./route");
    const response = await route.POST(request());

    expect(route.dynamic).toBe("force-dynamic");
    expect(route.runtime).toBe("nodejs");
    expect(response.status).toBe(503);
    expect(serviceMock.getConnectorCarProposalService).not.toHaveBeenCalled();
    expect(serviceMock.execute).not.toHaveBeenCalled();
  });

  it("constructs the dedicated proposal service only after exact enablement", async () => {
    vi.stubEnv("VIBERACING_CAR_PROPOSALS_ENABLED", "true");
    const route = await import("./route");
    const response = await route.POST(request());

    expect(response.status).toBe(200);
    expect(serviceMock.getConnectorCarProposalService).toHaveBeenCalledOnce();
    expect(serviceMock.execute).toHaveBeenCalledOnce();
  });

  it("dispatches every non-POST method through the closed response while disabled", async () => {
    vi.stubEnv("VIBERACING_CAR_PROPOSALS_ENABLED", "false");
    const route = await import("./route");
    for (const [method, handler] of [
      ["DELETE", route.DELETE],
      ["GET", route.GET],
      ["HEAD", route.HEAD],
      ["OPTIONS", route.OPTIONS],
      ["PATCH", route.PATCH],
      ["PUT", route.PUT],
    ] as const) {
      const response = handler(new Request(path, { method }));
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
      expect(response.headers.get("vary")).toBe("Accept");
      if (method !== "HEAD") {
        await expect(response.json()).resolves.toMatchObject({
          errorCode: "method_not_allowed",
          status: 405,
        });
      }
    }
  });
});

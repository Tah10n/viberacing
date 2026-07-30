import { describe, expect, it, vi } from "vitest";

const routeMock = vi.hoisted(() => ({
  verify: vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
}));

vi.mock("@/lib/batch-pairing-browser-route", () => ({
  batchPairingBrowserHttp: routeMock,
}));

import { dynamic, POST, runtime } from "./route";

describe("batch pairing approval verification Next.js entrypoint", () => {
  it("declares the exact runtime and delegates the original request", async () => {
    const request = new Request("https://viberacing.invalid/auth/pairing/verify", {
      method: "POST",
    });

    expect(dynamic).toBe("force-dynamic");
    expect(runtime).toBe("nodejs");
    await expect(POST(request)).resolves.toMatchObject({ status: 204 });
    expect(routeMock.verify).toHaveBeenCalledOnce();
    expect(routeMock.verify).toHaveBeenCalledWith(request);
  });
});

import { describe, expect, it, vi } from "vitest";

const routeMock = vi.hoisted(() => ({
  review: vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
}));

vi.mock("@/lib/batch-pairing-browser-route", () => ({
  batchPairingBrowserHttp: routeMock,
}));

import { dynamic, POST, runtime } from "./route";

describe("batch pairing review Next.js entrypoint", () => {
  it("declares the exact runtime and delegates the original request", async () => {
    const request = new Request("https://viberacing.invalid/auth/pairing/review", {
      method: "POST",
    });

    expect(dynamic).toBe("force-dynamic");
    expect(runtime).toBe("nodejs");
    await expect(POST(request)).resolves.toMatchObject({ status: 204 });
    expect(routeMock.review).toHaveBeenCalledOnce();
    expect(routeMock.review).toHaveBeenCalledWith(request);
  });
});

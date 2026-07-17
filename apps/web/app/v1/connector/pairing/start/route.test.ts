import { describe, expect, it } from "vitest";

import { DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT, dynamic, runtime } from "./route";

const path = "https://viberacing.invalid/v1/connector/pairing/start";

describe("connector pairing start Next.js entrypoint", () => {
  it("stays lazy for a rejected request and pins the Node dynamic runtime", async () => {
    expect(dynamic).toBe("force-dynamic");
    expect(runtime).toBe("nodejs");
    await expect(POST(new Request(path, { method: "POST" }))).resolves.toMatchObject({
      status: 400,
    });
  });

  it("dispatches every non-POST method through the closed response", async () => {
    for (const [method, handler] of [
      ["DELETE", DELETE],
      ["GET", GET],
      ["HEAD", HEAD],
      ["OPTIONS", OPTIONS],
      ["PATCH", PATCH],
      ["PUT", PUT],
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

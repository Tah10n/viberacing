import { describe, expect, it } from "vitest";

import { DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT, dynamic, runtime } from "./route";

const invalidRequest = new Request(
  "https://viberacing.invalid/v1/community/scores?seasonStart=2026-07-14",
);

describe("public Community score Next.js entrypoint", () => {
  it("stays lazy for a rejected request and pins the Node dynamic runtime", async () => {
    expect(dynamic).toBe("force-dynamic");
    expect(runtime).toBe("nodejs");
    await expect(GET(invalidRequest)).resolves.toMatchObject({ status: 400 });
  });

  it("dispatches every non-GET Next.js method through the closed 405 response", async () => {
    for (const handler of [DELETE, HEAD, OPTIONS, PATCH, POST, PUT]) {
      const response = handler();
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET");
      expect(response.headers.get("vary")).toBe("Accept");
      await expect(response.json()).resolves.toMatchObject({
        errorCode: "method_not_allowed",
        status: 405,
      });
    }
  });
});

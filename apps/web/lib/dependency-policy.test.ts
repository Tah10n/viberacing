import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const requireFromNext = createRequire(require.resolve("next/package.json"));

describe("installed web dependencies", () => {
  it("keeps unused Sharp image optimization unavailable to Next.js after upgrades", () => {
    expect(() => requireFromNext.resolve("sharp")).toThrow(
      expect.objectContaining({ code: "MODULE_NOT_FOUND" }),
    );
  });
});

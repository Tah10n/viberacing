import { resolve } from "node:path";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

describe("frontend lint policy", () => {
  it("rejects importing the intentionally unavailable sharp runtime", async () => {
    const eslint = new ESLint({ cwd: import.meta.dirname });
    const [result] = await eslint.lintText(
      [
        'import sharp from "sharp";',
        'const lazy = import("sharp");',
        'export { default as processor } from "sharp";',
        'export * from "sharp";',
        'const legacy = require("sharp");',
        "void [sharp, lazy, legacy];",
      ].join("\n"),
      { filePath: resolve(import.meta.dirname, "lib", "scoring.ts") },
    );

    const restrictions = result?.messages.filter(
      ({ message, ruleId }) =>
        ruleId === "no-restricted-syntax" && message.includes("Sharp is intentionally unavailable"),
    );
    expect(restrictions).toHaveLength(5);
  }, 15_000);
});

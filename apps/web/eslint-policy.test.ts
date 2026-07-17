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
  }, 30_000);

  it("confines every Ed25519 access shape to reviewed server verifier modules", async () => {
    const eslint = new ESLint({ cwd: import.meta.dirname });
    const [result] = await eslint.lintText(
      [
        'import { verifyAsync } from "@noble/ed25519";',
        'const lazy = import("@noble/ed25519");',
        'export { verifyAsync as verify } from "@noble/ed25519";',
        'export * from "@noble/ed25519";',
        'const legacy = require("@noble/ed25519");',
        "void [verifyAsync, lazy, legacy];",
      ].join("\n"),
      { filePath: resolve(import.meta.dirname, "lib", "scoring.ts") },
    );

    const restrictedImports = result?.messages.filter(
      ({ message, ruleId }) =>
        ruleId === "no-restricted-imports" && message.includes("reviewed server verifier modules"),
    );
    const restrictedSyntax = result?.messages.filter(
      ({ message, ruleId }) =>
        ruleId === "no-restricted-syntax" && message.includes("Web Ed25519 verification"),
    );
    expect(restrictedImports).toHaveLength(3);
    expect(restrictedSyntax).toHaveLength(2);
  }, 30_000);

  it("confines every node-postgres access shape to the reviewed pool wrappers", async () => {
    const eslint = new ESLint({ cwd: import.meta.dirname });
    const source = [
      'import { Pool } from "pg";',
      'const lazy = import("pg");',
      'export { Pool as DatabasePool } from "pg";',
      'export * from "pg";',
      'const legacy = require("pg");',
      "void [Pool, lazy, legacy];",
    ].join("\n");
    const results = await Promise.all([
      eslint.lintText(source, { filePath: resolve(import.meta.dirname, "lib", "scoring.ts") }),
      eslint.lintText(source, {
        filePath: resolve(import.meta.dirname, "components", "race-experience.tsx"),
      }),
    ]);

    for (const [result] of results) {
      const restrictedImports = result?.messages.filter(
        ({ message, ruleId }) =>
          ruleId === "no-restricted-imports" &&
          (message.includes("reviewed Web database pool") ||
            message.includes("server-side PostgreSQL access")),
      );
      const restrictedSyntax = result?.messages.filter(
        ({ message, ruleId }) =>
          ruleId === "no-restricted-syntax" && message.includes("Web PostgreSQL access"),
      );
      expect(restrictedImports).toHaveLength(3);
      expect(restrictedSyntax).toHaveLength(2);
    }
  }, 30_000);

  it("confines server and browser WebAuthn imports to their exact owners", async () => {
    const eslint = new ESLint({ cwd: import.meta.dirname });
    const source = (packageName: string) =>
      [
        `import { owner } from "${packageName}";`,
        `const lazy = import("${packageName}");`,
        `export { owner as verifier } from "${packageName}";`,
        `export * from "${packageName}";`,
        `const legacy = require("${packageName}");`,
        "void [owner, lazy, legacy];",
      ].join("\n");
    const [serverResult, browserResult] = await Promise.all([
      eslint.lintText(source("@simplewebauthn/server"), {
        filePath: resolve(import.meta.dirname, "lib", "scoring.ts"),
      }),
      eslint.lintText(source("@simplewebauthn/browser"), {
        filePath: resolve(import.meta.dirname, "components", "race-experience.tsx"),
      }),
    ]);

    for (const [result] of [serverResult, browserResult]) {
      const restrictedImports = result?.messages.filter(
        ({ message, ruleId }) =>
          ruleId === "no-restricted-imports" &&
          (message.includes("Only passkey-registration") || message.includes("Only passkey-setup")),
      );
      const restrictedSyntax = result?.messages.filter(
        ({ message, ruleId }) => ruleId === "no-restricted-syntax" && message.includes("WebAuthn"),
      );
      expect(restrictedImports).toHaveLength(3);
      expect(restrictedSyntax).toHaveLength(2);
    }
  }, 30_000);
});

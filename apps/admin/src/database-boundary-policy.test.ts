import { resolve } from "node:path";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

describe("Admin dependency boundary lint policy", () => {
  it("rejects every PostgreSQL driver import outside the fixed pool adapter", async () => {
    const eslint = new ESLint({ cwd: resolve(import.meta.dirname, "..") });
    const [result] = await eslint.lintText(
      [
        'import pg from "pg";',
        'const lazy = import("pg");',
        'export { default as driver } from "pg";',
        'export * from "pg";',
        'const legacy = require("pg");',
        "void [pg, lazy, legacy];",
      ].join("\n"),
      { filePath: resolve(import.meta.dirname, "invite-issuance.ts") },
    );

    const restrictions = result?.messages.filter(
      ({ message, ruleId }) =>
        ruleId === "no-restricted-syntax" &&
        message === "Only database-pool.ts may import the PostgreSQL driver.",
    );
    expect(restrictions).toHaveLength(5);
  }, 30_000);

  it("rejects every JOSE import outside the fixed Access verifier", async () => {
    const eslint = new ESLint({ cwd: resolve(import.meta.dirname, "..") });
    const [result] = await eslint.lintText(
      [
        'import { jwtVerify } from "jose";',
        'const lazy = import("jose");',
        'export { jwtVerify as verifier } from "jose";',
        'export * from "jose";',
        'const legacy = require("jose");',
        "void [jwtVerify, lazy, legacy];",
      ].join("\n"),
      { filePath: resolve(import.meta.dirname, "invite-issuance.ts") },
    );

    const restrictions = result?.messages.filter(
      ({ message, ruleId }) =>
        ruleId === "no-restricted-syntax" &&
        message === "Only access-verifier.ts may import the JOSE verifier.",
    );
    expect(restrictions).toHaveLength(5);
  }, 30_000);
});

import { resolve } from "node:path";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

describe("Ingest database boundary lint policy", () => {
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
      { filePath: resolve(import.meta.dirname, "community-sync-database.ts") },
    );

    const restrictions = result?.messages.filter(
      ({ message, ruleId }) =>
        ruleId === "no-restricted-syntax" &&
        message === "Only database-pool.ts may import the PostgreSQL driver.",
    );
    expect(restrictions).toHaveLength(5);
  }, 15_000);

  it("keeps HTTP imports and environment reads outside the current slice", async () => {
    const eslint = new ESLint({ cwd: resolve(import.meta.dirname, "..") });
    const [result] = await eslint.lintText(
      [
        'import http from "node:http";',
        'const lazy = import("fastify");',
        "const environment = process.env;",
        'const computedEnvironment = process["env"];',
        "void [http, lazy, environment, computedEnvironment];",
      ].join("\n"),
      { filePath: resolve(import.meta.dirname, "community-sync-database.ts") },
    );

    expect(
      result?.messages.filter(
        ({ ruleId }) => ruleId === "no-restricted-syntax" || ruleId === "no-restricted-imports",
      ),
    ).toHaveLength(4);
  }, 15_000);
});

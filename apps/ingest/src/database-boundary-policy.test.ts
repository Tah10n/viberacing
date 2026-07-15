import { resolve } from "node:path";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

describe("Ingest capability lint policy", () => {
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

  it("keeps listener imports and environment reads outside the database boundary", async () => {
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

  it("rejects every Fastify import form outside the reviewed listener", async () => {
    const eslint = new ESLint({ cwd: resolve(import.meta.dirname, "..") });
    const [result] = await eslint.lintText(
      [
        'import Fastify from "fastify";',
        'const lazy = import("fastify");',
        'export { default as serverFactory } from "fastify";',
        'export * from "fastify";',
        'const legacy = require("fastify");',
        "void [Fastify, lazy, legacy];",
      ].join("\n"),
      { filePath: resolve(import.meta.dirname, "community-sync-database.ts") },
    );

    expect(
      result?.messages.filter(
        ({ ruleId }) => ruleId === "no-restricted-syntax" || ruleId === "no-restricted-imports",
      ),
    ).toHaveLength(5);
  }, 15_000);

  it("confines Fastify to the reviewed listener without widening database or environment access", async () => {
    const eslint = new ESLint({ cwd: resolve(import.meta.dirname, "..") });
    const [allowed] = await eslint.lintText(
      'import Fastify from "fastify"; const server = Fastify(); void server;',
      { filePath: resolve(import.meta.dirname, "community-sync-http-server.ts") },
    );
    expect(
      allowed?.messages.filter(
        ({ ruleId }) => ruleId === "no-restricted-syntax" || ruleId === "no-restricted-imports",
      ),
    ).toHaveLength(0);

    const [rejected] = await eslint.lintText(
      [
        'import http from "node:http";',
        'const driver = import("pg");',
        "const environment = process.env;",
        "void [http, driver, environment];",
      ].join("\n"),
      { filePath: resolve(import.meta.dirname, "community-sync-http-server.ts") },
    );
    expect(
      rejected?.messages.filter(
        ({ ruleId }) => ruleId === "no-restricted-syntax" || ruleId === "no-restricted-imports",
      ),
    ).toHaveLength(3);
  }, 15_000);

  it.each(["database-config.ts", "origin-proof-config.ts"])(
    "permits environment reads only in the reviewed %s boundary",
    async (fileName) => {
      const eslint = new ESLint({ cwd: resolve(import.meta.dirname, "..") });
      const [result] = await eslint.lintText("const environment = process.env; void environment;", {
        filePath: resolve(import.meta.dirname, fileName),
      });

      expect(
        result?.messages.filter(({ ruleId }) => ruleId === "no-restricted-syntax"),
      ).toHaveLength(0);
    },
    15_000,
  );
});

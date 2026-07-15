import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  {
    files: ["**/*.{js,mjs,ts}"],
    extends: [js.configs.recommended],
  },
  {
    files: ["**/*.ts"],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: ["src/**/*.ts"],
    ignores: ["src/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "fastify",
              message: "Only community-sync-http-server.ts may own the Fastify boundary.",
            },
            {
              name: "node:http",
              message: "Only community-sync-http-server.ts may own the HTTP server boundary.",
            },
            {
              name: "node:https",
              message: "TLS termination remains outside the local Ingest server factory.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/community-sync-http-server.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "node:http",
              message: "The Fastify boundary must own HTTP server construction.",
            },
            {
              name: "node:https",
              message: "TLS termination remains outside the local Ingest server factory.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportDeclaration[source.value='pg']",
          message: "Only database-pool.ts may import the PostgreSQL driver.",
        },
        {
          selector: "ImportExpression[source.value='pg']",
          message: "Only database-pool.ts may import the PostgreSQL driver.",
        },
        {
          selector: "ExportNamedDeclaration[source.value='pg']",
          message: "Only database-pool.ts may import the PostgreSQL driver.",
        },
        {
          selector: "ExportAllDeclaration[source.value='pg']",
          message: "Only database-pool.ts may import the PostgreSQL driver.",
        },
        {
          selector: "CallExpression[callee.name='require'][arguments.0.value='pg']",
          message: "Only database-pool.ts may import the PostgreSQL driver.",
        },
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: "Only database-config.ts may read environment configuration.",
        },
        {
          selector: "MemberExpression[object.name='process'][computed=true][property.value='env']",
          message: "Only database-config.ts may read environment configuration.",
        },
        {
          selector: "ImportExpression[source.value=/^(node:http|node:https)$/]",
          message: "The Fastify boundary must not bypass its reviewed server construction.",
        },
        {
          selector:
            "CallExpression[callee.name='require'][arguments.0.value=/^(node:http|node:https)$/]",
          message: "The Fastify boundary must not bypass its reviewed server construction.",
        },
      ],
    },
  },
  {
    files: ["src/**/*.ts"],
    ignores: [
      "src/**/*.test.ts",
      "src/database-config.ts",
      "src/database-pool.ts",
      "src/origin-proof-config.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportDeclaration[source.value='pg']",
          message: "Only database-pool.ts may import the PostgreSQL driver.",
        },
        {
          selector: "ImportExpression[source.value='pg']",
          message: "Only database-pool.ts may import the PostgreSQL driver.",
        },
        {
          selector: "ExportNamedDeclaration[source.value='pg']",
          message: "Only database-pool.ts may import the PostgreSQL driver.",
        },
        {
          selector: "ExportAllDeclaration[source.value='pg']",
          message: "Only database-pool.ts may import the PostgreSQL driver.",
        },
        {
          selector: "CallExpression[callee.name='require'][arguments.0.value='pg']",
          message: "Only database-pool.ts may import the PostgreSQL driver.",
        },
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: "Only database-config.ts may read environment configuration.",
        },
        {
          selector: "MemberExpression[object.name='process'][computed=true][property.value='env']",
          message: "Only database-config.ts may read environment configuration.",
        },
        {
          selector: "ImportExpression[source.value=/^(fastify|node:http|node:https)$/]",
          message: "Only community-sync-http-server.ts may own the HTTP server boundary.",
        },
        {
          selector:
            "CallExpression[callee.name='require'][arguments.0.value=/^(fastify|node:http|node:https)$/]",
          message: "Only community-sync-http-server.ts may own the HTTP server boundary.",
        },
      ],
    },
  },
  {
    files: ["src/database-pool.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: "Only database-config.ts may read environment configuration.",
        },
        {
          selector: "MemberExpression[object.name='process'][computed=true][property.value='env']",
          message: "Only database-config.ts may read environment configuration.",
        },
        {
          selector: "ImportExpression[source.value=/^(fastify|node:http|node:https)$/]",
          message: "Only community-sync-http-server.ts may own the HTTP server boundary.",
        },
        {
          selector:
            "CallExpression[callee.name='require'][arguments.0.value=/^(fastify|node:http|node:https)$/]",
          message: "Only community-sync-http-server.ts may own the HTTP server boundary.",
        },
      ],
    },
  },
  {
    files: ["src/database-config.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportDeclaration[source.value='pg']",
          message: "Only database-pool.ts may import the PostgreSQL driver.",
        },
        {
          selector: "ImportExpression[source.value='pg']",
          message: "Only database-pool.ts may import the PostgreSQL driver.",
        },
        {
          selector: "ExportNamedDeclaration[source.value='pg']",
          message: "Only database-pool.ts may import the PostgreSQL driver.",
        },
        {
          selector: "ExportAllDeclaration[source.value='pg']",
          message: "Only database-pool.ts may import the PostgreSQL driver.",
        },
        {
          selector: "CallExpression[callee.name='require'][arguments.0.value='pg']",
          message: "Only database-pool.ts may import the PostgreSQL driver.",
        },
        {
          selector: "ImportExpression[source.value=/^(fastify|node:http|node:https)$/]",
          message: "Only community-sync-http-server.ts may own the HTTP server boundary.",
        },
        {
          selector:
            "CallExpression[callee.name='require'][arguments.0.value=/^(fastify|node:http|node:https)$/]",
          message: "Only community-sync-http-server.ts may own the HTTP server boundary.",
        },
      ],
    },
  },
  {
    files: ["src/origin-proof-config.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportDeclaration[source.value='pg']",
          message: "Only database-pool.ts may import the PostgreSQL driver.",
        },
        {
          selector: "ImportExpression[source.value='pg']",
          message: "Only database-pool.ts may import the PostgreSQL driver.",
        },
        {
          selector: "ExportNamedDeclaration[source.value='pg']",
          message: "Only database-pool.ts may import the PostgreSQL driver.",
        },
        {
          selector: "ExportAllDeclaration[source.value='pg']",
          message: "Only database-pool.ts may import the PostgreSQL driver.",
        },
        {
          selector: "CallExpression[callee.name='require'][arguments.0.value='pg']",
          message: "Only database-pool.ts may import the PostgreSQL driver.",
        },
        {
          selector: "ImportExpression[source.value=/^(fastify|node:http|node:https)$/]",
          message: "Only community-sync-http-server.ts may own the HTTP server boundary.",
        },
        {
          selector:
            "CallExpression[callee.name='require'][arguments.0.value=/^(fastify|node:http|node:https)$/]",
          message: "Only community-sync-http-server.ts may own the HTTP server boundary.",
        },
      ],
    },
  },
  globalIgnores(["coverage/**", "dist/**"]),
]);

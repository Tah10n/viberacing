import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

const forbiddenRuntimeImports = [
  "child_process",
  "cluster",
  "dgram",
  "dns",
  "dns/promises",
  "fs",
  "fs/promises",
  "http",
  "http2",
  "https",
  "module",
  "net",
  "node:child_process",
  "node:cluster",
  "node:dgram",
  "node:dns",
  "node:dns/promises",
  "node:fs",
  "node:fs/promises",
  "node:http",
  "node:http2",
  "node:https",
  "node:module",
  "node:net",
  "node:sqlite",
  "node:tls",
  "node:vm",
  "node:worker_threads",
  "pg",
  "sqlite",
  "tls",
  "vm",
  "worker_threads",
];

const runtimeBoundaryMessage =
  "The scheduler may reach PostgreSQL only through @viberacing/jobs and may not own filesystem, network, subprocess, worker, or durable-state authority.";
const forbiddenRuntimeSyntax = forbiddenRuntimeImports.flatMap((name) => [
  {
    selector: `ImportExpression[source.value='${name}']`,
    message: runtimeBoundaryMessage,
  },
  {
    selector: `CallExpression[callee.name='require'][arguments.0.value='${name}']`,
    message: runtimeBoundaryMessage,
  },
]);
forbiddenRuntimeSyntax.push(
  {
    selector: "MemberExpression[property.name='getBuiltinModule']",
    message: runtimeBoundaryMessage,
  },
  {
    selector: "MemberExpression[computed=true][property.value='getBuiltinModule']",
    message: runtimeBoundaryMessage,
  },
);

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
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/**/*.ts"],
    ignores: ["src/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: forbiddenRuntimeImports.map((name) => ({
            name,
            message: runtimeBoundaryMessage,
          })),
        },
      ],
    },
  },
  {
    files: ["src/**/*.ts"],
    ignores: ["src/**/*.test.ts", "src/config.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...forbiddenRuntimeSyntax,
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: "Only config.ts may read process environment configuration.",
        },
        {
          selector: "MemberExpression[object.name='process'][computed=true][property.value='env']",
          message: "Only config.ts may read process environment configuration.",
        },
      ],
    },
  },
  {
    files: ["src/config.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...forbiddenRuntimeSyntax],
    },
  },
  globalIgnores(["coverage/**", "dist/**"]),
]);

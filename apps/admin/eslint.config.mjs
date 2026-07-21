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
    ignores: ["src/**/*.test.ts", "src/access-verifier.ts", "src/database-pool.ts"],
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
          selector: "ImportDeclaration[source.value='jose']",
          message: "Only access-verifier.ts may import the JOSE verifier.",
        },
        {
          selector: "ImportExpression[source.value='jose']",
          message: "Only access-verifier.ts may import the JOSE verifier.",
        },
        {
          selector: "ExportNamedDeclaration[source.value='jose']",
          message: "Only access-verifier.ts may import the JOSE verifier.",
        },
        {
          selector: "ExportAllDeclaration[source.value='jose']",
          message: "Only access-verifier.ts may import the JOSE verifier.",
        },
        {
          selector: "CallExpression[callee.name='require'][arguments.0.value='jose']",
          message: "Only access-verifier.ts may import the JOSE verifier.",
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
          selector: "ImportDeclaration[source.value='jose']",
          message: "Only access-verifier.ts may import the JOSE verifier.",
        },
        {
          selector: "ImportExpression[source.value='jose']",
          message: "Only access-verifier.ts may import the JOSE verifier.",
        },
        {
          selector: "ExportNamedDeclaration[source.value='jose']",
          message: "Only access-verifier.ts may import the JOSE verifier.",
        },
        {
          selector: "ExportAllDeclaration[source.value='jose']",
          message: "Only access-verifier.ts may import the JOSE verifier.",
        },
        {
          selector: "CallExpression[callee.name='require'][arguments.0.value='jose']",
          message: "Only access-verifier.ts may import the JOSE verifier.",
        },
      ],
    },
  },
  {
    files: ["src/access-verifier.ts"],
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
      ],
    },
  },
  globalIgnores(["coverage/**", "dist/**"]),
]);

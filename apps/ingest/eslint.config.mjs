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
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportDeclaration[source.value=/^(fastify|pg|node:http|node:https)$/]",
          message: "The verification-kernel slice must not own an HTTP server or database driver.",
        },
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: "The verification-kernel slice must not read environment configuration.",
        },
      ],
    },
  },
  globalIgnores(["coverage/**", "dist/**"]),
]);

import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default defineConfig([
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    extends: [js.configs.recommended],
  },
  {
    files: ["**/*.{ts,tsx}"],
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
    },
  },
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    plugins: {
      "@next/next": nextPlugin,
      "react-hooks": reactHooks,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      "no-console": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: "Raw HTML injection is forbidden in the public web boundary.",
        },
        {
          selector: "ImportDeclaration[source.value='sharp']",
          message:
            "Sharp is intentionally unavailable while Next.js image optimization is disabled.",
        },
        {
          selector: "ImportExpression[source.value='sharp']",
          message:
            "Sharp is intentionally unavailable while Next.js image optimization is disabled.",
        },
        {
          selector: "ExportNamedDeclaration[source.value='sharp']",
          message:
            "Sharp is intentionally unavailable while Next.js image optimization is disabled.",
        },
        {
          selector: "ExportAllDeclaration[source.value='sharp']",
          message:
            "Sharp is intentionally unavailable while Next.js image optimization is disabled.",
        },
        {
          selector: "CallExpression[callee.name='require'][arguments.0.value='sharp']",
          message:
            "Sharp is intentionally unavailable while Next.js image optimization is disabled.",
        },
      ],
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/rules-of-hooks": "error",
    },
    settings: { next: { rootDir: "." } },
  },
  {
    files: ["components/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/race-data"],
              message:
                "Client components must receive a projected public DTO and cannot import raw synthetic activity.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.test.{ts,tsx}", "tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  globalIgnores([".next/**", "coverage/**", "next-env.d.ts"]),
]);

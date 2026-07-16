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
        {
          selector: "ImportExpression[source.value='@noble/ed25519']",
          message: "Web Ed25519 verification must not use dynamic imports.",
        },
        {
          selector: "CallExpression[callee.name='require'][arguments.0.value='@noble/ed25519']",
          message: "Web Ed25519 verification must not use CommonJS access.",
        },
      ],
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/rules-of-hooks": "error",
    },
    settings: { next: { rootDir: "." } },
  },
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}", "lib/pairing-possession-verifier.ts", "tests/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@noble/ed25519",
              message: "Only pairing-possession-verifier.ts may own Web Ed25519 verification.",
            },
          ],
        },
      ],
    },
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
          paths: [
            {
              name: "@noble/ed25519",
              message: "Client components must not import server-side cryptography.",
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

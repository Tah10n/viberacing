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
        {
          selector: "ImportExpression[source.value='pg']",
          message: "Web PostgreSQL access must not use dynamic imports.",
        },
        {
          selector: "CallExpression[callee.name='require'][arguments.0.value='pg']",
          message: "Web PostgreSQL access must not use CommonJS access.",
        },
        {
          selector: "ImportExpression[source.value='@simplewebauthn/server']",
          message: "Server WebAuthn verification must not use dynamic imports.",
        },
        {
          selector:
            "CallExpression[callee.name='require'][arguments.0.value='@simplewebauthn/server']",
          message: "Server WebAuthn verification must not use CommonJS access.",
        },
        {
          selector: "ImportExpression[source.value='@simplewebauthn/browser']",
          message: "Browser WebAuthn ceremonies must not use dynamic imports.",
        },
        {
          selector:
            "CallExpression[callee.name='require'][arguments.0.value='@simplewebauthn/browser']",
          message: "Browser WebAuthn ceremonies must not use CommonJS access.",
        },
      ],
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/rules-of-hooks": "error",
    },
    settings: { next: { rootDir: "." } },
  },
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],
    ignores: [
      "**/*.test.{ts,tsx}",
      "components/passkey-setup.tsx",
      "lib/passkey-registration.ts",
      "lib/pairing-database-pool.ts",
      "lib/pairing-possession-verifier.ts",
      "lib/public-score-database-pool.ts",
      "tests/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@noble/ed25519",
              message: "Only pairing-possession-verifier.ts may own Web Ed25519 verification.",
            },
            {
              name: "pg",
              message: "Only reviewed Web database pool wrappers may access node-postgres.",
            },
            {
              name: "@simplewebauthn/browser",
              message: "Only passkey-setup.tsx may start a browser WebAuthn ceremony.",
            },
            {
              name: "@simplewebauthn/server",
              message: "Only passkey-registration.ts may verify WebAuthn registration proofs.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["lib/passkey-registration.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@noble/ed25519",
              message: "Only pairing-possession-verifier.ts may own Web Ed25519 verification.",
            },
            {
              name: "pg",
              message: "Only reviewed Web database pool wrappers may access node-postgres.",
            },
            {
              name: "@simplewebauthn/browser",
              message: "Browser WebAuthn code belongs only in passkey-setup.tsx.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["lib/pairing-possession-verifier.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "pg",
              message: "Only reviewed Web database pool wrappers may access node-postgres.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["lib/{pairing-database-pool,public-score-database-pool}.ts"],
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
            {
              name: "pg",
              message: "Client components must not import server-side PostgreSQL access.",
            },
            {
              name: "@simplewebauthn/browser",
              message: "Only passkey-setup.tsx may start a browser WebAuthn ceremony.",
            },
            {
              name: "@simplewebauthn/server",
              message: "Client components must not import server-side WebAuthn verification.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["components/passkey-setup.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@noble/ed25519",
              message: "Client components must not import server-side cryptography.",
            },
            {
              name: "pg",
              message: "Client components must not import server-side PostgreSQL access.",
            },
            {
              name: "@simplewebauthn/server",
              message: "Client components must not import server-side WebAuthn verification.",
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

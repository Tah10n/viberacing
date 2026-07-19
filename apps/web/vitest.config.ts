import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
    jsx: { runtime: "automatic" },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/server-only.ts", import.meta.url)),
    },
  },
  test: {
    clearMocks: true,
    coverage: {
      exclude: ["**/*.d.ts", "**/*.config.*", ".next/**", "tests/**"],
      include: ["components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}", "proxy.ts"],
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "coverage",
      thresholds: {
        branches: 80,
        functions: 85,
        lines: 85,
        statements: 85,
      },
    },
    environment: "jsdom",
    include: ["**/*.test.{ts,tsx}"],
    // Keep isolated route-module imports below their per-test timeout on high-core hosts.
    maxWorkers: 4,
    mockReset: true,
    restoreMocks: true,
    setupFiles: ["./tests/setup.ts"],
  },
});

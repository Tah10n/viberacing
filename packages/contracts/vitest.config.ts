import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    clearMocks: true,
    coverage: {
      exclude: ["**/*.d.ts", "**/*.test.ts"],
      include: ["src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "coverage",
      thresholds: {
        branches: 90,
        functions: 100,
        lines: 95,
        statements: 95,
      },
    },
    environment: "node",
    include: ["src/**/*.test.ts"],
    mockReset: true,
    restoreMocks: true,
  },
});

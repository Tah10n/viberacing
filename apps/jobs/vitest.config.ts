import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    clearMocks: true,
    coverage: {
      exclude: ["**/*.d.ts", "**/*.test.ts", "src/main.ts"],
      include: ["src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "coverage",
      thresholds: {
        branches: 95,
        functions: 100,
        lines: 98,
        statements: 98,
      },
    },
    environment: "node",
    include: ["src/**/*.test.ts"],
    mockReset: true,
    restoreMocks: true,
  },
});

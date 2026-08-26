import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3015",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], timezoneId: "America/New_York" },
    },
  ],
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: "http://127.0.0.1:3015/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      VIBERACING_PUBLIC_ORIGIN: "http://127.0.0.1:3015",
      VIBERACING_ALLOW_INSECURE_LOCAL: "true",
      VIBERACING_DATABASE_SSL: process.env.VIBERACING_DATABASE_SSL ?? "false",
      VIBERACING_CONNECTOR_DISTRIBUTION: "npm",
      VIBERACING_TRUST_PROXY: "none",
      VIBERACING_MIN_CONNECTOR_VERSION: "0.4.3",
      VIBERACING_MAX_DAILY_TOKENS: "9999999999999999",
      VIBERACING_LOG_LEVEL: "info",
      VIBERACING_TEST_GITHUB_ORIGIN: "http://127.0.0.1:3016",
      GITHUB_CLIENT_ID: "synthetic-e2e-client",
      GITHUB_CLIENT_SECRET: "synthetic-e2e-secret",
    },
  },
});

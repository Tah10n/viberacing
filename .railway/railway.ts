import { defineRailway, github, preserve, project, service } from "railway/iac";

// Own only the existing web service. PostgreSQL and its volume remain unmanaged.
export const partial = "viberacing";

export default defineRailway((ctx) => {
  if (
    ctx.projectId !== "9c93a77d-9033-4045-b34c-f8755cf1d6b6" ||
    ctx.environmentId !== "2edee876-7008-4fe5-922e-917085a6f21e"
  ) {
    throw new Error(
      "This configuration targets only Vibe Racing's existing production environment.",
    );
  }

  const web = service("viberacing", {
    source: github("Tah10n/viberacing", { branch: "main", checkSuites: true }),
    build: {
      buildEnvironment: "V3",
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
    },
    deploy: {
      preDeployCommand: ["node scripts/migrate.mjs"],
      healthcheckPath: "/ready",
      healthcheckTimeout: 300,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 3,
      drainingSeconds: 40,
      // Preserve the current platform placement, limits and runtime switches.
      multiRegionConfig: { "europe-west4-drams3a": { numReplicas: 1 } },
      limitOverride: { containers: { cpu: 4, memoryBytes: 3000000000 } },
      runtime: "V2",
      useLegacyStacker: false,
      ipv6EgressEnabled: false,
    },
    // Keep both values and reference expressions on Railway, including DATABASE_URL.
    // Refresh this inventory from `railway config pull --json` before the first apply.
    env: {
      DATABASE_URL: preserve(),
      GITHUB_CLIENT_ID: preserve(),
      GITHUB_CLIENT_SECRET: preserve(),
      VIBERACING_ALLOW_INSECURE_LOCAL: preserve(),
      VIBERACING_CONNECTOR_DISTRIBUTION: preserve(),
      VIBERACING_DATABASE_SSL: preserve(),
      VIBERACING_LOG_LEVEL: preserve(),
      VIBERACING_MAX_DAILY_TOKENS: preserve(),
      VIBERACING_MIN_CONNECTOR_VERSION: preserve(),
      VIBERACING_PUBLIC_ORIGIN: preserve(),
      VIBERACING_TRUST_PROXY: preserve(),
    },
  });

  // Generated Railway domains stay platform-managed and are omitted by its importer.
  return project("robust-celebration", { resources: [web] });
});

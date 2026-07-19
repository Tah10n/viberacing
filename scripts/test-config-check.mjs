import assert from "node:assert/strict";
import {
  validateCompose,
  validateDependencyOverrides,
  validatePnpmWorkspace,
  validateRootPackage,
  validateWorkspacePackage,
  validateWorkflow,
  validateEnvExampleText,
} from "./check-config.mjs";

const goodEnvExample = `DATABASE_HOST=127.0.0.1
DATABASE_PORT=54329
DATABASE_NAME=viberacing_local
DATABASE_USER=viberacing_local
DATABASE_PASSWORD=local-development-only
VIBERACING_JOBS_DATABASE_HOST=127.0.0.1
VIBERACING_JOBS_DATABASE_PORT=54329
VIBERACING_JOBS_DATABASE_NAME=viberacing_local
VIBERACING_JOBS_DATABASE_USER=replace_with_local_jobs_login
VIBERACING_JOBS_DATABASE_PASSWORD=replace-with-local-jobs-password
VIBERACING_JOBS_DATABASE_TLS_MODE=disable
VIBERACING_INGEST_LISTENER_HOST=127.0.0.1
VIBERACING_INGEST_LISTENER_PORT=8788
VIBERACING_INGEST_TLS_TERMINATION=loopback-cleartext
VIBERACING_INGEST_DATABASE_HOST=127.0.0.1
VIBERACING_INGEST_DATABASE_PORT=54329
VIBERACING_INGEST_DATABASE_NAME=viberacing_local
VIBERACING_INGEST_DATABASE_USER=replace_with_local_ingest_login
VIBERACING_INGEST_DATABASE_PASSWORD=replace-with-local-ingest-password
VIBERACING_INGEST_DATABASE_TLS_MODE=disable
VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_ID=edge_local
VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_BASE64URL=replace-with-random-32-byte-base64url-key
VIBERACING_WEB_DATABASE_HOST=127.0.0.1
VIBERACING_WEB_DATABASE_PORT=54329
VIBERACING_WEB_DATABASE_NAME=viberacing_local
VIBERACING_WEB_DATABASE_USER=replace_with_local_web_login
VIBERACING_WEB_DATABASE_PASSWORD=replace-with-local-web-password
VIBERACING_WEB_DATABASE_TLS_MODE=disable
VIBERACING_RECOVERY_ARGON2_MEMORY_KIB=replace-with-reviewed-memory-kib
VIBERACING_RECOVERY_ARGON2_PARALLELISM=replace-with-reviewed-parallelism
VIBERACING_RECOVERY_ARGON2_PASSES=replace-with-reviewed-pass-count
VIBERACING_RECOVERY_PEPPER=replace-with-distinct-32-byte-base64url-value
VIBERACING_WEB_PAIRING_POLL_PRIMARY_KEY_BASE64URL=replace-with-random-32-byte-base64url-key
VIBERACING_WEB_PAIRING_CODE_PRIMARY_KEY_BASE64URL=replace-with-distinct-random-32-byte-base64url-key`;

assert.deepEqual(validateEnvExampleText(goodEnvExample), []);
assert.match(
  validateEnvExampleText(
    goodEnvExample.replace(
      "VIBERACING_WEB_DATABASE_USER=replace_with_local_web_login",
      "VIBERACING_WEB_DATABASE_USER=viberacing_local",
    ),
  ).join("\n"),
  /must not reuse the bootstrap owner/,
);
assert.match(
  validateEnvExampleText(
    goodEnvExample.replace(
      "VIBERACING_JOBS_DATABASE_USER=replace_with_local_jobs_login",
      "VIBERACING_JOBS_DATABASE_USER=viberacing_local",
    ),
  ).join("\n"),
  /Jobs database example credentials must not reuse the bootstrap owner/,
);
assert.match(
  validateEnvExampleText(
    goodEnvExample.replace(
      "VIBERACING_JOBS_DATABASE_USER=replace_with_local_jobs_login",
      "VIBERACING_JOBS_DATABASE_USER=replace_with_local_web_login",
    ),
  ).join("\n"),
  /Jobs and Web database examples must use distinct login principals/,
);
assert.match(
  validateEnvExampleText(
    goodEnvExample.replace(
      "VIBERACING_INGEST_DATABASE_USER=replace_with_local_ingest_login",
      "VIBERACING_INGEST_DATABASE_USER=viberacing_local",
    ),
  ).join("\n"),
  /Ingest database example credentials must not reuse the bootstrap owner/,
);
assert.match(
  validateEnvExampleText(
    goodEnvExample.replace(
      "VIBERACING_INGEST_DATABASE_USER=replace_with_local_ingest_login",
      "VIBERACING_INGEST_DATABASE_USER=replace_with_local_jobs_login",
    ),
  ).join("\n"),
  /Ingest, Jobs, and Web database examples must use distinct login principals/,
);
assert.match(
  validateEnvExampleText(
    goodEnvExample.replace(
      "VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_BASE64URL=replace-with-random-32-byte-base64url-key",
      "VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_BASE64URL=private-value",
    ),
  ).join("\n"),
  /must retain the reviewed public-safe example value/,
);
assert.match(
  validateEnvExampleText(
    goodEnvExample.replace(
      "VIBERACING_WEB_DATABASE_PASSWORD=replace-with-local-web-password",
      "VIBERACING_WEB_DATABASE_PASSWORD=private-value",
    ),
  ).join("\n"),
  /must retain the reviewed public-safe example value/,
);
assert.match(
  validateEnvExampleText(
    goodEnvExample.replace(
      "VIBERACING_WEB_PAIRING_CODE_PRIMARY_KEY_BASE64URL=replace-with-distinct-random-32-byte-base64url-key",
      "VIBERACING_WEB_PAIRING_CODE_PRIMARY_KEY_BASE64URL=private-value",
    ),
  ).join("\n"),
  /must retain the reviewed public-safe example value/,
);
assert.match(
  validateEnvExampleText(
    goodEnvExample.replace(
      "VIBERACING_WEB_PAIRING_POLL_PRIMARY_KEY_BASE64URL=replace-with-random-32-byte-base64url-key",
      "VIBERACING_WEB_PAIRING_POLL_PRIMARY_KEY_BASE64URL=private-value",
    ),
  ).join("\n"),
  /must retain the reviewed public-safe example value/,
);
assert.match(
  validateEnvExampleText(`${goodEnvExample}\nDATABASE_HOST=127.0.0.1`).join("\n"),
  /duplicates DATABASE_HOST/,
);

const pinnedCheckout = `actions/checkout@${"a".repeat(40)}`;
const goodWorkflow = {
  on: { pull_request: {} },
  permissions: { contents: "read" },
  jobs: {
    verify: {
      "timeout-minutes": 10,
      "runs-on": "ubuntu-24.04",
      steps: [
        {
          uses: pinnedCheckout,
          with: { "fetch-depth": 0, "persist-credentials": false },
        },
        { run: "pnpm run verify" },
      ],
    },
  },
};

assert.deepEqual(validateWorkflow("good.yml", goodWorkflow), []);

const requiredNodeSteps = [
  { run: "node scripts/check-public-files.mjs --all" },
  { run: "rustup toolchain install 1.94.0 --profile minimal" },
  { run: "cargo fetch --locked" },
  { run: "pnpm run verify:node" },
  { run: "pnpm run test:ingest:postgres-integration" },
];
const windowsPortableSteps = [
  {
    uses: pinnedCheckout,
    with: { "fetch-depth": 0, "persist-credentials": false },
  },
  {
    uses: `actions/setup-node@${"b".repeat(40)}`,
    with: { "node-version-file": ".node-version", "package-manager-cache": false },
  },
  { run: "node scripts/check-public-files.mjs --all" },
  { run: "rustup toolchain install 1.94.0 --profile minimal" },
  {
    run: "cargo build --release --locked --target-dir target --package viberacing-connector --bin viberacing-connector",
  },
  { run: "node scripts/test-connector-windows-portable.mjs" },
];
const goodCiWorkflow = {
  ...goodWorkflow,
  jobs: {
    node: {
      ...goodWorkflow.jobs.verify,
      steps: requiredNodeSteps,
    },
    connector_windows_portable: {
      ...goodWorkflow.jobs.verify,
      "runs-on": "windows-2025",
      "timeout-minutes": 15,
      steps: windowsPortableSteps,
    },
  },
};
assert.deepEqual(validateWorkflow(".github/workflows/ci.yml", goodCiWorkflow), []);
assert.match(
  validateWorkflow(".github/workflows/ci.yml", {
    ...goodCiWorkflow,
    jobs: { node: goodCiWorkflow.jobs.node },
  }).join("\n"),
  /bounded Windows portable connector job/,
);
assert.match(
  validateWorkflow(".github/workflows/ci.yml", {
    ...goodCiWorkflow,
    jobs: {
      ...goodCiWorkflow.jobs,
      connector_windows_portable: {
        ...goodCiWorkflow.jobs.connector_windows_portable,
        "runs-on": "ubuntu-24.04",
      },
    },
  }).join("\n"),
  /exact windows-2025 runner/,
);
assert.match(
  validateWorkflow(".github/workflows/ci.yml", {
    ...goodCiWorkflow,
    jobs: {
      ...goodCiWorkflow.jobs,
      connector_windows_portable: {
        ...goodCiWorkflow.jobs.connector_windows_portable,
        "timeout-minutes": 30,
      },
    },
  }).join("\n"),
  /exact 15-minute timeout/,
);
assert.match(
  validateWorkflow(".github/workflows/ci.yml", {
    ...goodCiWorkflow,
    jobs: {
      ...goodCiWorkflow.jobs,
      connector_windows_portable: {
        ...goodCiWorkflow.jobs.connector_windows_portable,
        steps: windowsPortableSteps.slice(0, -1),
      },
    },
  }).join("\n"),
  /bounded smoke in exact order/,
);
assert.match(
  validateWorkflow(".github/workflows/ci.yml", {
    ...goodCiWorkflow,
    jobs: {
      ...goodCiWorkflow.jobs,
      connector_windows_portable: {
        ...goodCiWorkflow.jobs.connector_windows_portable,
        steps: [
          windowsPortableSteps[2],
          ...windowsPortableSteps.slice(0, 2),
          ...windowsPortableSteps.slice(3),
        ],
      },
    },
  }).join("\n"),
  /bounded smoke in exact order/,
);
assert.match(
  validateWorkflow(".github/workflows/ci.yml", {
    ...goodCiWorkflow,
    jobs: {
      ...goodCiWorkflow.jobs,
      connector_windows_portable: {
        ...goodCiWorkflow.jobs.connector_windows_portable,
        steps: [
          ...windowsPortableSteps.slice(0, 2),
          windowsPortableSteps[3],
          windowsPortableSteps[2],
          ...windowsPortableSteps.slice(4),
        ],
      },
    },
  }).join("\n"),
  /bounded smoke in exact order/,
);
assert.match(
  validateWorkflow(".github/workflows/ci.yml", {
    ...goodCiWorkflow,
    jobs: {
      ...goodCiWorkflow.jobs,
      connector_windows_portable: {
        ...goodCiWorkflow.jobs.connector_windows_portable,
        steps: [...windowsPortableSteps, { uses: `actions/upload-artifact@${"c".repeat(40)}` }],
      },
    },
  }).join("\n"),
  /only checkout, pinned Node setup/,
);
assert.match(
  validateWorkflow(".github/workflows/ci.yml", {
    ...goodCiWorkflow,
    jobs: {
      ...goodCiWorkflow.jobs,
      node: {
        ...goodCiWorkflow.jobs.node,
        steps: requiredNodeSteps.filter((step) => step.run !== "cargo fetch --locked"),
      },
    },
  }).join("\n"),
  /fetch Cargo with --locked/,
);
assert.match(
  validateWorkflow(".github/workflows/ci.yml", {
    ...goodCiWorkflow,
    jobs: {
      ...goodCiWorkflow.jobs,
      node: {
        ...goodCiWorkflow.jobs.node,
        steps: requiredNodeSteps.filter(
          (step) => step.run !== "pnpm run test:ingest:postgres-integration",
        ),
      },
    },
  }).join("\n"),
  /Ingest PostgreSQL integration/,
);
assert.match(
  validateWorkflow(".github/workflows/ci.yml", {
    ...goodCiWorkflow,
    jobs: {
      ...goodCiWorkflow.jobs,
      node: {
        ...goodCiWorkflow.jobs.node,
        steps: [
          requiredNodeSteps[2],
          ...requiredNodeSteps.slice(0, 2),
          ...requiredNodeSteps.slice(3),
        ],
      },
    },
  }).join("\n"),
  /scan public files before pinned Rust setup/,
);
assert.match(
  validateWorkflow("unpinned.yml", {
    ...goodWorkflow,
    jobs: { verify: { ...goodWorkflow.jobs.verify, steps: [{ uses: "actions/checkout@v6" }] } },
  }).join("\n"),
  /does not pin uses/,
);
assert.match(
  validateWorkflow("shallow.yml", {
    ...goodWorkflow,
    jobs: {
      verify: {
        ...goodWorkflow.jobs.verify,
        steps: [
          {
            uses: pinnedCheckout,
            with: { "fetch-depth": 1, "persist-credentials": false },
          },
        ],
      },
    },
  }).join("\n"),
  /fetch complete history/,
);
assert.match(
  validateWorkflow("write.yml", { ...goodWorkflow, permissions: { contents: "write" } }).join("\n"),
  /CI is read-only/,
);
assert.match(
  validateWorkflow("target.yml", {
    ...goodWorkflow,
    on: { pull_request_target: {} },
  }).join("\n"),
  /pull_request_target/,
);
assert.match(
  validateWorkflow("target-array.yml", {
    ...goodWorkflow,
    on: ["pull_request_target"],
  }).join("\n"),
  /pull_request_target/,
);
assert.match(
  validateWorkflow("shell.yml", {
    ...goodWorkflow,
    jobs: {
      verify: {
        ...goodWorkflow.jobs.verify,
        steps: [{ run: "echo ${{ github.event.pull_request.title }}" }],
      },
    },
  }).join("\n"),
  /directly in shell code/,
);
assert.match(
  validateWorkflow("secret.yml", {
    ...goodWorkflow,
    env: { RELEASE_VALUE: "${{ secrets.RELEASE_VALUE }}" },
  }).join("\n"),
  /references secrets/,
);
assert.match(
  validateWorkflow("runner.yml", {
    ...goodWorkflow,
    jobs: { verify: { ...goodWorkflow.jobs.verify, "runs-on": "self-hosted" } },
  }).join("\n"),
  /GitHub-hosted runner/,
);
assert.match(
  validateWorkflow("timeout.yml", {
    ...goodWorkflow,
    jobs: { verify: { ...goodWorkflow.jobs.verify, "timeout-minutes": 120 } },
  }).join("\n"),
  /between 1 and 60/,
);
assert.match(
  validateWorkflow("cache.yml", {
    ...goodWorkflow,
    jobs: {
      verify: {
        ...goodWorkflow.jobs.verify,
        steps: [{ uses: `actions/cache@${"c".repeat(40)}` }],
      },
    },
  }).join("\n"),
  /writable dependency cache/,
);
assert.match(
  validateWorkflow("container.yml", {
    ...goodWorkflow,
    jobs: { verify: { ...goodWorkflow.jobs.verify, container: "node:latest" } },
  }).join("\n"),
  /container must be pinned/,
);

assert.deepEqual(
  validateCompose({
    services: {
      postgres: {
        image: `postgres:example@sha256:${"b".repeat(64)}`,
        ports: ["127.0.0.1:54329:5432"],
        security_opt: ["no-new-privileges:true"],
        environment: { POSTGRES_PASSWORD: "local-development-only" },
      },
      "postgres-test": {
        image: `postgres:example@sha256:${"b".repeat(64)}`,
        profiles: ["test"],
        security_opt: ["no-new-privileges:true"],
        environment: { POSTGRES_PASSWORD: "local-development-only" },
        tmpfs: ["/var/lib/postgresql:rw,noexec,nosuid,nodev"],
      },
    },
  }),
  [],
);
assert.match(
  validateCompose({ services: { postgres: { image: "postgres:latest" } } }).join("\n"),
  /sha256/,
);
assert.match(
  validateCompose({
    services: {
      postgres: {
        image: `postgres:example@sha256:${"b".repeat(64)}`,
        ports: ["127.0.0.1:54329:5432"],
        security_opt: ["no-new-privileges:true"],
        environment: { POSTGRES_PASSWORD: "local-development-only" },
      },
      "postgres-test": {
        image: `postgres:example@sha256:${"b".repeat(64)}`,
        profiles: ["test"],
        ports: ["127.0.0.1:54330:5432"],
        security_opt: ["no-new-privileges:true"],
        environment: { POSTGRES_PASSWORD: "local-development-only" },
        tmpfs: ["/var/lib/postgresql:rw"],
      },
    },
  }).join("\n"),
  /must not publish/,
);

const goodWorkspace = {
  nodeVersion: "24.18.0",
  engineStrict: true,
  verifyDepsBeforeRun: "error",
  enableGlobalVirtualStore: false,
  autoInstallPeers: false,
  strictPeerDependencies: true,
  savePrefix: "",
  minimumReleaseAge: 1440,
  minimumReleaseAgeIgnoreMissingTime: false,
  minimumReleaseAgeStrict: true,
  trustPolicy: "no-downgrade",
  trustLockfile: false,
  blockExoticSubdeps: true,
  strictDepBuilds: true,
  allowBuilds: {},
  packages: ["apps/*", "packages/*"],
};
assert.deepEqual(validatePnpmWorkspace(goodWorkspace), []);
assert.match(
  validatePnpmWorkspace({ ...goodWorkspace, trustLockfile: true }).join("\n"),
  /trustLockfile/,
);
assert.match(
  validatePnpmWorkspace({ ...goodWorkspace, enableGlobalVirtualStore: true }).join("\n"),
  /enableGlobalVirtualStore/,
);
assert.match(
  validatePnpmWorkspace({ ...goodWorkspace, allowBuilds: { tool: true } }).join("\n"),
  /pin one exact version/,
);

assert.deepEqual(
  validateRootPackage({
    private: true,
    packageManager: "pnpm@11.7.0",
    devDependencies: { tool: "1.2.3" },
  }),
  [],
);
assert.match(
  validateRootPackage({
    private: true,
    packageManager: "pnpm@11.7.0",
    devDependencies: { tool: "^1.2.3" },
  }).join("\n"),
  /exact version/,
);

const goodWebPackage = {
  name: "@viberacing/web",
  version: "0.0.0",
  private: true,
  type: "module",
  engines: { node: ">=24.14.0 <25" },
  dependencies: { react: "19.2.7" },
  scripts: { test: "vitest run" },
};
assert.deepEqual(validateWorkspacePackage("apps/web/package.json", goodWebPackage), []);
assert.match(
  validateWorkspacePackage("apps/web/package.json", {
    ...goodWebPackage,
    name: "@personal/web",
  }).join("\n"),
  /workspace name/,
);
assert.match(
  validateWorkspacePackage("apps/web/package.json", {
    ...goodWebPackage,
    dependencies: { react: "^19.2.7" },
  }).join("\n"),
  /exact version/,
);
assert.match(
  validateWorkspacePackage("apps/web/package.json", {
    ...goodWebPackage,
    private: false,
  }).join("\n"),
  /must remain private/,
);

const overrideSelector = "eslint-config-next@16.2.10>eslint-import-resolver-typescript";
const goodOverrideWorkspace = { overrides: { [overrideSelector]: "3.10.0" } };
const goodOverridePolicy = {
  schemaVersion: 1,
  overrides: [
    {
      selector: overrideSelector,
      replacement: "3.10.0",
      reviewedOn: "2026-07-14",
      expiresOn: "2026-10-12",
      reason:
        "A compatible newer transitive release lost stronger trust evidence after an attested release had already been published.",
      removalCondition:
        "Remove when the parent package selects a compatible release that passes the trust policy without an override.",
    },
  ],
};
const reviewDate = new Date("2026-07-14T12:00:00.000Z");
assert.deepEqual(
  validateDependencyOverrides(goodOverrideWorkspace, goodOverridePolicy, reviewDate),
  [],
);
assert.match(
  validateDependencyOverrides(
    goodOverrideWorkspace,
    {
      ...goodOverridePolicy,
      overrides: [{ ...goodOverridePolicy.overrides[0], expiresOn: "2026-07-13" }],
    },
    reviewDate,
  ).join("\n"),
  /expired/,
);
assert.match(
  validateDependencyOverrides(
    goodOverrideWorkspace,
    {
      ...goodOverridePolicy,
      overrides: [
        {
          ...goodOverridePolicy.overrides[0],
          reviewedOn: "2026-07-15",
          expiresOn: "2026-10-13",
        },
      ],
    },
    reviewDate,
  ).join("\n"),
  /reviewedOn must not be in the future/,
);
assert.match(
  validateDependencyOverrides(
    { overrides: { [overrideSelector]: "3.10.1" } },
    goodOverridePolicy,
    reviewDate,
  ).join("\n"),
  /undocumented or stale/,
);
assert.match(
  validateDependencyOverrides(
    goodOverrideWorkspace,
    {
      ...goodOverridePolicy,
      overrides: [
        {
          ...goodOverridePolicy.overrides[0],
          selector: "eslint-config-next>eslint-import-resolver-typescript",
        },
      ],
    },
    reviewDate,
  ).join("\n"),
  /pin one exact parent/,
);
assert.deepEqual(
  validateDependencyOverrides(
    { overrides: { "next@16.2.10>sharp": "-" } },
    {
      schemaVersion: 1,
      overrides: [
        {
          selector: "next@16.2.10>sharp",
          replacement: "-",
          reviewedOn: "2026-07-14",
          expiresOn: "2026-10-12",
          reason:
            "The application does not use runtime image optimization, so this optional native dependency is unnecessary distribution surface.",
          removalCondition:
            "Remove before enabling image optimization, then review the native binary and all redistribution obligations.",
        },
      ],
    },
    reviewDate,
  ),
  [],
);

console.log("Configuration checker tests passed (41 cases).");

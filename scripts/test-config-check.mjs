import assert from "node:assert/strict";
import {
  validateCompose,
  validatePnpmWorkspace,
  validateRootPackage,
  validateWorkflow,
} from "./check-config.mjs";

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
          with: { "persist-credentials": false },
        },
        { run: "pnpm run verify" },
      ],
    },
  },
};

assert.deepEqual(validateWorkflow("good.yml", goodWorkflow), []);
assert.match(
  validateWorkflow("unpinned.yml", {
    ...goodWorkflow,
    jobs: { verify: { ...goodWorkflow.jobs.verify, steps: [{ uses: "actions/checkout@v6" }] } },
  }).join("\n"),
  /does not pin uses/,
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
    },
  }),
  [],
);
assert.match(
  validateCompose({ services: { postgres: { image: "postgres:latest" } } }).join("\n"),
  /sha256/,
);

const goodWorkspace = {
  nodeVersion: "24.18.0",
  engineStrict: true,
  verifyDepsBeforeRun: "error",
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

console.log("Configuration checker tests passed (18 cases).");

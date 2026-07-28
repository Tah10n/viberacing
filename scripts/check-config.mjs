import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import process from "node:process";
import { parseDocument } from "yaml";

const root = resolve(import.meta.dirname, "..");
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const exactPackageSelector = /^(?:@[^/\s]+\/[^@\s]+|[^@\s]+)@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const exactOverrideSelector =
  /^(?:@[^/\s]+\/[^@\s>]+|[^@\s>]+)@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?>(?:@[^/\s]+\/[^@\s>]+|[^@\s>]+)$/;
const hostedRunners = new Set(["ubuntu-24.04", "windows-2025", "macos-15"]);
const releaseDeploymentWorkflowPath = ".github/workflows/deploy-release.yml";
const checkoutAction = "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd";
const setupNodeAction = "actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e";
const cloudflareAction = "cloudflare/wrangler-action@ebbaa1584979971c8614a24965b4405ff95890e0";
const railwayCliImage =
  "ghcr.io/railwayapp/cli:5.26.0@sha256:30293385a4793e30b54b1616dd0fddf6a60d355ed70767ae06bdbc5e8253f883";
const releaseJobCondition =
  "(github.event_name == 'release' && github.event.release.prerelease == false) || " +
  "(github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main')";
const releaseTagCheck = [
  'if [[ ! "$RELEASE_TAG" =~ ^v[0-9]+\\.[0-9]+\\.[0-9]+$ ]]; then',
  '  echo "Release deployment requires a stable vMAJOR.MINOR.PATCH tag." >&2',
  "  exit 1",
  "fi",
  'tag_commit="$(git rev-parse --verify "refs/tags/${RELEASE_TAG}^{commit}")"',
  'if [[ "$(git rev-parse HEAD)" != "$tag_commit" ]]; then',
  '  echo "Checked-out source does not match the release tag." >&2',
  "  exit 1",
  "fi",
  'if ! git merge-base --is-ancestor "$tag_commit" refs/remotes/origin/main; then',
  '  echo "Release tag is not reachable from origin/main." >&2',
  "  exit 1",
  "fi",
].join("\n");
const releaseVerifyStepNames = [
  "Check out the exact release without persisted credentials",
  "Require a stable tag reachable from main",
  "Set up pinned Node.js",
  "Activate pinned pnpm",
  "Scan public files before dependency installation",
  "Install pinned Rust for Cargo license metadata",
  "Fetch the exact locked Cargo graph",
  "Install locked dependencies without lifecycle scripts",
  "Run the exhaustive release gate",
  "Verify the Edge-to-Ingest proof contract",
  "Exercise migrations against disposable PostgreSQL",
  "Exercise Web against disposable PostgreSQL",
  "Exercise Ingest against disposable PostgreSQL",
];
const releaseDeployStepNames = [
  "Check out the verified release without persisted credentials",
  "Recheck the stable tag before privileged work",
  "Set up pinned Node.js",
  "Activate pinned pnpm",
  "Validate non-secret deployment inputs",
  "Enable the one-shot migration service",
  "Run reviewed migrations",
  "Close the migration service latch",
  "Deploy Web",
  "Configure the Ingest usage gate",
  "Deploy Ingest",
  "Deploy Jobs scheduler",
  "Deploy the Usage Sync edge",
  "Smoke-check the public Web origin",
];
const railwayDockerPrefix =
  "docker run --rm --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m " +
  "--tmpfs /root:rw,noexec,nosuid,size=16m --cap-drop ALL " +
  "--security-opt no-new-privileges --pids-limit 128 --memory 512m " +
  '--env RAILWAY_TOKEN --volume "$GITHUB_WORKSPACE:/workspace:ro" --workdir /workspace ';
const releaseSmokeCheck = [
  'response_headers="$(mktemp)"',
  `trap 'rm -f "$response_headers"' EXIT`,
  `status="$(curl --silent --show-error --output /dev/null --dump-header "$response_headers" --write-out '%{http_code}' --max-time 30 --max-redirs 0 --proto '=https' --proto-redir '=https' --tlsv1.2 "$VIBERACING_PUBLIC_ORIGIN/")"`,
  'test "$status" = "200"',
  "grep -Eiq '^content-security-policy:' \"$response_headers\"",
  "grep -Eiq '^strict-transport-security:' \"$response_headers\"",
  "grep -Eiq '^x-content-type-options:[[:space:]]*nosniff' \"$response_headers\"",
].join("\n");
const windowsPortableRuns = [
  "node scripts/check-public-files.mjs --all",
  "rustup toolchain install 1.94.0 --profile minimal",
  "cargo build --release --locked --target-dir target --package viberacing-connector --bin viberacing-connector",
  "node scripts/test-connector-windows-portable.mjs",
];
const linuxSecretServiceBuildSetup = [
  "sudo apt-get update",
  "sudo apt-get install --yes --no-install-recommends libdbus-1-dev pkg-config",
].join("\n");
const requiredEnvExampleValues = new Map([
  ["DATABASE_HOST", "127.0.0.1"],
  ["DATABASE_NAME", "viberacing_local"],
  ["DATABASE_PASSWORD", "local-development-only"],
  ["DATABASE_PORT", "54329"],
  ["DATABASE_USER", "viberacing_local"],
  ["VIBERACING_JOBS_DATABASE_HOST", "127.0.0.1"],
  ["VIBERACING_JOBS_DATABASE_NAME", "viberacing_local"],
  ["VIBERACING_JOBS_DATABASE_PASSWORD", "replace-with-local-jobs-password"],
  ["VIBERACING_JOBS_DATABASE_PORT", "54329"],
  ["VIBERACING_JOBS_DATABASE_TLS_MODE", "disable"],
  ["VIBERACING_JOBS_DATABASE_USER", "replace_with_local_jobs_login"],
  ["VIBERACING_JOBS_SCHEDULER_ENABLED", "false"],
  ["VIBERACING_INGEST_DATABASE_HOST", "127.0.0.1"],
  ["VIBERACING_INGEST_DATABASE_NAME", "viberacing_local"],
  ["VIBERACING_INGEST_DATABASE_PASSWORD", "replace-with-local-ingest-password"],
  ["VIBERACING_INGEST_DATABASE_PORT", "54329"],
  ["VIBERACING_INGEST_DATABASE_TLS_MODE", "disable"],
  ["VIBERACING_INGEST_DATABASE_USER", "replace_with_local_ingest_login"],
  ["VIBERACING_INGEST_ENABLED", "false"],
  ["VIBERACING_USAGE_SYNC_ENABLED", "false"],
  ["VIBERACING_INGEST_LISTENER_HOST", "127.0.0.1"],
  ["VIBERACING_INGEST_LISTENER_PORT", "8788"],
  ["VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_BASE64URL", "replace-with-random-32-byte-base64url-key"],
  ["VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_ID", "edge_local"],
  ["VIBERACING_INGEST_TLS_TERMINATION", "loopback-cleartext"],
  ["VIBERACING_CAR_PROPOSALS_ENABLED", "false"],
  ["VIBERACING_ENROLLMENT_ENABLED", "false"],
  ["VIBERACING_PAIRING_ENABLED", "false"],
  ["VIBERACING_PUBLIC_RANKING_ENABLED", "false"],
  ["VIBERACING_TOKEN_RANKING_ENABLED", "false"],
  ["VIBERACING_SOURCE_CREATION_ENABLED", "false"],
  ["VIBERACING_WEB_DATABASE_HOST", "127.0.0.1"],
  ["VIBERACING_WEB_DATABASE_NAME", "viberacing_local"],
  ["VIBERACING_WEB_DATABASE_PASSWORD", "replace-with-local-web-password"],
  ["VIBERACING_WEB_DATABASE_PORT", "54329"],
  ["VIBERACING_WEB_DATABASE_TLS_MODE", "disable"],
  ["VIBERACING_WEB_DATABASE_USER", "replace_with_local_web_login"],
  ["VIBERACING_RECOVERY_ARGON2_MEMORY_KIB", "replace-with-reviewed-memory-kib"],
  ["VIBERACING_RECOVERY_ARGON2_PARALLELISM", "replace-with-reviewed-parallelism"],
  ["VIBERACING_RECOVERY_ARGON2_PASSES", "replace-with-reviewed-pass-count"],
  ["VIBERACING_RECOVERY_PEPPER", "replace-with-distinct-32-byte-base64url-value"],
  [
    "VIBERACING_WEB_PAIRING_POLL_PRIMARY_KEY_BASE64URL",
    "replace-with-random-32-byte-base64url-key",
  ],
  [
    "VIBERACING_WEB_PAIRING_CODE_PRIMARY_KEY_BASE64URL",
    "replace-with-distinct-random-32-byte-base64url-key",
  ],
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function permissionFindings(scope, permissions) {
  if (!isObject(permissions)) {
    return [`${scope} must declare an explicit permission map`];
  }

  const findings = [];
  for (const [permission, access] of Object.entries(permissions)) {
    if (access !== "read" && access !== "none") {
      findings.push(`${scope} grants ${permission}: ${String(access)}; CI is read-only`);
    }
  }
  return findings;
}

function hasTrigger(triggers, name) {
  return (
    triggers === name ||
    (Array.isArray(triggers) && triggers.includes(name)) ||
    (isObject(triggers) && Object.hasOwn(triggers, name))
  );
}

function pinnedContainerImage(image) {
  return typeof image === "string" && /^[^\s@]+@sha256:[a-f0-9]{64}$/.test(image);
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function exactValue(actual, expected) {
  return canonicalJson(actual) === canonicalJson(expected);
}

function railwayCommand(command) {
  return `${railwayDockerPrefix}${railwayCliImage} /usr/bin/railway ${command}`;
}

export function validateReleaseDeploymentWorkflow(workflow) {
  const findings = [];
  if (
    workflow.name !== "Deploy stable release" ||
    !exactValue(workflow.on, {
      release: { types: ["published"] },
      workflow_dispatch: {
        inputs: {
          release_tag: {
            description: "Stable vMAJOR.MINOR.PATCH tag to redeploy",
            required: true,
            type: "string",
          },
        },
      },
    })
  ) {
    findings.push("release deployment must use only stable published releases or one exact tag");
  }
  if (
    !exactValue(workflow.permissions, { contents: "read" }) ||
    !exactValue(workflow.concurrency, {
      group: "production-release",
      "cancel-in-progress": false,
    }) ||
    !exactValue(workflow.defaults, { run: { shell: "bash" } })
  ) {
    findings.push("release deployment must retain read-only permissions and serialized execution");
  }
  if (
    !isObject(workflow.jobs) ||
    !exactValue(Object.keys(workflow.jobs).sort(), ["deploy", "verify_release"])
  ) {
    findings.push("release deployment must contain only verify_release and deploy jobs");
    return findings;
  }

  const verify = workflow.jobs.verify_release;
  const deploy = workflow.jobs.deploy;
  const exactReleaseEnvironment = {
    RELEASE_TAG: "${{ github.event.release.tag_name || inputs.release_tag }}",
  };
  if (
    verify.if !== releaseJobCondition ||
    verify["runs-on"] !== "ubuntu-24.04" ||
    verify["timeout-minutes"] !== 60 ||
    verify.environment !== undefined ||
    verify.needs !== undefined ||
    !exactValue(verify.env, exactReleaseEnvironment)
  ) {
    findings.push("release verification must remain secretless, bounded, and stable-tag-only");
  }
  if (
    deploy.if !== releaseJobCondition ||
    deploy.needs !== "verify_release" ||
    deploy["runs-on"] !== "ubuntu-24.04" ||
    deploy["timeout-minutes"] !== 60 ||
    !exactValue(deploy.environment, {
      name: "production",
      url: "${{ vars.VIBERACING_PUBLIC_ORIGIN }}",
    }) ||
    !exactValue(deploy.env, exactReleaseEnvironment)
  ) {
    findings.push(
      "release deployment must wait for verification and use only the protected production environment",
    );
  }

  const verifySteps = Array.isArray(verify.steps) ? verify.steps : [];
  const deploySteps = Array.isArray(deploy.steps) ? deploy.steps : [];
  if (
    !exactValue(
      verifySteps.map((step) => step?.name),
      releaseVerifyStepNames,
    ) ||
    !exactValue(
      deploySteps.map((step) => step?.name),
      releaseDeployStepNames,
    )
  ) {
    findings.push("release verification and deployment steps must retain their exact closed order");
    return findings;
  }

  const checkoutWith = {
    "fetch-depth": 0,
    "persist-credentials": false,
    ref: "${{ env.RELEASE_TAG }}",
  };
  const setupNodeWith = {
    "node-version-file": ".node-version",
    "package-manager-cache": false,
  };
  if (
    verifySteps[0].uses !== checkoutAction ||
    !exactValue(verifySteps[0].with, checkoutWith) ||
    verifySteps[1].run !== releaseTagCheck ||
    verifySteps[2].uses !== setupNodeAction ||
    !exactValue(verifySteps[2].with, setupNodeWith) ||
    !exactValue(
      verifySteps.slice(3).map((step) => step.run),
      [
        "corepack enable\ncorepack install --global pnpm@11.7.0",
        "node scripts/check-public-files.mjs --all",
        "rustup toolchain install 1.94.0 --profile minimal",
        "cargo fetch --locked",
        "pnpm install --frozen-lockfile --ignore-scripts --registry=https://registry.npmjs.org/",
        "pnpm run verify:release",
        "pnpm run test:edge-ingest-compatibility",
        "pnpm run test:migrate:postgres-integration",
        "pnpm run test:web:postgres-integration",
        "pnpm run test:ingest:postgres-integration",
      ],
    )
  ) {
    findings.push("release verification must retain the exact pinned checkout and release gates");
  }

  if (
    deploySteps[0].uses !== checkoutAction ||
    !exactValue(deploySteps[0].with, checkoutWith) ||
    deploySteps[1].run !== releaseTagCheck ||
    deploySteps[2].uses !== setupNodeAction ||
    !exactValue(deploySteps[2].with, setupNodeWith) ||
    deploySteps[3].run !== "corepack enable\ncorepack install --global pnpm@11.7.0" ||
    deploySteps[4].run !== "node scripts/check-release-deployment-inputs.mjs" ||
    !exactValue(deploySteps[4].env, {
      CLOUDFLARE_ACCOUNT_ID: "${{ vars.CLOUDFLARE_ACCOUNT_ID }}",
      VIBERACING_PUBLIC_ORIGIN: "${{ vars.VIBERACING_PUBLIC_ORIGIN }}",
      VIBERACING_USAGE_SYNC_ENABLED: "${{ vars.VIBERACING_USAGE_SYNC_ENABLED }}",
    })
  ) {
    findings.push("privileged deployment must revalidate the tag and non-secret inputs first");
  }

  const railwayToken = { RAILWAY_TOKEN: "${{ secrets.RAILWAY_TOKEN }}" };
  const expectedRailwaySteps = [
    {
      index: 5,
      id: "enable_migrations",
      env: railwayToken,
      run: railwayCommand(
        "variable set VIBERACING_MIGRATIONS_ENABLED=true --service viberacing-migrate --skip-deploys",
      ),
    },
    {
      index: 6,
      id: "deploy_migrations",
      env: railwayToken,
      run: railwayCommand("up --yes --service viberacing-migrate"),
    },
    {
      index: 7,
      if: "${{ always() && steps.enable_migrations.outcome != 'skipped' }}",
      env: railwayToken,
      run: railwayCommand(
        "variable set VIBERACING_MIGRATIONS_ENABLED=false --service viberacing-migrate --skip-deploys",
      ),
    },
    {
      index: 8,
      env: railwayToken,
      run: railwayCommand("up --yes --service viberacing-web"),
    },
    {
      index: 9,
      env: {
        RAILWAY_TOKEN: "${{ secrets.RAILWAY_TOKEN }}",
        VIBERACING_USAGE_SYNC_ENABLED: "${{ vars.VIBERACING_USAGE_SYNC_ENABLED }}",
      },
      run: railwayCommand(
        'variable set "VIBERACING_USAGE_SYNC_ENABLED=$VIBERACING_USAGE_SYNC_ENABLED" --service viberacing-ingest --skip-deploys',
      ),
    },
    {
      index: 10,
      env: railwayToken,
      run: railwayCommand("up --yes --service viberacing-ingest"),
    },
    {
      index: 11,
      env: railwayToken,
      run: railwayCommand("up --yes --service viberacing-jobs-scheduler"),
    },
  ];
  if (
    expectedRailwaySteps.some(({ index, ...expected }) => {
      const actual = deploySteps[index];
      return (
        actual.run !== expected.run ||
        !exactValue(actual.env, expected.env) ||
        actual.id !== expected.id ||
        actual.if !== expected.if
      );
    })
  ) {
    findings.push(
      "Railway deployment must retain the pinned CLI, closed migration latch, and exact service order",
    );
  }

  if (
    deploySteps[12].uses !== cloudflareAction ||
    !exactValue(deploySteps[12].with, {
      apiToken: "${{ secrets.CLOUDFLARE_API_TOKEN }}",
      accountId: "${{ vars.CLOUDFLARE_ACCOUNT_ID }}",
      workingDirectory: "apps/edge",
      wranglerVersion: "4.112.0",
      packageManager: "pnpm",
      command: "deploy --config wrangler.jsonc",
      vars: "VIBERACING_USAGE_SYNC_ENABLED",
      quiet: true,
    }) ||
    !exactValue(deploySteps[12].env, {
      VIBERACING_USAGE_SYNC_ENABLED: "${{ vars.VIBERACING_USAGE_SYNC_ENABLED }}",
    }) ||
    deploySteps[13].run !== releaseSmokeCheck ||
    !exactValue(deploySteps[13].env, {
      VIBERACING_PUBLIC_ORIGIN: "${{ vars.VIBERACING_PUBLIC_ORIGIN }}",
    })
  ) {
    findings.push("Edge deployment and public smoke must retain their exact pinned closed surface");
  }

  const verifySecrets = [
    ...canonicalJson(verify).matchAll(/\$\{\{ secrets\.([A-Z0-9_]+) \}\}/g),
  ].map((match) => match[1]);
  const deploySecrets = new Set(
    [...canonicalJson(deploy).matchAll(/\$\{\{ secrets\.([A-Z0-9_]+) \}\}/g)].map(
      (match) => match[1],
    ),
  );
  if (
    verifySecrets.length !== 0 ||
    !exactValue([...deploySecrets].sort(), ["CLOUDFLARE_API_TOKEN", "RAILWAY_TOKEN"])
  ) {
    findings.push("only the protected deploy job may consume the two exact deployment secrets");
  }
  return findings;
}

export function validateWorkflow(path, workflow) {
  const findings = [];
  if (!isObject(workflow)) {
    return ["workflow root must be a mapping"];
  }

  const triggers = workflow.on;
  if (hasTrigger(triggers, "pull_request_target")) {
    findings.push("pull_request_target is forbidden for untrusted repository code");
  }

  findings.push(...permissionFindings("top-level permissions", workflow.permissions));

  if (!isObject(workflow.jobs) || Object.keys(workflow.jobs).length === 0) {
    findings.push("workflow must define at least one job");
    return findings;
  }

  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    if (!isObject(job)) {
      findings.push(`job ${jobName} must be a mapping`);
      continue;
    }
    if (
      !Number.isInteger(job["timeout-minutes"]) ||
      job["timeout-minutes"] <= 0 ||
      job["timeout-minutes"] > 60
    ) {
      findings.push(`job ${jobName} must set timeout-minutes between 1 and 60`);
    }
    if (!hostedRunners.has(job["runs-on"])) {
      findings.push(`job ${jobName} must use an allowlisted GitHub-hosted runner`);
    }
    const allowedReleaseEnvironment =
      path === releaseDeploymentWorkflowPath &&
      jobName === "deploy" &&
      exactValue(job.environment, {
        name: "production",
        url: "${{ vars.VIBERACING_PUBLIC_ORIGIN }}",
      });
    if (job.environment !== undefined && !allowedReleaseEnvironment) {
      findings.push(`job ${jobName} must not attach a privileged environment`);
    }
    const jobContainer = typeof job.container === "string" ? job.container : job.container?.image;
    if (job.container !== undefined && !pinnedContainerImage(jobContainer)) {
      findings.push(`job ${jobName} container must be pinned to a sha256 digest`);
    }
    for (const [serviceName, service] of Object.entries(job.services ?? {})) {
      const serviceImage = typeof service === "string" ? service : service?.image;
      if (!pinnedContainerImage(serviceImage)) {
        findings.push(`job ${jobName} service ${serviceName} must be pinned to a sha256 digest`);
      }
    }
    if (job.permissions !== undefined) {
      findings.push(...permissionFindings(`job ${jobName} permissions`, job.permissions));
    }
    if (!Array.isArray(job.steps)) {
      findings.push(`job ${jobName} must define steps`);
      continue;
    }

    for (const [stepIndex, step] of job.steps.entries()) {
      if (!isObject(step)) {
        findings.push(`job ${jobName} step ${stepIndex + 1} must be a mapping`);
        continue;
      }

      if (typeof step.uses === "string") {
        const action = step.uses;
        const localAction = action.startsWith("./");
        const pinnedRemoteAction =
          /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*@[a-f0-9]{40}$/.test(action);
        const pinnedContainer = /^docker:\/\/[^\s@]+@sha256:[a-f0-9]{64}$/.test(action);
        if (!localAction && !pinnedRemoteAction && !pinnedContainer) {
          findings.push(`job ${jobName} step ${stepIndex + 1} does not pin uses to a digest`);
        }
        if (
          action.startsWith("actions/checkout@") &&
          step.with?.["persist-credentials"] !== false
        ) {
          findings.push(`job ${jobName} checkout must set persist-credentials: false`);
        }
        if (action.startsWith("actions/checkout@") && step.with?.["fetch-depth"] !== 0) {
          findings.push(`job ${jobName} checkout must fetch complete history for leak scanning`);
        }
        if (action.startsWith("actions/cache@")) {
          findings.push(`job ${jobName} must not use a writable dependency cache`);
        }
        if (
          action.startsWith("actions/setup-node@") &&
          step.with?.["package-manager-cache"] !== false
        ) {
          findings.push(`job ${jobName} setup-node must disable package-manager-cache`);
        }
      }

      if (typeof step.run === "string" && /\$\{\{[^}]+\}\}/.test(step.run)) {
        findings.push(
          `job ${jobName} step ${stepIndex + 1} interpolates an expression directly in shell code`,
        );
      }
    }
  }

  if (path !== releaseDeploymentWorkflowPath && JSON.stringify(workflow).includes("${{ secrets.")) {
    findings.push(`${path} references secrets; pull-request CI must remain secretless`);
  }

  if (path === releaseDeploymentWorkflowPath) {
    findings.push(...validateReleaseDeploymentWorkflow(workflow));
  }

  if (path === ".github/workflows/ci.yml") {
    const nodeSteps = workflow.jobs?.node?.steps;
    if (!Array.isArray(nodeSteps)) {
      findings.push("primary CI must define the Node repository-gate job");
      return findings;
    }
    if (workflow.jobs.node["timeout-minutes"] !== 25) {
      findings.push("Node repository-gate CI must retain the exact 25-minute timeout");
    }

    const requiredRuns = [
      "node scripts/check-public-files.mjs --all",
      "rustup toolchain install 1.94.0 --profile minimal",
      "cargo fetch --locked",
      "pnpm run verify:node",
      "pnpm run verify:release:node --history-ref=HEAD",
      "pnpm run test:migrate:postgres-integration",
      "pnpm run test:web:postgres-integration",
      "pnpm run test:ingest:postgres-integration",
      "pnpm run test:ingest:signal-postgres-integration",
      "pnpm run test:jobs:postgres-integration",
      "pnpm run test:jobs-scheduler:postgres-integration",
      "pnpm run test:jobs-scheduler:timer-postgres-integration",
      "pnpm run test:jobs-scheduler:lifecycle-postgres-integration",
      "pnpm run test:jobs-scheduler:process-postgres-integration",
      "pnpm run test:jobs-scheduler:wall-clock-postgres-integration",
      "pnpm run test:jobs-scheduler:signal-postgres-integration",
    ];
    const positions = requiredRuns.map((command) =>
      nodeSteps.findIndex((step) => isObject(step) && step.run === command),
    );
    if (positions.some((position) => position === -1)) {
      findings.push(
        "Node CI must scan public files, install pinned minimal Rust, fetch Cargo with --locked, run the core PR gate and the HEAD-scoped release gate, and retain all eleven synthetic PostgreSQL integrations using exact commands",
      );
    } else if (
      !positions.every((position, index) => index === 0 || position > positions[index - 1])
    ) {
      findings.push(
        "Node CI must scan public files before pinned Rust setup, locked Cargo fetch, the core PR and release gates, and all eleven synthetic PostgreSQL integrations",
      );
    }
    const pullRequestStep = nodeSteps.find(
      (step) => isObject(step) && step.run === "pnpm run verify:node",
    );
    const releaseOnlyRuns = [...requiredRuns.slice(1, 3), ...requiredRuns.slice(4)];
    if (
      !isObject(pullRequestStep) ||
      pullRequestStep.if !== "github.event_name == 'pull_request'" ||
      releaseOnlyRuns.some((command) => {
        const step = nodeSteps.find(
          (candidate) => isObject(candidate) && candidate.run === command,
        );
        return !isObject(step) || step.if !== "github.event_name != 'pull_request'";
      })
    ) {
      findings.push(
        "Node CI must run only the core gate on pull requests and reserve Cargo license setup, the release gate, and synthetic PostgreSQL integrations for main or manual runs",
      );
    }

    const rustJob = workflow.jobs?.rust;
    if (!isObject(rustJob)) {
      findings.push("primary CI must define the Rust workspace-gate job");
    } else {
      const rustSteps = rustJob.steps;
      const rustCheckoutStep = Array.isArray(rustSteps) ? rustSteps[0] : undefined;
      const rustRunSteps = Array.isArray(rustSteps)
        ? rustSteps
            .slice(1)
            .map((step) =>
              isObject(step) && typeof step.run === "string" ? step.run.trimEnd() : null,
            )
        : [];
      const exactRustCheckout =
        isObject(rustCheckoutStep) &&
        typeof rustCheckoutStep.uses === "string" &&
        rustCheckoutStep.uses.startsWith("actions/checkout@") &&
        exactValue(rustCheckoutStep.with, {
          "fetch-depth": 0,
          "persist-credentials": false,
        });
      if (
        rustJob["runs-on"] !== "ubuntu-24.04" ||
        rustJob["timeout-minutes"] !== 15 ||
        !Array.isArray(rustSteps) ||
        rustSteps.length !== 4 ||
        !exactRustCheckout ||
        !exactValue(rustRunSteps, [
          linuxSecretServiceBuildSetup,
          "rustup toolchain install 1.94.0 --profile minimal --component clippy,rustfmt",
          "node scripts/check-rust.mjs",
        ])
      ) {
        findings.push(
          "Rust CI must use the exact Ubuntu runner, Linux Secret Service build setup, pinned toolchain, and workspace gate in fixed order",
        );
      }
    }

    const windowsPortableJob = workflow.jobs?.connector_windows_portable;
    if (!isObject(windowsPortableJob)) {
      findings.push("primary CI must define the bounded Windows portable connector job");
      return findings;
    }
    if (windowsPortableJob["runs-on"] !== "windows-2025") {
      findings.push("Windows portable connector CI must use the exact windows-2025 runner");
    }
    if (windowsPortableJob["timeout-minutes"] !== 15) {
      findings.push("Windows portable connector CI must retain the exact 15-minute timeout");
    }
    if (windowsPortableJob.if !== "github.event_name != 'pull_request'") {
      findings.push("Windows portable connector CI must remain a main/manual release-only job");
    }
    const windowsPortableSteps = windowsPortableJob.steps;
    if (!Array.isArray(windowsPortableSteps)) {
      findings.push("Windows portable connector CI must define its fixed steps");
      return findings;
    }
    const checkoutStep = windowsPortableSteps[0];
    const setupNodeStep = windowsPortableSteps[1];
    const exactActionSurface =
      isObject(checkoutStep) &&
      typeof checkoutStep.uses === "string" &&
      checkoutStep.uses.startsWith("actions/checkout@") &&
      isObject(setupNodeStep) &&
      typeof setupNodeStep.uses === "string" &&
      setupNodeStep.uses.startsWith("actions/setup-node@") &&
      setupNodeStep.with?.["node-version-file"] === ".node-version" &&
      setupNodeStep.with?.["package-manager-cache"] === false;
    const runSteps = windowsPortableSteps
      .slice(2)
      .map((step) => (isObject(step) && typeof step.run === "string" ? step.run : null));
    if (
      windowsPortableSteps.length !== 6 ||
      !exactActionSurface ||
      JSON.stringify(runSteps) !== JSON.stringify(windowsPortableRuns)
    ) {
      findings.push(
        "Windows portable connector CI must use only checkout, pinned Node setup, public scan, pinned Rust, locked release build, and bounded smoke in exact order",
      );
    }
  }
  return findings;
}

export function validateCompose(compose) {
  const findings = [];
  const postgres = compose?.services?.postgres;
  if (!isObject(postgres)) {
    return ["compose.yaml must define the local postgres service"];
  }

  if (!/^[^\s@]+@sha256:[a-f0-9]{64}$/.test(postgres.image ?? "")) {
    findings.push("PostgreSQL image must be pinned to a sha256 index digest");
  }
  if (
    !Array.isArray(postgres.ports) ||
    postgres.ports.length === 0 ||
    postgres.ports.some((port) => typeof port !== "string" || !port.startsWith("127.0.0.1:"))
  ) {
    findings.push("PostgreSQL ports must bind explicitly to 127.0.0.1");
  }
  if (postgres.privileged === true || postgres.network_mode === "host") {
    findings.push("PostgreSQL must not use privileged or host-network mode");
  }
  if (
    !Array.isArray(postgres.security_opt) ||
    !postgres.security_opt.includes("no-new-privileges:true")
  ) {
    findings.push("PostgreSQL must enable no-new-privileges");
  }
  if (postgres.environment?.POSTGRES_PASSWORD !== "local-development-only") {
    findings.push("compose.yaml must use only the documented synthetic local password");
  }

  const postgresTest = compose?.services?.["postgres-test"];
  if (!isObject(postgresTest)) {
    findings.push("compose.yaml must define the isolated postgres-test service");
    return findings;
  }
  if (postgresTest.image !== postgres.image) {
    findings.push("postgres-test must use the same pinned image as local PostgreSQL");
  }
  if (
    !Array.isArray(postgresTest.profiles) ||
    postgresTest.profiles.length !== 1 ||
    postgresTest.profiles[0] !== "test"
  ) {
    findings.push("postgres-test must be opt-in through only the test profile");
  }
  if (Array.isArray(postgresTest.ports) && postgresTest.ports.length > 0) {
    findings.push("postgres-test must not publish a host port");
  }
  if (Array.isArray(postgresTest.volumes) && postgresTest.volumes.length > 0) {
    findings.push("postgres-test must not use persistent volumes");
  }
  if (
    !Array.isArray(postgresTest.tmpfs) ||
    !postgresTest.tmpfs.some(
      (entry) => typeof entry === "string" && entry.startsWith("/var/lib/postgresql:"),
    )
  ) {
    findings.push("postgres-test must keep its database on an ephemeral tmpfs");
  }
  if (postgresTest.privileged === true || postgresTest.network_mode === "host") {
    findings.push("postgres-test must not use privileged or host-network mode");
  }
  if (
    !Array.isArray(postgresTest.security_opt) ||
    !postgresTest.security_opt.includes("no-new-privileges:true")
  ) {
    findings.push("postgres-test must enable no-new-privileges");
  }
  if (postgresTest.environment?.POSTGRES_PASSWORD !== "local-development-only") {
    findings.push("postgres-test must use only the documented synthetic local password");
  }

  const nodeProcessSignalTest = compose?.services?.["node-process-signal-test"];
  if (!isObject(nodeProcessSignalTest)) {
    findings.push("compose.yaml must define the isolated node-process-signal-test runtime");
    return findings;
  }
  if (
    Object.keys(nodeProcessSignalTest).sort().join(",") !==
    "cap_drop,command,image,mem_limit,network_mode,pids_limit,profiles,read_only,restart,security_opt,user"
  ) {
    findings.push("node-process-signal-test must retain its exact inert service shape");
  }
  if (
    !/^node:24\.18\.0-bookworm-slim@sha256:[a-f0-9]{64}$/.test(nodeProcessSignalTest.image ?? "")
  ) {
    findings.push("node-process-signal-test must pin the official Node image by sha256 digest");
  }
  if (
    !Array.isArray(nodeProcessSignalTest.profiles) ||
    nodeProcessSignalTest.profiles.length !== 1 ||
    nodeProcessSignalTest.profiles[0] !== "test"
  ) {
    findings.push("node-process-signal-test must be opt-in through only the test profile");
  }
  if (
    nodeProcessSignalTest.restart !== "no" ||
    nodeProcessSignalTest.network_mode !== "none" ||
    nodeProcessSignalTest.read_only !== true ||
    nodeProcessSignalTest.user !== "node" ||
    nodeProcessSignalTest.pids_limit !== 64 ||
    nodeProcessSignalTest.mem_limit !== "256m"
  ) {
    findings.push(
      "node-process-signal-test must retain its non-restarting, read-only, unprivileged resource boundary and disable networking",
    );
  }
  if (
    !Array.isArray(nodeProcessSignalTest.command) ||
    JSON.stringify(nodeProcessSignalTest.command) !== JSON.stringify(["node", "--version"])
  ) {
    findings.push("node-process-signal-test must expose only the inert Node version command");
  }
  if (
    nodeProcessSignalTest.privileged === true ||
    !Array.isArray(nodeProcessSignalTest.cap_drop) ||
    JSON.stringify(nodeProcessSignalTest.cap_drop) !== JSON.stringify(["ALL"]) ||
    !Array.isArray(nodeProcessSignalTest.security_opt) ||
    !nodeProcessSignalTest.security_opt.includes("no-new-privileges:true")
  ) {
    findings.push(
      "node-process-signal-test must drop all capabilities and enable no-new-privileges",
    );
  }
  if (
    (Array.isArray(nodeProcessSignalTest.ports) && nodeProcessSignalTest.ports.length > 0) ||
    (Array.isArray(nodeProcessSignalTest.volumes) && nodeProcessSignalTest.volumes.length > 0) ||
    isObject(nodeProcessSignalTest.environment)
  ) {
    findings.push(
      "node-process-signal-test must declare no ports, volumes, or environment authority",
    );
  }
  return findings;
}

export function validatePnpmWorkspace(workspace) {
  const findings = [];
  const requiredValues = [
    ["nodeVersion", "24.18.0"],
    ["engineStrict", true],
    ["verifyDepsBeforeRun", "error"],
    ["enableGlobalVirtualStore", false],
    ["autoInstallPeers", false],
    ["strictPeerDependencies", true],
    ["savePrefix", ""],
    ["minimumReleaseAgeIgnoreMissingTime", false],
    ["minimumReleaseAgeStrict", true],
    ["trustLockfile", false],
    ["blockExoticSubdeps", true],
    ["strictDepBuilds", true],
  ];
  for (const [key, expected] of requiredValues) {
    if (workspace?.[key] !== expected) {
      findings.push(`pnpm setting ${key} must equal ${JSON.stringify(expected)}`);
    }
  }
  if (!Number.isInteger(workspace?.minimumReleaseAge) || workspace.minimumReleaseAge < 1440) {
    findings.push("minimumReleaseAge must enforce at least a 24-hour quarantine");
  }
  if (workspace?.trustPolicy !== "no-downgrade") {
    findings.push("trustPolicy must be no-downgrade");
  }
  if (!isObject(workspace?.allowBuilds)) {
    findings.push("allowBuilds must be an explicit map");
  } else {
    for (const [selector, allowed] of Object.entries(workspace.allowBuilds)) {
      if (!exactPackageSelector.test(selector) || typeof allowed !== "boolean") {
        findings.push(`allowBuilds entry ${selector} must pin one exact version to true or false`);
      }
    }
  }
  if (workspace?.dangerouslyAllowAllBuilds === true) {
    findings.push("dangerouslyAllowAllBuilds must never be enabled");
  }
  for (const key of ["registry", "registries", "namedRegistries"]) {
    if (workspace?.[key] !== undefined) {
      findings.push(`${key} must not redirect package resolution in tracked configuration`);
    }
  }
  for (const key of ["minimumReleaseAgeExclude", "trustPolicyExclude"]) {
    for (const selector of workspace?.[key] ?? []) {
      if (!exactPackageSelector.test(selector)) {
        findings.push(`${key} entry ${selector} must name one exact package version`);
      }
    }
  }
  const expectedPackages = ["apps/*", "packages/*"];
  if (
    !Array.isArray(workspace?.packages) ||
    workspace.packages.length !== expectedPackages.length ||
    expectedPackages.some((pattern) => !workspace.packages.includes(pattern))
  ) {
    findings.push("workspace package globs must remain bounded to apps/* and packages/*");
  }
  return findings;
}

export function validateRootPackage(manifest) {
  const findings = [];
  if (manifest?.private !== true) {
    findings.push("root package must remain private");
  }
  if (manifest?.packageManager !== "pnpm@11.7.0") {
    findings.push("root packageManager must pin pnpm@11.7.0");
  }
  findings.push(...validateDependencyDeclarations(manifest));
  findings.push(...validatePackageScripts(manifest));
  return findings;
}

function validateDependencyDeclarations(manifest) {
  const findings = [];
  const declared = new Map();
  for (const group of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    const dependencies = manifest?.[group] ?? {};
    if (!isObject(dependencies)) {
      findings.push(`${group} must be a dependency map`);
      continue;
    }
    for (const [name, version] of Object.entries(dependencies)) {
      if (declared.has(name)) {
        findings.push(`${name} must not be declared in both ${declared.get(name)} and ${group}`);
      }
      declared.set(name, group);
      const workspaceReference = version === "workspace:*";
      if (typeof version !== "string" || (!exactVersion.test(version) && !workspaceReference)) {
        findings.push(`${group}.${name} must use an exact version, received ${String(version)}`);
      }
      if (workspaceReference && !name.startsWith("@viberacing/")) {
        findings.push(`${group}.${name} uses workspace:* but is outside the @viberacing scope`);
      }
      if (name.startsWith("@viberacing/") && !workspaceReference) {
        findings.push(`${group}.${name} must use workspace:* for an internal package`);
      }
    }
  }
  return findings;
}

function validatePackageScripts(manifest) {
  const findings = [];
  if (!isObject(manifest?.scripts ?? {})) {
    return ["scripts must be a command map"];
  }
  for (const [name, command] of Object.entries(manifest?.scripts ?? {})) {
    if (typeof command !== "string") {
      findings.push(`script ${name} must be a string`);
    } else if (/\b(?:curl|wget|Invoke-WebRequest)\b/i.test(command)) {
      findings.push(`script ${name} must not download and execute remote content`);
    }
  }
  return findings;
}

export function validateWorkspacePackage(path, manifest) {
  const findings = [];
  const match = /^(?:apps|packages)\/([A-Za-z0-9._-]+)\/package\.json$/.exec(path);
  if (!match) {
    return ["workspace manifest path is outside apps/* or packages/*"];
  }
  if (manifest?.private !== true) {
    findings.push("workspace package must remain private until a separate publication review");
  }
  if (manifest?.name !== `@viberacing/${match[1]}`) {
    findings.push(`workspace name must be @viberacing/${match[1]}`);
  }
  if (!exactVersion.test(manifest?.version ?? "")) {
    findings.push("workspace version must be an exact semantic version");
  }
  if (manifest?.type !== "module") {
    findings.push("workspace package must use type: module");
  }
  if (manifest?.engines?.node !== ">=24.14.0 <25") {
    findings.push("workspace Node engine must match >=24.14.0 <25");
  }
  if (manifest?.packageManager !== undefined) {
    findings.push("workspace packageManager must be inherited from the root");
  }
  findings.push(...validateDependencyDeclarations(manifest));
  findings.push(...validatePackageScripts(manifest));
  return findings;
}

function parseDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

export function validateDependencyOverrides(workspace, policy, now = new Date()) {
  const findings = [];
  if (policy?.schemaVersion !== 1 || !Array.isArray(policy?.overrides)) {
    return ["dependency override policy must use schemaVersion 1 with an overrides array"];
  }
  const declaredOverrides = workspace?.overrides ?? {};
  if (!isObject(declaredOverrides)) {
    return ["pnpm-workspace.yaml overrides must be a map"];
  }

  const documented = new Map();
  let previousSelector = "";
  for (const [index, entry] of policy.overrides.entries()) {
    const scope = `dependency override policy entry ${index + 1}`;
    if (
      !isObject(entry) ||
      Object.keys(entry).sort().join(",") !==
        "expiresOn,reason,removalCondition,replacement,reviewedOn,selector"
    ) {
      findings.push(`${scope} has an invalid shape`);
      continue;
    }
    if (!exactOverrideSelector.test(entry.selector)) {
      findings.push(`${scope} selector must pin one exact parent and one child package`);
    }
    if (entry.replacement !== "-" && !exactVersion.test(entry.replacement)) {
      findings.push(`${scope} replacement must be one exact version or an explicit removal`);
    }
    if (typeof entry.reason !== "string" || entry.reason.length < 100) {
      findings.push(`${scope} reason must contain at least 100 characters of review evidence`);
    }
    if (typeof entry.removalCondition !== "string" || entry.removalCondition.length < 80) {
      findings.push(`${scope} removalCondition must contain at least 80 characters`);
    }
    if (documented.has(entry.selector)) {
      findings.push(`${scope} duplicates selector ${entry.selector}`);
    }
    if (previousSelector && previousSelector.localeCompare(entry.selector) >= 0) {
      findings.push("dependency override policy entries must be uniquely sorted by selector");
    }
    previousSelector = entry.selector;
    documented.set(entry.selector, entry.replacement);

    const reviewedOn = parseDateOnly(entry.reviewedOn);
    const expiresOn = parseDateOnly(entry.expiresOn);
    if (reviewedOn === null || expiresOn === null) {
      findings.push(`${scope} review dates must be real YYYY-MM-DD dates`);
    } else {
      const lifetimeDays = (expiresOn.valueOf() - reviewedOn.valueOf()) / 86_400_000;
      if (lifetimeDays <= 0 || lifetimeDays > 120) {
        findings.push(`${scope} review window must be between 1 and 120 days`);
      }
      const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      if (reviewedOn.valueOf() > today) {
        findings.push(`${scope} reviewedOn must not be in the future`);
      }
      if (expiresOn.valueOf() < today) {
        findings.push(`${scope} expired on ${entry.expiresOn}`);
      }
    }
  }

  for (const [selector, replacement] of Object.entries(declaredOverrides)) {
    if (documented.get(selector) !== replacement) {
      findings.push(`pnpm-workspace.yaml override is undocumented or stale: ${selector}`);
    }
  }
  for (const [selector, replacement] of documented) {
    if (declaredOverrides[selector] !== replacement) {
      findings.push(`documented override is missing or stale in pnpm-workspace.yaml: ${selector}`);
    }
  }
  return findings;
}

function workspaceManifestPaths(failures) {
  const paths = [];
  for (const parent of ["apps", "packages"]) {
    const parentPath = resolve(root, parent);
    if (!existsSync(parentPath)) {
      continue;
    }
    for (const entry of readdirSync(parentPath, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        failures.push(`${parent}/${entry.name} — symbolic workspace directories are not allowed`);
        continue;
      }
      if (!entry.isDirectory()) {
        continue;
      }
      const path = `${parent}/${entry.name}/package.json`;
      if (!existsSync(resolve(root, path))) {
        failures.push(`${parent}/${entry.name} — workspace directory must contain package.json`);
      } else {
        paths.push(path);
      }
    }
  }
  return paths.sort((left, right) => left.localeCompare(right));
}

function yamlPaths() {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "*.yml", "*.yaml"],
    { cwd: root, encoding: "buffer", maxBuffer: 8 * 1024 * 1024 },
  )
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function parseYaml(path, failures) {
  const safePath = JSON.stringify(path).slice(1, -1);
  const absolutePath = resolve(root, path);
  if (!existsSync(absolutePath)) {
    return null;
  }
  if (lstatSync(absolutePath).isSymbolicLink()) {
    failures.push(`${safePath} — symbolic configuration files are not allowed`);
    return null;
  }
  const text = readFileSync(absolutePath, "utf8");
  const document = parseDocument(text, { strict: true, uniqueKeys: true, version: "1.2" });
  for (const error of document.errors) {
    failures.push(`${safePath} — ${error.message.split("\n", 1)[0]}`);
  }
  return document.errors.length === 0 ? document.toJS() : null;
}

export function validateEnvExampleText(text) {
  const findings = [];
  const seen = new Set();
  const values = new Map();
  for (const [index, line] of text.split("\n").entries()) {
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const match = /^([A-Z][A-Z0-9_]*)=(.+)$/.exec(line);
    if (!match) {
      findings.push(`line ${index + 1} must use UPPER_SNAKE_CASE=value`);
      continue;
    }
    if (seen.has(match[1])) {
      findings.push(`line ${index + 1} duplicates ${match[1]}`);
    }
    seen.add(match[1]);
    values.set(match[1], match[2]);
  }
  for (const [key, expected] of requiredEnvExampleValues) {
    if (values.get(key) !== expected) {
      findings.push(`${key} must retain the reviewed public-safe example value ${expected}`);
    }
  }
  if (values.get("VIBERACING_WEB_DATABASE_USER") === values.get("DATABASE_USER")) {
    findings.push("Web database example credentials must not reuse the bootstrap owner");
  }
  if (values.get("VIBERACING_JOBS_DATABASE_USER") === values.get("DATABASE_USER")) {
    findings.push("Jobs database example credentials must not reuse the bootstrap owner");
  }
  if (values.get("VIBERACING_INGEST_DATABASE_USER") === values.get("DATABASE_USER")) {
    findings.push("Ingest database example credentials must not reuse the bootstrap owner");
  }
  if (values.get("VIBERACING_JOBS_DATABASE_USER") === values.get("VIBERACING_WEB_DATABASE_USER")) {
    findings.push("Jobs and Web database examples must use distinct login principals");
  }
  if (
    values.get("VIBERACING_INGEST_DATABASE_USER") === values.get("VIBERACING_WEB_DATABASE_USER") ||
    values.get("VIBERACING_INGEST_DATABASE_USER") === values.get("VIBERACING_JOBS_DATABASE_USER")
  ) {
    findings.push("Ingest, Jobs, and Web database examples must use distinct login principals");
  }
  return findings;
}

function validateEnvExample(failures) {
  const path = resolve(root, ".env.example");
  if (lstatSync(path).isSymbolicLink()) {
    failures.push(".env.example — symbolic configuration files are not allowed");
    return;
  }
  const text = readFileSync(path, "utf8");
  for (const finding of validateEnvExampleText(text)) {
    failures.push(`.env.example — ${finding}`);
  }
}

function main() {
  const failures = [];
  for (const path of yamlPaths()) {
    const safePath = JSON.stringify(path).slice(1, -1);
    const value = parseYaml(path, failures);
    if (value === null) {
      continue;
    }
    if (path.startsWith(".github/workflows/")) {
      for (const finding of validateWorkflow(path, value)) {
        failures.push(`${safePath} — ${finding}`);
      }
    } else if (path === "compose.yaml") {
      for (const finding of validateCompose(value)) {
        failures.push(`${safePath} — ${finding}`);
      }
    } else if (path === "pnpm-workspace.yaml") {
      for (const finding of validatePnpmWorkspace(value)) {
        failures.push(`${safePath} — ${finding}`);
      }
    }
  }

  for (const manifestName of ["package.json", ...workspaceManifestPaths(failures)]) {
    const manifestPath = resolve(root, manifestName);
    if (lstatSync(manifestPath).isSymbolicLink()) {
      failures.push(`${manifestName} — symbolic configuration files are not allowed`);
      continue;
    }
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      const manifestFindings =
        manifestName === "package.json"
          ? validateRootPackage(manifest)
          : validateWorkspacePackage(manifestName, manifest);
      for (const finding of manifestFindings) {
        failures.push(`${manifestName} — ${finding}`);
      }
    } catch (error) {
      failures.push(`${manifestName} — invalid JSON: ${error.message}`);
    }
  }
  try {
    const workspace = parseYaml("pnpm-workspace.yaml", failures);
    const overridePolicy = JSON.parse(
      readFileSync(resolve(root, "config/dependency-overrides.json"), "utf8"),
    );
    for (const finding of validateDependencyOverrides(workspace, overridePolicy)) {
      failures.push(`config/dependency-overrides.json — ${finding}`);
    }
  } catch (error) {
    failures.push(`config/dependency-overrides.json — invalid JSON: ${error.message}`);
  }
  validateEnvExample(failures);

  if (failures.length > 0) {
    console.error(`Configuration check failed with ${failures.length} finding(s):`);
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log(`Configuration check passed (${yamlPaths().length} YAML file(s)).`);
}

if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

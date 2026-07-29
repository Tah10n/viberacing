import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const sourceRoot = resolve(import.meta.dirname, "..");
const temporaryRoot = mkdtempSync(join(tmpdir(), "viberacing-containment-runbook-check-"));
const runbookRelativePath = join("docs", "operations", "CAPABILITY_CONTAINMENT_RUNBOOK.md");
const fixtureRelativePaths = Object.freeze([
  ".env.example",
  join("scripts", "check-config.mjs"),
  join("apps", "web", "lib", "public-snapshot-config.ts"),
  join("apps", "web", "lib", "pairing-config.ts"),
  join("apps", "web", "lib", "car-proposals-config.ts"),
  join("apps", "web", "lib", "enrollment-enable-config.ts"),
  join("apps", "web", "lib", "invite-gate-config.ts"),
  join("apps", "web", "app", "v1", "leaderboards", "current", "route.ts"),
  join("apps", "web", "app", "v1", "leaderboards", "[seasonStart]", "route.ts"),
  join("apps", "web", "app", "v1", "profiles", "[handle]", "route.ts"),
  join("apps", "web", "lib", "public-home-snapshot.ts"),
  join("apps", "web", "app", "v1", "connector", "pairing", "start", "route.ts"),
  join("apps", "web", "app", "v1", "connector", "pairing", "poll", "route.ts"),
  join("apps", "web", "lib", "batch-pairing-browser-route.ts"),
  join("apps", "web", "app", "account", "page.tsx"),
  join("apps", "web", "app", "auth", "cars", "proposals", "route.ts"),
  join("apps", "web", "app", "auth", "cars", "proposals", "approve", "route.ts"),
  join("apps", "web", "app", "v1", "connector", "cars", "proposals", "route.ts"),
  join("apps", "web", "app", "join", "page.tsx"),
  join("apps", "web", "app", "join", "passkey", "page.tsx"),
  join("apps", "web", "app", "auth", "github", "start", "route.ts"),
  join("apps", "web", "app", "auth", "github", "callback", "route.ts"),
  join("apps", "web", "app", "auth", "passkey", "options", "route.ts"),
  join("apps", "web", "app", "auth", "passkey", "verify", "route.ts"),
  join("apps", "ingest-host", "src", "listener-config.ts"),
  join("apps", "ingest-host", "src", "host.ts"),
  join("apps", "edge", "src", "worker.mjs"),
  join("apps", "jobs-scheduler", "src", "config.ts"),
  join("apps", "migrate", "src", "enablement.ts"),
]);
const fixtureSources = new Map(
  fixtureRelativePaths.map((path) => [path, readFileSync(join(sourceRoot, path), "utf8")]),
);
const runbookSource = readFileSync(join(sourceRoot, runbookRelativePath), "utf8");
const runbookPath = join(temporaryRoot, runbookRelativePath);
const rootPackagePath = join(temporaryRoot, "package.json");

const validRootPackage = Object.freeze({
  scripts: {
    "check:config": "node scripts/check-config.mjs",
    "check:containment-runbook": "node scripts/check-containment-runbook.mjs",
    "test:config-check": "node scripts/test-config-check.mjs",
    "test:containment-runbook-check": "node scripts/test-containment-runbook-check.mjs",
    "test:ingest-host:coverage": "pnpm --filter @viberacing/ingest-host run test:coverage",
    "test:jobs-scheduler:coverage": "pnpm --filter @viberacing/jobs-scheduler run test:coverage",
    "test:migrate:coverage": "pnpm --filter @viberacing/migrate run test:coverage",
    "test:web:coverage": "pnpm --filter @viberacing/web run test:coverage",
    "verify:release:node": "node scripts/verify.mjs --release --node-only",
  },
});

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeFixture(relativePath, content) {
  const path = join(temporaryRoot, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function restoreValidFixture() {
  writeFixture(runbookRelativePath, runbookSource);
  writeJson(rootPackagePath, validRootPackage);
  for (const [path, source] of fixtureSources) {
    writeFixture(path, source);
  }
}

function mutateFixture(relativePath, search, replacement) {
  const source = fixtureSources.get(relativePath);
  if (source === undefined || !source.includes(search)) {
    throw new Error(`fixture mutation source was not found: ${relativePath}`);
  }
  writeFixture(relativePath, source.replace(search, replacement));
}

function scan() {
  return spawnSync(
    process.execPath,
    [join(temporaryRoot, "scripts", "check-containment-runbook.mjs")],
    {
      cwd: temporaryRoot,
      encoding: "utf8",
    },
  );
}

function expectPass(label) {
  const result = scan();
  if (result.status !== 0) {
    throw new Error(`${label} unexpectedly failed:\n${result.stderr}`);
  }
}

function expectFailure(label, expectedFinding) {
  const result = scan();
  if (result.status === 0) {
    throw new Error(`${label} unexpectedly passed`);
  }
  if (!result.stderr.includes(expectedFinding)) {
    throw new Error(`${label} did not report ${expectedFinding}:\n${result.stderr}`);
  }
}

try {
  mkdirSync(join(temporaryRoot, "scripts"), { recursive: true });
  copyFileSync(
    join(sourceRoot, "scripts", "check-containment-runbook.mjs"),
    join(temporaryRoot, "scripts", "check-containment-runbook.mjs"),
  );

  restoreValidFixture();
  expectPass("valid capability containment runbook contract");

  rmSync(runbookPath);
  expectFailure("missing runbook", "docs/operations/CAPABILITY_CONTAINMENT_RUNBOOK.md is missing");

  restoreValidFixture();
  writeFixture(runbookRelativePath, runbookSource.replace("## Contain", "## Disable"));
  expectFailure("heading drift", "heading inventory or order drifted");

  restoreValidFixture();
  writeFixture(runbookRelativePath, runbookSource.replace("VR-CONTAIN-24", "VR-CONTAIN-23"));
  expectFailure("control inventory drift", "control inventory or order drifted");

  restoreValidFixture();
  writeFixture(
    runbookRelativePath,
    runbookSource.replace("Keep failed capabilities and routes closed", "Reopen failed routes"),
  );
  expectFailure("control meaning drift", "control text drifted");

  restoreValidFixture();
  writeFixture(
    runbookRelativePath,
    runbookSource.replace("pnpm run check:config", "pnpm run check:configuration"),
  );
  expectFailure("documented command drift", "command inventory or order drifted");

  restoreValidFixture();
  writeFixture(
    runbookRelativePath,
    [runbookSource, "```bash", "not-a-reviewed-command", "```", ""].join("\n"),
  );
  expectFailure("extra fenced command", "fenced command block inventory drifted");

  restoreValidFixture();
  writeJson(rootPackagePath, {
    scripts: { ...validRootPackage.scripts, "check:config": "node scripts/unsafe.mjs" },
  });
  expectFailure("root command drift", "root package script check:config drifted");

  restoreValidFixture();
  mutateFixture(
    ".env.example",
    "VIBERACING_INGEST_ENABLED=false",
    "VIBERACING_INGEST_ENABLED=true",
  );
  expectFailure("tracked default drift", "tracked environment default");

  restoreValidFixture();
  writeFixture(
    ".env.example",
    `${fixtureSources.get(".env.example")}\nVIBERACING_MIGRATIONS_ENABLED=false\n`,
  );
  expectFailure("published migration gate", "must not publish migration enablement");

  restoreValidFixture();
  mutateFixture(
    join("scripts", "check-config.mjs"),
    '["VIBERACING_PAIRING_ENABLED", "false"]',
    '["VIBERACING_PAIRING_ENABLED", "true"]',
  );
  expectFailure("configuration checker drift", "no longer fixes VIBERACING_PAIRING_ENABLED");

  restoreValidFixture();
  mutateFixture(
    join("apps", "web", "lib", "public-snapshot-config.ts"),
    'readEnvironmentValue(environment) === "true"',
    'readEnvironmentValue(environment) !== "false"',
  );
  expectFailure("public-snapshot Web admission drift", "Web capability source");

  restoreValidFixture();
  mutateFixture(
    join("apps", "web", "lib", "invite-gate-config.ts"),
    "VIBERACING_INVITE_GATE_ENABLED",
    "VIBERACING_INVITE_POLICY_ENABLED",
  );
  expectFailure("Web gate-name drift", "Web capability source");

  restoreValidFixture();
  mutateFixture(
    join("apps", "web", "lib", "pairing-config.ts"),
    'readEnvironmentValue(environment) === "true"',
    'readEnvironmentValue(environment) !== "false"',
  );
  expectFailure("Web admission drift", "Web capability source");

  restoreValidFixture();
  rmSync(join(temporaryRoot, "apps", "web", "app", "v1", "leaderboards", "current", "route.ts"));
  expectFailure("missing module gate binding", "Web module gate binding");

  restoreValidFixture();
  mutateFixture(
    join("apps", "ingest-host", "src", "listener-config.ts"),
    'enabled: "VIBERACING_INGEST_ENABLED"',
    'enabled: "VIBERACING_INGEST_ACTIVE"',
  );
  expectFailure("Ingest gate-name drift", "Ingest capability source drifted");

  restoreValidFixture();
  mutateFixture(
    join("apps", "ingest-host", "src", "listener-config.ts"),
    'if (environmentValue(environment, names.enabled) !== "true")',
    'if (environmentValue(environment, names.enabled) === "false")',
  );
  expectFailure("Ingest admission drift", "Ingest capability source drifted");

  restoreValidFixture();
  mutateFixture(
    join("apps", "ingest-host", "src", "listener-config.ts"),
    "const usageSyncEnabled = optionalExactEnablement(environment as object, names.usageSyncEnabled)",
    'const usageSyncEnabled = environmentValue(environment, names.usageSyncEnabled) !== "false"',
  );
  expectFailure("Usage Sync Ingest admission drift", "Usage Sync Ingest capability source drifted");

  restoreValidFixture();
  mutateFixture(
    join("apps", "edge", "src", "worker.mjs"),
    'descriptor.value === "true"',
    'descriptor.value !== "false"',
  );
  expectFailure("Usage Sync Edge admission drift", "Usage Sync Edge capability source drifted");

  restoreValidFixture();
  mutateFixture(
    join("apps", "jobs-scheduler", "src", "config.ts"),
    'environment[enabledEnvironmentName] !== "true"',
    'environment[enabledEnvironmentName] === "false"',
  );
  expectFailure("Jobs scheduler admission drift", "Jobs scheduler capability source drifted");

  restoreValidFixture();
  mutateFixture(
    join("apps", "migrate", "src", "enablement.ts"),
    'environment.VIBERACING_MIGRATIONS_ENABLED === "true"',
    'environment.VIBERACING_MIGRATIONS_ENABLED !== "false"',
  );
  expectFailure("migration admission drift", "migration capability source drifted");

  restoreValidFixture();
  writeFixture(
    runbookRelativePath,
    runbookSource.replaceAll("`VIBERACING_PAIRING_ENABLED`", "`PAIRING_GATE`"),
  );
  expectFailure("gate inventory drift", "missing capability gate VIBERACING_PAIRING_ENABLED");

  restoreValidFixture();
  writeFixture(
    runbookRelativePath,
    runbookSource.replace(
      /resolve\s+their\s+decisions\s+at\s+module\s+evaluation\./u,
      "read a decision",
    ),
  );
  expectFailure("module-load boundary removal", "missing required statement");

  restoreValidFixture();
  writeFixture(
    runbookRelativePath,
    runbookSource.replace(
      /It\s+is\s+not\s+a\s+deployed\s+control\s+plane,\s+dynamic\s+kill\s+switch,\s+private\s+reporting\s+channel,\s+monitoring\s+backend,\s+incident\s+exercise,\s+or\s+proof\s+that\s+an\s+external\s+service\s+was\s+contained\./u,
      "",
    ),
  );
  expectFailure("deployed boundary removal", "missing required statement");

  restoreValidFixture();
  writeFixture(runbookRelativePath, `${runbookSource}\nVIBERACING_INGEST_ENABLED=true\n`);
  expectFailure("inline capability assignment", "inline capability assignment");

  restoreValidFixture();
  writeFileSync(runbookPath, Buffer.from([0xff]));
  expectFailure("invalid UTF-8", "canonical UTF-8 text without NUL bytes");

  console.log("Containment runbook checker regressions passed (25 unsafe/drift variants).");
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}

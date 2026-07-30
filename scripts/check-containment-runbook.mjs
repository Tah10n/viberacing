import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const runbookPath = resolve(root, "docs", "operations", "CAPABILITY_CONTAINMENT_RUNBOOK.md");
const rootPackagePath = resolve(root, "package.json");
const envExamplePath = resolve(root, ".env.example");
const configCheckerPath = resolve(root, "scripts", "check-config.mjs");
const ingestConfigPath = resolve(root, "apps", "ingest-host", "src", "listener-config.ts");
const ingestHostPath = resolve(root, "apps", "ingest-host", "src", "host.ts");
const edgeWorkerPath = resolve(root, "apps", "edge", "src", "worker.mjs");
const jobsConfigPath = resolve(root, "apps", "jobs-scheduler", "src", "config.ts");
const migrationConfigPath = resolve(root, "apps", "migrate", "src", "enablement.ts");
const maximumRunbookBytes = 32 * 1024;
const failures = [];

const expectedHeadings = Object.freeze([
  "# Capability containment and recovery rehearsal runbook",
  "## Scope and evidence boundary",
  "## Authority and prerequisites",
  "## Preflight",
  "## Local evidence",
  "## Contain",
  "## Preserve security and deletion paths",
  "## Verify containment",
  "## Recover one capability at a time",
  "## Failure and incident handoff",
  "## Prohibited actions",
]);
const expectedControls = Object.freeze([
  [
    "VR-CONTAIN-01",
    "Pin the exact reviewed commit, immutable artifacts, deployed topology, and affected environment in the protected incident record.",
  ],
  [
    "VR-CONTAIN-02",
    "Assign incident commander, security, service, data/deletion, and communications owners before changing capability state.",
  ],
  [
    "VR-CONTAIN-03",
    "Classify affected capabilities, attacker persistence, user-data exposure, deletion risk, credential scope, and public impact using only minimized protected evidence.",
  ],
  [
    "VR-CONTAIN-04",
    "Prove the controller can replace or stop every affected process and can close its public and direct-origin routes without relying on application success.",
  ],
  [
    "VR-CONTAIN-05",
    "Confirm credential/key revocation, cache invalidation, database isolation, and rollback authority are available through separately reviewed protected workflows.",
  ],
  [
    "VR-CONTAIN-06",
    "Identify which returning login, recovery, logout, visibility, deletion, passkey, installation, device, and AgentAccount-security actions must remain reachable or receive a protected manual fallback.",
  ],
  [
    "VR-CONTAIN-07",
    "Freeze new releases and keep migration enablement absent before changing any runtime capability.",
  ],
  [
    "VR-CONTAIN-08",
    "Stop the Jobs scheduler when database integrity, deletion, accounting, snapshot refresh, finalization, retention, or privileged Jobs authority is in scope.",
  ],
  [
    "VR-CONTAIN-09",
    "Remove enablement for each affected capability through protected configuration; do not patch the application to invert, bypass, or merge independent decisions.",
  ],
  [
    "VR-CONTAIN-10",
    "Replace every affected Web worker because public snapshots, pairing, CarRecipe proposals, enrollment, and optional invite policy resolve their decisions at module evaluation.",
  ],
  [
    "VR-CONTAIN-11",
    "Drain or stop every affected Ingest host before removing its startup enablement; changing environment state does not stop an already-running listener.",
  ],
  [
    "VR-CONTAIN-12",
    "Stop every affected scheduler or migration process; their startup latches do not revoke authority already held by a running process.",
  ],
  [
    "VR-CONTAIN-13",
    "Close public and direct-origin routing, invalidate relevant caches, and verify that no old enabled worker remains addressable before treating configuration as contained.",
  ],
  [
    "VR-CONTAIN-14",
    "Rotate or revoke a compromised credential, key, session, device, or artifact only through its separately approved workflow and verify that old authority is denied.",
  ],
  [
    "VR-CONTAIN-15",
    "Preserve returning login, recovery, logout, profile hide/delete, passkey revoke, installation/device revoke, AgentAccount pause/unlink, and proposal rejection unless that exact path is compromised.",
  ],
  [
    "VR-CONTAIN-16",
    "When a security or deletion path is compromised, close it narrowly, document a protected manual fallback, and prevent the broader Web surface from implying the action succeeded.",
  ],
  [
    "VR-CONTAIN-17",
    "Keep deletion-pending profiles hidden and ingestion authority revoked; do not re-enable a capability to repair backup, tombstone, cache, or deletion state.",
  ],
  [
    "VR-CONTAIN-18",
    "Verify every affected route, listener, scheduler, migration process, database session, and old artifact through an external protected oracle rather than configuration state alone.",
  ],
  [
    "VR-CONTAIN-19",
    "Record only timestamps, pinned revisions/artifacts, capability names, coarse outcomes, opaque request references, and bounded aggregate counts needed for response.",
  ],
  [
    "VR-CONTAIN-20",
    "Exclude credentials, keys, cookies, raw requests, database rows/errors, exact usage, handles, device material, hostnames, private paths, and reporter or user data from public output and this repository.",
  ],
  [
    "VR-CONTAIN-21",
    "Require a reviewed root-cause fix, clean immutable artifact, restored protected dependencies, and explicit incident-commander approval before recovery.",
  ],
  [
    "VR-CONTAIN-22",
    "Recover only one capability in one environment at a time through a new process, then verify routing, caches, authorization, data invariants, and monitoring before continuing.",
  ],
  [
    "VR-CONTAIN-23",
    "Return immediately to containment on any mismatch; do not widen another capability to make the failed one appear healthy.",
  ],
  [
    "VR-CONTAIN-24",
    "Keep failed capabilities and routes closed, remove temporary authority, assign every residual risk and follow-up, and retain only the protected redacted timeline before handing off or closing the incident.",
  ],
]);
const expectedControlIds = Object.freeze(expectedControls.map(([id]) => id));
const expectedCommands = Object.freeze([
  "pnpm run check:containment-runbook",
  "pnpm run check:config",
  "pnpm run test:config-check",
  "pnpm run test:web:coverage",
  "pnpm run test:ingest-host:coverage",
  "pnpm run test:jobs-scheduler:coverage",
  "pnpm run test:migrate:coverage",
  "pnpm run verify:release:node",
]);
const expectedRootScripts = Object.freeze({
  "check:config": "node scripts/check-config.mjs",
  "check:containment-runbook": "node scripts/check-containment-runbook.mjs",
  "test:config-check": "node scripts/test-config-check.mjs",
  "test:containment-runbook-check": "node scripts/test-containment-runbook-check.mjs",
  "test:ingest-host:coverage": "corepack pnpm --filter @viberacing/ingest-host run test:coverage",
  "test:jobs-scheduler:coverage":
    "corepack pnpm --filter @viberacing/jobs-scheduler run test:coverage",
  "test:migrate:coverage": "corepack pnpm --filter @viberacing/migrate run test:coverage",
  "test:web:coverage": "corepack pnpm --filter @viberacing/web run test:coverage",
  "verify:release:node": "node scripts/verify.mjs --release --node-only",
});
const expectedGateNames = Object.freeze([
  "VIBERACING_MIGRATIONS_ENABLED",
  "VIBERACING_JOBS_SCHEDULER_ENABLED",
  "VIBERACING_INGEST_ENABLED",
  "VIBERACING_USAGE_SYNC_ENABLED",
  "VIBERACING_PUBLIC_SNAPSHOTS_ENABLED",
  "VIBERACING_PAIRING_ENABLED",
  "VIBERACING_CAR_PROPOSALS_ENABLED",
  "VIBERACING_ENROLLMENT_ENABLED",
  "VIBERACING_INVITE_GATE_ENABLED",
]);
const trackedFalseGateNames = Object.freeze(expectedGateNames.slice(1));
const webGateSources = Object.freeze([
  [
    "VIBERACING_PUBLIC_SNAPSHOTS_ENABLED",
    "publicSnapshotsEnabledName",
    resolve(root, "apps", "web", "lib", "public-snapshot-config.ts"),
  ],
  [
    "VIBERACING_PAIRING_ENABLED",
    "pairingEnabledName",
    resolve(root, "apps", "web", "lib", "pairing-config.ts"),
  ],
  [
    "VIBERACING_CAR_PROPOSALS_ENABLED",
    "carProposalsEnabledName",
    resolve(root, "apps", "web", "lib", "car-proposals-config.ts"),
  ],
  [
    "VIBERACING_ENROLLMENT_ENABLED",
    "enrollmentEnabledName",
    resolve(root, "apps", "web", "lib", "enrollment-enable-config.ts"),
  ],
  [
    "VIBERACING_INVITE_GATE_ENABLED",
    "inviteGateEnabledName",
    resolve(root, "apps", "web", "lib", "invite-gate-config.ts"),
  ],
]);
const webModuleGateBindings = Object.freeze([
  [
    resolve(root, "apps", "web", "app", "v1", "leaderboards", "current", "route.ts"),
    "const publicSnapshotConfig = resolvePublicSnapshotConfig();",
  ],
  [
    resolve(root, "apps", "web", "app", "v1", "leaderboards", "[seasonStart]", "route.ts"),
    "const publicSnapshotConfig = resolvePublicSnapshotConfig();",
  ],
  [
    resolve(root, "apps", "web", "app", "v1", "profiles", "[handle]", "route.ts"),
    "const publicSnapshotConfig = resolvePublicSnapshotConfig();",
  ],
  [
    resolve(root, "apps", "web", "lib", "public-home-snapshot.ts"),
    "const publicHomeConfig = resolvePublicSnapshotConfig();",
  ],
  [
    resolve(root, "apps", "web", "app", "v1", "connector", "pairing", "start", "route.ts"),
    "const pairingConfig = resolvePairingConfig();",
  ],
  [
    resolve(root, "apps", "web", "app", "v1", "connector", "pairing", "poll", "route.ts"),
    "const pairingConfig = resolvePairingConfig();",
  ],
  [
    resolve(root, "apps", "web", "lib", "batch-pairing-browser-route.ts"),
    "const pairingConfig = resolvePairingConfig();",
  ],
  [
    resolve(root, "apps", "web", "app", "account", "page.tsx"),
    "const carProposalsConfig = resolveCarProposalsConfig();",
  ],
  [
    resolve(root, "apps", "web", "app", "auth", "cars", "proposals", "route.ts"),
    "const carProposalsConfig = resolveCarProposalsConfig();",
  ],
  [
    resolve(root, "apps", "web", "app", "auth", "cars", "proposals", "approve", "route.ts"),
    "const carProposalsConfig = resolveCarProposalsConfig();",
  ],
  [
    resolve(root, "apps", "web", "app", "v1", "connector", "cars", "proposals", "route.ts"),
    "const carProposalsConfig = resolveCarProposalsConfig();",
  ],
  [
    resolve(root, "apps", "web", "app", "join", "page.tsx"),
    "const enrollmentConfig = resolveEnrollmentEnableConfig();",
  ],
  [
    resolve(root, "apps", "web", "app", "join", "passkey", "page.tsx"),
    "const enrollmentConfig = resolveEnrollmentEnableConfig();",
  ],
  [
    resolve(root, "apps", "web", "app", "auth", "github", "start", "route.ts"),
    "const enrollmentConfig = resolveEnrollmentEnableConfig();",
  ],
  [
    resolve(root, "apps", "web", "app", "auth", "github", "callback", "route.ts"),
    "const enrollmentConfig = resolveEnrollmentEnableConfig();",
  ],
  [
    resolve(root, "apps", "web", "app", "auth", "passkey", "options", "route.ts"),
    "const enrollmentConfig = resolveEnrollmentEnableConfig();",
  ],
  [
    resolve(root, "apps", "web", "app", "auth", "passkey", "verify", "route.ts"),
    "const enrollmentConfig = resolveEnrollmentEnableConfig();",
  ],
  [
    resolve(root, "apps", "web", "app", "join", "page.tsx"),
    "const inviteGateConfig = resolveInviteGateConfig();",
  ],
  [
    resolve(root, "apps", "web", "app", "auth", "github", "start", "route.ts"),
    "const inviteGateConfig = resolveInviteGateConfig();",
  ],
  [
    resolve(root, "apps", "web", "app", "auth", "github", "callback", "route.ts"),
    "const inviteGateConfig = resolveInviteGateConfig();",
  ],
]);
const requiredStatements = Object.freeze([
  "Every decision admits only the exact string `true`; absence, `false`, alternate case, another type, or unreadable state fails closed.",
  "The local checker binds five Web decisions to 20 exact module-load points: four public-snapshot, three pairing, four CarRecipe-proposal, six enrollment, and three invite-policy bindings.",
  "Editing that file is never an incident action.",
  "It is not a deployed control plane, dynamic kill switch, private reporting channel, monitoring backend, incident exercise, or proof that an external service was contained.",
  "They do not inspect, change, or observe deployed capability state.",
  "changing environment state does not stop an already-running listener.",
  "their startup latches do not revoke authority already held by a running process.",
  "resolve their decisions at module evaluation.",
  "Preserve returning login, recovery, logout, profile hide/delete, passkey revoke, installation/device revoke, AgentAccount pause/unlink, and proposal rejection",
  "Do not run raw database, cache, credential-store, key-rotation, or artifact-publication commands from this public runbook.",
]);

function fail(message) {
  failures.push(message);
}

function normalizedFile(path, label) {
  try {
    return readFileSync(path, "utf8").replace(/\r\n/gu, "\n");
  } catch {
    fail(`${label} could not be read`);
    return undefined;
  }
}

function readJson(path, label) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      fail(`${label} must be a JSON object`);
      return undefined;
    }
    return value;
  } catch {
    fail(`${label} could not be read as JSON`);
    return undefined;
  }
}

let runbook;
if (!existsSync(runbookPath)) {
  fail("docs/operations/CAPABILITY_CONTAINMENT_RUNBOOK.md is missing");
} else {
  const metadata = lstatSync(runbookPath);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    fail("containment runbook must be one regular non-symlink file");
  } else {
    const bytes = readFileSync(runbookPath);
    if (bytes.length === 0 || bytes.length > maximumRunbookBytes) {
      fail(`containment runbook must be between 1 and ${maximumRunbookBytes} bytes`);
    }
    runbook = bytes.toString("utf8");
    if (!Buffer.from(runbook, "utf8").equals(bytes) || runbook.includes("\0")) {
      fail("containment runbook must be canonical UTF-8 text without NUL bytes");
    }
  }
}

if (runbook !== undefined) {
  const normalizedRunbook = runbook.replace(/\s+/gu, " ");
  const headings = [...runbook.matchAll(/^(#{1,6} .+)$/gmu)].map((match) => match[1]);
  if (JSON.stringify(headings) !== JSON.stringify(expectedHeadings)) {
    fail("containment runbook heading inventory or order drifted");
  }

  const controlIds = [...runbook.matchAll(/^- \[ \] (VR-CONTAIN-\d{2}):/gmu)].map(
    (match) => match[1],
  );
  if (JSON.stringify(controlIds) !== JSON.stringify(expectedControlIds)) {
    fail("containment runbook control inventory or order drifted");
  }
  const lines = runbook.split(/\r?\n/u);
  const observedControls = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^- \[ \] (VR-CONTAIN-\d{2}):\s+(.+)$/u.exec(lines[index]);
    if (match === null) {
      continue;
    }
    const textParts = [match[2]];
    while (index + 1 < lines.length && /^ {2,}\S/u.test(lines[index + 1])) {
      index += 1;
      textParts.push(lines[index].trim());
    }
    observedControls.push([match[1], textParts.join(" ")]);
  }
  if (JSON.stringify(observedControls) !== JSON.stringify(expectedControls)) {
    fail("containment runbook control text drifted");
  }

  const fenceMarkers = [...runbook.matchAll(/^```.*$/gmu)].map((match) => match[0]);
  if (JSON.stringify(fenceMarkers) !== JSON.stringify(["```text", "```"])) {
    fail("containment runbook fenced command block inventory drifted");
  }
  const commands = [...runbook.matchAll(/```text\r?\n([\s\S]*?)```/gu)].flatMap((match) =>
    match[1]
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line !== ""),
  );
  if (JSON.stringify(commands) !== JSON.stringify(expectedCommands)) {
    fail("containment runbook command inventory or order drifted");
  }

  for (const gateName of expectedGateNames) {
    if (!runbook.includes(`\`${gateName}\``)) {
      fail(`containment runbook is missing capability gate ${gateName}`);
    }
  }
  for (const statement of requiredStatements) {
    if (!normalizedRunbook.includes(statement)) {
      fail(`containment runbook is missing required statement: ${statement}`);
    }
  }
  const inlineGateAssignment = new RegExp(`(?:${expectedGateNames.join("|")})\\s*=\\s*\\S+`, "u");
  if (inlineGateAssignment.test(runbook)) {
    fail("containment runbook must not contain an inline capability assignment");
  }
}

const rootPackage = readJson(rootPackagePath, "root package manifest");
if (rootPackage !== undefined) {
  const scripts = rootPackage.scripts;
  if (scripts === null || typeof scripts !== "object" || Array.isArray(scripts)) {
    fail("root package scripts must be an object");
  } else {
    for (const [name, expected] of Object.entries(expectedRootScripts)) {
      if (scripts[name] !== expected) {
        fail(`root package script ${name} drifted from the containment runbook contract`);
      }
    }
  }
}

const envExample = normalizedFile(envExamplePath, "tracked environment example");
if (envExample !== undefined) {
  for (const gateName of trackedFalseGateNames) {
    const matches = envExample.match(new RegExp(`^${gateName}=false$`, "gmu")) ?? [];
    if (matches.length !== 1) {
      fail(`tracked environment default for ${gateName} drifted from false`);
    }
  }
  if (/^VIBERACING_MIGRATIONS_ENABLED=/mu.test(envExample)) {
    fail("tracked environment must not publish migration enablement");
  }
}

const configChecker = normalizedFile(configCheckerPath, "configuration checker source");
if (configChecker !== undefined) {
  for (const gateName of trackedFalseGateNames) {
    if (!configChecker.includes(`["${gateName}", "false"]`)) {
      fail(`configuration checker no longer fixes ${gateName} to false`);
    }
  }
}

for (const [gateName, constantName, path] of webGateSources) {
  const source = normalizedFile(path, `Web capability source ${gateName}`);
  if (
    source !== undefined &&
    (!source.includes(`const ${constantName} = "${gateName}";`) ||
      !source.includes('readEnvironmentValue(environment) === "true"'))
  ) {
    fail(`Web capability source ${gateName} drifted from exact fail-closed admission`);
  }
}

for (const [path, binding] of webModuleGateBindings) {
  const source = normalizedFile(path, `Web module gate binding ${binding}`);
  if (source !== undefined && !source.split("\n").includes(binding)) {
    fail(`Web module gate binding drifted from module evaluation: ${binding}`);
  }
}

const ingestConfig = normalizedFile(ingestConfigPath, "Ingest capability source");
if (ingestConfig !== undefined) {
  const gateIndex = ingestConfig.indexOf(
    'if (environmentValue(environment, names.enabled) !== "true")',
  );
  const protectedReadIndex = ingestConfig.indexOf(
    "const nodeEnvironment = environmentValue(environment, names.nodeEnvironment)",
  );
  if (
    !ingestConfig.includes('enabled: "VIBERACING_INGEST_ENABLED"') ||
    gateIndex < 0 ||
    protectedReadIndex < 0 ||
    gateIndex > protectedReadIndex
  ) {
    fail("Ingest capability source drifted from first exact fail-closed admission");
  }
}

const ingestHost = normalizedFile(ingestHostPath, "Usage Sync Ingest host binding");
if (
  ingestConfig !== undefined &&
  (!ingestConfig.includes('usageSyncEnabled: "VIBERACING_USAGE_SYNC_ENABLED"') ||
    !ingestConfig.includes(
      "const usageSyncEnabled = optionalExactEnablement(environment as object, names.usageSyncEnabled)",
    ) ||
    ingestConfig.indexOf(
      "const usageSyncEnabled = optionalExactEnablement(environment as object, names.usageSyncEnabled)",
    ) >
      ingestConfig.indexOf(
        "const nodeEnvironment = environmentValue(environment, names.nodeEnvironment)",
      ))
) {
  fail("Usage Sync Ingest capability source drifted from exact pre-application admission");
}
if (
  ingestHost !== undefined &&
  !ingestHost.includes("createCommunitySyncHttpServer(application, config.usageSyncEnabled)")
) {
  fail("Usage Sync Ingest host binding drifted from validated listener configuration");
}

const edgeWorker = normalizedFile(edgeWorkerPath, "Usage Sync Edge capability source");
if (
  edgeWorker !== undefined &&
  (!edgeWorker.includes("usageSyncIsEnabled") ||
    !edgeWorker.includes('"VIBERACING_USAGE_SYNC_ENABLED"') ||
    !edgeWorker.includes('descriptor.value === "true"'))
) {
  fail("Usage Sync Edge capability source drifted from exact fail-closed admission");
}

const jobsConfig = normalizedFile(jobsConfigPath, "Jobs scheduler capability source");
if (
  jobsConfig !== undefined &&
  (!jobsConfig.includes('const enabledEnvironmentName = "VIBERACING_JOBS_SCHEDULER_ENABLED";') ||
    !jobsConfig.includes('environment[enabledEnvironmentName] !== "true"'))
) {
  fail("Jobs scheduler capability source drifted from exact fail-closed admission");
}

const migrationConfig = normalizedFile(migrationConfigPath, "migration capability source");
if (
  migrationConfig !== undefined &&
  !migrationConfig.includes('environment.VIBERACING_MIGRATIONS_ENABLED === "true"')
) {
  fail("migration capability source drifted from exact fail-closed admission");
}

if (failures.length > 0) {
  console.error(`Containment runbook check failed with ${failures.length} finding(s):`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Containment runbook check passed (${expectedControlIds.length} controls, ${expectedCommands.length} commands, ${expectedGateNames.length} gates, ${webModuleGateBindings.length} Web module bindings).`,
);

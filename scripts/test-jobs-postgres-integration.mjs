import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

import { validateManifest } from "./check-database.mjs";
import { createPortableNodeRuntime, removePortableNodeRuntime } from "./portable-node-runtime.mjs";

// cspell:ignore usename

const root = resolve(import.meta.dirname, "..");
const projectName = `vr-jobs-it-${process.pid}`;
const containerName = `${projectName}-postgres`;
const composePrefix = [
  "compose",
  "--ansi",
  "never",
  "--project-name",
  projectName,
  "--profile",
  "test",
];
const databaseName = "viberacing_local";
const bootstrapUser = "viberacing_local";
const jobsLogin = "viberacing_jobs_login";
const jobsPassword = "synthetic-jobs-integration-password";
const wideJobsLogin = "viberacing_jobs_wide_login";
const wideJobsPassword = "synthetic-wide-jobs-integration-password";
const extraRole = "viberacing_jobs_extra";
const completedMessage = "Vibe Racing Jobs command completed.\n";
const failedMessage = "Vibe Racing Jobs command failed.\n";
const defaultFinalizedSeasonStart = "2000-01-03";
const schedulerArgument = "--scheduler";
const schedulerLifecycleArgument = "--scheduler-lifecycle";
const schedulerProcessArgument = "--scheduler-process";
const schedulerSignalProcessArgument = "--scheduler-signal-process";
const schedulerTimerArgument = "--scheduler-timer";
const schedulerWallClockProcessArgument = "--scheduler-wall-clock-process";
const schedulerCycleTimeoutMs = 120_000;
const schedulerProcessCloseTimeoutMs = 10_000;
const schedulerProcessPollIntervalMs = 250;
const schedulerWallClockPollIntervalMs = 1_000;
const schedulerWallClockTimeoutMs = 7 * 60_000;
const schedulerProcessContainerImage = (() => {
  const compose = parse(readFileSync(resolve(root, "compose.yaml"), "utf8"));
  const image = compose?.services?.["node-process-signal-test"]?.image;
  assert.equal(typeof image, "string");
  assert.match(image, /^node:24\.18\.0-bookworm-slim@sha256:[a-f0-9]{64}$/);
  return image;
})();
const schedulerProcessContainerName = `${projectName}-scheduler-process`;
const schedulerScoringLockReadyMarker = "scheduler-scoring-lock-ready";
const schedulerProcessRuntimeInventory = Object.freeze([
  "pg-cloudflare@1.4.0",
  "pg-connection-string@2.14.0",
  "pg-int8@1.0.1",
  "pg-pool@3.14.0",
  "pg-protocol@1.15.0",
  "pg-types@2.2.0",
  "pg@8.22.0",
  "pgpass@1.0.5",
  "postgres-array@2.0.0",
  "postgres-bytea@1.0.1",
  "postgres-date@1.0.7",
  "postgres-interval@1.2.0",
  "split2@4.2.0",
  "xtend@4.0.2",
]);
const fiveMinutesMs = 5 * 60 * 1_000;
const oneHourMs = 60 * 60 * 1_000;
const oneDayMs = 24 * oneHourMs;

function readIntegrationMode() {
  if (process.argv.length === 2) {
    return "commands";
  }
  if (process.argv.length === 3 && process.argv[2] === schedulerArgument) {
    return "scheduler";
  }
  if (process.argv.length === 3 && process.argv[2] === schedulerLifecycleArgument) {
    return "scheduler_lifecycle";
  }
  if (process.argv.length === 3 && process.argv[2] === schedulerProcessArgument) {
    return "scheduler_process";
  }
  if (process.argv.length === 3 && process.argv[2] === schedulerSignalProcessArgument) {
    return "scheduler_signal_process";
  }
  if (process.argv.length === 3 && process.argv[2] === schedulerTimerArgument) {
    return "scheduler_timer";
  }
  if (process.argv.length === 3 && process.argv[2] === schedulerWallClockProcessArgument) {
    return "scheduler_wall_clock_process";
  }
  throw new Error("Jobs PostgreSQL integration arguments failed closed.");
}

const integrationMode = readIntegrationMode();

const fixture = Object.freeze({
  abandonedInviteId: "00000000-0000-4000-8000-000000031951",
  abandonedProfileId: "00000000-0000-4000-8000-000000031952",
  abandonedSessionId: "00000000-0000-4000-8000-000000031953",
  authChallengeId: "00000000-0000-4000-8000-000000031101",
  auditEventId: "00000000-0000-4000-8000-000000031901",
  carProfileId: "00000000-0000-4000-8000-000000031201",
  carProposalId: "00000000-0000-4000-8000-000000031202",
  finalizedSourceProfileId: "00000000-0000-4000-8000-000000031954",
  inviteId: "00000000-0000-4000-8000-000000031701",
  pairingDeviceKeyId: "00000000-0000-4000-8000-000000031301",
  pairingId: "00000000-0000-4000-8000-000000031302",
  provenanceDeviceKeyId: "00000000-0000-4000-8000-000000031913",
  provenancePairingId: "00000000-0000-4000-8000-000000031914",
  provenancePasskeyId: "00000000-0000-4000-8000-000000031911",
  provenanceSessionId: "00000000-0000-4000-8000-000000031912",
  purgeJobId: "00000000-0000-4000-8000-000000031401",
  purgeProfileId: "00000000-0000-4000-8000-000000031402",
  revokedDeviceKeyId: "00000000-0000-4000-8000-000000031916",
  revokedDevicePairingId: "00000000-0000-4000-8000-000000031917",
  revokedPasskeyId: "00000000-0000-4000-8000-000000031915",
  scoringProfileId: "00000000-0000-4000-8000-000000031501",
  sessionId: "00000000-0000-4000-8000-000000031601",
  sessionProfileId: "00000000-0000-4000-8000-000000031602",
  terminalDeletionJobId: "00000000-0000-4000-8000-000000031801",
});

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 120_000,
    windowsHide: true,
    ...options,
  });
  if (result.error) {
    throw new Error(`${command} could not complete: ${result.error.message}`);
  }
  return result;
}

function requireSuccess(result, label) {
  if (result.status === 0) {
    return;
  }
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  throw new Error(`${label} failed${output ? `:\n${output}` : ""}`);
}

function docker(args, options = {}) {
  return run("docker", args, options);
}

function psqlArguments() {
  return [
    "exec",
    "-i",
    containerName,
    "psql",
    "--no-psqlrc",
    "--quiet",
    "--username",
    bootstrapUser,
    "--dbname",
    databaseName,
    "--set",
    "ON_ERROR_STOP=1",
    "--set",
    "VERBOSITY=terse",
  ];
}

function psql(sql, label) {
  const result = docker(psqlArguments(), { input: sql, timeout: 30_000 });
  requireSuccess(result, label);
}

function psqlScalar(sql, label) {
  const result = docker([...psqlArguments(), "--tuples-only", "--no-align", "--command", sql], {
    timeout: 10_000,
  });
  requireSuccess(result, label);
  return result.stdout.trim();
}

function readPrivateStateFingerprint(label) {
  const canonicalState = psqlScalar(
    `CREATE TEMP TABLE jobs_integration_fingerprints (
  table_name text PRIMARY KEY,
  table_state jsonb NOT NULL
);

DO $fingerprint$
DECLARE
  private_table record;
  table_state jsonb;
BEGIN
  FOR private_table IN
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'viberacing_private'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  LOOP
    EXECUTE pg_catalog.format(
      'SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(candidate) ORDER BY pg_catalog.to_jsonb(candidate)::text), ''[]''::jsonb) FROM %I.%I AS candidate',
      'viberacing_private',
      private_table.table_name
    )
    INTO table_state;

    INSERT INTO jobs_integration_fingerprints (table_name, table_state)
    VALUES (private_table.table_name, table_state);
  END LOOP;
END
$fingerprint$;

SELECT pg_catalog.jsonb_object_agg(table_name, table_state ORDER BY table_name)::text
FROM jobs_integration_fingerprints;`,
    label,
  );
  assert.notEqual(canonicalState, "", `${label} must return canonical private state`);
  return createHash("sha256").update(canonicalState, "utf8").digest("hex");
}

function buildWorkspace(relativePath, label) {
  const workspaceRoot = resolve(root, relativePath);
  const workspaceRequire = createRequire(resolve(workspaceRoot, "package.json"));
  const tsc = workspaceRequire.resolve("typescript/bin/tsc");
  const result = run(process.execPath, [tsc, "--project", "tsconfig.build.json"], {
    cwd: workspaceRoot,
  });
  requireSuccess(result, label);
}

function loadReviewedMigrations() {
  const migrationDirectory = resolve(root, "database", "migrations");
  const manifest = JSON.parse(readFileSync(resolve(migrationDirectory, "manifest.json"), "utf8"));
  const filesByPath = new Map();

  for (const entry of readdirSync(migrationDirectory, { withFileTypes: true })) {
    if (entry.name === "manifest.json") {
      continue;
    }
    if (entry.isSymbolicLink() || !entry.isFile() || !entry.name.endsWith(".sql")) {
      throw new Error(`unsafe migration directory entry: ${entry.name}`);
    }
    const path = `database/migrations/${entry.name}`;
    filesByPath.set(path, readFileSync(resolve(migrationDirectory, entry.name), "utf8"));
  }

  const findings = validateManifest(manifest, filesByPath);
  if (findings.length > 0) {
    throw new Error(`migration manifest validation failed:\n- ${findings.join("\n- ")}`);
  }

  return manifest.migrations.map((migration) => ({
    label: `migration ${migration.revision}: ${migration.name}`,
    sql: filesByPath.get(migration.path),
  }));
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function waitForHealthyContainer() {
  const deadline = Date.now() + 60_000;
  let lastStatus = "missing";
  while (Date.now() < deadline) {
    const result = docker(["inspect", "--format", "{{.State.Health.Status}}", containerName], {
      timeout: 10_000,
    });
    if (result.status === 0) {
      lastStatus = result.stdout.trim();
      if (lastStatus === "healthy") {
        return;
      }
      if (lastStatus === "unhealthy") {
        break;
      }
    }
    await sleep(250);
  }
  throw new Error(`isolated PostgreSQL did not become healthy (${lastStatus})`);
}

function readPublishedPostgresPort() {
  const result = docker(["port", containerName, "5432/tcp"], { timeout: 10_000 });
  requireSuccess(result, "isolated PostgreSQL port discovery");
  const output = result.stdout.trim();
  const match = /^127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(output);
  if (match === null) {
    throw new Error("isolated PostgreSQL did not publish one exact IPv4 loopback port");
  }
  const port = Number(match[1]);
  if (!Number.isSafeInteger(port) || port > 65_535) {
    throw new Error("isolated PostgreSQL returned an invalid loopback port");
  }
  return port;
}

function jobsEnvironment(databasePort, login, password) {
  return Object.freeze({
    NODE_ENV: "test",
    VIBERACING_JOBS_DATABASE_HOST: "127.0.0.1",
    VIBERACING_JOBS_DATABASE_NAME: databaseName,
    VIBERACING_JOBS_DATABASE_PASSWORD: password,
    VIBERACING_JOBS_DATABASE_PORT: String(databasePort),
    VIBERACING_JOBS_DATABASE_TLS_MODE: "disable",
    VIBERACING_JOBS_DATABASE_USER: login,
  });
}

async function loadSchedulerModules() {
  const jobs = await import(pathToFileURL(resolve(root, "apps", "jobs", "dist", "index.js")).href);
  const scheduler = await import(
    pathToFileURL(resolve(root, "apps", "jobs-scheduler", "dist", "index.js")).href
  );
  return Object.freeze({ jobs, scheduler });
}

async function runSchedulerCycle({
  databasePort,
  expectedJobs,
  expectFailure,
  login,
  modules,
  nowEpochMs,
  password,
}) {
  const configuredRunner = modules.jobs.createConfiguredCommunityMaintenanceRunner(
    jobsEnvironment(databasePort, login, password),
  );
  const attemptedJobs = [];
  const outcomes = [];
  const signals = [];
  let resolveCycle;
  const cycleSettled = new Promise((resolveCyclePromise) => {
    resolveCycle = resolveCyclePromise;
  });
  const runner = Object.freeze({
    close: () => configuredRunner.close(),
    execute: async (job) => {
      attemptedJobs.push(job);
      try {
        const result = await configuredRunner.execute(job);
        outcomes.push("completed");
        return result;
      } catch (error) {
        outcomes.push("rejected");
        throw error;
      } finally {
        if (attemptedJobs.length === expectedJobs.length) {
          resolveCycle();
        }
      }
    },
  });
  const intervalToken = Object.freeze({ schedulerIntegrationTimer: true });
  let clearedIntervals = 0;
  const controller = await modules.scheduler.startJobsScheduler(
    Object.freeze({ enabled: true, pollIntervalMs: 60_000 }),
    Object.freeze({
      clearInterval: (token) => {
        assert.equal(token, intervalToken, "the combined scheduler must clear its exact timer");
        clearedIntervals += 1;
      },
      createRunner: () => runner,
      createSchedule: () => modules.scheduler.createMaintenanceSchedule(),
      now: () => nowEpochMs,
      setInterval: (_handler, milliseconds) => {
        assert.equal(
          milliseconds,
          60_000,
          "the combined scheduler must retain its fixed poll slot",
        );
        return intervalToken;
      },
      signalSink: (signal) => {
        signals.push(signal);
      },
    }),
  );

  let timeoutToken;
  const timeout = new Promise((_, reject) => {
    timeoutToken = setTimeout(() => {
      reject(new Error("Jobs scheduler PostgreSQL cycle exceeded its fixed test deadline."));
    }, schedulerCycleTimeoutMs);
  });
  try {
    await Promise.race([cycleSettled, timeout]);
  } finally {
    clearTimeout(timeoutToken);
    await controller.close();
  }

  assert.equal(clearedIntervals, 1, "the combined scheduler must clear one timer on close");
  assert.deepEqual(
    attemptedJobs,
    expectedJobs,
    "the combined scheduler must attempt the exact reviewed catalog in order",
  );
  assert.deepEqual(
    outcomes,
    expectedJobs.map(() => (expectFailure ? "rejected" : "completed")),
    "the combined scheduler must observe the exact outcome for every reviewed job",
  );
  assert.deepEqual(
    signals,
    expectFailure ? ["cycle_failed"] : [],
    "the combined scheduler must emit only the expected closed cycle signal",
  );
}

function runJobsCommand(databasePort, login, password, args) {
  return run(process.execPath, [resolve(root, "apps", "jobs", "dist", "main.js"), ...args], {
    env: jobsEnvironment(databasePort, login, password),
    maxBuffer: 64 * 1024,
    timeout: 45_000,
  });
}

function assertSuccessfulCommand(result, label) {
  assert.equal(result.signal, null, `${label} must not be terminated by a signal`);
  assert.equal(result.status, 0, `${label} must exit successfully`);
  assert.equal(result.stdout, completedMessage, `${label} must emit one generic success sentence`);
  assert.equal(result.stderr, "", `${label} must not emit stderr`);
}

function assertRejectedCommand(result, label) {
  assert.equal(result.signal, null, `${label} must not be terminated by a signal`);
  assert.equal(result.status, 1, `${label} must exit with the closed failure code`);
  assert.equal(result.stdout, "", `${label} must not emit stdout`);
  assert.equal(result.stderr, failedMessage, `${label} must emit one generic failure sentence`);
}

function assertCanonicalMonday(value) {
  assert.match(value, /^\d{4}-\d{2}-\d{2}$/);
  const date = new Date(`${value}T00:00:00.000Z`);
  assert.equal(date.toISOString().slice(0, 10), value);
  assert.equal(date.getUTCDay(), 1);
}

function expectedSchedulerSeasonStarts(nowEpochMs) {
  const now = new Date(nowEpochMs);
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  const currentMondayMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - daysSinceMonday,
  );
  const finalizationOffsetDays = daysSinceMonday >= 2 ? 7 : 14;
  return Object.freeze({
    current: new Date(currentMondayMs).toISOString().slice(0, 10),
    finalization: new Date(currentMondayMs - finalizationOffsetDays * oneDayMs)
      .toISOString()
      .slice(0, 10),
  });
}

function expectedSchedulerCatalog(currentSeasonStart, finalizedSeasonStart) {
  return Object.freeze(
    [
      { kind: "finalize_community_season", seasonStart: finalizedSeasonStart },
      { kind: "refresh_community_season", seasonStart: currentSeasonStart },
      { kind: "finalize_community_season_backlog" },
      { batchSize: 10, kind: "purge_profile_deletions" },
      { batchSize: 1_000, kind: "cleanup_expired_auth_state" },
      { batchSize: 1_000, kind: "cleanup_expired_ingest_state" },
      { batchSize: 1_000, kind: "cleanup_expired_pairing_state" },
      { batchSize: 1_000, kind: "cleanup_expired_car_recipe_proposals" },
      { batchSize: 1_000, kind: "redact_aged_pairing_approval_provenance" },
      { batchSize: 1_000, kind: "cleanup_expired_sessions" },
      { batchSize: 1_000, kind: "cleanup_expired_invites" },
      { batchSize: 1_000, kind: "cleanup_abandoned_enrollments" },
      { batchSize: 1_000, kind: "cleanup_finalized_source_day_values" },
      { batchSize: 1_000, kind: "cleanup_terminal_deletion_jobs" },
      { batchSize: 1_000, kind: "cleanup_expired_audit_events" },
      { batchSize: 1_000, kind: "cleanup_aged_revoked_passkeys" },
      { batchSize: 1_000, kind: "cleanup_aged_revoked_devices" },
      { kind: "reset_expired_pairing_request_windows" },
    ].map((job) => Object.freeze(job)),
  );
}

function assertSchedulerSeasonStarts(expectedSeasonStarts, label) {
  assert.deepEqual(expectedSchedulerSeasonStarts(Date.now()), expectedSeasonStarts, label);
}

function startEmittedSchedulerProcess(databasePort) {
  let exitObserved = false;
  let stdoutObserved = false;
  let stderrObserved = false;
  const child = spawn(
    process.execPath,
    [resolve(root, "apps", "jobs-scheduler", "dist", "main.js")],
    {
      cwd: root,
      env: Object.freeze({
        ...jobsEnvironment(databasePort, jobsLogin, jobsPassword),
        VIBERACING_JOBS_SCHEDULER_ENABLED: "true",
      }),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  const terminateOnOutput = (stream) => {
    if (stream === "stdout") {
      stdoutObserved = true;
    } else {
      stderrObserved = true;
    }
    child.kill("SIGKILL");
  };
  child.stdout.on("data", () => {
    terminateOnOutput("stdout");
  });
  child.stderr.on("data", () => {
    terminateOnOutput("stderr");
  });
  child.once("exit", () => {
    exitObserved = true;
  });
  const closed = new Promise((resolveClose, rejectClose) => {
    child.once("error", () => {
      exitObserved = true;
      rejectClose(new Error("Emitted Jobs scheduler process could not start."));
    });
    child.once("close", (code, signal) => {
      exitObserved = true;
      resolveClose(Object.freeze({ code, signal }));
    });
  });
  void closed.catch(() => undefined);
  return Object.freeze({
    child,
    closed,
    hasExited: () => exitObserved,
    outputObserved: () => stdoutObserved || stderrObserved,
  });
}

function createPortableSchedulerRuntime() {
  return createPortableNodeRuntime({
    entryWorkspaceDirectory: resolve(root, "apps", "jobs-scheduler"),
    expectedExternalInventory: schedulerProcessRuntimeInventory,
    expectedWorkspaceInventory: ["@viberacing/jobs-scheduler@0.0.0", "@viberacing/jobs@0.0.0"],
    maximumFileCount: 499,
    minimumFileCount: 21,
    root,
    runtimePrefix: "jobs-scheduler-process-runtime-",
    workspaceDirectories: [resolve(root, "apps", "jobs-scheduler"), resolve(root, "apps", "jobs")],
  });
}

function removePortableSchedulerRuntime(runtime) {
  removePortableNodeRuntime(runtime);
}

function startSchedulerScoringLockHolder() {
  let exited = false;
  let output = "";
  let readySettled = false;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolvePromise, rejectPromise) => {
    resolveReady = resolvePromise;
    rejectReady = rejectPromise;
  });
  const child = spawn("docker", psqlArguments(), {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const observe = (chunk) => {
    output += chunk.toString("utf8");
    if (output.length > 8 * 1024) {
      child.kill("SIGKILL");
      if (!readySettled) {
        readySettled = true;
        rejectReady(new Error("Scheduler scoring lock holder exceeded its output budget."));
      }
      return;
    }
    if (!readySettled && output.includes(schedulerScoringLockReadyMarker)) {
      readySettled = true;
      resolveReady();
    }
  };
  child.stdout.on("data", observe);
  child.stderr.on("data", observe);
  const closed = new Promise((resolveClose, rejectClose) => {
    child.once("error", () => {
      exited = true;
      if (!readySettled) {
        readySettled = true;
        rejectReady(new Error("Scheduler scoring lock holder could not start."));
      }
      rejectClose(new Error("Scheduler scoring lock holder could not start."));
    });
    child.once("close", (code, signal) => {
      exited = true;
      if (!readySettled) {
        readySettled = true;
        rejectReady(new Error("Scheduler scoring lock holder exited before readiness."));
      }
      resolveClose(Object.freeze({ code, signal }));
    });
  });
  void ready.catch(() => undefined);
  void closed.catch(() => undefined);
  child.stdin.write(`BEGIN;
SET LOCAL application_name = 'viberacing-jobs-scheduler-scoring-holder';
SET LOCAL ROLE viberacing_owner;
SELECT lock_record.capability
FROM viberacing_private.maintenance_locks AS lock_record
WHERE lock_record.capability = 'community_scoring_refresh'
FOR UPDATE;
\\echo ${schedulerScoringLockReadyMarker}
`);
  return Object.freeze({
    child,
    closed,
    hasExited: () => exited,
    ready,
    release: (commit) => {
      child.stdin.end(commit ? "\nCOMMIT;\n" : "\nROLLBACK;\n");
    },
  });
}

async function stopSchedulerScoringLockHolder(holder, commit) {
  if (!holder.hasExited()) {
    holder.release(commit);
  }
  let result;
  try {
    result = await waitWithDeadline(
      holder.closed,
      schedulerProcessCloseTimeoutMs,
      "Scheduler scoring lock holder did not close within its fixed deadline.",
    );
  } catch (error) {
    if (!holder.hasExited()) {
      holder.child.kill("SIGKILL");
      await waitWithDeadline(
        holder.closed,
        schedulerProcessCloseTimeoutMs,
        "Scheduler scoring lock holder did not close after forced test cleanup.",
      ).catch(() => undefined);
    }
    throw error;
  }
  if (commit) {
    assert.deepEqual(result, { code: 0, signal: null });
  }
}

function schedulerProcessContainerExists() {
  const result = docker(["inspect", schedulerProcessContainerName], { timeout: 10_000 });
  if (result.status === 0) {
    return true;
  }
  if (
    result.status === 1 &&
    `${result.stdout}${result.stderr}`.includes(`No such object: ${schedulerProcessContainerName}`)
  ) {
    return false;
  }
  throw new Error("Scheduler process container existence check failed.");
}

function removeSchedulerProcessContainer(force) {
  if (!schedulerProcessContainerExists()) {
    return;
  }
  const args = force
    ? ["rm", "--force", schedulerProcessContainerName]
    : ["rm", schedulerProcessContainerName];
  requireSuccess(docker(args, { timeout: 15_000 }), "scheduler process container removal");
}

function createSchedulerProcessContainer(runtimeDirectory) {
  const environment = Object.freeze({
    ...jobsEnvironment(5432, jobsLogin, jobsPassword),
    VIBERACING_JOBS_SCHEDULER_ENABLED: "true",
  });
  const environmentArguments = Object.entries(environment)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([key, value]) => ["--env", `${key}=${value}`]);
  const bindSource = runtimeDirectory.replaceAll("\\", "/");
  const result = docker(
    [
      "create",
      "--name",
      schedulerProcessContainerName,
      "--network",
      `container:${containerName}`,
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges:true",
      "--pids-limit",
      "64",
      "--memory",
      "256m",
      "--cpus",
      "1",
      "--user",
      "node",
      "--workdir",
      "/runtime",
      "--mount",
      `type=bind,source=${bindSource},target=/runtime,readonly`,
      ...environmentArguments,
      schedulerProcessContainerImage,
      "node",
      "/runtime/dist/main.js",
    ],
    { timeout: 30_000 },
  );
  requireSuccess(result, "scheduler process container creation");
  assert.match(result.stdout.trim(), /^[a-f0-9]{64}$/);
  const imageInspection = docker(
    ["image", "inspect", "--format", "{{json .Config.Env}}", schedulerProcessContainerImage],
    { timeout: 10_000 },
  );
  requireSuccess(imageInspection, "scheduler process runtime image inspection");
  const imageEnvironment = JSON.parse(imageInspection.stdout.trim());
  assert.equal(Array.isArray(imageEnvironment), true);
  assert.equal(
    imageEnvironment.includes("NODE_VERSION=24.18.0"),
    true,
    "the pinned Linux process runtime must match the repository Node version",
  );
}

function readSchedulerProcessContainerState() {
  const result = docker(["inspect", "--format", "{{json .State}}", schedulerProcessContainerName], {
    timeout: 10_000,
  });
  requireSuccess(result, "scheduler process container state read");
  return JSON.parse(result.stdout.trim());
}

function readSchedulerProcessContainerOutput() {
  const result = docker(["logs", schedulerProcessContainerName], { timeout: 10_000 });
  requireSuccess(result, "scheduler process container output read");
  return `${result.stdout}${result.stderr}`;
}

function createSchedulerProcessContainerState() {
  return Object.freeze({
    hasExited: () => !readSchedulerProcessContainerState().Running,
    outputObserved: () => readSchedulerProcessContainerOutput() !== "",
  });
}

async function waitForSchedulerSignalDatabaseWait() {
  const deadline = performance.now() + schedulerCycleTimeoutMs;
  while (performance.now() < deadline) {
    const state = readSchedulerProcessContainerState();
    if (!state.Running) {
      throw new Error("Scheduler signal container exited before the controlled database wait.");
    }
    if (readSchedulerProcessContainerOutput() !== "") {
      throw new Error("Scheduler signal container produced output before shutdown.");
    }
    const observed = psqlScalar(
      `SELECT pg_catalog.concat(
  pg_catalog.count(*),
  ':',
  pg_catalog.count(*) FILTER (
    WHERE state = 'active'
      AND wait_event_type = 'Lock'
      AND query LIKE '%viberacing_api.finalize_community_season%'
  )
)
FROM pg_catalog.pg_stat_activity
WHERE application_name = 'viberacing-jobs-community-maintenance'
  AND usename = '${jobsLogin}';`,
      "emitted scheduler signal database-wait observation",
    );
    if (observed === "1:1") {
      return;
    }
    assert.match(observed, /^(?:0:0|1:0)$/);
    await sleep(schedulerProcessPollIntervalMs);
  }
  throw new Error("Scheduler signal container did not reach its controlled database wait.");
}

async function waitForSchedulerProcessContainerExit() {
  const deadline = performance.now() + schedulerProcessCloseTimeoutMs;
  while (performance.now() < deadline) {
    const state = readSchedulerProcessContainerState();
    if (!state.Running) {
      return state;
    }
    await sleep(schedulerProcessPollIntervalMs);
  }
  throw new Error("Scheduler process container did not exit within its fixed deadline.");
}

async function runEmittedSchedulerSignalProcess({ expectedSeasonStarts }) {
  assertSchedulerSeasonStarts(
    expectedSeasonStarts,
    "the host clock must retain the reviewed scheduler season targets before signal startup",
  );
  const runtime = createPortableSchedulerRuntime();
  let containerCreated = false;
  let holder;
  let holderReleased = false;
  try {
    holder = startSchedulerScoringLockHolder();
    await waitWithDeadline(
      holder.ready,
      schedulerProcessCloseTimeoutMs,
      "Scheduler scoring lock holder did not become ready.",
    );
    createSchedulerProcessContainer(runtime.runtimeDirectory);
    containerCreated = true;
    requireSuccess(
      docker(["start", schedulerProcessContainerName], { timeout: 15_000 }),
      "scheduler signal container start",
    );
    await waitForSchedulerSignalDatabaseWait();
    assertSchedulerSeasonStarts(
      expectedSeasonStarts,
      "the host clock must retain the reviewed scheduler season targets through signal delivery",
    );

    requireSuccess(
      docker(["kill", "--signal", "SIGTERM", schedulerProcessContainerName], {
        timeout: 10_000,
      }),
      "scheduler signal delivery",
    );
    await stopSchedulerScoringLockHolder(holder, true);
    holderReleased = true;

    const state = await waitForSchedulerProcessContainerExit();
    assert.equal(state.Status, "exited");
    assert.equal(state.ExitCode, 0, "the OS-signalled scheduler must exit successfully");
    assert.equal(state.OOMKilled, false);
    assert.equal(state.Error, "");
    assert.equal(
      readSchedulerProcessContainerOutput(),
      "",
      "the OS-signalled scheduler must remain silent through graceful exit",
    );
    assert.equal(
      psqlScalar(
        `SELECT pg_catalog.count(*)::integer
FROM pg_catalog.pg_stat_activity
WHERE application_name = 'viberacing-jobs-community-maintenance'
  AND usename = '${jobsLogin}';`,
        "emitted scheduler signal released-session verification",
      ),
      "0",
      "graceful exit must release the exact Jobs database session",
    );
    assert.equal(
      psqlScalar(
        `SET ROLE viberacing_owner;
SELECT pg_catalog.concat(
  (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.season_entries
    WHERE season_start = DATE '${expectedSeasonStarts.current}'
  ),
  ':',
  (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.season_daily_scores
    WHERE season_start = DATE '${expectedSeasonStarts.current}'
  ),
  ':',
  (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.pairing_request_windows
    WHERE operation = 'poll'
      AND bucket IN (-1, 5)
      AND attempt_count > 0
      AND window_started_at < pg_catalog.statement_timestamp() - INTERVAL '1 hour'
  )
);`,
        "emitted scheduler signal omitted-job marker",
      ),
      "0:0:2",
      "SIGTERM must settle the active finalization without starting refresh or later jobs",
    );
  } finally {
    try {
      if (holder !== undefined && !holderReleased) {
        await stopSchedulerScoringLockHolder(holder, false).catch(() => undefined);
      }
    } finally {
      try {
        if (containerCreated || schedulerProcessContainerExists()) {
          removeSchedulerProcessContainer(true);
        }
      } finally {
        removePortableSchedulerRuntime(runtime);
      }
    }
  }
}

async function waitWithDeadline(promise, milliseconds, message) {
  let timeoutToken;
  const timeout = new Promise((_, reject) => {
    timeoutToken = setTimeout(() => {
      reject(new Error(message));
    }, milliseconds);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutToken);
  }
}

async function runSchedulerTimerCycle({ databasePort, expectedJobs, modules, nowEpochMs }) {
  assert.equal(expectedJobs.length, 18, "the timer integration requires the closed catalog");
  const recurringExpectedJobs = Object.freeze(expectedJobs.slice(1));
  assert.equal(recurringExpectedJobs.length, 17, "the repeated hour must omit daily finalization");
  const nextHourEpochMs = (Math.floor(nowEpochMs / oneHourMs) + 1) * oneHourMs;
  assert.equal(
    new Date(nextHourEpochMs).toISOString().slice(0, 10),
    new Date(nowEpochMs).toISOString().slice(0, 10),
    "the repeated timer callback must stay on the fixed UTC day",
  );

  const configuredRunner = modules.jobs.createConfiguredCommunityMaintenanceRunner(
    jobsEnvironment(databasePort, jobsLogin, jobsPassword),
  );
  const attemptedJobs = [];
  const outcomes = [];
  const schedulerSignals = [];
  const dueCalls = [];
  const intervalHandlers = [];
  const intervalToken = Object.freeze({ schedulerTimerIntegration: true });
  let currentNowEpochMs = nowEpochMs;
  let clearedIntervals = 0;
  let runnerCloses = 0;
  let resolveInitialCycle;
  let resolveRecurringCycle;
  let resolveSameSlotCycle;
  const initialCycleSettled = new Promise((resolve) => {
    resolveInitialCycle = resolve;
  });
  const recurringCycleSettled = new Promise((resolve) => {
    resolveRecurringCycle = resolve;
  });
  const sameSlotCycleObserved = new Promise((resolve) => {
    resolveSameSlotCycle = resolve;
  });
  const productionSchedule = modules.scheduler.createMaintenanceSchedule();
  const schedule = Object.freeze({
    due: (clock) => {
      const jobs = productionSchedule.due(clock);
      dueCalls.push(Object.freeze({ clock, jobs }));
      if (dueCalls.length === 3) {
        resolveSameSlotCycle();
      }
      return jobs;
    },
  });
  const runner = Object.freeze({
    close: async () => {
      runnerCloses += 1;
      await configuredRunner.close();
    },
    execute: async (job) => {
      attemptedJobs.push(job);
      try {
        const result = await configuredRunner.execute(job);
        outcomes.push("completed");
        return result;
      } catch (error) {
        outcomes.push("rejected");
        throw error;
      } finally {
        if (outcomes.length === expectedJobs.length) {
          resolveInitialCycle();
        }
        if (outcomes.length === expectedJobs.length + recurringExpectedJobs.length) {
          resolveRecurringCycle();
        }
      }
    },
  });
  const controller = await modules.scheduler.startJobsScheduler(
    Object.freeze({ enabled: true, pollIntervalMs: 60_000 }),
    Object.freeze({
      clearInterval: (token) => {
        assert.equal(token, intervalToken, "the timer integration must clear its exact interval");
        clearedIntervals += 1;
      },
      createRunner: () => runner,
      createSchedule: () => schedule,
      now: () => currentNowEpochMs,
      setInterval: (handler, milliseconds) => {
        assert.equal(
          milliseconds,
          60_000,
          "the repeated scheduler must retain its fixed poll slot",
        );
        assert.equal(typeof handler, "function");
        assert.equal(
          intervalHandlers.length,
          0,
          "the scheduler must register one interval handler",
        );
        intervalHandlers.push(handler);
        return intervalToken;
      },
      signalSink: (signal) => {
        schedulerSignals.push(signal);
      },
    }),
  );

  try {
    await waitWithDeadline(
      initialCycleSettled,
      schedulerCycleTimeoutMs,
      "Jobs scheduler initial timer cycle exceeded its fixed deadline.",
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(attemptedJobs, expectedJobs);
    assert.deepEqual(
      outcomes,
      expectedJobs.map(() => "completed"),
      "the initial timer cycle must settle every reviewed job",
    );
    assert.deepEqual(dueCalls, [Object.freeze({ clock: nowEpochMs, jobs: expectedJobs })]);
    assert.equal(intervalHandlers.length, 1);

    assert.equal(
      psqlScalar(
        `SET ROLE viberacing_owner;
WITH updated AS (
  UPDATE viberacing_private.pairing_request_windows
  SET
    window_started_at = pg_catalog.statement_timestamp() - INTERVAL '2 hours',
    attempt_count = CASE bucket WHEN -1 THEN 21 ELSE 6 END
  WHERE operation = 'poll'
    AND bucket IN (-1, 5)
  RETURNING 1
)
SELECT pg_catalog.count(*)::integer
FROM updated;`,
        "recurring scheduler rate-window rearm",
      ),
      "2",
      "the recurring cycle fixture must rearm both exact pairing windows",
    );

    currentNowEpochMs = nextHourEpochMs;
    intervalHandlers[0]();
    intervalHandlers[0]();
    await waitWithDeadline(
      recurringCycleSettled,
      schedulerCycleTimeoutMs,
      "Jobs scheduler recurring timer cycle exceeded its fixed deadline.",
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(dueCalls.length, 2, "an overlapping timer callback must be ignored");
    assert.deepEqual(attemptedJobs, [...expectedJobs, ...recurringExpectedJobs]);
    assert.deepEqual(
      outcomes,
      [...expectedJobs, ...recurringExpectedJobs].map(() => "completed"),
      "both admitted timer cycles must settle every exact job",
    );

    intervalHandlers[0]();
    await waitWithDeadline(
      sameSlotCycleObserved,
      schedulerCycleTimeoutMs,
      "Jobs scheduler same-slot timer cycle was not observed.",
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(dueCalls, [
      Object.freeze({ clock: nowEpochMs, jobs: expectedJobs }),
      Object.freeze({ clock: nextHourEpochMs, jobs: recurringExpectedJobs }),
      Object.freeze({ clock: nextHourEpochMs, jobs: Object.freeze([]) }),
    ]);
    assert.deepEqual(
      attemptedJobs,
      [...expectedJobs, ...recurringExpectedJobs],
      "the repeated fixed slot must not retry any database job",
    );
    assert.equal(
      psqlScalar(
        `SET ROLE viberacing_owner;
SELECT pg_catalog.count(*)::integer
FROM viberacing_private.pairing_request_windows
WHERE operation = 'poll'
  AND bucket IN (-1, 5)
  AND attempt_count = 0
  AND window_started_at = TIMESTAMPTZ '1970-01-01 00:00:00+00';`,
        "recurring scheduler reset marker",
      ),
      "2",
      "the admitted recurring timer cycle must persist its terminal reset",
    );
    assert.deepEqual(schedulerSignals, [], "both timer cycles must emit no failure signal");
  } finally {
    await controller.close();
  }

  assert.equal(clearedIntervals, 1, "the repeated scheduler must clear one interval on close");
  assert.equal(runnerCloses, 1, "the repeated scheduler must close the real runner exactly once");
}

async function runSchedulerLifecycle({ databasePort, expectedJobs, modules, nowEpochMs }) {
  assert.equal(expectedJobs.length, 18, "the lifecycle integration requires the closed catalog");
  const configuredRunner = modules.jobs.createConfiguredCommunityMaintenanceRunner(
    jobsEnvironment(databasePort, jobsLogin, jobsPassword),
  );
  const attemptedJobs = [];
  const outcomes = [];
  const schedulerSignals = [];
  const registeredHandlers = new Map();
  const removedSignals = [];
  const terminalEvents = [];
  const schedulerIntervalHandlers = [];
  const shutdownDeadlineHandlers = [];
  const schedulerIntervalToken = Object.freeze({ schedulerLifecycleInterval: true });
  const shutdownTimerToken = Object.freeze({ schedulerLifecycleShutdownTimer: true });
  let schedulerController;
  let schedulerIntervalsCleared = 0;
  let shutdownTimersCleared = 0;
  let runnerCloses = 0;
  let shutdownSignalRequests = 0;
  let resolveTerminal;
  const terminal = new Promise((resolveTerminalPromise) => {
    resolveTerminal = resolveTerminalPromise;
  });
  const recordTerminal = (kind, code) => {
    const event = Object.freeze({ code, kind });
    terminalEvents.push(event);
    if (terminalEvents.length === 1) {
      resolveTerminal(event);
    }
  };
  const runner = Object.freeze({
    close: async () => {
      runnerCloses += 1;
      await configuredRunner.close();
    },
    execute: async (job) => {
      attemptedJobs.push(job);
      const execution = configuredRunner.execute(job);
      if (attemptedJobs.length === expectedJobs.length - 1) {
        const handler = registeredHandlers.get("SIGTERM");
        assert.equal(
          typeof handler,
          "function",
          "the lifecycle signal must be registered before scheduler startup",
        );
        shutdownSignalRequests += 1;
        handler();
      }
      try {
        const result = await execution;
        outcomes.push("completed");
        return result;
      } catch (error) {
        outcomes.push("rejected");
        throw error;
      }
    },
  });

  await modules.scheduler.runJobsSchedulerProcess(
    Object.freeze({
      clearTimer: (token) => {
        assert.equal(token, shutdownTimerToken, "the lifecycle must clear its exact deadline");
        shutdownTimersCleared += 1;
      },
      forceExit: (code) => {
        recordTerminal("forced", code);
      },
      onSignal: (signal, handler) => {
        assert.match(signal, /^SIG(?:INT|TERM)$/);
        assert.equal(
          registeredHandlers.has(signal),
          false,
          "the lifecycle must register each signal exactly once",
        );
        registeredHandlers.set(signal, handler);
      },
      removeSignal: (signal, handler) => {
        assert.equal(
          registeredHandlers.get(signal),
          handler,
          "the lifecycle must remove the exact registered handler",
        );
        removedSignals.push(signal);
        registeredHandlers.delete(signal);
      },
      setExitCode: (code) => {
        recordTerminal("exit", code);
      },
      setTimer: (handler, milliseconds) => {
        assert.equal(
          milliseconds,
          modules.scheduler.jobsSchedulerShutdownDeadlineMs,
          "the lifecycle must retain its fixed shutdown deadline",
        );
        shutdownDeadlineHandlers.push(handler);
        return shutdownTimerToken;
      },
      start: async () => {
        assert.deepEqual(
          [...registeredHandlers.keys()],
          ["SIGINT", "SIGTERM"],
          "the lifecycle must register both handlers before scheduler startup",
        );
        assert.equal(
          registeredHandlers.get("SIGINT"),
          registeredHandlers.get("SIGTERM"),
          "both process signals must share one first-signal state machine",
        );
        schedulerController = await modules.scheduler.startJobsScheduler(
          Object.freeze({ enabled: true, pollIntervalMs: 60_000 }),
          Object.freeze({
            clearInterval: (token) => {
              assert.equal(
                token,
                schedulerIntervalToken,
                "the lifecycle scheduler must clear its exact interval",
              );
              schedulerIntervalsCleared += 1;
            },
            createRunner: () => runner,
            createSchedule: () => modules.scheduler.createMaintenanceSchedule(),
            now: () => nowEpochMs,
            setInterval: (handler, milliseconds) => {
              assert.equal(
                milliseconds,
                60_000,
                "the lifecycle scheduler must retain its fixed poll slot",
              );
              schedulerIntervalHandlers.push(handler);
              return schedulerIntervalToken;
            },
            signalSink: (signal) => {
              schedulerSignals.push(signal);
            },
          }),
        );
        return schedulerController;
      },
    }),
  );

  let terminalResult;
  try {
    terminalResult = await waitWithDeadline(
      terminal,
      schedulerCycleTimeoutMs,
      "Jobs scheduler lifecycle PostgreSQL settlement exceeded its fixed deadline.",
    );
  } finally {
    if (schedulerController !== undefined) {
      await schedulerController.close();
    }
  }

  assert.deepEqual(terminalResult, { code: 0, kind: "exit" });
  assert.deepEqual(terminalEvents, [{ code: 0, kind: "exit" }]);
  assert.equal(shutdownSignalRequests, 1, "the harness must inject only the first signal");
  assert.deepEqual(
    attemptedJobs,
    expectedJobs.slice(0, -1),
    "shutdown must settle the active job without starting the later reset",
  );
  assert.deepEqual(
    outcomes,
    expectedJobs.slice(0, -1).map(() => "completed"),
    "every job admitted before shutdown must settle successfully",
  );
  assert.deepEqual(schedulerSignals, [], "the graceful cycle must emit no failure signal");
  assert.equal(runnerCloses, 1, "graceful shutdown must close the real Jobs runner exactly once");
  assert.equal(schedulerIntervalsCleared, 1, "graceful shutdown must clear one scheduler interval");
  assert.equal(schedulerIntervalHandlers.length, 1);
  assert.equal(shutdownDeadlineHandlers.length, 1);
  assert.equal(shutdownTimersCleared, 1, "graceful shutdown must clear one process deadline");
  assert.deepEqual(removedSignals, ["SIGINT", "SIGTERM"]);
  assert.equal(registeredHandlers.size, 0, "graceful shutdown must remove both signal handlers");
  assert.equal(
    psqlScalar(
      `SET ROLE viberacing_owner;
SELECT pg_catalog.concat(
  pg_catalog.count(*) FILTER (
    WHERE attempt_count = 0
      AND window_started_at = TIMESTAMPTZ '1970-01-01 00:00:00+00'
  ),
  ':',
  pg_catalog.count(*) FILTER (
    WHERE attempt_count > 0
      AND window_started_at < pg_catalog.statement_timestamp() - INTERVAL '1 hour'
  )
)
FROM viberacing_private.pairing_request_windows
WHERE operation = 'poll'
  AND bucket IN (-1, 5);`,
      "scheduler lifecycle omitted-job marker",
    ),
    "0:2",
    "the job after the active shutdown call must not start or reset either retained row",
  );
}

async function waitForEmittedSchedulerTerminalMarker(processState) {
  const deadline = performance.now() + schedulerCycleTimeoutMs;
  while (performance.now() < deadline) {
    if (processState.outputObserved()) {
      throw new Error("Emitted Jobs scheduler process produced unexpected output.");
    }
    if (processState.hasExited()) {
      throw new Error("Emitted Jobs scheduler process exited before its terminal startup marker.");
    }
    const resetCount = psqlScalar(
      `SET ROLE viberacing_owner;
SELECT pg_catalog.count(*)::integer
FROM viberacing_private.pairing_request_windows
WHERE operation = 'poll'
  AND bucket IN (-1, 5)
  AND attempt_count = 0
  AND window_started_at = TIMESTAMPTZ '1970-01-01 00:00:00+00';`,
      "emitted scheduler terminal-job marker",
    );
    if (resetCount === "2") {
      return;
    }
    assert.match(resetCount, /^(?:0|1)$/);
    await sleep(schedulerProcessPollIntervalMs);
  }
  throw new Error(
    "Emitted Jobs scheduler process did not reach its terminal startup marker in time.",
  );
}

async function runEmittedSchedulerProcess({ databasePort, expectedSeasonStarts }) {
  assertSchedulerSeasonStarts(
    expectedSeasonStarts,
    "the host clock must retain the reviewed scheduler season targets before process startup",
  );
  const processState = startEmittedSchedulerProcess(databasePort);
  let terminalMarkerObserved = false;
  let closeResult;
  let terminationRequested = false;
  try {
    await waitForEmittedSchedulerTerminalMarker(processState);
    assertSchedulerSeasonStarts(
      expectedSeasonStarts,
      "the host clock must retain the reviewed scheduler season targets through process execution",
    );
    terminalMarkerObserved = true;
  } finally {
    if (!processState.hasExited()) {
      terminationRequested = processState.child.kill("SIGKILL");
    }
    closeResult = await waitWithDeadline(
      processState.closed,
      schedulerProcessCloseTimeoutMs,
      "Emitted Jobs scheduler process did not terminate and close stdio within its fixed test deadline.",
    );
  }
  assert.equal(terminalMarkerObserved, true);
  assert.equal(
    terminationRequested,
    true,
    "the synthetic harness must terminate only its emitted scheduler child",
  );
  assert.equal(
    processState.outputObserved(),
    false,
    "the scheduler process must remain silent through its terminal marker and stdio close",
  );
  assert.deepEqual(
    closeResult,
    { code: null, signal: "SIGKILL" },
    "the synthetic harness must end the otherwise persistent scheduler only after its terminal marker",
  );
}

function readLatestOpenSeasonRefreshEpochMs(label) {
  const rawEpochMs = psqlScalar(
    `SET ROLE viberacing_owner;
SELECT COALESCE(
  (EXTRACT(EPOCH FROM pg_catalog.max(refreshed_at)) * 1000)::bigint,
  (-1)::bigint
)::text
FROM viberacing_private.seasons
WHERE state = 'open';`,
    label,
  );
  assert.match(rawEpochMs, /^\d{13}$/);
  const epochMs = Number(rawEpochMs);
  assert.equal(Number.isSafeInteger(epochMs), true);
  return epochMs;
}

async function waitForEmittedSchedulerRefreshDatabaseWait(processState) {
  const deadline = performance.now() + schedulerWallClockTimeoutMs;
  while (performance.now() < deadline) {
    if (processState.outputObserved()) {
      throw new Error("Emitted Jobs scheduler process produced output before recurring refresh.");
    }
    if (processState.hasExited()) {
      throw new Error("Emitted Jobs scheduler process exited before recurring refresh.");
    }
    const observed = psqlScalar(
      `SELECT pg_catalog.concat(
  pg_catalog.count(*),
  ':',
  pg_catalog.count(*) FILTER (
    WHERE state = 'active'
      AND wait_event_type = 'Lock'
      AND query LIKE '%viberacing_api.refresh_community_season%'
  )
)
FROM pg_catalog.pg_stat_activity
WHERE application_name = 'viberacing-jobs-community-maintenance'
  AND usename = '${jobsLogin}';`,
      "emitted scheduler wall-clock database-wait observation",
    );
    if (observed === "1:1") {
      return Date.now();
    }
    assert.match(observed, /^(?:0:0|1:0)$/);
    await sleep(schedulerWallClockPollIntervalMs);
  }
  throw new Error("Emitted Jobs scheduler did not reach a recurring refresh database wait.");
}

async function waitForEmittedSchedulerSessionRelease() {
  const deadline = performance.now() + schedulerProcessCloseTimeoutMs;
  while (performance.now() < deadline) {
    const sessionCount = psqlScalar(
      `SELECT pg_catalog.count(*)::integer
FROM pg_catalog.pg_stat_activity
WHERE application_name = 'viberacing-jobs-community-maintenance'
  AND usename = '${jobsLogin}';`,
      "emitted scheduler released-session observation",
    );
    if (sessionCount === "0") {
      return;
    }
    assert.equal(sessionCount, "1");
    await sleep(schedulerProcessPollIntervalMs);
  }
  throw new Error("Emitted Jobs scheduler session was not released after graceful exit.");
}

async function runEmittedSchedulerWallClockProcess({ expectedSeasonStarts }) {
  assertSchedulerSeasonStarts(
    expectedSeasonStarts,
    "the host clock must retain the reviewed scheduler season targets before wall-clock startup",
  );
  const runtime = createPortableSchedulerRuntime();
  let containerCreated = false;
  let holder;
  let holderReleased = false;
  try {
    createSchedulerProcessContainer(runtime.runtimeDirectory);
    containerCreated = true;
    const processStartedAtEpochMs = Date.now();
    requireSuccess(
      docker(["start", schedulerProcessContainerName], { timeout: 15_000 }),
      "scheduler wall-clock container start",
    );
    const processState = createSchedulerProcessContainerState();
    await waitForEmittedSchedulerTerminalMarker(processState);
    const startupRefreshEpochMs = readLatestOpenSeasonRefreshEpochMs(
      "emitted scheduler startup-refresh timestamp",
    );
    holder = startSchedulerScoringLockHolder();
    await waitWithDeadline(
      holder.ready,
      schedulerProcessCloseTimeoutMs,
      "Scheduler scoring lock holder did not become ready.",
    );

    const recurringWaitEpochMs = await waitForEmittedSchedulerRefreshDatabaseWait(processState);
    assert.equal(
      Math.floor(recurringWaitEpochMs / fiveMinutesMs) >
        Math.floor(processStartedAtEpochMs / fiveMinutesMs),
      true,
      "the recurring refresh must be admitted in a later real host-clock five-minute slot",
    );
    assertSchedulerSeasonStarts(
      expectedSeasonStarts,
      "the host clock must retain the reviewed scheduler season targets through recurring signal delivery",
    );

    requireSuccess(
      docker(["kill", "--signal", "SIGTERM", schedulerProcessContainerName], {
        timeout: 10_000,
      }),
      "scheduler wall-clock signal delivery",
    );
    await stopSchedulerScoringLockHolder(holder, true);
    holderReleased = true;

    const state = await waitForSchedulerProcessContainerExit();
    assert.equal(state.Status, "exited");
    assert.equal(state.ExitCode, 0, "the recurring OS-signalled scheduler must exit successfully");
    assert.equal(state.OOMKilled, false);
    assert.equal(state.Error, "");
    assert.equal(
      readSchedulerProcessContainerOutput(),
      "",
      "the recurring OS-signalled scheduler must remain silent through graceful exit",
    );
    const recurringRefreshEpochMs = readLatestOpenSeasonRefreshEpochMs(
      "emitted scheduler recurring-refresh settlement timestamp",
    );
    assert.equal(
      recurringRefreshEpochMs > startupRefreshEpochMs,
      true,
      "graceful SIGTERM settlement must commit the active recurring refresh",
    );
    await waitForEmittedSchedulerSessionRelease();
  } finally {
    try {
      if (holder !== undefined && !holderReleased) {
        await stopSchedulerScoringLockHolder(holder, false).catch(() => undefined);
      }
    } finally {
      try {
        if (containerCreated || schedulerProcessContainerExists()) {
          removeSchedulerProcessContainer(true);
        }
      } finally {
        removePortableSchedulerRuntime(runtime);
      }
    }
  }
}

function seedSyntheticState(currentSeasonStart) {
  psql(
    `BEGIN;
SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.auth_challenges (
  challenge_id,
  purpose,
  challenge_digest,
  context_digest,
  created_at,
  expires_at
)
VALUES (
  '${fixture.authChallengeId}',
  'passkey_login',
  pg_catalog.decode(pg_catalog.repeat('11', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('12', 32), 'hex'),
  pg_catalog.statement_timestamp() - INTERVAL '10 minutes',
  pg_catalog.statement_timestamp() - INTERVAL '5 minutes'
);

INSERT INTO viberacing_private.audit_events (
  audit_event_id,
  event_type,
  actor_kind,
  request_id,
  occurred_at
)
VALUES (
  '${fixture.auditEventId}',
  'session.revoked',
  'system',
  'req_' || pg_catalog.repeat('K', 22),
  pg_catalog.statement_timestamp() - INTERVAL '200 days'
);

INSERT INTO viberacing_private.invites (
  invite_id,
  verifier_digest,
  created_at,
  expires_at
)
VALUES (
  '${fixture.inviteId}',
  pg_catalog.decode(pg_catalog.repeat('71', 32), 'hex'),
  pg_catalog.statement_timestamp() - INTERVAL '2 hours',
  pg_catalog.statement_timestamp() - INTERVAL '1 hour'
);

INSERT INTO viberacing_private.profiles (profile_id, github_user_id, handle, state)
VALUES
  ('${fixture.abandonedProfileId}', 900000000000031952, 'jobs-it-abandoned', 'enrolling'),
  ('${fixture.carProfileId}', 900000000000031201, 'jobs-it-car', 'active'),
  ('${fixture.finalizedSourceProfileId}', 900000000000031954, 'jobs-it-source-ret', 'active'),
  ('${fixture.sessionProfileId}', 900000000000031602, 'jobs-it-session', 'active'),
  ('${fixture.scoringProfileId}', 900000000000031501, 'jobs-it-score', 'active');

INSERT INTO viberacing_private.invites (
  invite_id,
  verifier_digest,
  state,
  created_at,
  expires_at,
  redeemed_at,
  redeemed_profile_id
)
VALUES (
  '${fixture.abandonedInviteId}',
  pg_catalog.decode(pg_catalog.repeat('95', 32), 'hex'),
  'redeemed',
  pg_catalog.statement_timestamp() - INTERVAL '3 hours',
  pg_catalog.statement_timestamp() - INTERVAL '2 hours',
  pg_catalog.statement_timestamp() - INTERVAL '2 hours',
  '${fixture.abandonedProfileId}'
);

INSERT INTO viberacing_private.passkeys (
  passkey_id,
  profile_id,
  credential_id,
  cose_public_key,
  label,
  created_at,
  state,
  revoked_at
)
VALUES
  (
    '${fixture.provenancePasskeyId}',
    '${fixture.sessionProfileId}',
    pg_catalog.decode(pg_catalog.repeat('A1', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('A2', 64), 'hex'),
    'Synthetic provenance passkey',
    pg_catalog.statement_timestamp() - INTERVAL '210 days',
    'active',
    NULL
  ),
  (
    '${fixture.revokedPasskeyId}',
    '${fixture.sessionProfileId}',
    pg_catalog.decode(pg_catalog.repeat('B1', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('B2', 64), 'hex'),
    'Synthetic old revoked passkey',
    pg_catalog.statement_timestamp() - INTERVAL '210 days',
    'revoked',
    pg_catalog.statement_timestamp() - INTERVAL '200 days'
  );

INSERT INTO viberacing_private.profiles (
  profile_id,
  github_user_id,
  handle,
  state,
  created_at,
  updated_at,
  hidden_at,
  deletion_requested_at
)
VALUES (
  '${fixture.purgeProfileId}',
  900000000000031402,
  'jobs-it-purge',
  'deletion_pending',
  pg_catalog.statement_timestamp() - INTERVAL '2 hours',
  pg_catalog.statement_timestamp() - INTERVAL '1 hour',
  pg_catalog.statement_timestamp() - INTERVAL '1 hour',
  pg_catalog.statement_timestamp() - INTERVAL '1 hour'
);

INSERT INTO viberacing_private.car_recipe_proposals (
  proposal_id,
  profile_id,
  schema_version,
  chassis,
  nose,
  cockpit,
  wing,
  wheels,
  palette,
  trail,
  seed,
  created_at,
  expires_at
)
VALUES (
  '${fixture.carProposalId}',
  '${fixture.carProfileId}',
  1,
  'roadster',
  'classic',
  'open',
  'none',
  'street',
  'mint',
  'none',
  31,
  pg_catalog.statement_timestamp() - INTERVAL '2 hours',
  pg_catalog.statement_timestamp() - INTERVAL '1 hour'
);

INSERT INTO viberacing_private.origin_nonces (origin_key_id, nonce_digest, expires_at)
VALUES (
  'edge_jobs_integration',
  pg_catalog.decode(pg_catalog.repeat('21', 32), 'hex'),
  pg_catalog.statement_timestamp() - INTERVAL '5 minutes'
);

UPDATE viberacing_private.pairing_request_windows
SET
  window_started_at = pg_catalog.statement_timestamp() - INTERVAL '2 hours',
  attempt_count = CASE bucket WHEN -1 THEN 21 ELSE 6 END
WHERE operation = 'poll'
  AND bucket IN (-1, 5);

INSERT INTO viberacing_private.device_keys (
  device_key_id,
  public_key,
  label,
  connector_version,
  os_family,
  architecture,
  created_at
)
VALUES (
  '${fixture.pairingDeviceKeyId}',
  pg_catalog.decode(pg_catalog.repeat('31', 32), 'hex'),
  'Synthetic expired pairing',
  '1.2.3',
  'linux',
  'x86_64',
  pg_catalog.statement_timestamp() - INTERVAL '20 minutes'
);

INSERT INTO viberacing_private.pairing_transactions (
  pairing_id,
  poll_verifier_digest,
  user_code_digest,
  challenge,
  pending_device_key_id,
  device_label,
  connector_version,
  os_family,
  architecture,
  created_at,
  expires_at
)
VALUES (
  '${fixture.pairingId}',
  pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('42', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('43', 32), 'hex'),
  '${fixture.pairingDeviceKeyId}',
  'Synthetic expired pairing',
  '1.2.3',
  'linux',
  'x86_64',
  pg_catalog.statement_timestamp() - INTERVAL '20 minutes',
  pg_catalog.statement_timestamp() - INTERVAL '10 minutes'
);

INSERT INTO viberacing_private.sessions (
  session_id,
  profile_id,
  verifier_digest,
  authentication_kind,
  authenticated_by_passkey_id,
  created_at,
  expires_at
)
VALUES
  (
    '${fixture.abandonedSessionId}',
    '${fixture.abandonedProfileId}',
    pg_catalog.decode(pg_catalog.repeat('94', 32), 'hex'),
    'enrollment',
    NULL,
    pg_catalog.statement_timestamp() - INTERVAL '2 hours',
    pg_catalog.statement_timestamp() - INTERVAL '1 hour'
  ),
  (
    '${fixture.sessionId}',
    '${fixture.sessionProfileId}',
    pg_catalog.decode(pg_catalog.repeat('51', 32), 'hex'),
    'enrollment',
    NULL,
    pg_catalog.statement_timestamp() - INTERVAL '2 hours',
    pg_catalog.statement_timestamp() - INTERVAL '1 hour'
  ),
  (
    '${fixture.provenanceSessionId}',
    '${fixture.sessionProfileId}',
    pg_catalog.decode(pg_catalog.repeat('A3', 32), 'hex'),
    'passkey',
    '${fixture.provenancePasskeyId}',
    pg_catalog.statement_timestamp() - INTERVAL '210 days',
    pg_catalog.statement_timestamp() - INTERVAL '190 days'
  );

INSERT INTO viberacing_private.codex_sources (source_id, profile_id)
VALUES (
  'src_' || pg_catalog.repeat('V', 22),
  '${fixture.sessionProfileId}'
);

INSERT INTO viberacing_private.device_keys (
  device_key_id,
  public_key,
  label,
  connector_version,
  os_family,
  architecture,
  created_at
)
VALUES
  (
    '${fixture.provenanceDeviceKeyId}',
    pg_catalog.decode(pg_catalog.repeat('A4', 32), 'hex'),
    'Synthetic provenance device',
    '9.0.0',
    'linux',
    'x86_64',
    pg_catalog.statement_timestamp() - INTERVAL '202 days'
  ),
  (
    '${fixture.revokedDeviceKeyId}',
    pg_catalog.decode(pg_catalog.repeat('C1', 32), 'hex'),
    'Synthetic old revoked device',
    '9.0.1',
    'linux',
    'x86_64',
    pg_catalog.statement_timestamp() - INTERVAL '202 days'
  );

INSERT INTO viberacing_private.pairing_transactions (
  pairing_id,
  poll_verifier_digest,
  user_code_digest,
  challenge,
  pending_device_key_id,
  device_label,
  connector_version,
  os_family,
  architecture,
  created_at,
  expires_at
)
VALUES
  (
    '${fixture.provenancePairingId}',
    pg_catalog.decode(pg_catalog.repeat('A5', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('A6', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('A7', 32), 'hex'),
    '${fixture.provenanceDeviceKeyId}',
    'Synthetic provenance device',
    '9.0.0',
    'linux',
    'x86_64',
    pg_catalog.statement_timestamp() - INTERVAL '202 days',
    pg_catalog.statement_timestamp() - INTERVAL '199 days'
  ),
  (
    '${fixture.revokedDevicePairingId}',
    pg_catalog.decode(pg_catalog.repeat('C2', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('C3', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('C4', 32), 'hex'),
    '${fixture.revokedDeviceKeyId}',
    'Synthetic old revoked device',
    '9.0.1',
    'linux',
    'x86_64',
    pg_catalog.statement_timestamp() - INTERVAL '202 days',
    pg_catalog.statement_timestamp() - INTERVAL '199 days'
  );

UPDATE viberacing_private.pairing_transactions
SET
  state = 'approved',
  approved_profile_id = '${fixture.sessionProfileId}',
  source_choice = 'existing',
  approved_source_id = 'src_' || pg_catalog.repeat('V', 22),
  approved_by_session_id = '${fixture.provenanceSessionId}',
  approved_by_passkey_id = '${fixture.provenancePasskeyId}',
  approved_at = pg_catalog.statement_timestamp() - INTERVAL '201 days'
WHERE pairing_id = '${fixture.provenancePairingId}';

UPDATE viberacing_private.pairing_transactions
SET
  state = 'approved',
  approved_profile_id = '${fixture.sessionProfileId}',
  source_choice = 'existing',
  approved_source_id = 'src_' || pg_catalog.repeat('V', 22),
  approved_by_session_id = '${fixture.provenanceSessionId}',
  approved_by_passkey_id = '${fixture.provenancePasskeyId}',
  approved_at = pg_catalog.statement_timestamp() - INTERVAL '201 days'
WHERE pairing_id = '${fixture.revokedDevicePairingId}';

UPDATE viberacing_private.device_keys
SET
  state = 'active',
  source_id = 'src_' || pg_catalog.repeat('V', 22),
  device_id = 'dev_' || pg_catalog.repeat('V', 22),
  activated_at = pg_catalog.statement_timestamp() - INTERVAL '200 days'
WHERE device_key_id = '${fixture.provenanceDeviceKeyId}';

UPDATE viberacing_private.device_keys
SET
  state = 'active',
  source_id = 'src_' || pg_catalog.repeat('V', 22),
  device_id = 'dev_' || pg_catalog.repeat('W', 22),
  activated_at = pg_catalog.statement_timestamp() - INTERVAL '200 days'
WHERE device_key_id = '${fixture.revokedDeviceKeyId}';

UPDATE viberacing_private.pairing_transactions
SET
  state = 'activated',
  activated_device_id = 'dev_' || pg_catalog.repeat('V', 22),
  activated_at = pg_catalog.statement_timestamp() - INTERVAL '200 days'
WHERE pairing_id = '${fixture.provenancePairingId}';

UPDATE viberacing_private.pairing_transactions
SET
  state = 'activated',
  activated_device_id = 'dev_' || pg_catalog.repeat('W', 22),
  activated_at = pg_catalog.statement_timestamp() - INTERVAL '200 days'
WHERE pairing_id = '${fixture.revokedDevicePairingId}';

UPDATE viberacing_private.device_keys
SET
  state = 'revoked',
  revoked_at = pg_catalog.statement_timestamp() - INTERVAL '190 days'
WHERE device_key_id = '${fixture.revokedDeviceKeyId}';

INSERT INTO viberacing_private.deletion_jobs (
  deletion_job_id,
  profile_id,
  profile_ref_digest,
  requested_at,
  available_at
)
VALUES (
  '${fixture.purgeJobId}',
  '${fixture.purgeProfileId}',
  pg_catalog.decode(pg_catalog.repeat('61', 32), 'hex'),
  pg_catalog.statement_timestamp() - INTERVAL '1 hour',
  pg_catalog.statement_timestamp() - INTERVAL '1 hour'
);

INSERT INTO viberacing_private.deletion_jobs (
  deletion_job_id,
  profile_ref_digest,
  state,
  requested_at,
  available_at,
  completed_at
)
VALUES (
  '${fixture.terminalDeletionJobId}',
  pg_catalog.decode(pg_catalog.repeat('81', 32), 'hex'),
  'purged',
  pg_catalog.statement_timestamp() - INTERVAL '50 days',
  pg_catalog.statement_timestamp() - INTERVAL '50 days',
  pg_catalog.statement_timestamp() - INTERVAL '40 days'
);

INSERT INTO viberacing_private.codex_sources (source_id, profile_id)
VALUES
  ('src_' || pg_catalog.repeat('J', 22), '${fixture.scoringProfileId}'),
  ('src_' || pg_catalog.repeat('Q', 22), '${fixture.scoringProfileId}'),
  (
    'src_' || pg_catalog.lpad('31954', 22, 'R'),
    '${fixture.finalizedSourceProfileId}'
  );

INSERT INTO viberacing_private.source_day_values (
  source_id,
  codex_reported_date,
  tokens,
  accepted_sync_id,
  accepted_device_id,
  first_accepted_at,
  last_accepted_at
)
VALUES
  (
    'src_' || pg_catalog.repeat('J', 22),
    DATE '${currentSeasonStart}',
    12345,
    'syn_' || pg_catalog.repeat('J', 22),
    'dev_' || pg_catalog.repeat('J', 22),
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp()
  ),
  (
    'src_' || pg_catalog.lpad('31954', 22, 'R'),
    DATE '2001-01-08',
    67890,
    'syn_' || pg_catalog.lpad('31954', 22, 'R'),
    'dev_' || pg_catalog.lpad('31954', 22, 'R'),
    TIMESTAMPTZ '2001-01-10 08:00:00+00',
    TIMESTAMPTZ '2001-01-10 09:00:00+00'
  ),
  (
    'src_' || pg_catalog.repeat('Q', 22),
    DATE '2001-02-05',
    23456,
    'syn_' || pg_catalog.repeat('Q', 22),
    'dev_' || pg_catalog.repeat('Q', 22),
    TIMESTAMPTZ '2001-02-06 08:00:00+00',
    TIMESTAMPTZ '2001-02-06 09:00:00+00'
  );

INSERT INTO viberacing_private.seasons (
  season_start,
  season_end,
  score_version,
  created_at,
  refreshed_at,
  grace_ends_at
)
VALUES (
  DATE '2001-01-08',
  DATE '2001-01-14',
  'community_v1',
  TIMESTAMPTZ '2001-01-08 00:00:00+00',
  TIMESTAMPTZ '2001-01-17 00:30:00+00',
  viberacing_private.community_season_grace_ends_at(DATE '2001-01-08')
);

UPDATE viberacing_private.seasons
SET state = 'finalized',
  finalized_at = TIMESTAMPTZ '2001-01-17 01:00:00+00'
WHERE season_start = DATE '2001-01-08';
COMMIT;`,
    "synthetic Jobs integration fixture",
  );
}

async function main() {
  buildWorkspace("apps/jobs", "Jobs production build");
  if (integrationMode !== "commands") {
    buildWorkspace("apps/jobs-scheduler", "Jobs scheduler production build");
  }

  let containerStarted = false;
  let primaryFailure;
  let cleanupFailure;

  try {
    const start = docker(
      [
        ...composePrefix,
        "run",
        "--detach",
        "--no-deps",
        "--name",
        containerName,
        "--publish",
        "127.0.0.1::5432",
        "postgres-test",
      ],
      { timeout: 120_000 },
    );
    requireSuccess(start, "isolated PostgreSQL start");
    containerStarted = true;
    await waitForHealthyContainer();
    const databasePort = readPublishedPostgresPort();

    psql(
      readFileSync(resolve(root, "database", "roles", "bootstrap.sql"), "utf8"),
      "database role bootstrap",
    );
    for (const migration of loadReviewedMigrations()) {
      psql(migration.sql, migration.label);
    }

    psql(
      `BEGIN;
CREATE ROLE ${extraRole} NOLOGIN;
CREATE ROLE ${jobsLogin}
  WITH LOGIN PASSWORD '${jobsPassword}'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
GRANT viberacing_jobs TO ${jobsLogin} WITH INHERIT FALSE, SET TRUE;
GRANT CONNECT ON DATABASE ${databaseName} TO ${jobsLogin};
ALTER ROLE ${jobsLogin} IN DATABASE ${databaseName}
  SET search_path TO pg_catalog, pg_temp;

CREATE ROLE ${wideJobsLogin}
  WITH LOGIN PASSWORD '${wideJobsPassword}'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
GRANT viberacing_jobs TO ${wideJobsLogin} WITH INHERIT FALSE, SET TRUE;
GRANT ${extraRole} TO ${wideJobsLogin};
GRANT CONNECT ON DATABASE ${databaseName} TO ${wideJobsLogin};
ALTER ROLE ${wideJobsLogin} IN DATABASE ${databaseName}
  SET search_path TO pg_catalog, pg_temp;
COMMIT;`,
      "narrow and deliberately widened synthetic Jobs logins",
    );

    let currentSeasonStart;
    let finalizedSeasonStart = defaultFinalizedSeasonStart;
    let schedulerExpectedJobs;
    let schedulerModules;
    let schedulerNowEpochMs;
    let schedulerSeasonStarts;
    const usesFixedClockScheduler =
      integrationMode === "scheduler" ||
      integrationMode === "scheduler_lifecycle" ||
      integrationMode === "scheduler_timer";
    if (usesFixedClockScheduler) {
      const databaseDate = psqlScalar(
        "SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date::text;",
        "scheduler database-date discovery",
      );
      assert.match(databaseDate, /^\d{4}-\d{2}-\d{2}$/);
      schedulerNowEpochMs = Date.parse(`${databaseDate}T12:00:00.000Z`);
      assert.equal(Number.isSafeInteger(schedulerNowEpochMs), true);
      schedulerModules = await loadSchedulerModules();
      const scheduledJobs = schedulerModules.scheduler
        .createMaintenanceSchedule()
        .due(schedulerNowEpochMs);
      schedulerSeasonStarts = expectedSchedulerSeasonStarts(schedulerNowEpochMs);
      currentSeasonStart = schedulerSeasonStarts.current;
      finalizedSeasonStart = schedulerSeasonStarts.finalization;
      schedulerExpectedJobs = expectedSchedulerCatalog(currentSeasonStart, finalizedSeasonStart);
      assert.deepEqual(
        scheduledJobs,
        schedulerExpectedJobs,
        "the combined catalog must match all 18 independently reviewed jobs in order",
      );
    } else if (
      integrationMode === "scheduler_process" ||
      integrationMode === "scheduler_signal_process" ||
      integrationMode === "scheduler_wall_clock_process"
    ) {
      const databaseDate = psqlScalar(
        "SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date::text;",
        "emitted scheduler database-date discovery",
      );
      const hostNowEpochMs = Date.now();
      assert.equal(
        new Date(hostNowEpochMs).toISOString().slice(0, 10),
        databaseDate,
        "the host and disposable database clocks must agree on the UTC date",
      );
      schedulerSeasonStarts = expectedSchedulerSeasonStarts(hostNowEpochMs);
      currentSeasonStart = schedulerSeasonStarts.current;
      finalizedSeasonStart = schedulerSeasonStarts.finalization;
    } else {
      currentSeasonStart = psqlScalar(
        `SELECT (
  CURRENT_DATE - (pg_catalog.date_part('isodow', CURRENT_DATE)::integer - 1)
)::text;`,
        "current Community season discovery",
      );
    }
    assertCanonicalMonday(currentSeasonStart);
    assertCanonicalMonday(finalizedSeasonStart);
    seedSyntheticState(currentSeasonStart);

    if (usesFixedClockScheduler) {
      const stateBeforeRejectedCatalog = readPrivateStateFingerprint(
        "pre-rejection private-state fingerprint",
      );
      await runSchedulerCycle({
        databasePort,
        expectedJobs: schedulerExpectedJobs,
        expectFailure: true,
        login: wideJobsLogin,
        modules: schedulerModules,
        nowEpochMs: schedulerNowEpochMs,
        password: wideJobsPassword,
      });
      assert.equal(
        readPrivateStateFingerprint("post-rejection private-state fingerprint"),
        stateBeforeRejectedCatalog,
        "the widened login must not mutate any private table through the scheduler catalog",
      );
    } else {
      const rejected = runJobsCommand(databasePort, wideJobsLogin, wideJobsPassword, [
        "reset-expired-pairing-request-windows",
      ]);
      assertRejectedCommand(rejected, "widened Jobs login");
      assert.equal(
        psqlScalar(
          `SET ROLE viberacing_owner;
SELECT (
  (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.device_keys
    WHERE device_key_id = '${fixture.revokedDeviceKeyId}'
      AND state = 'revoked'
  ) + (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = '${fixture.revokedDevicePairingId}'
      AND state = 'activated'
  ) + (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.pairing_request_windows
    WHERE operation = 'poll'
      AND bucket IN (-1, 5)
      AND attempt_count > 0
      AND window_started_at < pg_catalog.statement_timestamp() - INTERVAL '1 hour'
  )
)::integer;`,
          "rejected-login stored-state verification",
        ),
        "4",
        "the runtime probe must fail before the requested reset or retained-row cleanup mutates state",
      );
    }

    if (integrationMode === "scheduler") {
      await runSchedulerCycle({
        databasePort,
        expectedJobs: schedulerExpectedJobs,
        expectFailure: false,
        login: jobsLogin,
        modules: schedulerModules,
        nowEpochMs: schedulerNowEpochMs,
        password: jobsPassword,
      });
    } else if (integrationMode === "scheduler_timer") {
      await runSchedulerTimerCycle({
        databasePort,
        expectedJobs: schedulerExpectedJobs,
        modules: schedulerModules,
        nowEpochMs: schedulerNowEpochMs,
      });
    } else if (integrationMode === "scheduler_lifecycle") {
      await runSchedulerLifecycle({
        databasePort,
        expectedJobs: schedulerExpectedJobs,
        modules: schedulerModules,
        nowEpochMs: schedulerNowEpochMs,
      });
      const reset = runJobsCommand(databasePort, jobsLogin, jobsPassword, [
        "reset-expired-pairing-request-windows",
      ]);
      assertSuccessfulCommand(reset, "post-lifecycle omitted Jobs command");
    } else if (integrationMode === "scheduler_process") {
      await runEmittedSchedulerProcess({
        databasePort,
        expectedSeasonStarts: schedulerSeasonStarts,
      });
    } else if (integrationMode === "scheduler_wall_clock_process") {
      await runEmittedSchedulerWallClockProcess({
        expectedSeasonStarts: schedulerSeasonStarts,
      });
    } else if (integrationMode === "scheduler_signal_process") {
      await runEmittedSchedulerSignalProcess({ expectedSeasonStarts: schedulerSeasonStarts });
      const omittedCommands = [
        ["finalize-community-backlog"],
        ["refresh-community-season", currentSeasonStart],
        ["purge-profile-deletions"],
        ["cleanup-expired-auth-state"],
        ["cleanup-expired-ingest-state"],
        ["cleanup-expired-pairing-state"],
        ["cleanup-expired-car-recipe-proposals"],
        ["redact-aged-pairing-approval-provenance"],
        ["cleanup-expired-sessions"],
        ["cleanup-expired-invites"],
        ["cleanup-abandoned-enrollments"],
        ["cleanup-finalized-source-day-values"],
        ["cleanup-terminal-deletion-jobs"],
        ["cleanup-expired-audit-events"],
        ["cleanup-aged-revoked-passkeys"],
        ["cleanup-aged-revoked-devices"],
        ["reset-expired-pairing-request-windows"],
      ];
      for (const args of omittedCommands) {
        const result = runJobsCommand(databasePort, jobsLogin, jobsPassword, args);
        assertSuccessfulCommand(result, `post-signal omitted Jobs command ${args[0]}`);
      }
    } else {
      const commands = [
        ["finalize-community-backlog"],
        ["cleanup-expired-auth-state"],
        ["cleanup-expired-audit-events"],
        ["cleanup-expired-car-recipe-proposals"],
        ["cleanup-expired-invites"],
        ["cleanup-abandoned-enrollments"],
        ["cleanup-finalized-source-day-values"],
        ["cleanup-expired-ingest-state"],
        ["cleanup-expired-pairing-state"],
        ["redact-aged-pairing-approval-provenance"],
        ["cleanup-expired-sessions"],
        ["cleanup-aged-revoked-passkeys"],
        ["cleanup-aged-revoked-devices"],
        ["reset-expired-pairing-request-windows"],
        ["purge-profile-deletions"],
        ["cleanup-terminal-deletion-jobs"],
        ["refresh-community-season", currentSeasonStart],
        ["finalize-community-season", finalizedSeasonStart],
      ];
      for (const args of commands) {
        const result = runJobsCommand(databasePort, jobsLogin, jobsPassword, args);
        assertSuccessfulCommand(result, `Jobs command ${args[0]}`);
      }
    }

    const storedState = JSON.parse(
      psqlScalar(
        `SET ROLE viberacing_owner;
SELECT pg_catalog.jsonb_build_object(
  'backlogDailyCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.season_daily_scores
    WHERE season_start = DATE '2001-02-05'
  ),
  'backlogEntryCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.season_entries
    WHERE season_start = DATE '2001-02-05'
  ),
  'backlogSeasonState', (
    SELECT state
    FROM viberacing_private.seasons
    WHERE season_start = DATE '2001-02-05'
  ),
  'backlogSourceDayTokens', (
    SELECT tokens
    FROM viberacing_private.source_day_values
    WHERE source_id = 'src_' || pg_catalog.repeat('Q', 22)
      AND codex_reported_date = DATE '2001-02-05'
  ),
  'abandonedInviteCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.invites
    WHERE invite_id = '${fixture.abandonedInviteId}'
  ),
  'abandonedProfileCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.profiles
    WHERE profile_id = '${fixture.abandonedProfileId}'
  ),
  'abandonedSessionCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.sessions
    WHERE session_id = '${fixture.abandonedSessionId}'
  ),
  'authChallengeCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.auth_challenges
    WHERE challenge_id = '${fixture.authChallengeId}'
  ),
  'auditEventCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.audit_events
    WHERE audit_event_id = '${fixture.auditEventId}'
  ),
  'carProposalCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.car_recipe_proposals
    WHERE proposal_id = '${fixture.carProposalId}'
  ),
  'finalizedSourceDayCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.source_day_values
    WHERE source_id = 'src_' || pg_catalog.lpad('31954', 22, 'R')
      AND codex_reported_date = DATE '2001-01-08'
  ),
  'finalizedSourceProjectionPurgedCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.finalized_season_profile_freshness
    WHERE season_start = DATE '2001-01-08'
      AND profile_id = '${fixture.finalizedSourceProfileId}'
      AND last_accepted_date = DATE '2001-01-10'
      AND retained_source_count = 1
      AND source_day_value_count = 1
      AND deleted_source_day_value_count = 1
      AND source_values_purged_at IS NOT NULL
  ),
  'inviteCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.invites
    WHERE invite_id = '${fixture.inviteId}'
  ),
  'originNonceCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.origin_nonces
    WHERE origin_key_id = 'edge_jobs_integration'
  ),
  'pairingCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = '${fixture.pairingId}'
  ),
  'pendingDeviceKeyCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.device_keys
    WHERE device_key_id = '${fixture.pairingDeviceKeyId}'
  ),
  'pairingRateWindowResetCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.pairing_request_windows
    WHERE operation = 'poll'
      AND bucket IN (-1, 5)
      AND attempt_count = 0
      AND window_started_at = TIMESTAMPTZ '1970-01-01 00:00:00+00'
  ),
  'provenanceDeviceCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.device_keys
    WHERE device_key_id = '${fixture.provenanceDeviceKeyId}'
      AND state = 'active'
      AND source_id = 'src_' || pg_catalog.repeat('V', 22)
      AND device_id = 'dev_' || pg_catalog.repeat('V', 22)
  ),
  'provenancePairingCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = '${fixture.provenancePairingId}'
      AND state = 'activated'
      AND approved_source_id = 'src_' || pg_catalog.repeat('V', 22)
      AND activated_device_id = 'dev_' || pg_catalog.repeat('V', 22)
  ),
  'provenancePairingRedacted', (
    SELECT approved_by_session_id IS NULL AND approved_by_passkey_id IS NULL
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = '${fixture.provenancePairingId}'
  ),
  'provenancePasskeyCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.passkeys
    WHERE passkey_id = '${fixture.provenancePasskeyId}'
      AND state = 'active'
  ),
  'provenanceSessionCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.sessions
    WHERE session_id = '${fixture.provenanceSessionId}'
  ),
  'revokedPasskeyCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.passkeys
    WHERE passkey_id = '${fixture.revokedPasskeyId}'
  ),
  'revokedDeviceCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.device_keys
    WHERE device_key_id = '${fixture.revokedDeviceKeyId}'
  ),
  'revokedDevicePairingCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = '${fixture.revokedDevicePairingId}'
  ),
  'sessionCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.sessions
    WHERE session_id = '${fixture.sessionId}'
  ),
  'purgeProfileCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.profiles
    WHERE profile_id = '${fixture.purgeProfileId}'
  ),
  'purgeJobState', (
    SELECT state
    FROM viberacing_private.deletion_jobs
    WHERE deletion_job_id = '${fixture.purgeJobId}'
  ),
  'purgeJobProfileCleared', (
    SELECT profile_id IS NULL
    FROM viberacing_private.deletion_jobs
    WHERE deletion_job_id = '${fixture.purgeJobId}'
  ),
  'purgeJobCompleted', (
    SELECT completed_at IS NOT NULL
    FROM viberacing_private.deletion_jobs
    WHERE deletion_job_id = '${fixture.purgeJobId}'
  ),
  'terminalDeletionJobCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.deletion_jobs
    WHERE deletion_job_id = '${fixture.terminalDeletionJobId}'
  ),
  'refreshSeasonState', (
    SELECT state
    FROM viberacing_private.seasons
    WHERE season_start = DATE '${currentSeasonStart}'
  ),
  'refreshEntryCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.season_entries
    WHERE season_start = DATE '${currentSeasonStart}'
  ),
  'refreshDailyCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.season_daily_scores
    WHERE season_start = DATE '${currentSeasonStart}'
  ),
  'sourceDayTokens', (
    SELECT tokens
    FROM viberacing_private.source_day_values
    WHERE source_id = 'src_' || pg_catalog.repeat('J', 22)
      AND codex_reported_date = DATE '${currentSeasonStart}'
  ),
  'finalizedSeasonState', (
    SELECT state
    FROM viberacing_private.seasons
    WHERE season_start = DATE '${finalizedSeasonStart}'
  ),
  'finalizedAtSet', (
    SELECT finalized_at IS NOT NULL
    FROM viberacing_private.seasons
    WHERE season_start = DATE '${finalizedSeasonStart}'
  ),
  'finalizedEntryCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.season_entries
    WHERE season_start = DATE '${finalizedSeasonStart}'
  )
)::text;`,
        "Jobs stored-state verification",
      ),
    );
    assert.deepEqual(storedState, {
      backlogDailyCount: 7,
      backlogEntryCount: 1,
      backlogSeasonState: "finalized",
      backlogSourceDayTokens: 23456,
      abandonedInviteCount: 0,
      abandonedProfileCount: 0,
      abandonedSessionCount: 0,
      authChallengeCount: 0,
      auditEventCount: 0,
      carProposalCount: 0,
      finalizedAtSet: true,
      finalizedEntryCount: 0,
      finalizedSeasonState: "finalized",
      finalizedSourceDayCount: 0,
      finalizedSourceProjectionPurgedCount: 1,
      inviteCount: 0,
      originNonceCount: 0,
      pairingCount: 0,
      pairingRateWindowResetCount: 2,
      pendingDeviceKeyCount: 0,
      provenanceDeviceCount: 1,
      provenancePairingCount: 1,
      provenancePairingRedacted: true,
      provenancePasskeyCount: 1,
      provenanceSessionCount: 0,
      revokedDeviceCount: 0,
      revokedDevicePairingCount: 0,
      revokedPasskeyCount: 0,
      purgeJobCompleted: true,
      purgeJobProfileCleared: true,
      purgeJobState: "purged",
      purgeProfileCount: 0,
      refreshDailyCount: 7,
      refreshEntryCount: 1,
      refreshSeasonState: "open",
      sessionCount: 0,
      sourceDayTokens: 12345,
      terminalDeletionJobCount: 0,
    });

    const successMessage =
      integrationMode === "scheduler"
        ? "Jobs scheduler PostgreSQL integration passed (exact catalog, full-state least-privilege denial, and exact stored state)."
        : integrationMode === "scheduler_timer"
          ? "Jobs scheduler timer PostgreSQL integration passed (exact recurring catalog, overlap suppression, same-slot suppression, and exact final state)."
          : integrationMode === "scheduler_lifecycle"
            ? "Jobs scheduler lifecycle PostgreSQL integration passed (active-call settlement, no later scheduler job, graceful close, and exact final state)."
            : integrationMode === "scheduler_process"
              ? "Emitted Jobs scheduler PostgreSQL integration passed (real startup clock, silent terminal catalog marker, forced test-child termination, and exact stored state)."
              : integrationMode === "scheduler_wall_clock_process"
                ? "Emitted Jobs scheduler wall-clock PostgreSQL integration passed (real host-timer recurring refresh, OS SIGTERM, active-refresh settlement, silent code-0 exit, released session, immutable runtime, and exact stored state)."
                : integrationMode === "scheduler_signal_process"
                  ? "Emitted Jobs scheduler signal PostgreSQL integration passed (OS SIGTERM, active finalization settlement, no later scheduler job, silent graceful exit, and exact final state)."
                  : "Jobs PostgreSQL integration passed (eighteen commands, least-privilege denial, generic output, and exact stored state).";
    console.log(successMessage);
  } catch (error) {
    primaryFailure = error;
  } finally {
    if (containerStarted) {
      const remove = docker(["rm", "--force", "--volumes", containerName], {
        timeout: 30_000,
      });
      if (remove.status !== 0) {
        cleanupFailure ??= new Error("isolated PostgreSQL container cleanup failed");
      }
    }
    const down = docker([...composePrefix, "down", "--volumes", "--remove-orphans"], {
      timeout: 30_000,
    });
    if (down.status !== 0) {
      cleanupFailure ??= new Error("isolated PostgreSQL network cleanup failed");
    }
  }

  if (primaryFailure !== undefined) {
    throw primaryFailure;
  }
  if (cleanupFailure !== undefined) {
    throw cleanupFailure;
  }
}

await main();

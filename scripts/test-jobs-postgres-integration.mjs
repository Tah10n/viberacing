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

const root = resolve(import.meta.dirname, "..");
const projectName = `vr-jobs-clean-it-${process.pid}`;
const databaseContainerName = `${projectName}-postgres`;
const schedulerContainerName = `${projectName}-scheduler`;
const databaseName = "viberacing_local";
const bootstrapUser = "viberacing_local";
const jobsLogin = "viberacing_jobs_login";
const jobsPassword = "synthetic-jobs-integration-password";
const wideJobsLogin = "viberacing_jobs_wide_login";
const wideJobsPassword = "synthetic-wide-jobs-integration-password";
const extraRole = "viberacing_jobs_extra";
const completedMessage = "Vibe Racing Jobs command completed.\n";
const failedMessage = "Vibe Racing Jobs command failed.\n";
const applicationName = "viberacing-jobs-maintenance";
const schedulerTimeoutMs = 120_000;
const processExitTimeoutMs = 20_000;
const composePrefix = [
  "compose",
  "--ansi",
  "never",
  "--project-name",
  projectName,
  "--profile",
  "test",
];
const schedulerImage = (() => {
  const compose = parse(readFileSync(resolve(root, "compose.yaml"), "utf8"));
  const image = compose?.services?.["node-process-signal-test"]?.image;
  assert.equal(typeof image, "string");
  assert.match(image, /^node:24\.18\.0-bookworm-slim@sha256:[a-f0-9]{64}$/);
  return image;
})();
const schedulerRuntimeInventory = Object.freeze([
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
const commandCatalog = Object.freeze([
  "ensure-current-season",
  "refresh-dirty-leaderboard",
  "finalize-due-season",
  "cleanup-expired-ranking-events",
  "cleanup-expired-usage-nonces",
  "cleanup-expired-usage-history",
  "cleanup-expired-pairing-state",
  "cleanup-expired-auth-state",
  "cleanup-aged-revoked-authority",
  "cleanup-snapshot-history",
  "purge-profile-deletions",
  "cleanup-terminal-deletion-jobs",
  "reset-expired-pairing-request-windows",
]);
const jobKindCatalog = Object.freeze(commandCatalog.map((command) => command.replaceAll("-", "_")));

function readMode() {
  const argument = process.argv[2];
  if (process.argv.length === 2) {
    return "commands";
  }
  const modes = new Map([
    ["--scheduler", "scheduler"],
    ["--scheduler-lifecycle", "scheduler_lifecycle"],
    ["--scheduler-process", "scheduler_process"],
    ["--scheduler-signal-process", "scheduler_signal_process"],
    ["--scheduler-timer", "scheduler_timer"],
    ["--scheduler-wall-clock-process", "scheduler_wall_clock_process"],
  ]);
  if (process.argv.length !== 3 || !modes.has(argument)) {
    throw new Error("Jobs PostgreSQL integration arguments failed closed.");
  }
  return modes.get(argument);
}

const mode = readMode();

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
    databaseContainerName,
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
  const result = docker(psqlArguments(), { input: sql, timeout: 60_000 });
  requireSuccess(result, label);
}

function psqlScalar(sql, label) {
  const result = docker([...psqlArguments(), "--tuples-only", "--no-align", "--command", sql], {
    timeout: 30_000,
  });
  requireSuccess(result, label);
  return result.stdout.trim();
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function waitFor(predicate, label, timeoutMs = schedulerTimeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await sleep(100);
  }
  throw new Error(`${label} exceeded its fixed deadline.`);
}

function buildWorkspace(relativePath, label) {
  const workspaceRoot = resolve(root, relativePath);
  const workspaceRequire = createRequire(resolve(workspaceRoot, "package.json"));
  const tsc = workspaceRequire.resolve("typescript/bin/tsc");
  requireSuccess(
    run(process.execPath, [tsc, "--project", "tsconfig.build.json"], {
      cwd: workspaceRoot,
    }),
    label,
  );
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
  assert.equal(manifest.migrations.length, 6);
  return manifest.migrations.map((migration) => ({
    label: `migration ${migration.revision}: ${migration.name}`,
    sql: filesByPath.get(migration.path),
  }));
}

async function waitForHealthyDatabase() {
  await waitFor(() => {
    const result = docker(
      ["inspect", "--format", "{{.State.Health.Status}}", databaseContainerName],
      { timeout: 10_000 },
    );
    return result.status === 0 && result.stdout.trim() === "healthy";
  }, "disposable PostgreSQL health");
}

function readPublishedDatabasePort() {
  const result = docker(["port", databaseContainerName, "5432/tcp"], {
    timeout: 10_000,
  });
  requireSuccess(result, "isolated PostgreSQL port discovery");
  const match = /^127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(result.stdout.trim());
  assert.notEqual(match, null);
  const port = Number(match[1]);
  assert.equal(Number.isSafeInteger(port) && port <= 65_535, true);
  return port;
}

function jobsEnvironment(databasePort, login = jobsLogin, password = jobsPassword) {
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

function schedulerContainerEnvironment() {
  return Object.freeze({
    NODE_ENV: "test",
    VIBERACING_JOBS_DATABASE_HOST: "127.0.0.1",
    VIBERACING_JOBS_DATABASE_NAME: databaseName,
    VIBERACING_JOBS_DATABASE_PASSWORD: jobsPassword,
    VIBERACING_JOBS_DATABASE_PORT: "5432",
    VIBERACING_JOBS_DATABASE_TLS_MODE: "disable",
    VIBERACING_JOBS_DATABASE_USER: jobsLogin,
    VIBERACING_JOBS_SCHEDULER_ENABLED: "true",
  });
}

function readPrivateStateFingerprint(label) {
  const state = psqlScalar(
    `CREATE TEMP TABLE jobs_clean_fingerprints (
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
    INSERT INTO jobs_clean_fingerprints (table_name, table_state)
    VALUES (private_table.table_name, table_state);
  END LOOP;
END
$fingerprint$;

SELECT pg_catalog.jsonb_object_agg(table_name, table_state ORDER BY table_name)::text
FROM jobs_clean_fingerprints;`,
    label,
  );
  assert.notEqual(state, "");
  return createHash("sha256").update(state, "utf8").digest("hex");
}

function installLogins() {
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
    "narrow and deliberately widened Jobs logins",
  );
}

function armExpiredRateWindow() {
  psql(
    `SET ROLE viberacing_owner;
UPDATE viberacing_private.pairing_request_windows
SET window_started_at = pg_catalog.clock_timestamp() - interval '2 hours',
    attempt_count = 1
WHERE operation = 'start'
  AND bucket = 0;`,
    "pairing rate-window marker",
  );
}

function rateWindowIsEmpty() {
  return (
    psqlScalar(
      `SET ROLE viberacing_owner;
SELECT pg_catalog.count(*)::text
FROM viberacing_private.pairing_request_windows
WHERE operation = 'start'
  AND bucket = 0
  AND attempt_count = 0
  AND window_started_at = TIMESTAMPTZ '1970-01-01 00:00:00+00';`,
      "pairing rate-window state",
    ) === "1"
  );
}

function currentSeasonExists() {
  return (
    psqlScalar(
      `SET ROLE viberacing_owner;
SELECT pg_catalog.count(*)::text
FROM viberacing_private.seasons
WHERE trust_tier = 'community'
  AND season_start = (
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::date
    - (
      extract(
        isodow FROM (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::date
      )::integer - 1
    )
  );`,
      "current season state",
    ) === "1"
  );
}

function runJobsCommand(databasePort, login, password, argumentsValue) {
  return run(
    process.execPath,
    [resolve(root, "apps", "jobs", "dist", "main.js"), ...argumentsValue],
    {
      env: { ...process.env, ...jobsEnvironment(databasePort, login, password) },
      timeout: 60_000,
    },
  );
}

function assertSuccessfulCommand(result, label) {
  assert.equal(result.status, 0, `${label} must succeed`);
  assert.equal(result.stdout, completedMessage, `${label} stdout`);
  assert.equal(result.stderr, "", `${label} stderr`);
}

function assertRejectedCommand(result, label) {
  assert.equal(result.status, 1, `${label} must fail closed`);
  assert.equal(result.stdout, "", `${label} stdout`);
  assert.equal(result.stderr, failedMessage, `${label} stderr`);
}

async function loadBuiltModules() {
  const jobs = await loadBuiltJobs();
  const scheduler = await import(
    pathToFileURL(resolve(root, "apps", "jobs-scheduler", "dist", "index.js")).href
  );
  return Object.freeze({ jobs, scheduler });
}

async function loadBuiltJobs() {
  return import(pathToFileURL(resolve(root, "apps", "jobs", "dist", "index.js")).href);
}

function fixedSchedulerClock() {
  const date = psqlScalar(
    "SELECT (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::date::text;",
    "database UTC date",
  );
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
  return Date.parse(`${date}T12:00:00.000Z`);
}

async function runDirectScheduler({
  cycles,
  databasePort,
  login = jobsLogin,
  password = jobsPassword,
}) {
  const modules = await loadBuiltModules();
  const environment = jobsEnvironment(databasePort, login, password);
  const realRunner = modules.jobs.createConfiguredJobsMaintenanceRunner(environment);
  const executedKinds = [];
  const results = [];
  const signals = [];
  let clock = fixedSchedulerClock();
  let intervalHandler;
  let cleared = 0;
  const intervalToken = Object.freeze({ jobsCleanSchedulerTimer: true });
  const runner = Object.freeze({
    close: () => realRunner.close(),
    async execute(job) {
      try {
        results.push(await realRunner.execute(job));
      } finally {
        executedKinds.push(job.kind);
      }
    },
  });
  const controller = await modules.scheduler.startJobsScheduler(
    Object.freeze({ enabled: true, pollIntervalMs: 60_000 }),
    Object.freeze({
      clearInterval(token) {
        assert.equal(token, intervalToken);
        cleared += 1;
      },
      createRunner: () => runner,
      createSchedule: () => modules.scheduler.createMaintenanceSchedule(),
      now: () => clock,
      setInterval(handler, milliseconds) {
        assert.equal(milliseconds, 60_000);
        intervalHandler = handler;
        return intervalToken;
      },
      signalSink: (signal) => {
        signals.push(signal);
      },
    }),
  );

  try {
    await waitFor(() => executedKinds.length >= 13, "initial real Jobs scheduler catalog");
    for (let cycle = 1; cycle < cycles; cycle += 1) {
      armExpiredRateWindow();
      clock += 60 * 60 * 1_000;
      assert.equal(typeof intervalHandler, "function");
      intervalHandler();
      await waitFor(
        () => executedKinds.length >= (cycle + 1) * 13,
        `real Jobs scheduler catalog ${cycle + 1}`,
      );
      assert.equal(rateWindowIsEmpty(), true);
    }
  } finally {
    await controller.close();
  }

  assert.equal(cleared, 1);
  assert.deepEqual(executedKinds, Array.from({ length: cycles }, () => jobKindCatalog).flat());
  return Object.freeze({ executedKinds, results, signals });
}

async function runCommandsIntegration(databasePort) {
  armExpiredRateWindow();
  const before = readPrivateStateFingerprint("pre-widened-command fingerprint");
  assertRejectedCommand(
    runJobsCommand(databasePort, wideJobsLogin, wideJobsPassword, [
      "reset-expired-pairing-request-windows",
    ]),
    "widened Jobs login",
  );
  assert.equal(
    readPrivateStateFingerprint("post-widened-command fingerprint"),
    before,
    "widened login must leave every private table unchanged",
  );

  const jobs = await loadBuiltJobs();
  const preflightRunner = jobs.createConfiguredJobsMaintenanceRunner(jobsEnvironment(databasePort));
  try {
    await preflightRunner.execute(Object.freeze({ kind: "ensure_current_season" }));
  } catch (error) {
    const diagnostic =
      error instanceof Error && "code" in error ? `${error.name}:${String(error.code)}` : "unknown";
    throw new Error(`narrow Jobs preflight failed closed with ${diagnostic}`);
  } finally {
    await preflightRunner.close();
  }

  for (const command of commandCatalog) {
    assertSuccessfulCommand(
      runJobsCommand(databasePort, jobsLogin, jobsPassword, [command]),
      command,
    );
  }
  assert.equal(currentSeasonExists(), true);
  assert.equal(rateWindowIsEmpty(), true);
  assertRejectedCommand(
    runJobsCommand(databasePort, jobsLogin, jobsPassword, ["unknown-command"]),
    "unknown Jobs command",
  );
}

async function runSchedulerIntegration(databasePort) {
  const before = readPrivateStateFingerprint("pre-widened-scheduler fingerprint");
  const rejected = await runDirectScheduler({
    cycles: 1,
    databasePort,
    login: wideJobsLogin,
    password: wideJobsPassword,
  });
  assert.deepEqual(rejected.signals, ["cycle_failed"]);
  assert.equal(rejected.results.length, 0);
  assert.equal(
    readPrivateStateFingerprint("post-widened-scheduler fingerprint"),
    before,
    "widened scheduler must leave every private table unchanged",
  );

  armExpiredRateWindow();
  const accepted = await runDirectScheduler({ cycles: 1, databasePort });
  assert.deepEqual(accepted.signals, []);
  assert.equal(accepted.results.length, 13);
  assert.equal(currentSeasonExists(), true);
  assert.equal(rateWindowIsEmpty(), true);
}

async function runTimerIntegration(databasePort) {
  armExpiredRateWindow();
  const result = await runDirectScheduler({ cycles: 2, databasePort });
  assert.deepEqual(result.signals, []);
  assert.equal(result.results.length, 26);
  assert.equal(rateWindowIsEmpty(), true);
}

async function runLifecycleIntegration(databasePort) {
  const modules = await loadBuiltModules();
  const environment = jobsEnvironment(databasePort);
  const realRunner = modules.jobs.createConfiguredJobsMaintenanceRunner(environment);
  const executedKinds = [];
  const signalHandlers = new Map();
  const removedSignals = [];
  let exitCode;
  let forcedCode;
  let intervalHandler;
  const intervalToken = Object.freeze({ lifecycleInterval: true });
  const deadlineToken = Object.freeze({ lifecycleDeadline: true });
  let controller;
  const runner = Object.freeze({
    close: () => realRunner.close(),
    async execute(job) {
      try {
        await realRunner.execute(job);
      } finally {
        executedKinds.push(job.kind);
      }
    },
  });

  await modules.scheduler.runJobsSchedulerProcess(
    Object.freeze({
      clearTimer(token) {
        assert.equal(token, deadlineToken);
      },
      forceExit(code) {
        forcedCode = code;
      },
      onSignal(signal, handler) {
        signalHandlers.set(signal, handler);
      },
      removeSignal(signal, handler) {
        assert.equal(signalHandlers.get(signal), handler);
        removedSignals.push(signal);
      },
      setExitCode(code) {
        exitCode = code;
      },
      setTimer(handler, milliseconds) {
        assert.equal(typeof handler, "function");
        assert.equal(milliseconds, modules.scheduler.jobsSchedulerShutdownDeadlineMs);
        return deadlineToken;
      },
      async start() {
        controller = await modules.scheduler.startJobsScheduler(
          Object.freeze({ enabled: true, pollIntervalMs: 60_000 }),
          Object.freeze({
            clearInterval(token) {
              assert.equal(token, intervalToken);
            },
            createRunner: () => runner,
            createSchedule: () => modules.scheduler.createMaintenanceSchedule(),
            now: () => fixedSchedulerClock(),
            setInterval(handler, milliseconds) {
              assert.equal(milliseconds, 60_000);
              intervalHandler = handler;
              return intervalToken;
            },
            signalSink: () => {
              throw new Error("lifecycle cycle unexpectedly failed");
            },
          }),
        );
        return controller;
      },
    }),
  );

  await waitFor(() => executedKinds.length === 13, "scheduler process-lifecycle catalog");
  assert.equal(typeof intervalHandler, "function");
  assert.equal(typeof signalHandlers.get("SIGTERM"), "function");
  signalHandlers.get("SIGTERM")();
  await waitFor(
    () => exitCode !== undefined || forcedCode !== undefined,
    "graceful lifecycle exit",
  );
  assert.equal(exitCode, 0);
  assert.equal(forcedCode, undefined);
  assert.deepEqual(removedSignals.sort(), ["SIGINT", "SIGTERM"]);
  assert.deepEqual(executedKinds, jobKindCatalog);
}

function createPortableSchedulerRuntime() {
  return createPortableNodeRuntime({
    entryWorkspaceDirectory: resolve(root, "apps", "jobs-scheduler"),
    expectedExternalInventory: schedulerRuntimeInventory,
    expectedWorkspaceInventory: ["@viberacing/jobs-scheduler@0.0.0", "@viberacing/jobs@0.0.0"],
    maximumFileCount: 499,
    minimumFileCount: 21,
    root,
    runtimePrefix: "jobs-clean-scheduler-runtime-",
    workspaceDirectories: [resolve(root, "apps", "jobs-scheduler"), resolve(root, "apps", "jobs")],
  });
}

function schedulerContainerExists() {
  return docker(["inspect", schedulerContainerName], { timeout: 10_000 }).status === 0;
}

function removeSchedulerContainer(force = false) {
  if (!schedulerContainerExists()) {
    return;
  }
  const argumentsValue = force
    ? ["rm", "--force", schedulerContainerName]
    : ["rm", schedulerContainerName];
  requireSuccess(
    docker(argumentsValue, { timeout: 20_000 }),
    "scheduler process container removal",
  );
}

function createSchedulerContainer(runtimeDirectory) {
  const environmentArguments = Object.entries(schedulerContainerEnvironment())
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([key, value]) => ["--env", `${key}=${value}`]);
  const bindSource = runtimeDirectory.replaceAll("\\", "/");
  const result = docker(
    [
      "create",
      "--name",
      schedulerContainerName,
      "--network",
      `container:${databaseContainerName}`,
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
      schedulerImage,
      "node",
      "/runtime/dist/main.js",
    ],
    { timeout: 30_000 },
  );
  requireSuccess(result, "scheduler process container creation");
  assert.match(result.stdout.trim(), /^[a-f0-9]{64}$/);
}

function readSchedulerContainerState() {
  const result = docker(["inspect", "--format", "{{json .State}}", schedulerContainerName], {
    timeout: 10_000,
  });
  requireSuccess(result, "scheduler process state");
  return JSON.parse(result.stdout);
}

function readSchedulerContainerOutput() {
  const result = docker(["logs", schedulerContainerName], { timeout: 10_000 });
  requireSuccess(result, "scheduler process output");
  return `${result.stdout}${result.stderr}`;
}

async function waitForSchedulerExit() {
  await waitFor(
    () => !readSchedulerContainerState().Running,
    "scheduler process exit",
    processExitTimeoutMs,
  );
  const state = readSchedulerContainerState();
  assert.equal(state.ExitCode, 0);
  assert.equal(readSchedulerContainerOutput(), "");
}

function sendSchedulerSignal() {
  requireSuccess(
    docker(["kill", "--signal", "SIGTERM", schedulerContainerName], {
      timeout: 10_000,
    }),
    "scheduler SIGTERM delivery",
  );
}

function startLockHolder() {
  const child = spawn("docker", [...psqlArguments(), "--tuples-only", "--no-align"], {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  let errorOutput = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    errorOutput += chunk;
  });
  child.stdin.write(`BEGIN;
SET ROLE viberacing_owner;
LOCK TABLE viberacing_private.seasons IN ACCESS EXCLUSIVE MODE;
SELECT 'jobs-clean-lock-ready';
`);
  return Object.freeze({
    child,
    async release() {
      child.stdin.end("COMMIT;\n");
      await waitFor(() => child.exitCode !== null, "scheduler lock-holder exit");
      assert.equal(child.exitCode, 0, errorOutput);
    },
    ready: waitFor(
      () => output.includes("jobs-clean-lock-ready"),
      "scheduler lock-holder readiness",
    ),
  });
}

function seedWallClockDirtySeason() {
  psql(
    `SET ROLE viberacing_owner;
INSERT INTO viberacing_private.ranking_refresh_outbox (
  season_start,
  trust_tier,
  dirty_since,
  last_observation_id,
  attempt_count,
  next_attempt_at,
  state
)
SELECT
  season.season_start,
  'community',
  pg_catalog.clock_timestamp() - interval '2 minutes',
  NULL,
  0,
  pg_catalog.clock_timestamp() - interval '1 minute',
  'pending'
FROM viberacing_private.seasons AS season
WHERE season.trust_tier = 'community'
  AND season.season_start = (
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::date
    - (
      extract(
        isodow FROM (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::date
      )::integer - 1
    )
  );`,
    "wall-clock dirty-season marker",
  );
}

function wallClockSnapshotExists() {
  return (
    psqlScalar(
      `SET ROLE viberacing_owner;
SELECT pg_catalog.count(*)::text
FROM viberacing_private.leaderboard_published_snapshots AS published
JOIN viberacing_private.seasons AS season
  ON season.season_start = published.season_start
  AND season.trust_tier = published.trust_tier
WHERE season.trust_tier = 'community'
  AND season.season_start = (
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::date
    - (
      extract(
        isodow FROM (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::date
      )::integer - 1
    )
  );`,
      "wall-clock snapshot marker",
    ) === "1"
  );
}

async function runEmittedProcessIntegration(processMode) {
  const runtime = createPortableSchedulerRuntime();
  let created = false;
  try {
    if (processMode === "scheduler_signal_process") {
      const holder = startLockHolder();
      await holder.ready;
      createSchedulerContainer(runtime.runtimeDirectory);
      created = true;
      requireSuccess(
        docker(["start", schedulerContainerName], { timeout: 15_000 }),
        "scheduler signal process start",
      );
      await waitFor(
        () =>
          psqlScalar(
            `SELECT pg_catalog.count(*)::text
FROM pg_catalog.pg_stat_activity
WHERE application_name = '${applicationName}'
  AND usename = '${jobsLogin}'
  AND wait_event_type = 'Lock';`,
            "scheduler blocked-session state",
          ) === "1",
        "scheduler blocked database call",
      );
      sendSchedulerSignal();
      await holder.release();
      await waitForSchedulerExit();
      return;
    }

    armExpiredRateWindow();
    createSchedulerContainer(runtime.runtimeDirectory);
    created = true;
    requireSuccess(
      docker(["start", schedulerContainerName], { timeout: 15_000 }),
      "scheduler process start",
    );
    await waitFor(
      () => currentSeasonExists() && rateWindowIsEmpty(),
      "emitted scheduler initial catalog",
    );
    assert.equal(readSchedulerContainerOutput(), "");

    if (processMode === "scheduler_wall_clock_process") {
      seedWallClockDirtySeason();
      await waitFor(() => wallClockSnapshotExists(), "native wall-clock recurring refresh", 90_000);
      assert.equal(readSchedulerContainerOutput(), "");
    }

    sendSchedulerSignal();
    await waitForSchedulerExit();
  } finally {
    if (created && schedulerContainerExists()) {
      removeSchedulerContainer(readSchedulerContainerState().Running);
    }
    removePortableNodeRuntime(runtime);
  }
}

async function runSelectedIntegration(databasePort) {
  switch (mode) {
    case "commands":
      await runCommandsIntegration(databasePort);
      return;
    case "scheduler":
      await runSchedulerIntegration(databasePort);
      return;
    case "scheduler_timer":
      await runTimerIntegration(databasePort);
      return;
    case "scheduler_lifecycle":
      await runLifecycleIntegration(databasePort);
      return;
    case "scheduler_process":
    case "scheduler_signal_process":
    case "scheduler_wall_clock_process":
      await runEmittedProcessIntegration(mode);
  }
}

async function main() {
  buildWorkspace("apps/jobs", "Jobs production build");
  if (mode !== "commands") {
    buildWorkspace("apps/jobs-scheduler", "Jobs scheduler production build");
  }

  let databaseStarted = false;
  let primaryFailure;
  let cleanupFailure;
  try {
    requireSuccess(
      docker(
        [
          ...composePrefix,
          "run",
          "--detach",
          "--no-deps",
          "--name",
          databaseContainerName,
          "--publish",
          "127.0.0.1::5432",
          "postgres-test",
        ],
        { timeout: 120_000 },
      ),
      "isolated PostgreSQL start",
    );
    databaseStarted = true;
    await waitForHealthyDatabase();
    const databasePort = readPublishedDatabasePort();

    psql(
      readFileSync(resolve(root, "database", "roles", "bootstrap.sql"), "utf8"),
      "database role bootstrap",
    );
    for (const migration of loadReviewedMigrations()) {
      psql(migration.sql, migration.label);
    }
    installLogins();
    await runSelectedIntegration(databasePort);

    assert.equal(
      psqlScalar(
        `SELECT pg_catalog.count(*)::text
FROM pg_catalog.pg_stat_activity
WHERE application_name = '${applicationName}'
  AND usename IN ('${jobsLogin}', '${wideJobsLogin}');`,
        "Jobs connection cleanup",
      ),
      "0",
    );
  } catch (error) {
    primaryFailure = error;
  } finally {
    try {
      if (schedulerContainerExists()) {
        removeSchedulerContainer(true);
      }
      if (databaseStarted) {
        const result = docker(["rm", "--force", databaseContainerName], {
          timeout: 30_000,
        });
        requireSuccess(result, "isolated PostgreSQL cleanup");
      }
      const down = docker([...composePrefix, "down", "--volumes", "--remove-orphans"], {
        timeout: 60_000,
      });
      requireSuccess(down, "isolated compose cleanup");
    } catch (error) {
      cleanupFailure = error;
    }
  }

  if (primaryFailure !== undefined) {
    throw primaryFailure;
  }
  if (cleanupFailure !== undefined) {
    throw cleanupFailure;
  }
  process.stdout.write(
    `Jobs PostgreSQL ${mode.replaceAll("_", "-")} integration passed (6-migration clean bootstrap, exact 13-capability catalog, narrow-login boundary, bounded lifecycle, and generic output evidence).\n`,
  );
}

await main();

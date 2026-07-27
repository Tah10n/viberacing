import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

import { validateManifest } from "./check-database.mjs";

// cspell:ignore PGOPTIONS
const root = resolve(import.meta.dirname, "..");
const projectName = `vr-dbtest-${process.pid}`;
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
const databaseUser = "viberacing_local";
const sourceRestoreArchivePath = "/var/lib/postgresql/viberacing-source-snapshot.dump";
const normalizedRestoreArchivePath = "/var/lib/postgresql/viberacing-normalized-snapshot.dump";
const restoreDumpRestrictKey = "restoreTest1";
const maximumCanonicalDumpBytes = 32 * 1024 * 1024;
const maximumRestoreArchiveBytes = 64 * 1024 * 1024;
// Every connection in one run shares this test-only ISO-week anchor, including a run that crosses
// UTC Monday midnight between fixture setup and a lock-race assertion.
const now = new Date();
const testWeekStartDate = new Date(
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
);
testWeekStartDate.setUTCDate(
  testWeekStartDate.getUTCDate() - ((testWeekStartDate.getUTCDay() + 6) % 7),
);
const testWeekStart = testWeekStartDate.toISOString().slice(0, 10);
const expectedObservedLockWaitRaceCount = 46;
const expectedObservedMigrationOverlapCount = 1;
const expectedObservedEarlyCompletionOverlapCount = 1;
let raceSequence = 0;
let observedLockWaitRaceCount = 0;
let observedMigrationOverlapCount = 0;
let observedEarlyCompletionOverlapCount = 0;

function docker(args, options = {}) {
  const result = spawnSync("docker", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 120_000,
    ...options,
  });
  if (result.error) {
    if (Buffer.isBuffer(result.stdout)) {
      result.stdout.fill(0);
    }
    if (Buffer.isBuffer(result.stderr)) {
      result.stderr.fill(0);
    }
    throw new Error(`Docker command could not complete: ${result.error.message}`);
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

function psqlArguments() {
  return [
    ...composePrefix,
    "exec",
    "-T",
    "--env",
    `PGOPTIONS=-c viberacing.test_week_start=${testWeekStart}`,
    "postgres-test",
    "psql",
    "--no-psqlrc",
    "--username",
    databaseUser,
    "--dbname",
    databaseName,
    "--set",
    "ON_ERROR_STOP=1",
    "--set",
    "VERBOSITY=terse",
  ];
}

function containerCommand(command, args, options = {}) {
  return docker([...composePrefix, "exec", "-T", "postgres-test", command, ...args], options);
}

function requireSilentContainerSuccess(result, label) {
  const stdout = result.stdout;
  const stderr = result.stderr;
  const stdoutEmpty = stdout === null || stdout === undefined || stdout.length === 0;
  const stderrEmpty = stderr === null || stderr === undefined || stderr.length === 0;
  if (result.status === 0 && stdoutEmpty && stderrEmpty) {
    return;
  }
  if (Buffer.isBuffer(stdout)) {
    stdout.fill(0);
  }
  if (Buffer.isBuffer(stderr)) {
    stderr.fill(0);
  }
  throw new Error(`${label} failed without retaining database tool output`);
}

function captureCanonicalArchiveDump(archivePath, section, label) {
  if (section !== "schema" && section !== "data") {
    throw new Error("canonical database dump section is invalid");
  }
  const result = containerCommand(
    "pg_restore",
    [
      "--file=-",
      `--restrict-key=${restoreDumpRestrictKey}`,
      ...(section === "schema"
        ? ["--schema-only", "--create"]
        : ["--data-only", "--disable-triggers"]),
      archivePath,
    ],
    {
      encoding: null,
      maxBuffer: maximumCanonicalDumpBytes,
      timeout: 120_000,
    },
  );
  const stdout = result.stdout;
  const stderr = result.stderr;
  if (
    result.status !== 0 ||
    !Buffer.isBuffer(stdout) ||
    stdout.byteLength === 0 ||
    stdout.byteLength > maximumCanonicalDumpBytes ||
    !Buffer.isBuffer(stderr) ||
    stderr.byteLength !== 0
  ) {
    if (Buffer.isBuffer(stdout)) {
      stdout.fill(0);
    }
    if (Buffer.isBuffer(stderr)) {
      stderr.fill(0);
    }
    throw new Error(`${label} failed without retaining database dump output`);
  }
  const byteLength = stdout.byteLength;
  let digest;
  try {
    digest = createHash("sha256").update(stdout).digest("hex");
  } finally {
    stdout.fill(0);
    stderr.fill(0);
  }
  return Object.freeze({ byteLength, digest });
}

function readRestoreArchiveSize(archivePath, label) {
  const result = containerCommand("stat", ["-c", "%s", archivePath], {
    encoding: "utf8",
    maxBuffer: 1024,
    timeout: 10_000,
  });
  if (result.status !== 0 || result.stderr.length !== 0) {
    throw new Error(`${label} size check failed`);
  }
  const output = result.stdout.trim();
  if (!/^[1-9][0-9]*$/.test(output)) {
    throw new Error(`${label} returned an invalid size`);
  }
  const byteLength = Number(output);
  if (!Number.isSafeInteger(byteLength) || byteLength > maximumRestoreArchiveBytes) {
    throw new Error(`${label} exceeded its fixed size budget`);
  }
  return byteLength;
}

function createCurrentSnapshotArchive(archivePath, label) {
  const archive = containerCommand(
    "pg_dump",
    [
      "--no-password",
      "--username",
      databaseUser,
      "--dbname",
      databaseName,
      "--format=custom",
      "--create",
      "--serializable-deferrable",
      "--lock-wait-timeout=5s",
      "--file",
      archivePath,
    ],
    { encoding: null, maxBuffer: 1024 * 1024, timeout: 120_000 },
  );
  requireSilentContainerSuccess(archive, `${label} creation`);
  return readRestoreArchiveSize(archivePath, label);
}

function replaceDatabaseFromArchive(archivePath, label) {
  const drop = containerCommand(
    "dropdb",
    [
      "--force",
      "--no-password",
      "--username",
      databaseUser,
      "--maintenance-db",
      "postgres",
      databaseName,
    ],
    { encoding: null, maxBuffer: 1024 * 1024, timeout: 30_000 },
  );
  requireSilentContainerSuccess(drop, `${label} source database removal`);

  const restore = containerCommand(
    "pg_restore",
    [
      "--no-password",
      "--username",
      databaseUser,
      "--dbname",
      "postgres",
      "--create",
      "--exit-on-error",
      archivePath,
    ],
    { encoding: null, maxBuffer: 1024 * 1024, timeout: 120_000 },
  );
  requireSilentContainerSuccess(restore, label);
}

function assertRestoredSecurityBoundary() {
  const state = psqlScalar(
    `SELECT pg_catalog.concat_ws(
  ':',
  (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'viberacing_private'
      AND relation.relkind IN ('r', 'p')
  ),
  (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'viberacing_private'
      AND relation.relkind IN ('r', 'p')
      AND relation.relrowsecurity
      AND relation.relforcerowsecurity
  ),
  pg_catalog.has_function_privilege(
    'viberacing_web',
    'viberacing_api.list_public_community_scores(date,integer)',
    'EXECUTE'
  ),
  pg_catalog.has_table_privilege(
    'viberacing_web',
    'viberacing_private.profiles',
    'SELECT'
  ),
  pg_catalog.has_function_privilege(
    'viberacing_jobs',
    'viberacing_api.cleanup_expired_ingest_state(integer)',
    'EXECUTE'
  ),
  pg_catalog.has_function_privilege(
    'viberacing_jobs',
    'viberacing_api.list_public_community_scores(date,integer)',
    'EXECUTE'
  ),
  pg_catalog.has_function_privilege(
    'viberacing_admin',
    'viberacing_api.issue_invite(uuid,bytea,timestamptz,uuid,text,text)',
    'EXECUTE'
  ),
  pg_catalog.has_function_privilege(
    'viberacing_admin',
    'viberacing_api.enroll_profile(uuid,bytea,uuid,bigint,text,text,text,text,boolean,uuid,bytea,timestamptz,uuid,text)',
    'EXECUTE'
  )
) AS restore_security_state;`,
    "restored database security boundary",
  );
  if (state !== "28:28:t:f:t:f:t:f") {
    throw new Error(`restored database security boundary drifted (${state})`);
  }
}

function exerciseCurrentSnapshotRestore() {
  const sourceArchiveBytes = createCurrentSnapshotArchive(
    sourceRestoreArchivePath,
    "source current-snapshot archive",
  );
  const source = Object.freeze({
    data: captureCanonicalArchiveDump(
      sourceRestoreArchivePath,
      "data",
      "pre-restore canonical data dump",
    ),
  });
  replaceDatabaseFromArchive(sourceRestoreArchivePath, "source current-snapshot restore");
  assertRestoredSecurityBoundary();

  const normalizedArchiveBytes = createCurrentSnapshotArchive(
    normalizedRestoreArchivePath,
    "normalized current-snapshot archive",
  );

  const firstRestore = Object.freeze({
    data: captureCanonicalArchiveDump(
      normalizedRestoreArchivePath,
      "data",
      "first restored canonical data dump",
    ),
    schema: captureCanonicalArchiveDump(
      normalizedRestoreArchivePath,
      "schema",
      "first restored canonical schema dump",
    ),
  });
  if (
    firstRestore.data.byteLength !== source.data.byteLength ||
    firstRestore.data.digest !== source.data.digest
  ) {
    throw new Error("first restored data dump drifted from the source snapshot");
  }
  replaceDatabaseFromArchive(normalizedRestoreArchivePath, "normalized current-snapshot restore");
  assertRestoredSecurityBoundary();

  const secondRestoreArchiveBytes = createCurrentSnapshotArchive(
    sourceRestoreArchivePath,
    "second-generation current-snapshot archive",
  );

  const secondRestore = Object.freeze({
    data: captureCanonicalArchiveDump(
      sourceRestoreArchivePath,
      "data",
      "second restored canonical data dump",
    ),
    schema: captureCanonicalArchiveDump(
      sourceRestoreArchivePath,
      "schema",
      "second restored canonical schema dump",
    ),
  });
  if (
    secondRestore.data.byteLength !== source.data.byteLength ||
    secondRestore.data.digest !== source.data.digest
  ) {
    throw new Error("second restored data dump drifted from the source snapshot");
  }
  if (
    secondRestore.schema.byteLength !== firstRestore.schema.byteLength ||
    secondRestore.schema.digest !== firstRestore.schema.digest
  ) {
    throw new Error("restored schema did not reach a byte-stable canonical form");
  }
  return Object.freeze({
    archiveBytes: Math.max(sourceArchiveBytes, normalizedArchiveBytes, secondRestoreArchiveBytes),
    dataBytes: secondRestore.data.byteLength,
    schemaBytes: secondRestore.schema.byteLength,
  });
}

function psql(sql) {
  return docker(psqlArguments(), { input: sql, timeout: 30_000 });
}

function psqlScalar(sql, label) {
  const result = docker([...psqlArguments(), "--tuples-only", "--no-align", "--command", sql], {
    timeout: 10_000,
  });
  requireSuccess(result, label);
  return result.stdout.trim();
}

function startPsql(
  sql,
  readyMarker,
  { diagnosticName = "concurrent PostgreSQL command", keepStdinOpen = false } = {},
) {
  let stdout = "";
  let stderr = "";
  let readySettled = false;
  let inputClosed = false;
  let child;
  let resolveReady;
  let rejectReady;

  const ready = new Promise((resolvePromise, rejectPromise) => {
    resolveReady = resolvePromise;
    rejectReady = rejectPromise;
  });

  if (!readyMarker) {
    readySettled = true;
    resolveReady();
  }

  const completion = new Promise((resolvePromise, rejectPromise) => {
    child = spawn("docker", psqlArguments(), {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const timeout = setTimeout(() => {
      const error = new Error(`${diagnosticName} exceeded 30 seconds`);
      child.kill();
      if (!readySettled) {
        readySettled = true;
        rejectReady(error);
      }
      rejectPromise(error);
    }, 30_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (!readySettled && stdout.includes(readyMarker)) {
        readySettled = true;
        resolveReady();
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdin.on("error", (error) => {
      stderr += `\nstdin: ${error.message}`;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      if (!readySettled) {
        readySettled = true;
        rejectReady(error);
      }
      rejectPromise(error);
    });
    child.on("close", (status, signal) => {
      clearTimeout(timeout);
      inputClosed = true;
      if (!readySettled) {
        readySettled = true;
        rejectReady(new Error(`lock holder exited before marker ${readyMarker}`));
      }
      resolvePromise({ status, signal, stdout, stderr });
    });
    if (keepStdinOpen) {
      child.stdin.write(`${sql}\n`);
    } else {
      inputClosed = true;
      child.stdin.end(sql);
    }
  });

  function closeInput(finalSql = "") {
    if (inputClosed || !child) {
      return;
    }
    inputClosed = true;
    child.stdin.end(finalSql);
  }

  return { ready, completion, closeInput };
}

function sqlStringLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function withApplicationName(applicationName, sql) {
  return `SET application_name = ${sqlStringLiteral(applicationName)};\n${sql}`;
}

async function waitForBlockedContenders(label, holderName, contenderNames) {
  const deadline = Date.now() + 10_000;
  const contenderList = contenderNames.map(sqlStringLiteral).join(", ");
  const query = `WITH RECURSIVE blocking_chain(contender_pid, blocker_pid) AS (
  SELECT contender.pid, blocker.blocker_pid
  FROM pg_catalog.pg_stat_activity AS contender
  CROSS JOIN LATERAL pg_catalog.unnest(
    pg_catalog.pg_blocking_pids(contender.pid)
  ) AS blocker(blocker_pid)
  WHERE contender.application_name IN (${contenderList})
    AND contender.wait_event_type = 'Lock'
  UNION ALL
  SELECT chain.contender_pid, blocker.blocker_pid
  FROM blocking_chain AS chain
  CROSS JOIN LATERAL pg_catalog.unnest(
    pg_catalog.pg_blocking_pids(chain.blocker_pid)
  ) AS blocker(blocker_pid)
)
SELECT pg_catalog.count(DISTINCT chain.contender_pid)
FROM blocking_chain AS chain
JOIN pg_catalog.pg_stat_activity AS holder
  ON holder.pid = chain.blocker_pid
WHERE holder.application_name = ${sqlStringLiteral(holderName)};`;
  let blockedCount = 0;

  while (Date.now() < deadline) {
    const output = psqlScalar(query, `${label} lock observation`);
    blockedCount = Number.parseInt(output, 10);
    if (!Number.isInteger(blockedCount)) {
      throw new Error(`${label} returned an invalid blocked-contender count: ${output}`);
    }
    if (blockedCount === contenderNames.length) {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }

  throw new Error(
    `${label} observed ${blockedCount}/${contenderNames.length} contenders blocked by the holder`,
  );
}

async function runObservedRace(
  label,
  lockSql,
  readyMarker,
  contenderSql,
  { orderedContenders = false, releaseDelayMilliseconds = 0, releaseSql = "\nCOMMIT;\n" } = {},
) {
  raceSequence += 1;
  observedLockWaitRaceCount += 1;
  const racePrefix = `vr-race-${process.pid}-${raceSequence}`;
  const holderName = `${racePrefix}-holder`;
  const contenderNames = contenderSql.map((_, index) => `${racePrefix}-contender-${index + 1}`);
  const lockHolder = startPsql(withApplicationName(holderName, lockSql), readyMarker, {
    diagnosticName: `${label} lock holder`,
    keepStdinOpen: true,
  });
  const contenders = [];
  let holderReleased = false;

  try {
    await lockHolder.ready;
    for (const [index, sql] of contenderSql.entries()) {
      contenders.push(
        startPsql(withApplicationName(contenderNames[index], sql), undefined, {
          diagnosticName: `${label} contender ${index + 1}`,
        }),
      );
      if (orderedContenders) {
        await waitForBlockedContenders(
          `${label} ordered contender ${index + 1}`,
          holderName,
          contenderNames.slice(0, index + 1),
        );
      }
    }
    if (!orderedContenders) {
      await waitForBlockedContenders(label, holderName, contenderNames);
    }
    if (releaseDelayMilliseconds > 0) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, releaseDelayMilliseconds));
    }
    holderReleased = true;
    lockHolder.closeInput(releaseSql);

    const [lockResult, contenderResults] = await Promise.all([
      lockHolder.completion,
      Promise.all(contenders.map(({ completion }) => completion)),
    ]);
    requireSuccess(lockResult, `${label} lock holder`);
    return contenderResults;
  } catch (error) {
    if (!holderReleased) {
      lockHolder.closeInput("\nROLLBACK;\n");
    }
    const settled = await Promise.allSettled([
      lockHolder.completion,
      ...contenders.map(({ completion }) => completion),
    ]);
    const detail = error instanceof Error ? error.message : "unknown observed-race failure";
    const contenderEvidence = settled
      .slice(1)
      .map((result, index) =>
        result.status === "fulfilled"
          ? `contender ${index + 1} status=${result.value.status}\n${result.value.stdout}\n${result.value.stderr}`
          : `contender ${index + 1} rejected: ${String(result.reason)}`,
      )
      .join("\n");
    throw new Error(
      `${label} failed (holder released: ${holderReleased}): ${detail}` +
        (contenderEvidence ? `\n${contenderEvidence}` : ""),
      { cause: error },
    );
  }
}

async function exerciseMigrationOverlap(migrationSql) {
  const diagnosticSql = `\\set VERBOSITY sqlstate
${migrationSql}`;
  const contenderResults = await runObservedRace(
    "reviewed migration advisory-lock overlap",
    `BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);
\\echo migration-overlap-lock-ready`,
    "migration-overlap-lock-ready",
    [diagnosticSql, diagnosticSql],
  );
  const winners = contenderResults.filter((result) => result.status === 0);
  const losers = contenderResults.filter((result) => result.status !== 0);
  const serializedDuplicate =
    losers.length === 1 && /ERROR:\s+42P07\b/.test(`${losers[0].stdout}\n${losers[0].stderr}`);
  if (winners.length !== 1 || !serializedDuplicate) {
    throw new Error(
      `reviewed migration overlap did not produce one winner and one serialized SQLSTATE 42P07 loser (statuses: ${contenderResults.map((result) => result.status).join(",")})`,
    );
  }

  const state = psqlScalar(
    `SELECT pg_catalog.concat_ws(
  ':',
  (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.schema_migrations
    WHERE revision = 39
      AND name = 'finalized_source_day_retention_cleanup'
  ),
  pg_catalog.to_regclass(
    'viberacing_private.finalized_season_profile_freshness'
  ) IS NOT NULL
) AS migration_overlap_state;`,
    "reviewed migration overlap state",
  );
  if (state !== "1:t") {
    throw new Error(`reviewed migration overlap left invalid canonical state (${state})`);
  }
  observedMigrationOverlapCount += 1;
}

async function expectSuccessBeforeHolderRelease(label, lockSql, readyMarker, contenderSql) {
  raceSequence += 1;
  observedEarlyCompletionOverlapCount += 1;
  const racePrefix = `vr-race-${process.pid}-${raceSequence}`;
  const holder = startPsql(withApplicationName(`${racePrefix}-holder`, lockSql), readyMarker, {
    diagnosticName: `${label} lock holder`,
    keepStdinOpen: true,
  });
  let holderReleased = false;
  let contender;

  try {
    await holder.ready;
    contender = startPsql(withApplicationName(`${racePrefix}-contender`, contenderSql), undefined, {
      diagnosticName: `${label} contender`,
    });
    let timeout;
    const contenderResult = await Promise.race([
      contender.completion,
      new Promise((_, rejectPromise) => {
        timeout = setTimeout(
          () => rejectPromise(new Error(`${label} contender blocked behind the held transition`)),
          5_000,
        );
      }),
    ]).finally(() => clearTimeout(timeout));
    requireSuccess(contenderResult, `${label} contender`);

    holderReleased = true;
    holder.closeInput("\nCOMMIT;\n");
    requireSuccess(await holder.completion, `${label} lock holder`);
  } catch (error) {
    if (!holderReleased) {
      holder.closeInput("\nROLLBACK;\n");
    }
    await Promise.allSettled([
      holder.completion,
      ...(contender === undefined ? [] : [contender.completion]),
    ]);
    throw error;
  }
}

async function expectHeldProtectiveActionDominates(
  label,
  lockSql,
  readyMarker,
  releaseSql,
  competingSql,
  diagnosticSql,
) {
  const [competingResult] = await runObservedRace(label, lockSql, readyMarker, [competingSql], {
    releaseSql,
  });
  const competingClosed =
    competingResult.status !== 0 &&
    /operation cannot be completed/i.test(`${competingResult.stdout}\n${competingResult.stderr}`);
  if (!competingClosed) {
    const diagnosticResult = diagnosticSql ? psql(diagnosticSql) : null;
    const diagnostics = diagnosticResult
      ? `\ndiagnostics status=${diagnosticResult.status}\n${diagnosticResult.stdout}\n${diagnosticResult.stderr}`
      : "";
    throw new Error(
      `${label} did not preserve the protective action:\n` +
        `competing status=${competingResult.status}\n${competingResult.stdout}\n${competingResult.stderr}` +
        diagnostics,
    );
  }
}

async function expectOneConcurrentWinner(label, lockSql, readyMarker, contenderSql) {
  const contenderResults = await runObservedRace(label, lockSql, readyMarker, contenderSql);
  const winners = contenderResults.filter((result) => result.status === 0);
  const losers = contenderResults.filter((result) => result.status !== 0);
  const expectedClosedFailure = losers.every((result) =>
    /operation cannot be completed/i.test(`${result.stdout}\n${result.stderr}`),
  );
  if (winners.length !== 1 || losers.length !== 1 || !expectedClosedFailure) {
    const evidence = contenderResults
      .map(
        (result, index) =>
          `contender ${index + 1} status=${result.status}\n${result.stdout}\n${result.stderr}`,
      )
      .join("\n");
    throw new Error(`${label} did not produce one winner and one closed loser:\n${evidence}`);
  }
}

async function expectConcurrentSuccesses(label, lockSql, readyMarker, contenderSql, options) {
  const contenderResults = await runObservedRace(
    label,
    lockSql,
    readyMarker,
    contenderSql,
    options,
  );
  if (contenderResults.some((result) => result.status !== 0)) {
    const evidence = contenderResults
      .map(
        (result, index) =>
          `contender ${index + 1} status=${result.status}\n${result.stdout}\n${result.stderr}`,
      )
      .join("\n");
    throw new Error(`${label} did not produce only successful serialized outcomes:\n${evidence}`);
  }
}

async function expectProtectiveActionDominates(
  label,
  lockSql,
  readyMarker,
  protectiveSql,
  competingSql,
  diagnosticSql,
) {
  const [protectiveResult, competingResult] = await runObservedRace(
    label,
    lockSql,
    readyMarker,
    [protectiveSql, competingSql],
    { orderedContenders: true },
  );

  const competingClosed =
    competingResult.status !== 0 &&
    /operation cannot be completed/i.test(`${competingResult.stdout}\n${competingResult.stderr}`);
  if (protectiveResult.status !== 0 || !competingClosed) {
    const diagnosticResult = diagnosticSql ? psql(diagnosticSql) : null;
    const diagnostics = diagnosticResult
      ? `\ndiagnostics status=${diagnosticResult.status}\n${diagnosticResult.stdout}\n${diagnosticResult.stderr}`
      : "";
    throw new Error(
      `${label} did not preserve the protective action:\n` +
        `protective status=${protectiveResult.status}\n${protectiveResult.stdout}\n${protectiveResult.stderr}\n` +
        `competing status=${competingResult.status}\n${competingResult.stdout}\n${competingResult.stderr}` +
        diagnostics,
    );
  }
}

function expectDenied(role, statement, label) {
  const result = psql(`SET ROLE ${role};\n${statement}\n`);
  if (result.status === 0) {
    throw new Error(`${label} unexpectedly succeeded`);
  }
  const output = `${result.stdout}\n${result.stderr}`;
  if (!/permission denied/i.test(output)) {
    throw new Error(`${label} failed for an unexpected reason`);
  }
}

function loadReviewedMigrations() {
  const manifest = JSON.parse(
    readFileSync(resolve(root, "database/migrations/manifest.json"), "utf8"),
  );
  const filesByPath = new Map();
  const migrationDirectory = resolve(root, "database", "migrations");

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

  return manifest.migrations.flatMap((migration) => {
    const migrationInput = {
      label: `migration ${migration.revision}: ${migration.name}`,
      sql: filesByPath.get(migration.path),
      exerciseOverlap: migration.revision === 39,
    };
    if (migration.revision !== 39 && migration.revision !== 41) {
      return [migrationInput];
    }

    if (migration.revision === 41) {
      return [
        {
          label: "revision 0041 source-attribution backfill setup",
          sql: readFileSync(
            resolve(root, "database/tests/agent_source_provider_migration_setup.sql"),
            "utf8",
          ),
        },
        migrationInput,
        {
          label: "revision 0041 source-attribution backfill assertions",
          sql: readFileSync(
            resolve(root, "database/tests/agent_source_provider_migration_assertions.sql"),
            "utf8",
          ),
        },
      ];
    }

    return [
      {
        label: "revision 0039 finalized source-day backfill setup",
        sql: readFileSync(
          resolve(root, "database/tests/finalized_source_day_migration_setup.sql"),
          "utf8",
        ),
      },
      migrationInput,
      {
        label: "revision 0039 finalized source-day backfill assertions",
        sql: readFileSync(
          resolve(root, "database/tests/finalized_source_day_migration_assertions.sql"),
          "utf8",
        ),
      },
    ];
  });
}

let started = false;
try {
  const start = docker([...composePrefix, "up", "--detach", "--wait", "postgres-test"], {
    stdio: "inherit",
  });
  started = true;
  requireSuccess(start, "isolated PostgreSQL start");

  const databaseInputs = [
    {
      label: "database role bootstrap",
      sql: readFileSync(resolve(root, "database/roles/bootstrap.sql"), "utf8"),
    },
    ...loadReviewedMigrations(),
    {
      label: "identity and role invariants",
      sql: readFileSync(resolve(root, "database/tests/identity_invariants.sql"), "utf8"),
    },
    {
      label: "identity capability scenarios",
      sql: readFileSync(resolve(root, "database/tests/identity_capabilities.sql"), "utf8"),
    },
    {
      label: "passkey login and management scenarios",
      sql: readFileSync(resolve(root, "database/tests/passkey_capabilities.sql"), "utf8"),
    },
    {
      label: "restricted recovery scenarios",
      sql: readFileSync(resolve(root, "database/tests/recovery_capabilities.sql"), "utf8"),
    },
    {
      label: "source-bound pairing scenarios",
      sql: readFileSync(resolve(root, "database/tests/pairing_capabilities.sql"), "utf8"),
    },
    {
      label: "pairing transport rate scenarios",
      sql: readFileSync(resolve(root, "database/tests/pairing_transport_rate.sql"), "utf8"),
    },
    {
      label: "pairing transport rate-window retention reset scenarios",
      sql: readFileSync(
        resolve(root, "database/tests/pairing_rate_window_retention_reset.sql"),
        "utf8",
      ),
    },
    {
      label: "source and device lifecycle scenarios",
      sql: readFileSync(resolve(root, "database/tests/source_device_lifecycle.sql"), "utf8"),
    },
    {
      label: "Community usage ingest scenarios",
      sql: readFileSync(resolve(root, "database/tests/usage_ingest.sql"), "utf8"),
    },
    {
      label: "origin proof replay scenarios",
      sql: readFileSync(resolve(root, "database/tests/origin_replay.sql"), "utf8"),
    },
    {
      label: "Community ingest retention cleanup scenarios",
      sql: readFileSync(resolve(root, "database/tests/ingest_cleanup.sql"), "utf8"),
    },
    {
      label: "pairing retention cleanup scenarios",
      sql: readFileSync(resolve(root, "database/tests/pairing_cleanup.sql"), "utf8"),
    },
    {
      label: "authentication retention cleanup scenarios",
      sql: readFileSync(resolve(root, "database/tests/auth_cleanup.sql"), "utf8"),
    },
    {
      label: "invite retention cleanup scenarios",
      sql: readFileSync(resolve(root, "database/tests/invite_cleanup.sql"), "utf8"),
    },
    {
      label: "session retention cleanup scenarios",
      sql: readFileSync(resolve(root, "database/tests/session_cleanup.sql"), "utf8"),
    },
    {
      label: "abandoned enrollment retention cleanup scenarios",
      sql: readFileSync(resolve(root, "database/tests/abandoned_enrollment_cleanup.sql"), "utf8"),
    },
    {
      label: "finalized source-day retention cleanup scenarios",
      sql: readFileSync(resolve(root, "database/tests/finalized_source_day_cleanup.sql"), "utf8"),
    },
    {
      label: "pairing approval-provenance retention scenarios",
      sql: readFileSync(
        resolve(root, "database/tests/pairing_approval_provenance_retention.sql"),
        "utf8",
      ),
    },
    {
      label: "revoked-passkey retention scenarios",
      sql: readFileSync(resolve(root, "database/tests/revoked_passkey_retention.sql"), "utf8"),
    },
    {
      label: "revoked-device retention scenarios",
      sql: readFileSync(resolve(root, "database/tests/revoked_device_retention.sql"), "utf8"),
    },
    {
      label: "primary profile deletion purge scenarios",
      sql: readFileSync(resolve(root, "database/tests/profile_deletion_purge.sql"), "utf8"),
    },
    {
      label: "terminal deletion-job retention cleanup scenarios",
      sql: readFileSync(resolve(root, "database/tests/deletion_job_cleanup.sql"), "utf8"),
    },
    {
      label: "audit-event retention cleanup scenarios",
      sql: readFileSync(resolve(root, "database/tests/audit_event_cleanup.sql"), "utf8"),
    },
    {
      label: "CarRecipe proposal and approval scenarios",
      sql: readFileSync(resolve(root, "database/tests/car_recipe_proposals.sql"), "utf8"),
    },
    {
      label: "CarRecipe proposal retention cleanup scenarios",
      sql: readFileSync(resolve(root, "database/tests/car_recipe_proposal_cleanup.sql"), "utf8"),
    },
    {
      label: "Community open-season scoring scenarios",
      sql: readFileSync(resolve(root, "database/tests/season_scoring.sql"), "utf8"),
    },
    {
      label: "Community direct-token leaderboard scenarios",
      sql: readFileSync(resolve(root, "database/tests/community_token_leaderboard.sql"), "utf8"),
    },
    {
      label: "Community season finalization scenarios",
      sql: readFileSync(resolve(root, "database/tests/season_finalization.sql"), "utf8"),
    },
    {
      label: "Community historical season backlog scenarios",
      sql: readFileSync(resolve(root, "database/tests/season_backlog.sql"), "utf8"),
    },
    {
      label: "Community public score projection scenarios",
      sql: readFileSync(resolve(root, "database/tests/public_score_read.sql"), "utf8"),
    },
    {
      label: "identity concurrency setup",
      sql: readFileSync(resolve(root, "database/tests/identity_concurrency_setup.sql"), "utf8"),
    },
    {
      label: "Community ingest concurrency setup",
      sql: readFileSync(resolve(root, "database/tests/ingest_concurrency_setup.sql"), "utf8"),
    },
    {
      label: "origin proof replay concurrency setup",
      sql: readFileSync(
        resolve(root, "database/tests/origin_replay_concurrency_setup.sql"),
        "utf8",
      ),
    },
    {
      label: "Community ingest cleanup concurrency setup",
      sql: readFileSync(resolve(root, "database/tests/cleanup_concurrency_setup.sql"), "utf8"),
    },
    {
      label: "pairing cleanup concurrency setup",
      sql: readFileSync(
        resolve(root, "database/tests/pairing_cleanup_concurrency_setup.sql"),
        "utf8",
      ),
    },
    {
      label: "authentication cleanup concurrency setup",
      sql: readFileSync(resolve(root, "database/tests/auth_cleanup_concurrency_setup.sql"), "utf8"),
    },
    {
      label: "invite cleanup concurrency setup",
      sql: readFileSync(
        resolve(root, "database/tests/invite_cleanup_concurrency_setup.sql"),
        "utf8",
      ),
    },
    {
      label: "session cleanup concurrency setup",
      sql: readFileSync(
        resolve(root, "database/tests/session_cleanup_concurrency_setup.sql"),
        "utf8",
      ),
    },
    {
      label: "CarRecipe proposal cleanup concurrency setup",
      sql: readFileSync(
        resolve(root, "database/tests/car_recipe_proposal_cleanup_concurrency_setup.sql"),
        "utf8",
      ),
    },
    {
      label: "device CarRecipe proposal concurrency setup",
      sql: readFileSync(
        resolve(root, "database/tests/car_recipe_device_proposal_concurrency_setup.sql"),
        "utf8",
      ),
    },
    {
      label: "profile deletion purge concurrency setup",
      sql: readFileSync(
        resolve(root, "database/tests/profile_deletion_purge_concurrency_setup.sql"),
        "utf8",
      ),
    },
    {
      label: "terminal deletion-job cleanup concurrency setup",
      sql: readFileSync(
        resolve(root, "database/tests/deletion_job_cleanup_concurrency_setup.sql"),
        "utf8",
      ),
    },
    {
      label: "audit-event cleanup concurrency setup",
      sql: readFileSync(
        resolve(root, "database/tests/audit_event_cleanup_concurrency_setup.sql"),
        "utf8",
      ),
    },
    {
      label: "pairing approval-provenance concurrency setup",
      sql: readFileSync(
        resolve(root, "database/tests/pairing_approval_provenance_concurrency_setup.sql"),
        "utf8",
      ),
    },
    {
      label: "revoked-passkey concurrency setup",
      sql: readFileSync(
        resolve(root, "database/tests/revoked_passkey_concurrency_setup.sql"),
        "utf8",
      ),
    },
    {
      label: "revoked-device concurrency setup",
      sql: readFileSync(
        resolve(root, "database/tests/revoked_device_concurrency_setup.sql"),
        "utf8",
      ),
    },
    {
      label: "pairing rate-window reset concurrency setup",
      sql: readFileSync(
        resolve(root, "database/tests/pairing_rate_window_reset_concurrency_setup.sql"),
        "utf8",
      ),
    },
    {
      label: "Community scoring concurrency setup",
      sql: readFileSync(resolve(root, "database/tests/scoring_concurrency_setup.sql"), "utf8"),
    },
    {
      label: "Community finalization concurrency setup",
      sql: readFileSync(resolve(root, "database/tests/finalization_concurrency_setup.sql"), "utf8"),
    },
    {
      label: "Community historical backlog concurrency setup",
      sql: readFileSync(
        resolve(root, "database/tests/season_backlog_concurrency_setup.sql"),
        "utf8",
      ),
    },
    {
      label: "pairing concurrency setup",
      sql: readFileSync(resolve(root, "database/tests/pairing_concurrency_setup.sql"), "utf8"),
    },
    {
      label: "source lifecycle concurrency setup",
      sql: readFileSync(resolve(root, "database/tests/lifecycle_concurrency_setup.sql"), "utf8"),
    },
    {
      label: "passkey concurrency setup",
      sql: readFileSync(resolve(root, "database/tests/passkey_concurrency_setup.sql"), "utf8"),
    },
    {
      label: "recovery concurrency setup",
      sql: readFileSync(resolve(root, "database/tests/recovery_concurrency_setup.sql"), "utf8"),
    },
  ];
  for (const { sql, label, exerciseOverlap = false } of databaseInputs) {
    if (exerciseOverlap) {
      await exerciseMigrationOverlap(sql);
    } else {
      requireSuccess(psql(sql), label);
    }
  }

  const restoreEvidence = exerciseCurrentSnapshotRestore();

  await expectConcurrentSuccesses(
    "bounded authentication cleanup worker race",
    `BEGIN;
SET LOCAL ROLE viberacing_jobs;
SELECT * FROM viberacing_api.cleanup_expired_auth_state(1);
\\echo auth-cleanup-worker-lock-ready`,
    "auth-cleanup-worker-lock-ready",
    [
      `SET ROLE viberacing_jobs;
SELECT * FROM viberacing_api.cleanup_expired_auth_state(1);`,
    ],
  );

  requireSuccess(
    psql(
      readFileSync(resolve(root, "database/tests/auth_cleanup_concurrency_assertions.sql"), "utf8"),
    ),
    "authentication cleanup concurrency assertions",
  );

  await expectConcurrentSuccesses(
    "bounded invite cleanup worker race",
    `BEGIN;
SET LOCAL ROLE viberacing_jobs;
SELECT * FROM viberacing_api.cleanup_expired_invites(1);
\\echo invite-cleanup-worker-lock-ready`,
    "invite-cleanup-worker-lock-ready",
    [
      `SET ROLE viberacing_jobs;
SELECT * FROM viberacing_api.cleanup_expired_invites(1);`,
    ],
  );

  requireSuccess(
    psql(
      readFileSync(
        resolve(root, "database/tests/invite_cleanup_concurrency_assertions.sql"),
        "utf8",
      ),
    ),
    "invite cleanup concurrency assertions",
  );

  await expectConcurrentSuccesses(
    "bounded session cleanup worker race",
    `BEGIN;
SET LOCAL ROLE viberacing_jobs;
SELECT * FROM viberacing_api.cleanup_expired_sessions(1);
\\echo session-cleanup-worker-lock-ready`,
    "session-cleanup-worker-lock-ready",
    [
      `SET ROLE viberacing_jobs;
SELECT * FROM viberacing_api.cleanup_expired_sessions(1);`,
    ],
  );

  requireSuccess(
    psql(
      readFileSync(
        resolve(root, "database/tests/session_cleanup_concurrency_assertions.sql"),
        "utf8",
      ),
    ),
    "session cleanup concurrency assertions",
  );

  requireSuccess(
    psql(
      readFileSync(
        resolve(root, "database/tests/abandoned_enrollment_cleanup_concurrency_setup.sql"),
        "utf8",
      ),
    ),
    "abandoned enrollment cleanup concurrency setup",
  );

  await expectConcurrentSuccesses(
    "bounded abandoned enrollment cleanup worker race",
    `BEGIN;
SET LOCAL ROLE viberacing_jobs;
SELECT * FROM viberacing_api.cleanup_abandoned_enrollments(1);
\\echo abandoned-enrollment-worker-lock-ready`,
    "abandoned-enrollment-worker-lock-ready",
    [
      `SET ROLE viberacing_jobs;
SELECT * FROM viberacing_api.cleanup_abandoned_enrollments(1);`,
    ],
  );

  await expectSuccessBeforeHolderRelease(
    "initial passkey activation versus abandoned enrollment cleanup race",
    `BEGIN;
SET LOCAL ROLE viberacing_web;
SELECT viberacing_api.register_initial_passkey(
  '00000000-0000-4000-8000-000000038903',
  pg_catalog.decode(pg_catalog.lpad('38903', 64, '0'), 'hex'),
  '00000000-0000-4000-8000-000000039003',
  '00000000-0000-4000-8000-000000039103',
  pg_catalog.decode(pg_catalog.repeat('a3', 16), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('b3', 32), 'hex'),
  'Activation race key',
  0,
  false,
  false,
  '00000000-0000-4000-8000-000000039203',
  'req_' || pg_catalog.repeat('R', 22)
);
\\echo enrollment-activation-lock-ready`,
    "enrollment-activation-lock-ready",
    `SET ROLE viberacing_jobs;
SELECT * FROM viberacing_api.cleanup_abandoned_enrollments(1);`,
  );

  requireSuccess(
    psql(
      readFileSync(
        resolve(root, "database/tests/abandoned_enrollment_cleanup_concurrency_assertions.sql"),
        "utf8",
      ),
    ),
    "abandoned enrollment cleanup concurrency assertions",
  );

  requireSuccess(
    psql(
      readFileSync(
        resolve(root, "database/tests/finalized_source_day_cleanup_concurrency_setup.sql"),
        "utf8",
      ),
    ),
    "finalized source-day cleanup concurrency setup",
  );

  await expectConcurrentSuccesses(
    "bounded finalized source-day cleanup worker race",
    `BEGIN;
SET LOCAL ROLE viberacing_jobs;
SELECT * FROM viberacing_api.cleanup_finalized_source_day_values(1);
\\echo finalized-source-day-worker-lock-ready`,
    "finalized-source-day-worker-lock-ready",
    [
      `SET ROLE viberacing_jobs;
SELECT * FROM viberacing_api.cleanup_finalized_source_day_values(1);`,
    ],
  );

  await expectConcurrentSuccesses(
    "finalized source-day cleanup versus primary profile purge race",
    `BEGIN;
SET LOCAL ROLE viberacing_jobs;
SELECT * FROM viberacing_api.cleanup_finalized_source_day_values(1);
\\echo finalized-source-day-purge-lock-ready`,
    "finalized-source-day-purge-lock-ready",
    [
      `SET ROLE viberacing_jobs;
SELECT * FROM viberacing_api.purge_profile_deletions(1);`,
    ],
  );

  await expectConcurrentSuccesses(
    "Community finalization versus finalized source-day cleanup race",
    `BEGIN;
SET LOCAL ROLE viberacing_jobs;
SELECT * FROM viberacing_api.finalize_community_season(DATE '2009-01-05');
\\echo finalized-source-day-finalization-lock-ready`,
    "finalized-source-day-finalization-lock-ready",
    [
      `SET ROLE viberacing_jobs;
SELECT * FROM viberacing_api.cleanup_finalized_source_day_values(1);`,
    ],
  );

  requireSuccess(
    psql(
      readFileSync(
        resolve(root, "database/tests/finalized_source_day_cleanup_concurrency_assertions.sql"),
        "utf8",
      ),
    ),
    "finalized source-day cleanup concurrency assertions",
  );

  await expectConcurrentSuccesses(
    "bounded CarRecipe proposal cleanup worker race",
    `BEGIN;
SET LOCAL ROLE viberacing_jobs;
SELECT * FROM viberacing_api.cleanup_expired_car_recipe_proposals(1);
\\echo car-recipe-cleanup-worker-lock-ready`,
    "car-recipe-cleanup-worker-lock-ready",
    [
      `SET ROLE viberacing_jobs;
SELECT * FROM viberacing_api.cleanup_expired_car_recipe_proposals(1);`,
    ],
  );

  requireSuccess(
    psql(
      readFileSync(
        resolve(root, "database/tests/car_recipe_proposal_cleanup_concurrency_assertions.sql"),
        "utf8",
      ),
    ),
    "CarRecipe proposal cleanup concurrency assertions",
  );

  requireSuccess(
    psql(`BEGIN;
SET LOCAL ROLE viberacing_web;
SELECT viberacing_api.propose_car_recipe_from_device(
  '00000000-0000-4000-8000-000000028404',
  'dev_' || pg_catalog.repeat('4', 22),
  pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp()),
  pg_catalog.decode(pg_catalog.repeat('c7', 32), 'hex'),
  '00000000-0000-4000-8000-000000028305',
  1,
  'formula',
  'wedge',
  'canopy',
  'high',
  'slick',
  'turbo-blue',
  'spark',
  4242
);
ROLLBACK;`),
    "device CarRecipe proposal race preflight",
  );

  await expectHeldProtectiveActionDominates(
    "source pause versus device CarRecipe proposal race",
    `BEGIN;
SET LOCAL ROLE viberacing_owner;
SELECT profile_id
FROM viberacing_private.profiles
WHERE profile_id = '00000000-0000-4000-8000-000000028104'
FOR UPDATE;
\\echo car-proposal-pause-lock-ready`,
    "car-proposal-pause-lock-ready",
    `SET LOCAL ROLE viberacing_web;
SELECT viberacing_api.pause_source(
  '00000000-0000-4000-8000-000000028204',
  pg_catalog.decode(pg_catalog.lpad('28204', 64, '0'), 'hex'),
  'src_' || pg_catalog.repeat('4', 22),
  '00000000-0000-4000-8000-000000028804',
  'req_' || pg_catalog.repeat('4', 22)
);
COMMIT;`,
    `SET ROLE viberacing_web;
SELECT viberacing_api.propose_car_recipe_from_device(
  '00000000-0000-4000-8000-000000028404',
  'dev_' || pg_catalog.repeat('4', 22),
  pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp()),
  pg_catalog.decode(pg_catalog.repeat('c8', 32), 'hex'),
  '00000000-0000-4000-8000-000000028304',
  1,
  'formula',
  'wedge',
  'canopy',
  'high',
  'slick',
  'turbo-blue',
  'spark',
  4242
);`,
    `SET ROLE viberacing_owner;
SELECT state
FROM viberacing_private.codex_sources
WHERE source_id = 'src_' || pg_catalog.repeat('4', 22);`,
  );

  requireSuccess(
    psql(
      readFileSync(
        resolve(root, "database/tests/car_recipe_device_proposal_concurrency_assertions.sql"),
        "utf8",
      ),
    ),
    "device CarRecipe proposal concurrency assertions",
  );

  await expectConcurrentSuccesses(
    "authentication cleanup versus recovery start race",
    `BEGIN;
SET LOCAL ROLE viberacing_owner;
SELECT profile_id
FROM viberacing_private.profiles
WHERE profile_id = '00000000-0000-4000-8000-000000024104'
FOR UPDATE;
\\echo auth-cleanup-recovery-lock-ready`,
    "auth-cleanup-recovery-lock-ready",
    [
      `SET ROLE viberacing_web;
SELECT viberacing_api.start_recovery(
  '00000000-0000-4000-8000-000000024305',
  '00000000-0000-4000-8000-000000024405',
  pg_catalog.decode(pg_catalog.lpad('24405', 64, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('24505', 64, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('24605', 64, '0'), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '9 minutes',
  '00000000-0000-4000-8000-000000024901',
  'req_' || pg_catalog.repeat('H', 22)
);`,
      `SET ROLE viberacing_jobs;
SELECT * FROM viberacing_api.cleanup_expired_auth_state(1);`,
    ],
    { orderedContenders: true },
  );

  requireSuccess(
    psql(
      readFileSync(
        resolve(root, "database/tests/auth_cleanup_recovery_race_assertions.sql"),
        "utf8",
      ),
    ),
    "authentication cleanup versus recovery assertions",
  );

  await expectConcurrentSuccesses(
    "bounded pairing cleanup worker race",
    `BEGIN;
SET LOCAL ROLE viberacing_jobs;
SELECT * FROM viberacing_api.cleanup_expired_pairing_state(1);
\\echo pairing-cleanup-worker-lock-ready`,
    "pairing-cleanup-worker-lock-ready",
    [
      `SET ROLE viberacing_jobs;
SELECT * FROM viberacing_api.cleanup_expired_pairing_state(1);`,
    ],
  );

  requireSuccess(
    psql(
      readFileSync(
        resolve(root, "database/tests/pairing_cleanup_concurrency_assertions.sql"),
        "utf8",
      ),
    ),
    "pairing cleanup concurrency assertions",
  );

  await expectConcurrentSuccesses(
    "bounded profile deletion purge worker race",
    `BEGIN;
SET LOCAL ROLE viberacing_jobs;
SELECT * FROM viberacing_api.purge_profile_deletions(1);
\\echo profile-deletion-purge-worker-lock-ready`,
    "profile-deletion-purge-worker-lock-ready",
    [
      `SET ROLE viberacing_jobs;
SELECT * FROM viberacing_api.purge_profile_deletions(1);`,
    ],
  );

  await expectConcurrentSuccesses(
    "profile deletion purge versus authentication cleanup race",
    `BEGIN;
SET LOCAL ROLE viberacing_jobs;
SELECT * FROM viberacing_api.purge_profile_deletions(1);
\\echo profile-deletion-purge-cross-job-lock-ready`,
    "profile-deletion-purge-cross-job-lock-ready",
    [
      `SET ROLE viberacing_jobs;
SELECT * FROM viberacing_api.cleanup_expired_auth_state(1);`,
    ],
  );

  requireSuccess(
    psql(
      readFileSync(
        resolve(root, "database/tests/profile_deletion_purge_concurrency_assertions.sql"),
        "utf8",
      ),
    ),
    "profile deletion purge concurrency assertions",
  );

  await expectConcurrentSuccesses(
    "bounded terminal deletion-job cleanup worker race",
    `BEGIN;
SET LOCAL ROLE viberacing_jobs;
SELECT * FROM viberacing_api.cleanup_terminal_deletion_jobs(1);
\\echo deletion-job-cleanup-worker-lock-ready`,
    "deletion-job-cleanup-worker-lock-ready",
    [
      `SET ROLE viberacing_jobs;
SELECT * FROM viberacing_api.cleanup_terminal_deletion_jobs(1);`,
    ],
  );

  requireSuccess(
    psql(
      readFileSync(
        resolve(root, "database/tests/deletion_job_cleanup_concurrency_assertions.sql"),
        "utf8",
      ),
    ),
    "terminal deletion-job cleanup concurrency assertions",
  );

  await expectConcurrentSuccesses(
    "bounded audit-event cleanup worker race",
    `BEGIN;
SET LOCAL ROLE viberacing_jobs;
SELECT * FROM viberacing_api.cleanup_expired_audit_events(1);
\\echo audit-event-cleanup-worker-lock-ready`,
    "audit-event-cleanup-worker-lock-ready",
    [
      `SET ROLE viberacing_jobs;
SELECT * FROM viberacing_api.cleanup_expired_audit_events(1);`,
    ],
  );

  requireSuccess(
    psql(
      readFileSync(
        resolve(root, "database/tests/audit_event_cleanup_concurrency_assertions.sql"),
        "utf8",
      ),
    ),
    "audit-event cleanup concurrency assertions",
  );

  await expectConcurrentSuccesses(
    "bounded pairing approval-provenance worker race",
    `BEGIN;
SET LOCAL ROLE viberacing_jobs;
SELECT * FROM viberacing_api.redact_aged_pairing_approval_provenance(1);
\\echo pairing-provenance-worker-lock-ready`,
    "pairing-provenance-worker-lock-ready",
    [
      `SET ROLE viberacing_jobs;
SELECT * FROM viberacing_api.redact_aged_pairing_approval_provenance(1);`,
    ],
  );

  requireSuccess(
    psql(
      readFileSync(
        resolve(root, "database/tests/pairing_approval_provenance_concurrency_assertions.sql"),
        "utf8",
      ),
    ),
    "pairing approval-provenance concurrency assertions",
  );

  await expectConcurrentSuccesses(
    "bounded revoked-passkey cleanup worker race",
    `BEGIN;
SET LOCAL ROLE viberacing_jobs;
SELECT * FROM viberacing_api.cleanup_aged_revoked_passkeys(1);
\\echo revoked-passkey-worker-lock-ready`,
    "revoked-passkey-worker-lock-ready",
    [
      `SET ROLE viberacing_jobs;
SELECT * FROM viberacing_api.cleanup_aged_revoked_passkeys(1);`,
    ],
  );

  requireSuccess(
    psql(
      readFileSync(
        resolve(root, "database/tests/revoked_passkey_concurrency_assertions.sql"),
        "utf8",
      ),
    ),
    "revoked-passkey concurrency assertions",
  );

  await expectConcurrentSuccesses(
    "bounded revoked-device cleanup worker race",
    `BEGIN;
SET LOCAL ROLE viberacing_jobs;
SELECT * FROM viberacing_api.cleanup_aged_revoked_devices(1);
\\echo revoked-device-worker-lock-ready`,
    "revoked-device-worker-lock-ready",
    [
      `SET ROLE viberacing_jobs;
SELECT * FROM viberacing_api.cleanup_aged_revoked_devices(1);`,
    ],
  );

  requireSuccess(
    psql(
      readFileSync(
        resolve(root, "database/tests/revoked_device_concurrency_assertions.sql"),
        "utf8",
      ),
    ),
    "revoked-device concurrency assertions",
  );

  await expectConcurrentSuccesses(
    "bounded pairing rate-window reset worker race",
    `BEGIN;
SET LOCAL ROLE viberacing_jobs;
SELECT * FROM viberacing_api.reset_expired_pairing_request_windows();
\\echo rate-window-worker-lock-ready`,
    "rate-window-worker-lock-ready",
    [
      `SET ROLE viberacing_jobs;
SELECT * FROM viberacing_api.reset_expired_pairing_request_windows();`,
    ],
  );

  requireSuccess(
    psql(
      readFileSync(
        resolve(root, "database/tests/pairing_rate_window_admission_concurrency_setup.sql"),
        "utf8",
      ),
    ),
    "pairing rate-window admission concurrency setup",
  );

  await expectConcurrentSuccesses(
    "pairing rate-window reset versus live admission race",
    `BEGIN;
SET LOCAL ROLE viberacing_jobs;
SELECT * FROM viberacing_api.reset_expired_pairing_request_windows();
\\echo rate-window-admission-lock-ready`,
    "rate-window-admission-lock-ready",
    [
      `SET ROLE viberacing_web;
SELECT viberacing_api.admit_pairing_transport_request(
  'start',
  pg_catalog.decode('01' || pg_catalog.repeat('00', 31), 'hex'),
  3,
  1,
  60
);`,
    ],
  );

  requireSuccess(
    psql(
      readFileSync(
        resolve(root, "database/tests/pairing_rate_window_reset_concurrency_assertions.sql"),
        "utf8",
      ),
    ),
    "pairing rate-window reset concurrency assertions",
  );

  await expectOneConcurrentWinner(
    "single invite enrollment race",
    `BEGIN;
SET LOCAL ROLE viberacing_owner;
SELECT invite_id
FROM viberacing_private.invites
WHERE invite_id = '00000000-0000-4000-8000-000000004701'
FOR UPDATE;
\\echo enrollment-race-lock-ready`,
    "enrollment-race-lock-ready",
    [
      `SET ROLE viberacing_web;
SELECT viberacing_api.enroll_profile(
  '00000000-0000-4000-8000-000000004701',
  pg_catalog.decode(pg_catalog.lpad('4701', 64, '0'), 'hex'),
  '00000000-0000-4000-8000-000000004111',
  900000000000004111,
  'race-enroll-a',
  'en',
  'neon-night',
  'system',
  true,
  '00000000-0000-4000-8000-000000004211',
  pg_catalog.decode(pg_catalog.lpad('4211', 64, '0'), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '1 hour',
  '00000000-0000-4000-8000-000000004901',
  'req_' || pg_catalog.repeat('A', 22)
);`,
      `SET ROLE viberacing_web;
SELECT viberacing_api.enroll_profile(
  '00000000-0000-4000-8000-000000004701',
  pg_catalog.decode(pg_catalog.lpad('4701', 64, '0'), 'hex'),
  '00000000-0000-4000-8000-000000004112',
  900000000000004112,
  'race-enroll-b',
  'ru',
  'classic-grand-prix',
  'off',
  false,
  '00000000-0000-4000-8000-000000004212',
  pg_catalog.decode(pg_catalog.lpad('4212', 64, '0'), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '1 hour',
  '00000000-0000-4000-8000-000000004902',
  'req_' || pg_catalog.repeat('B', 22)
);`,
    ],
  );

  await expectOneConcurrentWinner(
    "single initial-passkey challenge consumption race",
    `BEGIN;
SET LOCAL ROLE viberacing_owner;
SELECT challenge_id
FROM viberacing_private.auth_challenges
WHERE challenge_id = '00000000-0000-4000-8000-000000004603'
FOR UPDATE;
\\echo challenge-race-lock-ready`,
    "challenge-race-lock-ready",
    [
      `SET ROLE viberacing_web;
DO $race$
BEGIN
  IF NOT viberacing_api.consume_auth_challenge(
    '00000000-0000-4000-8000-000000004203',
    pg_catalog.decode(pg_catalog.lpad('4203', 64, '0'), 'hex'),
    '00000000-0000-4000-8000-000000004603',
    'passkey_registration',
    pg_catalog.decode(pg_catalog.lpad('4603', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('8603', 64, '0'), 'hex')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'operation cannot be completed';
  END IF;
END
$race$;`,
      `SET ROLE viberacing_web;
DO $race$
BEGIN
  IF NOT viberacing_api.consume_auth_challenge(
    '00000000-0000-4000-8000-000000004203',
    pg_catalog.decode(pg_catalog.lpad('4203', 64, '0'), 'hex'),
    '00000000-0000-4000-8000-000000004603',
    'passkey_registration',
    pg_catalog.decode(pg_catalog.lpad('4603', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('8603', 64, '0'), 'hex')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'operation cannot be completed';
  END IF;
END
$race$;`,
    ],
  );

  await expectOneConcurrentWinner(
    "single session rotation race",
    `BEGIN;
SET LOCAL ROLE viberacing_owner;
SELECT session_id
FROM viberacing_private.sessions
WHERE session_id = '00000000-0000-4000-8000-000000004204'
FOR UPDATE;
\\echo session-rotation-lock-ready`,
    "session-rotation-lock-ready",
    [
      `SET ROLE viberacing_web;
SELECT viberacing_api.rotate_session(
  '00000000-0000-4000-8000-000000004204',
  pg_catalog.decode(pg_catalog.lpad('4204', 64, '0'), 'hex'),
  '00000000-0000-4000-8000-000000004221',
  pg_catalog.decode(pg_catalog.lpad('4221', 64, '0'), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '1 hour',
  '00000000-0000-4000-8000-000000004911',
  'req_' || pg_catalog.repeat('C', 22)
);`,
      `SET ROLE viberacing_web;
SELECT viberacing_api.rotate_session(
  '00000000-0000-4000-8000-000000004204',
  pg_catalog.decode(pg_catalog.lpad('4204', 64, '0'), 'hex'),
  '00000000-0000-4000-8000-000000004222',
  pg_catalog.decode(pg_catalog.lpad('4222', 64, '0'), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '1 hour',
  '00000000-0000-4000-8000-000000004912',
  'req_' || pg_catalog.repeat('D', 22)
);`,
    ],
  );

  await expectProtectiveActionDominates(
    "profile deletion versus session rotation race",
    `BEGIN;
SET LOCAL ROLE viberacing_owner;
SELECT profile_id
FROM viberacing_private.profiles
WHERE profile_id = '00000000-0000-4000-8000-000000004105'
FOR UPDATE;
\\echo deletion-race-lock-ready`,
    "deletion-race-lock-ready",
    `SET ROLE viberacing_web;
SELECT viberacing_api.request_profile_deletion(
  '00000000-0000-4000-8000-000000004205',
  pg_catalog.decode(pg_catalog.lpad('4205', 64, '0'), 'hex'),
  'race-delete',
  '00000000-0000-4000-8000-000000004605',
  '00000000-0000-4000-8000-000000004505',
  pg_catalog.decode(pg_catalog.lpad('4505', 64, '0'), 'hex'),
  '00000000-0000-4000-8000-000000004915',
  'req_' || pg_catalog.repeat('E', 22)
);`,
    `SET ROLE viberacing_web;
SELECT viberacing_api.rotate_session(
  '00000000-0000-4000-8000-000000004205',
  pg_catalog.decode(pg_catalog.lpad('4205', 64, '0'), 'hex'),
  '00000000-0000-4000-8000-000000004225',
  pg_catalog.decode(pg_catalog.lpad('4225', 64, '0'), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '1 hour',
  '00000000-0000-4000-8000-000000004925',
  'req_' || pg_catalog.repeat('F', 22)
);`,
  );

  requireSuccess(
    psql(readFileSync(resolve(root, "database/tests/identity_concurrency_assertions.sql"), "utf8")),
    "identity concurrency assertions",
  );

  const ingestRetryObservedAt = new Date().toISOString();

  await expectConcurrentSuccesses(
    "exact Community sync retry race",
    `BEGIN;
SET LOCAL ROLE viberacing_owner;
SELECT source_id
FROM viberacing_private.codex_sources
WHERE source_id = 'src_' || pg_catalog.repeat('S', 22)
FOR UPDATE;
\\echo ingest-retry-lock-ready`,
    "ingest-retry-lock-ready",
    [
      `SET ROLE viberacing_ingest;
SELECT * FROM viberacing_api.submit_community_sync(
  '00000000-0000-4000-8000-000000011401',
  'dev_' || pg_catalog.repeat('S', 22),
  'src_' || pg_catalog.repeat('S', 22),
  '00000000-0000-4000-8000-000000011500',
  'syn_' || pg_catalog.repeat('S', 22),
  ${sqlStringLiteral(ingestRetryObservedAt)},
  '1.2.3',
  '4.5.6',
  pg_catalog.decode(pg_catalog.lpad('11500', 64, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('21500', 128, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('31500', 64, '0'), 'hex'),
  ARRAY[
    pg_catalog.to_char(
      pg_catalog.current_setting('viberacing.test_week_start')::date,
      'YYYY-MM-DD'
    )
  ],
  ARRAY[321]::bigint[]
);`,
      `SET ROLE viberacing_ingest;
SELECT * FROM viberacing_api.submit_community_sync(
  '00000000-0000-4000-8000-000000011401',
  'dev_' || pg_catalog.repeat('S', 22),
  'src_' || pg_catalog.repeat('S', 22),
  '00000000-0000-4000-8000-000000011500',
  'syn_' || pg_catalog.repeat('S', 22),
  ${sqlStringLiteral(ingestRetryObservedAt)},
  '1.2.3',
  '4.5.6',
  pg_catalog.decode(pg_catalog.lpad('11500', 64, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('21500', 128, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('31500', 64, '0'), 'hex'),
  ARRAY[
    pg_catalog.to_char(
      pg_catalog.current_setting('viberacing.test_week_start')::date,
      'YYYY-MM-DD'
    )
  ],
  ARRAY[321]::bigint[]
);`,
    ],
  );

  await expectConcurrentSuccesses(
    "same-source multi-device monotonic race",
    `BEGIN;
SET LOCAL ROLE viberacing_owner;
SELECT source_id
FROM viberacing_private.codex_sources
WHERE source_id = 'src_' || pg_catalog.repeat('T', 22)
FOR UPDATE;
\\echo ingest-devices-lock-ready`,
    "ingest-devices-lock-ready",
    [
      `SET ROLE viberacing_ingest;
SELECT * FROM viberacing_api.submit_community_sync(
  '00000000-0000-4000-8000-000000011402',
  'dev_' || pg_catalog.repeat('T', 22),
  'src_' || pg_catalog.repeat('T', 22),
  '00000000-0000-4000-8000-000000011501',
  'syn_' || pg_catalog.repeat('T', 22),
  pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp()),
  '1.2.3',
  '4.5.6',
  pg_catalog.decode(pg_catalog.lpad('11501', 64, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('21501', 128, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('31501', 64, '0'), 'hex'),
  ARRAY[
    pg_catalog.to_char(
      pg_catalog.current_setting('viberacing.test_week_start')::date,
      'YYYY-MM-DD'
    )
  ],
  ARRAY[700]::bigint[]
);`,
      `SET ROLE viberacing_ingest;
SELECT * FROM viberacing_api.submit_community_sync(
  '00000000-0000-4000-8000-000000011403',
  'dev_' || pg_catalog.repeat('U', 22),
  'src_' || pg_catalog.repeat('T', 22),
  '00000000-0000-4000-8000-000000011502',
  'syn_' || pg_catalog.repeat('U', 22),
  pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp()),
  '1.2.3',
  '4.5.6',
  pg_catalog.decode(pg_catalog.lpad('11502', 64, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('21502', 128, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('31502', 64, '0'), 'hex'),
  ARRAY[
    pg_catalog.to_char(
      pg_catalog.current_setting('viberacing.test_week_start')::date,
      'YYYY-MM-DD'
    )
  ],
  ARRAY[600]::bigint[]
);`,
    ],
  );

  await expectProtectiveActionDominates(
    "source pause versus Community sync race",
    `BEGIN;
SET LOCAL ROLE viberacing_owner;
SELECT profile_id
FROM viberacing_private.profiles
WHERE profile_id = '00000000-0000-4000-8000-000000011103'
FOR UPDATE;
\\echo ingest-pause-lock-ready`,
    "ingest-pause-lock-ready",
    `SET ROLE viberacing_web;
SELECT viberacing_api.pause_source(
  '00000000-0000-4000-8000-000000011201',
  pg_catalog.decode(pg_catalog.lpad('11201', 64, '0'), 'hex'),
  'src_' || pg_catalog.repeat('W', 22),
  '00000000-0000-4000-8000-000000011801',
  'req_' || pg_catalog.repeat('1', 22)
);`,
    `SET ROLE viberacing_ingest;
SELECT * FROM viberacing_api.submit_community_sync(
  '00000000-0000-4000-8000-000000011404',
  'dev_' || pg_catalog.repeat('W', 22),
  'src_' || pg_catalog.repeat('W', 22),
  '00000000-0000-4000-8000-000000011503',
  'syn_' || pg_catalog.repeat('W', 22),
  pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp()),
  '1.2.3',
  '4.5.6',
  pg_catalog.decode(pg_catalog.lpad('11503', 64, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('21503', 128, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('31503', 64, '0'), 'hex'),
  ARRAY[
    pg_catalog.to_char(
      pg_catalog.current_setting('viberacing.test_week_start')::date,
      'YYYY-MM-DD'
    )
  ],
  ARRAY[123]::bigint[]
);`,
    `SET ROLE viberacing_owner;
SELECT state FROM viberacing_private.codex_sources
WHERE source_id = 'src_' || pg_catalog.repeat('W', 22);`,
  );

  await expectProtectiveActionDominates(
    "device revoke versus Community sync race",
    `BEGIN;
SET LOCAL ROLE viberacing_owner;
SELECT profile_id
FROM viberacing_private.profiles
WHERE profile_id = '00000000-0000-4000-8000-000000011104'
FOR UPDATE;
\\echo ingest-revoke-lock-ready`,
    "ingest-revoke-lock-ready",
    `SET ROLE viberacing_web;
SELECT viberacing_api.revoke_device(
  '00000000-0000-4000-8000-000000011202',
  pg_catalog.decode(pg_catalog.lpad('11202', 64, '0'), 'hex'),
  'dev_' || pg_catalog.repeat('Z', 22),
  '00000000-0000-4000-8000-000000011802',
  'req_' || pg_catalog.repeat('2', 22)
);`,
    `SET ROLE viberacing_ingest;
SELECT * FROM viberacing_api.submit_community_sync(
  '00000000-0000-4000-8000-000000011405',
  'dev_' || pg_catalog.repeat('Z', 22),
  'src_' || pg_catalog.repeat('Z', 22),
  '00000000-0000-4000-8000-000000011504',
  'syn_' || pg_catalog.repeat('Z', 22),
  pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp()),
  '1.2.3',
  '4.5.6',
  pg_catalog.decode(pg_catalog.lpad('11504', 64, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('21504', 128, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('31504', 64, '0'), 'hex'),
  ARRAY[
    pg_catalog.to_char(
      pg_catalog.current_setting('viberacing.test_week_start')::date,
      'YYYY-MM-DD'
    )
  ],
  ARRAY[456]::bigint[]
);`,
    `SET ROLE viberacing_owner;
SELECT state FROM viberacing_private.device_keys
WHERE device_key_id = '00000000-0000-4000-8000-000000011405';`,
  );

  requireSuccess(
    psql(readFileSync(resolve(root, "database/tests/ingest_concurrency_assertions.sql"), "utf8")),
    "Community ingest concurrency assertions",
  );

  await expectConcurrentSuccesses(
    "expired origin nonce replacement race",
    `BEGIN;
SET LOCAL ROLE viberacing_owner;
SELECT origin_key_id
FROM viberacing_private.origin_nonces
WHERE origin_key_id = 'edge_race'
  AND nonce_digest = pg_catalog.decode(pg_catalog.repeat('88', 32), 'hex')
FOR UPDATE;
\\echo origin-replay-lock-ready`,
    "origin-replay-lock-ready",
    [
      `SET ROLE viberacing_ingest;
SELECT viberacing_api.consume_origin_nonce(
  'edge_race',
  pg_catalog.decode(pg_catalog.repeat('88', 32), 'hex'),
  pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()) + INTERVAL '60 seconds'
) AS consumed \\gset
\\if :consumed
\\else
  \\quit 1
\\endif`,
      `SET ROLE viberacing_ingest;
SELECT viberacing_api.consume_origin_nonce(
  'edge_race',
  pg_catalog.decode(pg_catalog.repeat('88', 32), 'hex'),
  pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()) + INTERVAL '60 seconds'
) AS consumed \\gset
\\if :consumed
  \\quit 1
\\endif`,
    ],
    { orderedContenders: true },
  );

  await expectConcurrentSuccesses(
    "origin proof expiry during lock wait",
    `BEGIN;
SET LOCAL ROLE viberacing_owner;
SELECT origin_key_id
FROM viberacing_private.origin_nonces
WHERE origin_key_id = 'edge_expiring_race'
  AND nonce_digest = pg_catalog.decode(pg_catalog.repeat('99', 32), 'hex')
FOR UPDATE;
\\echo origin-expiry-lock-ready`,
    "origin-expiry-lock-ready",
    [
      `SET ROLE viberacing_ingest;
SELECT viberacing_api.consume_origin_nonce(
  'edge_expiring_race',
  pg_catalog.decode(pg_catalog.repeat('99', 32), 'hex'),
  pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()) + INTERVAL '2 seconds'
) AS consumed \\gset
\\if :consumed
  \\quit 1
\\endif`,
    ],
    { releaseDelayMilliseconds: 2_500 },
  );

  requireSuccess(
    psql(
      readFileSync(
        resolve(root, "database/tests/origin_replay_concurrency_assertions.sql"),
        "utf8",
      ),
    ),
    "origin proof replay concurrency assertions",
  );

  await expectConcurrentSuccesses(
    "opposing-order multi-season Ingest lock race",
    `BEGIN;
SET LOCAL ROLE viberacing_owner;
SELECT pg_catalog.pg_advisory_xact_lock(
  824762002,
  (
    pg_catalog.current_setting('viberacing.test_week_start')::date
      - DATE '2000-01-03'
  )::integer
);
\\echo ingest-season-order-lock-ready`,
    "ingest-season-order-lock-ready",
    [
      `SET ROLE viberacing_ingest;
SELECT * FROM viberacing_api.submit_community_sync(
  '00000000-0000-4000-8000-000000011401',
  'dev_' || pg_catalog.repeat('S', 22),
  'src_' || pg_catalog.repeat('S', 22),
  '00000000-0000-4000-8000-000000011505',
  'syn_' || pg_catalog.repeat('3', 22),
  pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp()),
  '1.2.3',
  '4.5.6',
  pg_catalog.decode(pg_catalog.lpad('11505', 64, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('21505', 128, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('31505', 64, '0'), 'hex'),
  ARRAY[
    pg_catalog.to_char(
      pg_catalog.current_setting('viberacing.test_week_start')::date,
      'YYYY-MM-DD'
    ),
    pg_catalog.to_char(
      pg_catalog.current_setting('viberacing.test_week_start')::date + 7,
      'YYYY-MM-DD'
    )
  ],
  ARRAY[400, 100]::bigint[]
);`,
      `SET ROLE viberacing_ingest;
SELECT * FROM viberacing_api.submit_community_sync(
  '00000000-0000-4000-8000-000000011402',
  'dev_' || pg_catalog.repeat('T', 22),
  'src_' || pg_catalog.repeat('T', 22),
  '00000000-0000-4000-8000-000000011506',
  'syn_' || pg_catalog.repeat('7', 22),
  pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp()),
  '1.2.3',
  '4.5.6',
  pg_catalog.decode(pg_catalog.lpad('11506', 64, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('21506', 128, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('31506', 64, '0'), 'hex'),
  ARRAY[
    pg_catalog.to_char(
      pg_catalog.current_setting('viberacing.test_week_start')::date + 7,
      'YYYY-MM-DD'
    ),
    pg_catalog.to_char(
      pg_catalog.current_setting('viberacing.test_week_start')::date,
      'YYYY-MM-DD'
    )
  ],
  ARRAY[100, 800]::bigint[]
);`,
    ],
  );

  requireSuccess(
    psql(readFileSync(resolve(root, "database/tests/ingest_season_lock_assertions.sql"), "utf8")),
    "Community multi-season lock assertions",
  );

  await expectConcurrentSuccesses(
    "bounded ingest cleanup worker race",
    `BEGIN;
SET LOCAL ROLE viberacing_jobs;
SELECT * FROM viberacing_api.cleanup_expired_ingest_state(1);
\\echo cleanup-worker-lock-ready`,
    "cleanup-worker-lock-ready",
    [
      `SET ROLE viberacing_jobs;
SELECT * FROM viberacing_api.cleanup_expired_ingest_state(1);`,
    ],
  );

  requireSuccess(
    psql(readFileSync(resolve(root, "database/tests/cleanup_concurrency_assertions.sql"), "utf8")),
    "Community ingest cleanup concurrency assertions",
  );

  await expectConcurrentSuccesses(
    "idempotent Community scoring refresh race",
    `BEGIN;
SET LOCAL ROLE viberacing_jobs;
SELECT * FROM viberacing_api.refresh_community_season(
  pg_catalog.current_setting('viberacing.test_week_start')::date
);
\\echo scoring-refresh-lock-ready`,
    "scoring-refresh-lock-ready",
    [
      `SET ROLE viberacing_jobs;
SELECT * FROM viberacing_api.refresh_community_season(
  pg_catalog.current_setting('viberacing.test_week_start')::date
);`,
    ],
  );

  requireSuccess(
    psql(readFileSync(resolve(root, "database/tests/scoring_concurrency_assertions.sql"), "utf8")),
    "Community scoring concurrency assertions",
  );

  await expectConcurrentSuccesses(
    "bounded Community historical backlog worker race",
    `BEGIN;
SET LOCAL ROLE viberacing_owner;
SELECT capability
FROM viberacing_private.maintenance_locks
WHERE capability = 'community_scoring_refresh'
FOR UPDATE;
\\echo season-backlog-lock-ready`,
    "season-backlog-lock-ready",
    [
      `SET ROLE viberacing_jobs;
SELECT * FROM viberacing_api.finalize_community_season_backlog();`,
      `SET ROLE viberacing_jobs;
SELECT * FROM viberacing_api.finalize_community_season_backlog();`,
    ],
  );

  requireSuccess(
    psql(
      readFileSync(
        resolve(root, "database/tests/season_backlog_concurrency_assertions.sql"),
        "utf8",
      ),
    ),
    "Community historical backlog concurrency assertions",
  );

  await expectConcurrentSuccesses(
    "Community finalization versus late ingest race",
    `BEGIN;
SET LOCAL ROLE viberacing_owner;
SELECT pg_catalog.pg_advisory_xact_lock(
  824762002,
  (
    pg_catalog.current_setting('viberacing.test_week_start')::date
      - 14 - DATE '2000-01-03'
  )::integer
);
\\echo season-finalization-lock-ready`,
    "season-finalization-lock-ready",
    [
      `SET ROLE viberacing_jobs;
SELECT * FROM viberacing_api.finalize_community_season(
  pg_catalog.current_setting('viberacing.test_week_start')::date - 14
);`,
      `SET ROLE viberacing_ingest;
SELECT * FROM viberacing_api.submit_community_sync(
  '00000000-0000-4000-8000-000000017401',
  'dev_' || pg_catalog.repeat('M', 22),
  'src_' || pg_catalog.repeat('M', 22),
  '00000000-0000-4000-8000-000000017502',
  'syn_' || pg_catalog.repeat('N', 22),
  pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp()),
  '1.2.3',
  '4.5.6',
  pg_catalog.decode(pg_catalog.lpad('17502', 64, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('27502', 128, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('37502', 64, '0'), 'hex'),
  ARRAY[
    pg_catalog.to_char(
      pg_catalog.current_setting('viberacing.test_week_start')::date - 14,
      'YYYY-MM-DD'
    )
  ],
  ARRAY[9007199254740991]::bigint[]
);`,
    ],
  );

  requireSuccess(
    psql(
      readFileSync(resolve(root, "database/tests/finalization_concurrency_assertions.sql"), "utf8"),
    ),
    "Community finalization concurrency assertions",
  );

  await expectOneConcurrentWinner(
    "single pairing approval race",
    `BEGIN;
SET LOCAL ROLE viberacing_owner;
SELECT pairing_id
FROM viberacing_private.pairing_transactions
WHERE pairing_id = '00000000-0000-4000-8000-000000008501'
FOR UPDATE;
\\echo pairing-race-lock-ready`,
    "pairing-race-lock-ready",
    [
      `SET ROLE viberacing_web;
SELECT viberacing_api.approve_pairing(
  '00000000-0000-4000-8000-000000008201',
  pg_catalog.decode(pg_catalog.repeat('81', 32), 'hex'),
  '00000000-0000-4000-8000-000000008501',
  '00000000-0000-4000-8000-000000008701',
  pg_catalog.decode(pg_catalog.repeat('22', 32), 'hex'),
  '00000000-0000-4000-8000-000000008801',
  'req_' || pg_catalog.repeat('C', 22)
);`,
      `SET ROLE viberacing_web;
SELECT viberacing_api.approve_pairing(
  '00000000-0000-4000-8000-000000008202',
  pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex'),
  '00000000-0000-4000-8000-000000008501',
  '00000000-0000-4000-8000-000000008702',
  pg_catalog.decode(pg_catalog.repeat('24', 32), 'hex'),
  '00000000-0000-4000-8000-000000008802',
  'req_' || pg_catalog.repeat('D', 22)
);`,
    ],
  );

  await expectOneConcurrentWinner(
    "source ceiling race",
    `BEGIN;
SET LOCAL ROLE viberacing_owner;
SELECT profile_id
FROM viberacing_private.profiles
WHERE profile_id = '00000000-0000-4000-8000-000000008103'
FOR UPDATE;
\\echo source-cap-lock-ready`,
    "source-cap-lock-ready",
    [
      `SET ROLE viberacing_web;
SELECT viberacing_api.approve_pairing(
  '00000000-0000-4000-8000-000000008203',
  pg_catalog.decode(pg_catalog.repeat('83', 32), 'hex'),
  '00000000-0000-4000-8000-000000008502',
  '00000000-0000-4000-8000-000000008703',
  pg_catalog.decode(pg_catalog.repeat('26', 32), 'hex'),
  '00000000-0000-4000-8000-000000008803',
  'req_' || pg_catalog.repeat('E', 22)
);`,
      `SET ROLE viberacing_web;
SELECT viberacing_api.approve_pairing(
  '00000000-0000-4000-8000-000000008204',
  pg_catalog.decode(pg_catalog.repeat('84', 32), 'hex'),
  '00000000-0000-4000-8000-000000008503',
  '00000000-0000-4000-8000-000000008704',
  pg_catalog.decode(pg_catalog.repeat('28', 32), 'hex'),
  '00000000-0000-4000-8000-000000008804',
  'req_' || pg_catalog.repeat('F', 22)
);`,
    ],
  );

  await expectOneConcurrentWinner(
    "device authority ceiling race",
    `BEGIN;
SET LOCAL ROLE viberacing_owner;
SELECT profile_id
FROM viberacing_private.profiles
WHERE profile_id = '00000000-0000-4000-8000-000000008104'
FOR UPDATE;
\\echo device-cap-lock-ready`,
    "device-cap-lock-ready",
    [
      `SET ROLE viberacing_web;
SELECT viberacing_api.approve_pairing(
  '00000000-0000-4000-8000-000000008205',
  pg_catalog.decode(pg_catalog.repeat('85', 32), 'hex'),
  '00000000-0000-4000-8000-000000008504',
  '00000000-0000-4000-8000-000000008705',
  pg_catalog.decode(pg_catalog.repeat('2a', 32), 'hex'),
  '00000000-0000-4000-8000-000000008805',
  'req_' || pg_catalog.repeat('G', 22)
);`,
      `SET ROLE viberacing_web;
SELECT viberacing_api.approve_pairing(
  '00000000-0000-4000-8000-000000008206',
  pg_catalog.decode(pg_catalog.repeat('86', 32), 'hex'),
  '00000000-0000-4000-8000-000000008505',
  '00000000-0000-4000-8000-000000008706',
  pg_catalog.decode(pg_catalog.repeat('2c', 32), 'hex'),
  '00000000-0000-4000-8000-000000008806',
  'req_' || pg_catalog.repeat('H', 22)
);`,
    ],
  );

  requireSuccess(
    psql(readFileSync(resolve(root, "database/tests/pairing_concurrency_assertions.sql"), "utf8")),
    "pairing concurrency assertions",
  );

  await expectProtectiveActionDominates(
    "source pause versus pairing approval race",
    `BEGIN;
SET LOCAL ROLE viberacing_owner;
SELECT profile_id
FROM viberacing_private.profiles
WHERE profile_id = '00000000-0000-4000-8000-000000007101'
FOR UPDATE;
\\echo source-pause-lock-ready`,
    "source-pause-lock-ready",
    `SET ROLE viberacing_web;
SELECT viberacing_api.pause_source(
  '00000000-0000-4000-8000-000000007201',
  pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
  'src_' || pg_catalog.repeat('L', 22),
  '00000000-0000-4000-8000-000000007801',
  'req_' || pg_catalog.repeat('K', 22)
);`,
    `SET ROLE viberacing_web;
SELECT viberacing_api.approve_pairing(
  '00000000-0000-4000-8000-000000007201',
  pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
  '00000000-0000-4000-8000-000000007501',
  '00000000-0000-4000-8000-000000007701',
  pg_catalog.decode(pg_catalog.repeat('e2', 32), 'hex'),
  '00000000-0000-4000-8000-000000007802',
  'req_' || pg_catalog.repeat('L', 22)
);`,
  );

  await expectProtectiveActionDominates(
    "source unlink versus device activation race",
    `BEGIN;
SET LOCAL ROLE viberacing_owner;
SELECT profile_id
FROM viberacing_private.profiles
WHERE profile_id = '00000000-0000-4000-8000-000000007102'
FOR UPDATE;
\\echo source-unlink-lock-ready`,
    "source-unlink-lock-ready",
    `SET ROLE viberacing_web;
SELECT viberacing_api.unlink_source(
  '00000000-0000-4000-8000-000000007202',
  pg_catalog.decode(pg_catalog.repeat('a2', 32), 'hex'),
  'src_' || pg_catalog.repeat('N', 22),
  '00000000-0000-4000-8000-000000007702',
  pg_catalog.decode(pg_catalog.repeat('e4', 32), 'hex'),
  '00000000-0000-4000-8000-000000007803',
  'req_' || pg_catalog.repeat('M', 22)
);`,
    `SET ROLE viberacing_web;
SELECT viberacing_api.activate_pairing(
  pg_catalog.decode(pg_catalog.repeat('d6', 32), 'hex'),
  '00000000-0000-4000-8000-000000007502',
  'dev_' || pg_catalog.repeat('X', 22),
  '00000000-0000-4000-8000-000000007804',
  'req_' || pg_catalog.repeat('N', 22)
);`,
  );

  requireSuccess(
    psql(
      readFileSync(resolve(root, "database/tests/lifecycle_concurrency_assertions.sql"), "utf8"),
    ),
    "source lifecycle concurrency assertions",
  );

  await expectOneConcurrentWinner(
    "single passkey login challenge race",
    `BEGIN;
SET LOCAL ROLE viberacing_owner;
SELECT profile_id
FROM viberacing_private.profiles
WHERE profile_id = '00000000-0000-4000-8000-000000006101'
FOR UPDATE;
\\echo passkey-login-lock-ready`,
    "passkey-login-lock-ready",
    [
      `SET ROLE viberacing_web;
SELECT viberacing_api.complete_passkey_login(
  '00000000-0000-4000-8000-000000006601',
  pg_catalog.decode(pg_catalog.repeat('d1', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('e1', 32), 'hex'),
  '00000000-0000-4000-8000-000000006301',
  pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
  1,
  false,
  '00000000-0000-4000-8000-000000006211',
  pg_catalog.decode(pg_catalog.repeat('f1', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '1 hour',
  '00000000-0000-4000-8000-000000006901',
  'req_' || pg_catalog.repeat('P', 22)
);`,
      `SET ROLE viberacing_web;
SELECT viberacing_api.complete_passkey_login(
  '00000000-0000-4000-8000-000000006601',
  pg_catalog.decode(pg_catalog.repeat('d1', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('e1', 32), 'hex'),
  '00000000-0000-4000-8000-000000006301',
  pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
  1,
  false,
  '00000000-0000-4000-8000-000000006212',
  pg_catalog.decode(pg_catalog.repeat('f2', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '1 hour',
  '00000000-0000-4000-8000-000000006902',
  'req_' || pg_catalog.repeat('Q', 22)
);`,
    ],
  );

  await expectProtectiveActionDominates(
    "passkey revoke versus login race",
    `BEGIN;
SET LOCAL ROLE viberacing_owner;
SELECT profile_id
FROM viberacing_private.profiles
WHERE profile_id = '00000000-0000-4000-8000-000000006102'
FOR UPDATE;
\\echo passkey-revoke-lock-ready`,
    "passkey-revoke-lock-ready",
    `SET ROLE viberacing_web;
SELECT viberacing_api.revoke_passkey(
  '00000000-0000-4000-8000-000000006201',
  pg_catalog.decode(pg_catalog.repeat('c1', 32), 'hex'),
  '00000000-0000-4000-8000-000000006302',
  '00000000-0000-4000-8000-000000006603',
  pg_catalog.decode(pg_catalog.repeat('e3', 32), 'hex'),
  '00000000-0000-4000-8000-000000006903',
  'req_' || pg_catalog.repeat('R', 22)
);`,
    `SET ROLE viberacing_web;
SELECT viberacing_api.complete_passkey_login(
  '00000000-0000-4000-8000-000000006602',
  pg_catalog.decode(pg_catalog.repeat('d2', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('e2', 32), 'hex'),
  '00000000-0000-4000-8000-000000006302',
  pg_catalog.decode(pg_catalog.repeat('a2', 32), 'hex'),
  1,
  false,
  '00000000-0000-4000-8000-000000006213',
  pg_catalog.decode(pg_catalog.repeat('f3', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '1 hour',
  '00000000-0000-4000-8000-000000006904',
  'req_' || pg_catalog.repeat('S', 22)
);`,
  );

  requireSuccess(
    psql(readFileSync(resolve(root, "database/tests/passkey_concurrency_assertions.sql"), "utf8")),
    "passkey concurrency assertions",
  );

  await expectOneConcurrentWinner(
    "single recovery code start race",
    `BEGIN;
SET LOCAL ROLE viberacing_owner;
SELECT profile_id
FROM viberacing_private.profiles
WHERE profile_id = '00000000-0000-4000-8000-000000005101'
FOR UPDATE;
\\echo recovery-code-lock-ready`,
    "recovery-code-lock-ready",
    [
      `SET ROLE viberacing_web;
SELECT viberacing_api.start_recovery(
  '00000000-0000-4000-8000-000000005701',
  '00000000-0000-4000-8000-000000005911',
  pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('a2', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('a3', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '9 minutes',
  '00000000-0000-4000-8000-000000005901',
  'req_' || pg_catalog.repeat('T', 22)
);`,
      `SET ROLE viberacing_web;
SELECT viberacing_api.start_recovery(
  '00000000-0000-4000-8000-000000005701',
  '00000000-0000-4000-8000-000000005912',
  pg_catalog.decode(pg_catalog.repeat('b1', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('b2', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('b3', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '9 minutes',
  '00000000-0000-4000-8000-000000005902',
  'req_' || pg_catalog.repeat('U', 22)
);`,
    ],
  );

  await expectProtectiveActionDominates(
    "recovery-code rotation versus old-code start race",
    `BEGIN;
SET LOCAL ROLE viberacing_owner;
SELECT profile_id
FROM viberacing_private.profiles
WHERE profile_id = '00000000-0000-4000-8000-000000005102'
FOR UPDATE;
\\echo recovery-rotation-lock-ready`,
    "recovery-rotation-lock-ready",
    `SET ROLE viberacing_web;
SELECT viberacing_api.replace_recovery_codes(
  '00000000-0000-4000-8000-000000005202',
  pg_catalog.decode(pg_catalog.repeat('52', 32), 'hex'),
  '00000000-0000-4000-8000-000000005802',
  pg_catalog.decode(pg_catalog.repeat('83', 32), 'hex'),
  '00000000-0000-4000-8000-000000005612',
  ARRAY(
    SELECT ('00000000-0000-4000-8005-' || pg_catalog.lpad((7500 + value)::text, 12, '0'))::uuid
    FROM pg_catalog.generate_series(1, 8) AS generated(value)
  ),
  ARRAY(
    SELECT '$argon2id$v=19$m=65536,t=3,p=1$c2FsdA$' || pg_catalog.repeat('o', 31) || value
    FROM pg_catalog.generate_series(1, 8) AS generated(value)
  ),
  '00000000-0000-4000-8000-000000005904',
  'req_' || pg_catalog.repeat('V', 22)
);`,
    `SET ROLE viberacing_web;
SELECT viberacing_api.start_recovery(
  '00000000-0000-4000-8000-000000005702',
  '00000000-0000-4000-8000-000000005914',
  pg_catalog.decode(pg_catalog.repeat('c1', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('c2', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('c3', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '9 minutes',
  '00000000-0000-4000-8000-000000005905',
  'req_' || pg_catalog.repeat('W', 22)
);`,
    `SET ROLE viberacing_owner;
SELECT
  challenge_record.consumed_at IS NOT NULL AS challenge_consumed,
  challenge_record.authorized_action_used_at IS NOT NULL AS action_claimed,
  session_record.state AS session_state,
  passkey_record.state AS passkey_state,
  recovery_code.used_at IS NOT NULL AS old_code_used,
  recovery_code.verifier_phc IS NULL AS old_verifier_scrubbed,
  recovery_authority.state AS authority_state
FROM viberacing_private.auth_challenges AS challenge_record
JOIN viberacing_private.sessions AS session_record
  ON session_record.session_id = '00000000-0000-4000-8000-000000005202'
JOIN viberacing_private.passkeys AS passkey_record
  ON passkey_record.passkey_id = '00000000-0000-4000-8000-000000005302'
LEFT JOIN viberacing_private.recovery_codes AS recovery_code
  ON recovery_code.recovery_code_id = '00000000-0000-4000-8000-000000005702'
LEFT JOIN viberacing_private.recovery_authorities AS recovery_authority
  ON recovery_authority.recovery_authority_id = '00000000-0000-4000-8000-000000005914'
WHERE challenge_record.challenge_id = '00000000-0000-4000-8000-000000005802';`,
  );

  await expectProtectiveActionDominates(
    "recovery completion versus old-passkey login race",
    `BEGIN;
SET LOCAL ROLE viberacing_owner;
SELECT profile_id
FROM viberacing_private.profiles
WHERE profile_id = '00000000-0000-4000-8000-000000005103'
FOR UPDATE;
\\echo recovery-completion-lock-ready`,
    "recovery-completion-lock-ready",
    `SET ROLE viberacing_web;
SELECT viberacing_api.complete_recovery_registration(
  '00000000-0000-4000-8000-000000005913',
  pg_catalog.decode(pg_catalog.repeat('91', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('92', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('93', 32), 'hex'),
  '00000000-0000-4000-8000-000000005313',
  pg_catalog.decode(pg_catalog.repeat('34', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('44', 64), 'hex'),
  'Recovery race replacement',
  0,
  false,
  false,
  '00000000-0000-4000-8000-000000005213',
  pg_catalog.decode(pg_catalog.repeat('f9', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '1 hour',
  '00000000-0000-4000-8000-000000005906',
  'req_' || pg_catalog.repeat('X', 22)
);`,
    `SET ROLE viberacing_web;
SELECT viberacing_api.complete_passkey_login(
  '00000000-0000-4000-8000-000000005803',
  pg_catalog.decode(pg_catalog.repeat('84', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('85', 32), 'hex'),
  '00000000-0000-4000-8000-000000005303',
  pg_catalog.decode(pg_catalog.repeat('33', 32), 'hex'),
  1,
  false,
  '00000000-0000-4000-8000-000000005214',
  pg_catalog.decode(pg_catalog.repeat('54', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '1 hour',
  '00000000-0000-4000-8000-000000005907',
  'req_' || pg_catalog.repeat('Y', 22)
);`,
  );

  requireSuccess(
    psql(readFileSync(resolve(root, "database/tests/recovery_concurrency_assertions.sql"), "utf8")),
    "recovery concurrency assertions",
  );

  for (const role of [
    "viberacing_web",
    "viberacing_ingest",
    "viberacing_jobs",
    "viberacing_admin",
  ]) {
    expectDenied(role, "SELECT count(*) FROM viberacing_private.profiles;", `${role} private read`);
    expectDenied(
      role,
      "SELECT count(*) FROM viberacing_private.source_day_values;",
      `${role} private usage read`,
    );
    expectDenied(
      role,
      "SELECT count(*) FROM viberacing_private.pairing_request_windows;",
      `${role} private pairing rate read`,
    );
    expectDenied(
      role,
      "CREATE TABLE viberacing_api.forbidden (value integer);",
      `${role} API schema mutation`,
    );
  }

  expectDenied(
    "viberacing_web",
    `SELECT viberacing_api.issue_invite(
      '00000000-0000-4000-8000-000000009001',
      pg_catalog.decode(pg_catalog.repeat('90', 32), 'hex'),
      pg_catalog.statement_timestamp() + INTERVAL '1 hour',
      '00000000-0000-4000-8000-000000009002',
      'req_' || pg_catalog.repeat('Z', 22),
      'SECURITY_REVIEW'
    );`,
    "web invite issuance",
  );
  expectDenied(
    "viberacing_admin",
    `SELECT viberacing_api.enroll_profile(
      '00000000-0000-4000-8000-000000009011',
      pg_catalog.decode(pg_catalog.repeat('91', 32), 'hex'),
      '00000000-0000-4000-8000-000000009012',
      900000000000009012,
      'denied-driver',
      'en',
      'neon-night',
      'system',
      true,
      '00000000-0000-4000-8000-000000009013',
      pg_catalog.decode(pg_catalog.repeat('92', 32), 'hex'),
      pg_catalog.statement_timestamp() + INTERVAL '1 hour',
      '00000000-0000-4000-8000-000000009014',
      'req_' || pg_catalog.repeat('Y', 22)
    );`,
    "admin profile enrollment",
  );
  expectDenied(
    "viberacing_ingest",
    `SELECT viberacing_api.revoke_session(
      '00000000-0000-4000-8000-000000009021',
      pg_catalog.decode(pg_catalog.repeat('93', 32), 'hex'),
      '00000000-0000-4000-8000-000000009022',
      'req_' || pg_catalog.repeat('X', 22)
    );`,
    "ingest session revocation",
  );
  expectDenied(
    "viberacing_jobs",
    `SELECT viberacing_api.consume_auth_challenge(
      '00000000-0000-4000-8000-000000009031',
      pg_catalog.decode(pg_catalog.repeat('94', 32), 'hex'),
      '00000000-0000-4000-8000-000000009032',
      'profile_deletion',
      pg_catalog.decode(pg_catalog.repeat('95', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('96', 32), 'hex')
    );`,
    "jobs challenge consumption",
  );
  for (const role of ["viberacing_ingest", "viberacing_jobs", "viberacing_admin"]) {
    expectDenied(
      role,
      `SELECT * FROM viberacing_api.complete_passkey_login_session(
        '00000000-0000-4000-8000-000000009035',
        pg_catalog.decode(pg_catalog.repeat('94', 32), 'hex'),
        pg_catalog.decode(pg_catalog.repeat('95', 32), 'hex'),
        pg_catalog.statement_timestamp() + INTERVAL '4 minutes',
        '00000000-0000-4000-8000-000000009036',
        pg_catalog.decode(pg_catalog.repeat('96', 32), 'hex'),
        0,
        false,
        '00000000-0000-4000-8000-000000009037',
        pg_catalog.decode(pg_catalog.repeat('97', 32), 'hex'),
        pg_catalog.statement_timestamp() + INTERVAL '1 hour',
        '00000000-0000-4000-8000-000000009038',
        'req_' || pg_catalog.repeat('W', 22)
      );`,
      `${role} passkey login session result`,
    );
  }
  expectDenied(
    "viberacing_admin",
    `SELECT viberacing_api.start_pairing(
      '00000000-0000-4000-8000-000000009041',
      pg_catalog.decode(pg_catalog.repeat('97', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('98', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('99', 32), 'hex'),
      '00000000-0000-4000-8000-000000009042',
      pg_catalog.decode(pg_catalog.repeat('9a', 32), 'hex'),
      'denied-device',
      '0.0.0-test',
      'test-os',
      'test-arch',
      pg_catalog.statement_timestamp() + INTERVAL '5 minutes'
    );`,
    "admin pairing start",
  );
  for (const role of ["viberacing_ingest", "viberacing_jobs", "viberacing_admin"]) {
    expectDenied(
      role,
      `SELECT viberacing_api.admit_pairing_transport_request(
        'start',
        pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex'),
        100,
        10,
        60
      );`,
      `${role} pairing transport admission`,
    );
  }
  expectDenied(
    "viberacing_ingest",
    `SELECT viberacing_api.pause_source(
      '00000000-0000-4000-8000-000000009051',
      pg_catalog.decode(pg_catalog.repeat('9b', 32), 'hex'),
      'src_' || pg_catalog.repeat('Z', 22),
      '00000000-0000-4000-8000-000000009052',
      'req_' || pg_catalog.repeat('W', 22)
    );`,
    "ingest source pause",
  );
  expectDenied(
    "viberacing_jobs",
    `SELECT viberacing_api.start_recovery(
      '00000000-0000-4000-8000-000000009061',
      '00000000-0000-4000-8000-000000009062',
      pg_catalog.decode(pg_catalog.repeat('9c', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('9d', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('9e', 32), 'hex'),
      pg_catalog.statement_timestamp() + INTERVAL '5 minutes',
      '00000000-0000-4000-8000-000000009063',
      'req_' || pg_catalog.repeat('V', 22)
    );`,
    "jobs recovery start",
  );

  for (const role of ["viberacing_web", "viberacing_jobs", "viberacing_admin"]) {
    expectDenied(
      role,
      `SELECT * FROM viberacing_api.read_device_verification_material(
        'dev_' || pg_catalog.repeat('A', 22)
      );`,
      `${role} device verification material read`,
    );
    expectDenied(
      role,
      `SELECT * FROM viberacing_api.submit_community_sync(
        '00000000-0000-4000-8000-000000019401',
        'dev_' || pg_catalog.repeat('A', 22),
        'src_' || pg_catalog.repeat('A', 22),
        '00000000-0000-4000-8000-000000019501',
        'syn_' || pg_catalog.repeat('A', 22),
        pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp()),
        '1.2.3',
        '4.5.6',
        pg_catalog.decode(pg_catalog.lpad('19501', 64, '0'), 'hex'),
        pg_catalog.decode(pg_catalog.lpad('29501', 128, '0'), 'hex'),
        pg_catalog.decode(pg_catalog.lpad('39501', 64, '0'), 'hex'),
        ARRAY['2026-07-15'],
        ARRAY[1]::bigint[]
      );`,
      `${role} Community sync submission`,
    );
  }

  for (const role of ["viberacing_web", "viberacing_ingest", "viberacing_admin"]) {
    expectDenied(
      role,
      "SELECT * FROM viberacing_api.cleanup_expired_auth_state(1);",
      `${role} authentication cleanup`,
    );
    expectDenied(
      role,
      "SELECT * FROM viberacing_api.cleanup_expired_audit_events(1);",
      `${role} audit-event cleanup`,
    );
    expectDenied(
      role,
      "SELECT * FROM viberacing_api.redact_aged_pairing_approval_provenance(1);",
      `${role} pairing approval-provenance redaction`,
    );
    expectDenied(
      role,
      "SELECT * FROM viberacing_api.cleanup_aged_revoked_passkeys(1);",
      `${role} revoked-passkey cleanup`,
    );
    expectDenied(
      role,
      "SELECT * FROM viberacing_api.cleanup_aged_revoked_devices(1);",
      `${role} revoked-device cleanup`,
    );
    expectDenied(
      role,
      "SELECT * FROM viberacing_api.reset_expired_pairing_request_windows();",
      `${role} pairing rate-window reset`,
    );
    expectDenied(
      role,
      "SELECT * FROM viberacing_api.cleanup_expired_car_recipe_proposals(1);",
      `${role} CarRecipe proposal cleanup`,
    );
    expectDenied(
      role,
      "SELECT * FROM viberacing_api.cleanup_expired_invites(1);",
      `${role} invite cleanup`,
    );
    expectDenied(
      role,
      "SELECT * FROM viberacing_api.cleanup_expired_ingest_state(1);",
      `${role} Community ingest cleanup`,
    );
    expectDenied(
      role,
      "SELECT * FROM viberacing_api.cleanup_expired_sessions(1);",
      `${role} session cleanup`,
    );
    expectDenied(
      role,
      "SELECT * FROM viberacing_api.cleanup_terminal_deletion_jobs(1);",
      `${role} terminal deletion-job cleanup`,
    );
    expectDenied(
      role,
      "SELECT * FROM viberacing_api.refresh_community_season('2026-07-06');",
      `${role} Community season refresh`,
    );
    expectDenied(
      role,
      "SELECT * FROM viberacing_api.finalize_community_season('2026-07-06');",
      `${role} Community season finalization`,
    );
    expectDenied(
      role,
      "SELECT * FROM viberacing_api.finalize_community_season_backlog();",
      `${role} Community historical season backlog finalization`,
    );
  }

  for (const role of ["viberacing_ingest", "viberacing_jobs", "viberacing_admin"]) {
    expectDenied(
      role,
      "SELECT * FROM viberacing_api.list_public_community_scores('2026-07-06', 10);",
      `${role} public Community score projection`,
    );
    expectDenied(
      role,
      "SELECT * FROM viberacing_api.list_public_community_race('2026-07-06', 10);",
      `${role} public Community race projection`,
    );
  }

  if (
    observedLockWaitRaceCount !== expectedObservedLockWaitRaceCount ||
    observedMigrationOverlapCount !== expectedObservedMigrationOverlapCount ||
    observedEarlyCompletionOverlapCount !== expectedObservedEarlyCompletionOverlapCount
  ) {
    throw new Error(
      `Database race inventory drifted: observed ${observedLockWaitRaceCount} lock-wait, ${observedMigrationOverlapCount} migration-overlap, and ${observedEarlyCompletionOverlapCount} early-completion overlap scenarios.`,
    );
  }
  const postRestoreLockWaitRaceCount = observedLockWaitRaceCount - observedMigrationOverlapCount;

  console.log(
    `Database integration passed (${observedMigrationOverlapCount} pre-restore serialized migration-overlap race, 28 forced-RLS tables after two current-snapshot restores from archives no larger than ${restoreEvidence.archiveBytes} bytes, SHA-256/length-identical ${restoreEvidence.dataBytes}-byte data dumps, a byte-stable ${restoreEvidence.schemaBytes}-byte canonical restored schema, ${postRestoreLockWaitRaceCount} post-restore lock-wait races, ${observedEarlyCompletionOverlapCount} post-restore early-completion overlap, 12 relation-denial and 67 cross-capability checks).`,
  );
} finally {
  if (started) {
    const cleanup = docker([...composePrefix, "down", "--volumes", "--remove-orphans"], {
      stdio: "inherit",
    });
    if (cleanup.status !== 0) {
      process.exitCode = cleanup.status ?? 1;
    }
  }
}

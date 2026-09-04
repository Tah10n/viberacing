import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  ensureOwnerOnlyWindowsFile,
  ensurePrivateStateDirectory,
  inspectOwnerOnlyWindowsFile,
} from "../packages/connector/lib/windows-security.mjs";
import {
  buildEvidenceReport,
  captureCursorHook,
  inspectJsonl,
  installProbeHooks,
  observationCapacityReached,
  removeProbeHooks,
  runCursorCli,
  sanitizeCursorObservation,
  schemaSignature,
} from "./cursor-evidence-probe.mjs";

const hmacKey = "a".repeat(43);
const runA = "11111111-1111-4111-8111-111111111111";
const runB = "22222222-2222-4222-8222-222222222222";
const probeScript = fileURLToPath(new URL("./cursor-evidence-probe.mjs", import.meta.url));
const closeFixture = fileURLToPath(
  new URL("./fixtures/cursor-evidence-cli-close-fixture.mjs", import.meta.url),
);

function context(overrides = {}) {
  return {
    surface: "desktop",
    scenario: "desktop-one-turn",
    runId: runA,
    step: "single",
    eventName: "stop",
    hmacKey,
    approvedVersionPaths: ["$.cursor_version"],
    ...overrides,
  };
}

async function privateTemporaryDirectory(testContext, prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  if (process.platform === "win32") await ensurePrivateStateDirectory(directory);
  else await chmod(directory, 0o700);
  testContext.after(() =>
    rm(directory, {
      recursive: true,
      force: true,
      maxRetries: process.platform === "win32" ? 50 : 0,
      retryDelay: 100,
    }),
  );
  return directory;
}

async function writePrivateFile(path, contents, options = {}) {
  await writeFile(path, contents, { mode: 0o600, ...options });
  await ensureOwnerOnlyWindowsFile(path);
}

async function writeExecutable(path, source) {
  await writeFile(path, source, { mode: 0o700 });
  if (process.platform !== "win32") await chmod(path, 0o700);
}

function usagePayload(account, timestamp = "2026-09-03T00:00:01.000Z", extra = {}) {
  return {
    account_id: `account-${account}`,
    user_email: `${account}@example.invalid`,
    request_id: `request-${account}-${timestamp}`,
    timestamp,
    cursor_version: "3.18.0",
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheWriteTokens: 40,
      totalTokens: 100,
    },
    ...extra,
  };
}

function hooksDocument(...commands) {
  return {
    version: 1,
    hooks: { stop: commands.map((command) => ({ command })) },
  };
}

const reportSelections = {
  counterPaths: ["$.usage"],
  accountPaths: ["$.account_id", "$.user_email"],
  eventIdPaths: ["$.request_id"],
  timestampPaths: ["$.timestamp"],
  versionSources: ["$.cursor_version", "cli"],
};

async function writeEvidenceRows(outputDirectory, rows) {
  const observationsDirectory = join(outputDirectory, "observations");
  await mkdir(observationsDirectory, { recursive: true, mode: 0o700 });
  const state = JSON.parse(
    await readFile(join(outputDirectory, "cursor-evidence-state.json"), "utf8"),
  );
  const groups = new Map();
  for (const row of rows) {
    await writePrivateFile(
      join(observationsDirectory, `${row.observationId}.json`),
      `${JSON.stringify(row)}\n`,
    );
    const key = `${row.declaredRunId}\0${row.declaredStep}\0${row.eventName}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const [first] = group;
    const identity = (first.eventIdentities ?? []).find(
      (candidate) =>
        candidate.field === "request_id" &&
        candidate.path === "$.request_id" &&
        !candidate.contentDerived,
    );
    const isHook = ["afterAgentResponse", "stop", "sessionEnd"].includes(first.eventName);
    const runsDirectory = join(outputDirectory, "runs");
    const runDirectory = join(runsDirectory, first.declaredRunId);
    const directory = join(runDirectory, first.declaredStep);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (process.platform === "win32") {
      await ensurePrivateStateDirectory(runsDirectory, {
        paths: [runsDirectory, runDirectory, directory],
      });
    }
    const manifest = {
      schemaVersion: 1,
      manifestId: randomUUID(),
      probeId: state.probeId,
      declaredSurface: first.declaredSurface,
      declaredScenario: first.declaredScenario,
      declaredRunId: first.declaredRunId,
      declaredStep: first.declaredStep,
      eventName: first.eventName,
      expectedEventIdentity:
        isHook && identity
          ? { kind: identity.field, path: identity.path, hash: identity.hash }
          : null,
      versionPath: "$.cursor_version",
      status: "completed",
      createdAt: "2026-09-03T00:00:00.000Z",
      startedAt: "2026-09-03T00:00:00.000Z",
      completedAt: "2026-09-03T00:00:01.000Z",
      invocationCount: 1,
      inputComplete: true,
      failureCode: null,
      activeInvocationId: null,
      identityBindingStatus: isHook ? (identity ? "matched" : "unbound") : "not_applicable",
      observationIds: group.map(({ observationId }) => observationId),
      schemaSignatures: [...new Set(group.map(schemaSignature))].sort(),
      contracts: [...new Set(group.map(schemaSignature))].sort().map((signature) => ({
        schemaSignature: signature,
        observationIds: group
          .filter((entry) => schemaSignature(entry) === signature)
          .map(({ observationId }) => observationId)
          .sort(),
      })),
    };
    await writePrivateFile(
      join(directory, `${first.eventName}.json`),
      `${JSON.stringify(manifest)}\n`,
    );
  }
}

test("sanitizer traverses nested content while hashing unknown keys and dropping scalar canaries", () => {
  const keyCanaries = ["CANARY_KEY_OBJECT", "CANARY_KEY_MAP", "CANARY_KEY_ARRAY"];
  const valueCanaries = [
    "CANARY_PROMPT_PRIVATE",
    "CANARY_RESPONSE_PRIVATE",
    "CANARY_SOURCE_CODE_PRIVATE",
    "/CANARY/ABSOLUTE/PATH",
    "CANARY_MODEL_PRIVATE",
    "CANARY_COST_PRIVATE",
    "CANARY_ACCOUNT_ID_PRIVATE",
    "canary.private@example.invalid",
  ];
  const observation = sanitizeCursorObservation(
    {
      prompt: valueCanaries[0],
      response: {
        content: {
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            cache_read_tokens: 30,
            cache_write_tokens: 40,
            total_tokens: 100,
          },
          [keyCanaries[0]]: valueCanaries[1],
        },
      },
      metadata: {
        [keyCanaries[1]]: { code: valueCanaries[2], path: valueCanaries[3] },
      },
      attachments: [{ [keyCanaries[2]]: valueCanaries[4], cost: valueCanaries[5] }],
      account_id: valueCanaries[6],
      user_email: valueCanaries[7],
      timestamp: "2026-09-03T00:00:01.000Z",
    },
    context(),
  );
  const serialized = JSON.stringify(observation);
  for (const canary of [...keyCanaries, ...valueCanaries])
    assert.doesNotMatch(serialized, new RegExp(canary.replaceAll("/", "\\/")));
  assert.ok(observation.schemaPaths.some((path) => path.includes("field1_")));
  assert.deepEqual(observation.tokenGroups[0], {
    path: "$.response.content.usage",
    counters: {
      inputTokens: "10",
      outputTokens: "20",
      cacheReadTokens: "30",
      cacheWriteTokens: "40",
      totalTokens: "100",
    },
    candidateRelationships: ["total_equals_input_output_cache_read_cache_write"],
    contentDerived: true,
  });
  assert.equal(observation.accountAmbiguous, false);
  assert.deepEqual(
    observation.accountIdentityCandidates.map(({ kind, hashes }) => [kind, hashes.length]),
    [
      ["account_id", 1],
      ["user_email", 1],
    ],
  );
});

test("sanitizer marks every traversal limit and never lets truncated data qualify silently", () => {
  const deep = {};
  let cursor = deep;
  for (let index = 0; index < 12; index += 1) cursor = cursor[`level-${index}`] = {};
  const wide = Object.fromEntries(
    Array.from({ length: 300 }, (_, index) => [`wide-${index}`, index]),
  );
  const manyPaths = Object.fromEntries(
    Array.from({ length: 256 }, (_, index) => [
      `branch-${index}`,
      { [`leaf-${index}-a`]: true, [`leaf-${index}-b`]: true },
    ]),
  );
  const observation = sanitizeCursorObservation(
    {
      deep,
      wide,
      array: Array.from({ length: 17 }, () => ({})),
      identities: Object.fromEntries(
        Array.from({ length: 33 }, (_, index) => [
          `identity-${index}`,
          { request_id: `request-${index}` },
        ]),
      ),
      manyPaths,
    },
    context(),
  );
  assert.equal(observation.truncated, true);
  assert.deepEqual(observation.truncationReasons, [
    "array_item_limit",
    "depth_limit",
    "object_key_limit",
    "schema_path_limit",
  ]);
});

test("integer, account, and timestamp validation is conservative and provenance-preserving", () => {
  const invalid = sanitizeCursorObservation(
    {
      account_id: "CaseSensitive",
      nested: { accountId: "casesensitive" },
      timestamp: "2026-02-30T00:00:00Z",
      createdAt: "2026-09-03T00:00:00Z",
      started_at: "2026-09-03T01:00:00Z",
      usage: {
        inputTokens: 1.5,
        outputTokens: -1,
        cacheReadTokens: Number.MAX_SAFE_INTEGER + 1,
        cacheWriteTokens: "01",
        totalTokens: "request-count-not-tokens",
      },
    },
    context(),
  );
  assert.equal(invalid.accountAmbiguous, true);
  assert.equal(invalid.timestampAmbiguous, true);
  assert.equal(invalid.providerTimestamp, null);
  assert.equal(invalid.timestampCandidates.length, 2);
  assert.equal(invalid.invalidTimestampPaths.length, 1);
  assert.equal(invalid.invalidCounterPaths.length, 5);

  const unknownOffset = sanitizeCursorObservation(
    { timestamp: "2026-09-03T00:00:00-00:00" },
    context(),
  );
  assert.equal(unknownOffset.providerTimestamp, null);
  assert.deepEqual(unknownOffset.invalidTimestampPaths, ["$.timestamp"]);

  const emailUpper = sanitizeCursorObservation({ user_email: " USER@Example.Invalid " }, context());
  const emailLower = sanitizeCursorObservation({ userEmail: "user@example.invalid" }, context());
  assert.equal(
    emailUpper.accountIdentityCandidates.find(({ kind }) => kind === "user_email").hashes[0],
    emailLower.accountIdentityCandidates.find(({ kind }) => kind === "user_email").hashes[0],
  );
});

test("exact paths exclude content and unknown-wrapper candidates without leaking raw versions", async (testContext) => {
  const outputDirectory = await privateTemporaryDirectory(testContext, "viberacing-cursor-output-");
  const cursorRoot = await privateTemporaryDirectory(testContext, "viberacing-cursor-hooks-");
  await installProbeHooks({
    outputDirectory,
    surface: "desktop",
    scenario: "desktop-one-turn",
    runId: runA,
    step: "single",
    hooksFile: join(cursorRoot, "hooks.json"),
  });
  await rm(join(outputDirectory, "runs"), { recursive: true, force: true });
  const malicious = {
    ...usagePayload("trusted"),
    tool_call: {
      result: {
        account_id: "content-account",
        user_email: "content@example.invalid",
        request_id: "content-request",
        timestamp: "2026-09-04T00:00:00.000Z",
        cursor_version: "PRIVATE_VERSION_CANARY",
        status: "aborted",
        usage: { inputTokens: 999, outputTokens: 1, totalTokens: 1000 },
      },
    },
    unknownWrapper: {
      account_id: "wrapped-account",
      request_id: "wrapped-request",
      timestamp: "2026-09-05T00:00:00.000Z",
      cursor_version: "SECOND_PRIVATE_VERSION_CANARY",
      usage: { inputTokens: 500, outputTokens: 500, totalTokens: 1000 },
    },
    content: Object.fromEntries(
      Array.from({ length: 600 }, (_, index) => [`noise-${index}`, index]),
    ),
  };
  const observation = sanitizeCursorObservation(malicious, context({ eventName: "local-jsonl" }));
  const serialized = JSON.stringify(observation);
  assert.doesNotMatch(serialized, /PRIVATE_VERSION_CANARY/);
  assert.ok(
    observation.tokenGroups.some(
      ({ path, contentDerived }) =>
        path.startsWith("$.tool_call.") && path.endsWith(".usage") && contentDerived,
    ),
  );
  assert.ok(
    observation.versionCandidates
      .filter(({ source }) => source !== "$.cursor_version")
      .every(({ trusted, value }) => !trusted && value === undefined),
  );
  await writeEvidenceRows(outputDirectory, [observation]);
  const report = await buildEvidenceReport(outputDirectory, {
    ...reportSelections,
    eventIdentityKind: "request_id",
  });
  assert.equal(report.qualifyingObservationCount, 1);
  assert.equal(report.usageObservationCount, 1);
  assert.equal(report.sourceTruncatedObservationCount, 1);
  assert.equal(report.exactPathQualifiedTruncationCount, 1);
  assert.deepEqual(report.versions, ["3.18.0"]);
  assert.equal(report.distinctLocallyLinkedAccounts, 1);
});

test("truncation at a selected array path remains non-qualifying", async (testContext) => {
  const outputDirectory = await privateTemporaryDirectory(testContext, "viberacing-cursor-output-");
  const cursorRoot = await privateTemporaryDirectory(testContext, "viberacing-cursor-hooks-");
  await installProbeHooks({
    outputDirectory,
    surface: "desktop",
    scenario: "desktop-one-turn",
    runId: runA,
    step: "single",
    hooksFile: join(cursorRoot, "hooks.json"),
  });
  await rm(join(outputDirectory, "runs"), { recursive: true, force: true });
  const events = Array.from({ length: 17 }, (_, index) => ({
    account_id: index === 16 ? "conflicting-account" : "account-a",
    request_id: index === 16 ? "conflicting-request" : "request-a",
    timestamp: "2026-09-03T00:00:01.000Z",
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
  }));
  const observation = sanitizeCursorObservation(
    { cursor_version: "3.18.0", events },
    context({ eventName: "local-jsonl" }),
  );
  await writeEvidenceRows(outputDirectory, [observation]);
  const report = await buildEvidenceReport(outputDirectory, {
    counterPaths: ["$.events[].usage"],
    accountPaths: ["$.events[].account_id"],
    eventIdPaths: ["$.events[].request_id"],
    timestampPaths: ["$.events[].timestamp"],
    versionSources: ["$.cursor_version"],
    eventIdentityKind: "request_id",
  });
  assert.equal(report.qualifyingObservationCount, 1);
  assert.equal(report.truncatedObservationCount, 1);
  assert.equal(report.exactPathQualifiedTruncationCount, 0);
  assert.equal(report.usageObservationCount, 0);
});

test("hook install uses a fixed relative launcher, preserves foreign fields, and removes only owned artifacts", async (testContext) => {
  const outputDirectory = await privateTemporaryDirectory(testContext, "viberacing-cursor-output-");
  const cursorRoot = await privateTemporaryDirectory(testContext, "viberacing-cursor-hooks-");
  const hooksFile = join(cursorRoot, "hooks.json");
  const foreign = {
    version: 1,
    vendorExtension: { enabled: true },
    hooks: { stop: [{ command: "foreign-stop --keep" }], afterFileEdit: [{ command: "keep" }] },
  };
  await writePrivateFile(hooksFile, `${JSON.stringify(foreign, null, 2)}\n`);
  const first = await installProbeHooks({
    outputDirectory,
    surface: "desktop",
    scenario: "desktop-one-turn",
    runId: runA,
    step: "single",
    hooksFile,
  });
  assert.match(
    first.command,
    process.platform === "win32"
      ? /^\.\\viberacing-cursor-evidence-[0-9a-f-]+-[0-9a-f-]+\\scripts\\viberacing-cursor-evidence-probe\.cmd$/
      : /^\.\/viberacing-cursor-evidence-[0-9a-f-]+-[0-9a-f-]+\/scripts\/viberacing-cursor-evidence-probe-hook\.mjs$/,
  );
  assert.doesNotMatch(first.command, /[&|<>^%!()'" ]/);
  const installed = JSON.parse(await readFile(hooksFile, "utf8"));
  assert.deepEqual(installed.vendorExtension, foreign.vendorExtension);
  assert.deepEqual(installed.hooks.afterFileEdit, foreign.hooks.afterFileEdit);
  assert.deepEqual(installed.hooks.stop[0], foreign.hooks.stop[0]);
  const repeated = await installProbeHooks({
    outputDirectory,
    surface: "desktop",
    scenario: "desktop-one-turn",
    runId: runA,
    step: "single",
    hooksFile,
  });
  assert.equal(repeated.changed, false);
  const futureLifecycle = JSON.parse(await readFile(hooksFile, "utf8"));
  futureLifecycle.hooks.customLifecycle = [
    { command: "foreign-custom --keep" },
    { command: first.command },
  ];
  await writePrivateFile(hooksFile, `${JSON.stringify(futureLifecycle, null, 2)}\n`);
  const reconciled = await installProbeHooks({
    outputDirectory,
    surface: "desktop",
    scenario: "desktop-one-turn",
    runId: runA,
    step: "single",
    hooksFile,
  });
  assert.equal(reconciled.changed, true);
  const reconciledDocument = JSON.parse(await readFile(hooksFile, "utf8"));
  assert.deepEqual(reconciledDocument.hooks.customLifecycle, [
    { command: "foreign-custom --keep" },
  ]);
  assert.equal(
    Object.values(reconciledDocument.hooks)
      .filter(Array.isArray)
      .flat()
      .filter((entry) => entry.command === first.command).length,
    1,
  );
  const removed = await removeProbeHooks({ outputDirectory, hooksFile });
  assert.deepEqual(removed, { changed: true, artifactsRemoved: true });
  assert.deepEqual(JSON.parse(await readFile(hooksFile, "utf8")), {
    ...foreign,
    hooks: {
      ...foreign.hooks,
      customLifecycle: [{ command: "foreign-custom --keep" }],
    },
  });
});

test("install CLI reads an owner-only expected identity file and stores only its HMAC", async (testContext) => {
  const outputDirectory = await privateTemporaryDirectory(testContext, "viberacing-cursor-output-");
  const cursorRoot = await privateTemporaryDirectory(testContext, "viberacing-cursor-hooks-");
  const hooksFile = join(cursorRoot, "hooks.json");
  const expectedIdentityFile = join(cursorRoot, "expected-identity.json");
  const rawIdentity = "PRIVATE_EXPECTED_REQUEST_ID";
  await writePrivateFile(expectedIdentityFile, `${JSON.stringify(rawIdentity)}\n`);
  const installed = JSON.parse(
    execFileSync(
      process.execPath,
      [
        probeScript,
        "install-hooks",
        "--output-dir",
        outputDirectory,
        "--surface",
        "desktop",
        "--scenario",
        "desktop-one-turn",
        "--run-id",
        runA,
        "--step",
        "single",
        "--event",
        "stop",
        "--hooks-file",
        hooksFile,
        "--expected-event-id-kind",
        "request_id",
        "--expected-event-id-path",
        "$.request_id",
        "--expected-event-id-file",
        expectedIdentityFile,
        "--version-path",
        "$.cursor_version",
      ],
      { encoding: "utf8" },
    ),
  );
  const bundle = join(
    cursorRoot,
    `viberacing-cursor-evidence-${installed.probeId}-${installed.installationId}`,
  );
  const configuration = await readFile(
    join(bundle, "scripts", "viberacing-cursor-evidence-probe-state.json"),
    "utf8",
  );
  const manifest = await readFile(
    join(outputDirectory, "runs", runA, "single", "stop.json"),
    "utf8",
  );
  assert.doesNotMatch(configuration, new RegExp(rawIdentity));
  assert.doesNotMatch(manifest, new RegExp(rawIdentity));
  assert.match(configuration, /"hash": "evt1_[A-Za-z0-9_-]{43}"/);
});

test("remove-hooks validates the probe identity before changing hooks or runtime artifacts", async (testContext) => {
  const currentOutput = await privateTemporaryDirectory(testContext, "viberacing-cursor-current-");
  const staleOutput = await privateTemporaryDirectory(testContext, "viberacing-cursor-stale-");
  const currentRoot = await privateTemporaryDirectory(
    testContext,
    "viberacing-cursor-current-hooks-",
  );
  const staleRoot = await privateTemporaryDirectory(testContext, "viberacing-cursor-stale-hooks-");
  const hooksFile = join(currentRoot, "hooks.json");
  const current = await installProbeHooks({
    outputDirectory: currentOutput,
    surface: "desktop",
    scenario: "desktop-one-turn",
    runId: runA,
    step: "single",
    event: "stop",
    hooksFile,
  });
  await installProbeHooks({
    outputDirectory: staleOutput,
    surface: "desktop",
    scenario: "desktop-one-turn",
    runId: runA,
    step: "single",
    event: "stop",
    hooksFile: join(staleRoot, "hooks.json"),
  });
  const bundle = join(
    currentRoot,
    `viberacing-cursor-evidence-${current.probeId}-${current.installationId}`,
  );
  const watched = [
    hooksFile,
    join(bundle, "scripts", "viberacing-cursor-evidence-probe-state.json"),
    join(bundle, "scripts", "viberacing-cursor-evidence-probe-hook.mjs"),
    join(bundle, "scripts", "cursor-evidence-probe.mjs"),
  ];
  const before = await Promise.all(watched.map((path) => readFile(path)));
  assert.deepEqual(await removeProbeHooks({ outputDirectory: staleOutput, hooksFile }), {
    changed: false,
    artifactsRemoved: false,
  });
  const copiedOutput = await privateTemporaryDirectory(
    testContext,
    "viberacing-cursor-copied-state-",
  );
  await writePrivateFile(
    join(copiedOutput, "cursor-evidence-state.json"),
    await readFile(join(currentOutput, "cursor-evidence-state.json")),
  );
  await assert.rejects(
    removeProbeHooks({ outputDirectory: copiedOutput, hooksFile }),
    /runtime ownership state is invalid/,
  );
  const after = await Promise.all(watched.map((path) => readFile(path)));
  for (let index = 0; index < before.length; index += 1)
    assert.ok(before[index].equals(after[index]), watched[index]);

  const launcherState = JSON.parse(after[1].toString("utf8"));
  launcherState.runtimeArtifacts.at(-1).path = launcherState.runtimeArtifacts[0].path;
  launcherState.runtimeArtifacts.at(-1).sha256 = launcherState.runtimeArtifacts[0].sha256;
  await writePrivateFile(watched[1], `${JSON.stringify(launcherState, null, 2)}\n`);
  const mismatchBefore = await Promise.all(watched.map((path) => readFile(path)));
  await assert.rejects(
    removeProbeHooks({ outputDirectory: currentOutput, hooksFile }),
    /runtime manifest is invalid/,
  );
  const mismatchAfter = await Promise.all(watched.map((path) => readFile(path)));
  for (let index = 0; index < mismatchBefore.length; index += 1)
    assert.ok(mismatchBefore[index].equals(mismatchAfter[index]), watched[index]);
});

test(
  "installed hook runtime is self-contained and fails open after runtime tampering",
  { skip: process.platform === "win32" },
  async (testContext) => {
    const outputDirectory = await privateTemporaryDirectory(
      testContext,
      "viberacing-cursor-output-",
    );
    const cursorRoot = await privateTemporaryDirectory(testContext, "viberacing-cursor-hooks-");
    const hooksFile = join(cursorRoot, "hooks.json");
    const installed = await installProbeHooks({
      outputDirectory,
      surface: "desktop",
      scenario: "desktop-one-turn",
      runId: runA,
      step: "single",
      event: "stop",
      hooksFile,
    });
    const bundle = join(
      cursorRoot,
      `viberacing-cursor-evidence-${installed.probeId}-${installed.installationId}`,
    );
    const state = JSON.parse(
      await readFile(
        join(bundle, "scripts", "viberacing-cursor-evidence-probe-state.json"),
        "utf8",
      ),
    );
    assert.equal(state.probeScriptPath, join(bundle, "scripts", "cursor-evidence-probe.mjs"));
    assert.notEqual(state.probeScriptPath, probeScript);
    await writeFile(state.probeScriptPath, "// changed after installation\n", { mode: 0o700 });
    const stdout = execFileSync("/bin/sh", ["-c", installed.command], {
      cwd: cursorRoot,
      encoding: "utf8",
      input: JSON.stringify({ hook_event_name: "stop", ...usagePayload("a") }),
    });
    assert.equal(stdout, "{}\n");
    await assert.rejects(readdir(join(outputDirectory, "observations")), { code: "ENOENT" });
  },
);

test(
  "an old delayed hook keeps its immutable run and step after a later installation",
  { skip: process.platform === "win32" },
  async (testContext) => {
    const outputDirectory = await privateTemporaryDirectory(
      testContext,
      "viberacing-cursor-output-",
    );
    const cursorRoot = await privateTemporaryDirectory(testContext, "viberacing-cursor-hooks-");
    const hooksFile = join(cursorRoot, "hooks.json");
    const first = await installProbeHooks({
      outputDirectory,
      surface: "desktop",
      scenario: "desktop-a-b-a",
      runId: runA,
      step: "a1",
      event: "sessionEnd",
      hooksFile,
    });
    const second = await installProbeHooks({
      outputDirectory,
      surface: "desktop",
      scenario: "desktop-a-b-a",
      runId: runA,
      step: "b",
      event: "sessionEnd",
      hooksFile,
    });
    assert.notEqual(first.command, second.command);
    const firstBundle = join(
      cursorRoot,
      `viberacing-cursor-evidence-${first.probeId}-${first.installationId}`,
    );
    const firstStatePath = join(
      firstBundle,
      "scripts",
      "viberacing-cursor-evidence-probe-state.json",
    );
    const firstStateBytes = await readFile(firstStatePath);
    const tamperedState = JSON.parse(firstStateBytes.toString("utf8"));
    tamperedState.declaredStep = "b";
    await writePrivateFile(firstStatePath, `${JSON.stringify(tamperedState, null, 2)}\n`);
    const hooksBeforeTamperedRemoval = await readFile(hooksFile);
    const tamperedStdout = execFileSync("/bin/sh", ["-c", first.command], {
      cwd: cursorRoot,
      encoding: "utf8",
      input: JSON.stringify({ hook_event_name: "sessionEnd", ...usagePayload("a") }),
    });
    assert.equal(tamperedStdout, "{}\n");
    await assert.rejects(readdir(join(outputDirectory, "observations")), { code: "ENOENT" });
    await assert.rejects(
      removeProbeHooks({ outputDirectory, hooksFile }),
      /runtime ownership state is invalid/,
    );
    assert.ok(hooksBeforeTamperedRemoval.equals(await readFile(hooksFile)));
    await writePrivateFile(firstStatePath, firstStateBytes);
    execFileSync("/bin/sh", ["-c", first.command], {
      cwd: cursorRoot,
      input: JSON.stringify({ hook_event_name: "sessionEnd", ...usagePayload("a") }),
    });
    const observationName = (await readdir(join(outputDirectory, "observations")))[0];
    const observation = JSON.parse(
      await readFile(join(outputDirectory, "observations", observationName), "utf8"),
    );
    assert.equal(observation.declaredStep, "a1");
    assert.equal(observation.eventName, "sessionEnd");
  },
);

test(
  "POSIX launcher executes from Cursor's documented user-hook working directory",
  { skip: process.platform === "win32" },
  async (testContext) => {
    const outputDirectory = await privateTemporaryDirectory(
      testContext,
      "viberacing-cursor-output-",
    );
    const cursorRoot = await privateTemporaryDirectory(testContext, "viberacing-cursor-hooks-");
    const hooksFile = join(cursorRoot, "hooks.json");
    await installProbeHooks({
      outputDirectory,
      surface: "desktop",
      scenario: "desktop-one-turn",
      runId: runA,
      step: "single",
      hooksFile,
    });
    const installed = JSON.parse(await readFile(hooksFile, "utf8"));
    const stdout = execFileSync("/bin/sh", ["-c", installed.hooks.stop[0].command], {
      cwd: cursorRoot,
      encoding: "utf8",
      input: JSON.stringify({
        hook_event_name: "stop",
        prompt: "HOOK_PRIVATE_CANARY",
        ...usagePayload("a"),
      }),
    });
    assert.equal(stdout, "{}\n");
    const files = await readdir(join(outputDirectory, "observations"));
    const observation = await readFile(join(outputDirectory, "observations", files[0]), "utf8");
    assert.doesNotMatch(observation, /HOOK_PRIVATE_CANARY|a@example\.invalid|account-a/);
  },
);

test(
  "Windows launcher survives cmd.exe metacharacters and all private files have owner-only ACLs",
  { skip: process.platform !== "win32" },
  async (testContext) => {
    const outputDirectory = await privateTemporaryDirectory(
      testContext,
      "viberacing &^%!() output-",
    );
    const cursorRoot = await privateTemporaryDirectory(testContext, "viberacing &^%!() hooks-");
    const hooksFile = join(cursorRoot, "hooks.json");
    const installed = await installProbeHooks({
      outputDirectory,
      surface: "desktop",
      scenario: "desktop-one-turn",
      runId: runA,
      step: "single",
      hooksFile,
    });
    execFileSync("cmd.exe", ["/d", "/s", "/c", installed.command], {
      cwd: cursorRoot,
      input: JSON.stringify({ hook_event_name: "stop", ...usagePayload("a") }),
    });
    const observationName = (await readdir(join(outputDirectory, "observations")))[0];
    const bundle = join(
      cursorRoot,
      `viberacing-cursor-evidence-${installed.probeId}-${installed.installationId}`,
    );
    for (const path of [
      join(outputDirectory, "cursor-evidence-state.json"),
      join(outputDirectory, "observations", observationName),
      join(bundle, "scripts", "viberacing-cursor-evidence-probe-state.json"),
      join(bundle, "scripts", "viberacing-cursor-evidence-probe-hook.mjs"),
      join(bundle, "scripts", "cursor-evidence-probe.mjs"),
      join(bundle, "scripts", "viberacing-cursor-evidence-probe.cmd"),
      join(bundle, "packages", "connector", "lib", "owned-lock.mjs"),
      join(bundle, "packages", "connector", "lib", "windows-security.mjs"),
    ])
      assert.equal(await inspectOwnerOnlyWindowsFile(path), true, path);
    const runtime = join(bundle, "scripts", "cursor-evidence-probe.mjs");
    execFileSync("icacls.exe", [runtime, "/grant", "*S-1-1-0:(R)"], { stdio: "ignore" });
    assert.equal(await inspectOwnerOnlyWindowsFile(runtime), false);
    execFileSync("cmd.exe", ["/d", "/s", "/c", installed.command], {
      cwd: cursorRoot,
      input: JSON.stringify({ hook_event_name: "stop", ...usagePayload("b") }),
    });
    assert.equal((await readdir(join(outputDirectory, "observations"))).length, 1);
    await ensureOwnerOnlyWindowsFile(runtime);
  },
);

test(
  "Windows validation never rewrites existing output or shared hook directory ACLs",
  { skip: process.platform !== "win32" },
  async (testContext) => {
    const outputDirectory = await privateTemporaryDirectory(
      testContext,
      "viberacing-cursor-output-",
    );
    const cursorRoot = await privateTemporaryDirectory(testContext, "viberacing-cursor-hooks-");
    const sharedHooks = join(cursorRoot, "hooks");
    await mkdir(sharedHooks, { mode: 0o700 });
    execFileSync("icacls.exe", [sharedHooks, "/grant", "*S-1-5-32-544:(OI)(CI)(F)"], {
      stdio: "ignore",
    });
    const sharedBefore = execFileSync("icacls.exe", [sharedHooks], { encoding: "utf8" });
    await installProbeHooks({
      outputDirectory,
      surface: "desktop",
      scenario: "desktop-one-turn",
      runId: runA,
      step: "single",
      hooksFile: join(cursorRoot, "hooks.json"),
    });
    const sharedAfter = execFileSync("icacls.exe", [sharedHooks], { encoding: "utf8" });
    assert.equal(sharedAfter, sharedBefore);

    const unsafeOutput = await privateTemporaryDirectory(
      testContext,
      "viberacing-cursor-unsafe-output-",
    );
    execFileSync("icacls.exe", [unsafeOutput, "/grant", "*S-1-1-0:(RX)"], {
      stdio: "ignore",
    });
    const unsafeBefore = execFileSync("icacls.exe", [unsafeOutput], { encoding: "utf8" });
    await assert.rejects(buildEvidenceReport(unsafeOutput), /current-user-only Windows ACL/);
    const unsafeAfter = execFileSync("icacls.exe", [unsafeOutput], { encoding: "utf8" });
    assert.equal(unsafeAfter, unsafeBefore);
  },
);

test("hooks.json compare-and-swap retries once and preserves a concurrent foreign update", async (testContext) => {
  const outputDirectory = await privateTemporaryDirectory(testContext, "viberacing-cursor-output-");
  const cursorRoot = await privateTemporaryDirectory(testContext, "viberacing-cursor-hooks-");
  const hooksFile = join(cursorRoot, "hooks.json");
  await writePrivateFile(hooksFile, '{"version":1,"hooks":{}}\n');
  const result = await installProbeHooks({
    outputDirectory,
    surface: "desktop",
    scenario: "desktop-one-turn",
    runId: runA,
    step: "single",
    hooksFile,
    beforeCompareAndSwap: async ({ attempt }) => {
      if (attempt === 0)
        await writePrivateFile(
          hooksFile,
          '{"version":1,"hooks":{"afterFileEdit":[{"command":"foreign"}]}}\n',
        );
    },
  });
  assert.equal(result.changed, true);
  const document = JSON.parse(await readFile(hooksFile, "utf8"));
  assert.deepEqual(document.hooks.afterFileEdit, [{ command: "foreign" }]);
  assert.ok(document.hooks.stop.some(({ command }) => command === result.command));
});

test("hooks.json compare-and-swap fails closed after the single retry", async (testContext) => {
  const outputDirectory = await privateTemporaryDirectory(testContext, "viberacing-cursor-output-");
  const cursorRoot = await privateTemporaryDirectory(testContext, "viberacing-cursor-hooks-");
  const hooksFile = join(cursorRoot, "hooks.json");
  await writePrivateFile(hooksFile, '{"version":1,"hooks":{}}\n');
  await assert.rejects(
    installProbeHooks({
      outputDirectory,
      surface: "desktop",
      scenario: "desktop-one-turn",
      runId: runA,
      step: "single",
      hooksFile,
      beforeCompareAndSwap: ({ attempt }) =>
        writePrivateFile(
          hooksFile,
          `{"version":1,"hooks":{"stop":[{"command":"foreign-${attempt}"}]}}\n`,
        ),
    }),
    /changed concurrently/,
  );
  const final = await readFile(hooksFile, "utf8");
  assert.match(final, /foreign-1/);
  assert.doesNotMatch(final, /viberacing-cursor-evidence/);
});

test("hooks.json no-replace publish preserves a foreign update after displacement", async (testContext) => {
  const outputDirectory = await privateTemporaryDirectory(testContext, "viberacing-cursor-output-");
  const cursorRoot = await privateTemporaryDirectory(testContext, "viberacing-cursor-hooks-");
  const hooksFile = join(cursorRoot, "hooks.json");
  await writePrivateFile(
    hooksFile,
    '{"version":1,"hooks":{"stop":[{"command":"foreign-stop-A"}]}}\n',
  );
  const result = await installProbeHooks({
    outputDirectory,
    surface: "desktop",
    scenario: "desktop-one-turn",
    runId: runA,
    step: "single",
    hooksFile,
    afterDisplace: async ({ attempt }) => {
      if (attempt === 0)
        await writePrivateFile(
          hooksFile,
          '{"version":1,"hooks":{"stop":[{"command":"foreign-stop-B"}]}}\n',
          { flag: "wx" },
        );
    },
  });
  assert.equal(result.changed, true);
  const document = JSON.parse(await readFile(hooksFile, "utf8"));
  assert.deepEqual(document.hooks.stop.slice(0, 2), [
    { command: "foreign-stop-A" },
    { command: "foreign-stop-B" },
  ]);
  assert.ok(document.hooks.stop.some(({ command }) => command === result.command));
});

test("hook mutation merges current and displaced foreign hooks after an interrupted publish", async (testContext) => {
  const outputDirectory = await privateTemporaryDirectory(testContext, "viberacing-cursor-output-");
  const cursorRoot = await privateTemporaryDirectory(testContext, "viberacing-cursor-hooks-");
  const hooksFile = join(cursorRoot, "hooks.json");
  const recovery = `${hooksFile}.viberacing-cursor-evidence.recovery`;
  await writePrivateFile(
    recovery,
    '{"version":1,"__proto__":{"preserve":"original"},"hooks":{"__proto__":[{"command":"foreign-prototype-event"}],"stop":[{"command":"foreign-stop-A"}]}}\n',
  );
  await writePrivateFile(
    hooksFile,
    '{"version":1,"hooks":{"stop":[{"command":"foreign-stop-B"}]}}\n',
  );
  const result = await installProbeHooks({
    outputDirectory,
    surface: "desktop",
    scenario: "desktop-one-turn",
    runId: runA,
    step: "single",
    hooksFile,
  });
  assert.equal(result.changed, true);
  const document = JSON.parse(await readFile(hooksFile, "utf8"));
  assert.deepEqual(document.hooks.stop.slice(0, 2), [
    { command: "foreign-stop-A" },
    { command: "foreign-stop-B" },
  ]);
  assert.ok(document.hooks.stop.some(({ command }) => command === result.command));
  assert.equal(Object.hasOwn(document, "__proto__"), true);
  assert.deepEqual(document.__proto__, { preserve: "original" });
  assert.equal(Object.hasOwn(document.hooks, "__proto__"), true);
  assert.deepEqual(document.hooks.__proto__, [{ command: "foreign-prototype-event" }]);
  await assert.rejects(readFile(recovery), { code: "ENOENT" });
});

test("hook recovery closes every non-empty current/recovery/reconcile state", async (testContext) => {
  const states = [
    { name: "current", current: hooksDocument("foreign-A"), expected: ["foreign-A"] },
    { name: "recovery", recovery: hooksDocument("foreign-A"), expected: ["foreign-A"] },
    { name: "reconcile", reconcile: hooksDocument("foreign-B"), expected: ["foreign-B"] },
    {
      name: "current-recovery",
      current: hooksDocument("foreign-B"),
      recovery: hooksDocument("foreign-A"),
      expected: ["foreign-A", "foreign-B"],
    },
    {
      name: "current-reconcile",
      current: hooksDocument("foreign-A"),
      reconcile: hooksDocument("foreign-A"),
      expected: ["foreign-A"],
    },
    {
      name: "recovery-reconcile",
      recovery: hooksDocument("foreign-A"),
      reconcile: hooksDocument("foreign-B"),
      expected: ["foreign-A", "foreign-B"],
    },
    {
      name: "all",
      current: hooksDocument("foreign-A", "foreign-B"),
      recovery: hooksDocument("foreign-A"),
      reconcile: hooksDocument("foreign-B"),
      expected: ["foreign-A", "foreign-B"],
    },
  ];
  for (const state of states) {
    const outputDirectory = await privateTemporaryDirectory(
      testContext,
      `viberacing-cursor-output-${state.name}-`,
    );
    const cursorRoot = await privateTemporaryDirectory(
      testContext,
      `viberacing-cursor-hooks-${state.name}-`,
    );
    const hooksFile = join(cursorRoot, "hooks.json");
    for (const [kind, document] of [
      ["current", state.current],
      ["recovery", state.recovery],
      ["reconcile", state.reconcile],
    ]) {
      if (!document) continue;
      const path =
        kind === "current" ? hooksFile : `${hooksFile}.viberacing-cursor-evidence.${kind}`;
      await writePrivateFile(path, `${JSON.stringify(document)}\n`);
    }
    await installProbeHooks({
      outputDirectory,
      surface: "desktop",
      scenario: "desktop-one-turn",
      runId: runA,
      step: "single",
      hooksFile,
    });
    const final = JSON.parse(await readFile(hooksFile, "utf8"));
    const foreign = final.hooks.stop
      .map(({ command }) => command)
      .filter((command) => command.startsWith("foreign-"))
      .sort();
    assert.deepEqual(foreign, [...state.expected].sort(), state.name);
    for (const kind of ["recovery", "reconcile"])
      await assert.rejects(readFile(`${hooksFile}.viberacing-cursor-evidence.${kind}`), {
        code: "ENOENT",
      });
  }
});

test("hook recovery preserves ambiguous current and reconcile documents", async (testContext) => {
  const outputDirectory = await privateTemporaryDirectory(testContext, "viberacing-cursor-output-");
  const cursorRoot = await privateTemporaryDirectory(testContext, "viberacing-cursor-hooks-");
  const hooksFile = join(cursorRoot, "hooks.json");
  const reconcile = `${hooksFile}.viberacing-cursor-evidence.reconcile`;
  await writePrivateFile(hooksFile, `${JSON.stringify(hooksDocument("foreign-A"))}\n`);
  await writePrivateFile(reconcile, `${JSON.stringify(hooksDocument("foreign-B"))}\n`);
  const before = await Promise.all([readFile(hooksFile), readFile(reconcile)]);
  await assert.rejects(
    installProbeHooks({
      outputDirectory,
      surface: "desktop",
      scenario: "desktop-one-turn",
      runId: runA,
      step: "single",
      hooksFile,
    }),
    /recovery is ambiguous/,
  );
  const after = await Promise.all([readFile(hooksFile), readFile(reconcile)]);
  assert.ok(before[0].equals(after[0]));
  assert.ok(before[1].equals(after[1]));
});

test("hook recovery accepts the hard-linked current/recovery crash state", async (testContext) => {
  const outputDirectory = await privateTemporaryDirectory(testContext, "viberacing-cursor-output-");
  const cursorRoot = await privateTemporaryDirectory(testContext, "viberacing-cursor-hooks-");
  const hooksFile = join(cursorRoot, "hooks.json");
  const recovery = `${hooksFile}.viberacing-cursor-evidence.recovery`;
  await writePrivateFile(recovery, `${JSON.stringify(hooksDocument("foreign-A"))}\n`);
  await link(recovery, hooksFile);
  await installProbeHooks({
    outputDirectory,
    surface: "desktop",
    scenario: "desktop-one-turn",
    runId: runA,
    step: "single",
    hooksFile,
  });
  const final = JSON.parse(await readFile(hooksFile, "utf8"));
  assert.ok(final.hooks.stop.some(({ command }) => command === "foreign-A"));
  await assert.rejects(readFile(recovery), { code: "ENOENT" });
});

test("single-journal recovery never replaces a concurrently created hooks file", async (testContext) => {
  const outputDirectory = await privateTemporaryDirectory(testContext, "viberacing-cursor-output-");
  const cursorRoot = await privateTemporaryDirectory(testContext, "viberacing-cursor-hooks-");
  const hooksFile = join(cursorRoot, "hooks.json");
  const recovery = `${hooksFile}.viberacing-cursor-evidence.recovery`;
  await writePrivateFile(recovery, `${JSON.stringify(hooksDocument("foreign-A"))}\n`);
  await assert.rejects(
    installProbeHooks({
      outputDirectory,
      surface: "desktop",
      scenario: "desktop-one-turn",
      runId: runA,
      step: "single",
      hooksFile,
      recoveryFaults: {
        beforeSingleRestore: async () =>
          writePrivateFile(hooksFile, `${JSON.stringify(hooksDocument("foreign-B"))}\n`, {
            flag: "wx",
          }),
      },
    }),
    /both versions were preserved/,
  );
  assert.ok((await readFile(hooksFile, "utf8")).includes("foreign-B"));
  assert.ok((await readFile(recovery, "utf8")).includes("foreign-A"));
});

test("reconciliation restores a current hooks file changed after its snapshot", async (testContext) => {
  const outputDirectory = await privateTemporaryDirectory(testContext, "viberacing-cursor-output-");
  const cursorRoot = await privateTemporaryDirectory(testContext, "viberacing-cursor-hooks-");
  const hooksFile = join(cursorRoot, "hooks.json");
  const recovery = `${hooksFile}.viberacing-cursor-evidence.recovery`;
  const reconcile = `${hooksFile}.viberacing-cursor-evidence.reconcile`;
  await writePrivateFile(hooksFile, `${JSON.stringify(hooksDocument("foreign-B"))}\n`);
  await writePrivateFile(recovery, `${JSON.stringify(hooksDocument("foreign-A"))}\n`);
  await assert.rejects(
    installProbeHooks({
      outputDirectory,
      surface: "desktop",
      scenario: "desktop-one-turn",
      runId: runA,
      step: "single",
      hooksFile,
      recoveryFaults: {
        beforeReconcileDisplace: async () =>
          writePrivateFile(hooksFile, `${JSON.stringify(hooksDocument("foreign-C"))}\n`),
      },
    }),
    /changed during recovery reconciliation displacement/,
  );
  assert.ok((await readFile(hooksFile, "utf8")).includes("foreign-C"));
  assert.ok((await readFile(recovery, "utf8")).includes("foreign-A"));
  await assert.rejects(readFile(reconcile), { code: "ENOENT" });
});

test("journal cleanup preserves a journal changed after recovery inspection", async (testContext) => {
  const outputDirectory = await privateTemporaryDirectory(testContext, "viberacing-cursor-output-");
  const cursorRoot = await privateTemporaryDirectory(testContext, "viberacing-cursor-hooks-");
  const hooksFile = join(cursorRoot, "hooks.json");
  const recovery = `${hooksFile}.viberacing-cursor-evidence.recovery`;
  const original = `${JSON.stringify(hooksDocument("foreign-A"))}\n`;
  await writePrivateFile(hooksFile, original);
  await writePrivateFile(recovery, original);
  await assert.rejects(
    installProbeHooks({
      outputDirectory,
      surface: "desktop",
      scenario: "desktop-one-turn",
      runId: runA,
      step: "single",
      hooksFile,
      recoveryFaults: {
        beforeJournalCleanup: async ({ kind }) => {
          if (kind === "recovery")
            await writePrivateFile(recovery, `${JSON.stringify(hooksDocument("foreign-C"))}\n`);
        },
      },
    }),
    /changed during recovery journal cleanup/,
  );
  assert.equal(await readFile(hooksFile, "utf8"), original);
  assert.ok((await readFile(recovery, "utf8")).includes("foreign-C"));
});

test("hook recovery is idempotent across every reconciliation crash boundary", async (testContext) => {
  for (const phase of ["afterReconcileRename", "afterMergedPublish", "afterReconcileCleanup"]) {
    const outputDirectory = await privateTemporaryDirectory(
      testContext,
      `viberacing-cursor-output-${phase}-`,
    );
    const cursorRoot = await privateTemporaryDirectory(
      testContext,
      `viberacing-cursor-hooks-${phase}-`,
    );
    const hooksFile = join(cursorRoot, "hooks.json");
    const recovery = `${hooksFile}.viberacing-cursor-evidence.recovery`;
    await writePrivateFile(hooksFile, `${JSON.stringify(hooksDocument("foreign-B"))}\n`);
    await writePrivateFile(recovery, `${JSON.stringify(hooksDocument("foreign-A"))}\n`);
    await assert.rejects(
      installProbeHooks({
        outputDirectory,
        surface: "desktop",
        scenario: "desktop-one-turn",
        runId: runA,
        step: "single",
        hooksFile,
        recoveryFaults: {
          [phase]: () => {
            throw new Error(`fault-${phase}`);
          },
        },
      }),
      new RegExp(`fault-${phase}`),
    );
    await installProbeHooks({
      outputDirectory,
      surface: "desktop",
      scenario: "desktop-one-turn",
      runId: runB,
      step: "single",
      hooksFile,
    });
    const final = JSON.parse(await readFile(hooksFile, "utf8"));
    const foreign = final.hooks.stop
      .map(({ command }) => command)
      .filter((command) => command.startsWith("foreign-"))
      .sort();
    assert.deepEqual(foreign, ["foreign-A", "foreign-B"], phase);
    for (const kind of ["recovery", "reconcile"])
      await assert.rejects(readFile(`${hooksFile}.viberacing-cursor-evidence.${kind}`), {
        code: "ENOENT",
      });
  }
});

test(
  "hook installation fails closed for malformed files, symlinks, and hard links",
  { skip: process.platform === "win32" },
  async (testContext) => {
    const outputDirectory = await privateTemporaryDirectory(
      testContext,
      "viberacing-cursor-output-",
    );
    const cursorRoot = await privateTemporaryDirectory(testContext, "viberacing-cursor-hooks-");
    const target = join(cursorRoot, "target.json");
    await writeFile(target, "not-json\n", { mode: 0o600 });
    const candidates = [
      target,
      join(cursorRoot, "symlink.json"),
      join(cursorRoot, "hardlink.json"),
    ];
    await symlink(target, candidates[1]);
    await link(target, candidates[2]);
    for (const hooksFile of candidates) {
      await assert.rejects(
        installProbeHooks({
          outputDirectory,
          surface: "desktop",
          scenario: "desktop-one-turn",
          runId: runA,
          step: "single",
          hooksFile,
        }),
      );
    }
    assert.equal(await readFile(target, "utf8"), "not-json\n");
  },
);

test("failed JSONL inspection persists a failed manifest and excludes partial observations", async (testContext) => {
  const outputDirectory = await privateTemporaryDirectory(testContext, "viberacing-cursor-output-");
  const input = join(outputDirectory, "history.jsonl");
  await writePrivateFile(input, `${JSON.stringify(usagePayload("a"))}\n{"malformed":\n`);
  await assert.rejects(
    inspectJsonl({
      "output-dir": outputDirectory,
      input,
      surface: "desktop",
      scenario: "desktop-one-turn",
      "run-id": runA,
      step: "single",
      "version-path": "$.cursor_version",
    }),
    SyntaxError,
  );
  const report = await buildEvidenceReport(outputDirectory, {
    ...reportSelections,
    eventIdentityKind: "request_id",
  });
  assert.equal(report.observationCount, 1);
  assert.equal(report.qualifyingObservationCount, 0);
  assert.equal(report.failedRunManifestCount, 1);
  assert.equal(report.invalidRunManifestCount, 1);
  assert.ok(report.limitations.includes("run_manifest_incomplete_or_conflicting"));
});

test("a hook manifest is identity-bound and becomes failed after any second invocation", async (testContext) => {
  const outputDirectory = await privateTemporaryDirectory(testContext, "viberacing-cursor-output-");
  const cursorRoot = await privateTemporaryDirectory(testContext, "viberacing-cursor-hooks-");
  const hooksFile = join(cursorRoot, "hooks.json");
  const payload = { hook_event_name: "stop", ...usagePayload("a") };
  const installed = await installProbeHooks({
    outputDirectory,
    surface: "desktop",
    scenario: "desktop-one-turn",
    runId: runA,
    step: "single",
    event: "stop",
    expectedEventIdentity: {
      kind: "request_id",
      path: "$.request_id",
      value: payload.request_id,
    },
    versionPath: "$.cursor_version",
    hooksFile,
  });
  const configuration = JSON.parse(
    await readFile(
      join(
        cursorRoot,
        `viberacing-cursor-evidence-${installed.probeId}-${installed.installationId}`,
        "scripts",
        "viberacing-cursor-evidence-probe-state.json",
      ),
      "utf8",
    ),
  );
  const output = [];
  await captureCursorHook(configuration, Readable.from([JSON.stringify(payload)]), {
    write: (value) => output.push(value),
  });
  assert.deepEqual(output, ["{}\n"]);
  await assert.rejects(
    captureCursorHook(configuration, Readable.from([JSON.stringify(payload)]), { write() {} }),
    /exactly one invocation/,
  );
  const report = await buildEvidenceReport(outputDirectory, {
    ...reportSelections,
    eventIdentityKind: "request_id",
  });
  assert.equal(report.observationCount, 1);
  assert.equal(report.qualifyingObservationCount, 0);
  assert.equal(report.failedRunManifestCount, 1);
});

test(
  "run-cli waits for close, preserves split UTF-8, continues after malformed records, and awaits writes",
  { skip: process.platform === "win32" },
  async (testContext) => {
    const outputDirectory = await privateTemporaryDirectory(
      testContext,
      "viberacing-cursor-output-",
    );
    const saved = [];
    let writesInFlight = 0;
    const forwarded = [];
    const result = await runCursorCli({
      outputDirectory,
      executable: closeFixture,
      scenario: "cli-headless-one-turn",
      runId: runA,
      step: "single",
      outputStream: { write: (chunk) => forwarded.push(chunk) },
      saveObservationImplementation: async (_output, observation) => {
        writesInFlight += 1;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
        saved.push(observation);
        writesInFlight -= 1;
      },
    });
    assert.deepEqual(result, { code: 0, signal: null });
    assert.equal(writesInFlight, 0);
    assert.equal(saved.filter(({ parseStatus }) => parseStatus === "parsed").length, 2);
    assert.ok(
      saved.some(({ truncationReasons }) => truncationReasons.includes("malformed_stream_record")),
    );
    assert.match(forwarded.join(""), /split-€-utf8/);
    assert.match(forwarded.join(""), /request-late/);
  },
);

test(
  "run-cli marks unterminated and capped streams and removes signal listeners",
  { skip: process.platform === "win32" },
  async (testContext) => {
    const outputDirectory = await privateTemporaryDirectory(
      testContext,
      "viberacing-cursor-output-",
    );
    const agent = join(outputDirectory, "fake-agent.mjs");
    await writeExecutable(
      agent,
      `#!/usr/bin/env node
if (process.argv.includes("--version")) { process.stdout.write("1.2.3\\n"); process.exit(0); }
process.stdout.write(JSON.stringify(${JSON.stringify(usagePayload("a"))}));
`,
    );
    const saved = [];
    const signalSource = new EventEmitter();
    const result = await runCursorCli({
      outputDirectory,
      executable: agent,
      scenario: "cli-headless-one-turn",
      runId: runA,
      step: "single",
      maximumObservationCount: 1,
      signalSource,
      outputStream: { write() {} },
      saveObservationImplementation: async (_output, observation) => saved.push(observation),
    });
    assert.deepEqual(result, { code: 0, signal: null });
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0].truncationReasons, ["unterminated_stream_record"]);
    assert.equal(signalSource.listenerCount("SIGINT"), 0);
    assert.equal(signalSource.listenerCount("SIGTERM"), 0);

    const cappedAgent = join(outputDirectory, "capped-agent.mjs");
    await writeExecutable(
      cappedAgent,
      `#!/usr/bin/env node
if (process.argv.includes("--version")) { process.stdout.write("1.2.3\\n"); process.exit(0); }
for (const account of ["a", "b"]) process.stdout.write(JSON.stringify({ ...${JSON.stringify(usagePayload("a"))}, account_id: account }) + "\\n");
`,
    );
    const capped = [];
    await runCursorCli({
      outputDirectory,
      executable: cappedAgent,
      scenario: "cli-headless-one-turn",
      runId: runB,
      step: "single",
      maximumObservationCount: 2,
      signalSource,
      outputStream: { write() {} },
      saveObservationImplementation: async (_output, observation) => capped.push(observation),
    });
    assert.equal(capped.length, 2);
    assert.deepEqual(capped[1].truncationReasons, ["stream_observation_limit"]);
  },
);

test(
  "run-cli nonzero exit durably excludes otherwise valid records",
  { skip: process.platform === "win32" },
  async (testContext) => {
    const outputDirectory = await privateTemporaryDirectory(
      testContext,
      "viberacing-cursor-output-",
    );
    const agent = join(outputDirectory, "failing-agent.mjs");
    await writeExecutable(
      agent,
      `#!/usr/bin/env node
if (process.argv.includes("--version")) { process.stdout.write("1.2.3\\n"); process.exit(0); }
process.stdout.write(JSON.stringify(${JSON.stringify(usagePayload("a"))}) + "\\n");
process.exit(7);
`,
    );
    assert.deepEqual(
      await runCursorCli({
        outputDirectory,
        executable: agent,
        scenario: "cli-headless-one-turn",
        runId: runA,
        step: "single",
        outputStream: { write() {} },
      }),
      { code: 7, signal: null },
    );
    const report = await buildEvidenceReport(outputDirectory, {
      ...reportSelections,
      eventIdentityKind: "request_id",
    });
    assert.equal(report.observationCount, 1);
    assert.equal(report.qualifyingObservationCount, 0);
    assert.equal(report.failedRunManifestCount, 1);
  },
);

test(
  "run-cli forwards a signal once and returns the original terminating signal",
  { skip: process.platform === "win32" },
  async (testContext) => {
    const outputDirectory = await privateTemporaryDirectory(
      testContext,
      "viberacing-cursor-output-",
    );
    const agent = join(outputDirectory, "fake-agent.mjs");
    await writeExecutable(
      agent,
      `#!/usr/bin/env node
if (process.argv.includes("--version")) { process.stdout.write("1.2.3\\n"); process.exit(0); }
setInterval(() => {}, 1000);
`,
    );
    const signalSource = new EventEmitter();
    const running = runCursorCli({
      outputDirectory,
      executable: agent,
      scenario: "aborted-error",
      runId: runA,
      step: "single",
      signalSource,
      outputStream: { write() {} },
      saveObservationImplementation: async () => {},
    });
    setTimeout(() => signalSource.emit("SIGTERM"), 80);
    assert.deepEqual(await running, { code: null, signal: "SIGTERM" });
    assert.equal(signalSource.listenerCount("SIGTERM"), 0);
  },
);

test(
  "run-cli honors output backpressure and terminates the child after a processing failure",
  { skip: process.platform === "win32" },
  async (testContext) => {
    const outputDirectory = await privateTemporaryDirectory(
      testContext,
      "viberacing-cursor-output-",
    );
    const agent = join(outputDirectory, "fake-agent.mjs");
    await writeExecutable(
      agent,
      `#!/usr/bin/env node
if (process.argv.includes("--version")) { process.stdout.write("1.2.3\\n"); process.exit(0); }
process.stdout.write(JSON.stringify(${JSON.stringify(usagePayload("a"))}) + "\\n");
setInterval(() => {}, 1000);
`,
    );
    const signalSource = new EventEmitter();
    const outputStream = new EventEmitter();
    let drained = false;
    outputStream.write = () => {
      setTimeout(() => {
        drained = true;
        outputStream.emit("drain");
      }, 30);
      return false;
    };
    await assert.rejects(
      runCursorCli({
        outputDirectory,
        executable: agent,
        scenario: "cli-headless-one-turn",
        runId: runA,
        step: "single",
        signalSource,
        outputStream,
        saveObservationImplementation: async () => {
          assert.equal(drained, true);
          throw new Error("save failed");
        },
      }),
      /save failed/,
    );
    assert.equal(signalSource.listenerCount("SIGINT"), 0);
    assert.equal(signalSource.listenerCount("SIGTERM"), 0);
  },
);

test(
  "the CLI wrapper itself re-raises the child's terminating signal",
  { skip: process.platform === "win32" },
  async (testContext) => {
    const outputDirectory = await privateTemporaryDirectory(
      testContext,
      "viberacing-cursor-output-",
    );
    const agent = join(outputDirectory, "fake-agent.mjs");
    await writeExecutable(
      agent,
      `#!/usr/bin/env node
if (process.argv.includes("--version")) { process.stdout.write("1.2.3\\n"); process.exit(0); }
setInterval(() => {}, 1000);
`,
    );
    const wrapper = spawn(process.execPath, [
      probeScript,
      "run-cli",
      "--output-dir",
      outputDirectory,
      "--agent",
      agent,
      "--scenario",
      "aborted-error",
      "--run-id",
      runA,
      "--step",
      "single",
      "--",
    ]);
    setTimeout(() => wrapper.kill("SIGTERM"), 100);
    const closed = await new Promise((resolveClose, reject) => {
      wrapper.once("error", reject);
      wrapper.once("close", (code, signal) => resolveClose({ code, signal }));
    });
    assert.deepEqual(closed, { code: null, signal: "SIGTERM" });
  },
);

test("report requires semantic scenarios but always keeps the production gate closed", async (testContext) => {
  const outputDirectory = await privateTemporaryDirectory(testContext, "viberacing-cursor-output-");
  const cursorRoot = await privateTemporaryDirectory(testContext, "viberacing-cursor-hooks-");
  await installProbeHooks({
    outputDirectory,
    surface: "desktop",
    scenario: "desktop-one-turn",
    runId: runA,
    step: "single",
    hooksFile: join(cursorRoot, "hooks.json"),
  });
  await rm(join(outputDirectory, "runs"), { recursive: true, force: true });
  const rows = [];
  const add = (scenario, surface, runId, step, account, extra = {}, eventName = "stop") => {
    rows.push(
      sanitizeCursorObservation(
        usagePayload(account, extra.timestamp ?? "2026-09-03T00:00:01.000Z", extra),
        context({ scenario, surface, runId, step, eventName }),
      ),
    );
  };
  add("desktop-one-turn", "desktop", "10000000-0000-4000-8000-000000000001", "single", "a");
  add(
    "cli-interactive-one-turn",
    "cli-interactive",
    "10000000-0000-4000-8000-000000000002",
    "single",
    "a",
  );
  add(
    "cli-headless-one-turn",
    "cli-headless",
    "10000000-0000-4000-8000-000000000003",
    "single",
    "a",
  );
  for (const [step, surface] of [
    ["desktop", "desktop"],
    ["cli", "cli-interactive"],
  ])
    add("desktop-cli-same-account", surface, "10000000-0000-4000-8000-000000000004", step, "a");
  add(
    "desktop-cli-different-accounts",
    "desktop",
    "10000000-0000-4000-8000-000000000005",
    "desktop",
    "a",
  );
  add(
    "desktop-cli-different-accounts",
    "cli-interactive",
    "10000000-0000-4000-8000-000000000005",
    "cli",
    "b",
  );
  for (const [step, account] of [
    ["a1", "a"],
    ["b", "b"],
    ["a2", "a"],
  ])
    add("cli-a-b-a", "cli-interactive", "10000000-0000-4000-8000-000000000006", step, account);
  for (const [step, account] of [
    ["a1", "a"],
    ["b", "b"],
    ["a2", "a"],
  ])
    add("desktop-a-b-a", "desktop", "10000000-0000-4000-8000-000000000007", step, account);
  add("subagent", "desktop", "10000000-0000-4000-8000-000000000008", "parent", "a");
  add("subagent", "desktop", "10000000-0000-4000-8000-000000000008", "subagent", "a");
  add("aborted-error", "cli-headless", "10000000-0000-4000-8000-000000000009", "single", "a", {
    status: "aborted",
  });
  add("utc-midnight", "desktop", "10000000-0000-4000-8000-000000000010", "before", "a", {
    timestamp: "2026-09-02T23:59:59.000Z",
  });
  add("utc-midnight", "desktop", "10000000-0000-4000-8000-000000000010", "after", "a", {
    timestamp: "2026-09-03T00:00:01.000Z",
  });
  rows[0] = sanitizeCursorObservation(
    { ...usagePayload("a"), request_id: "shared-event" },
    context({ eventName: "stop" }),
  );
  rows[1] = sanitizeCursorObservation(
    { ...usagePayload("a"), request_id: "shared-event" },
    context({
      surface: "cli-interactive",
      scenario: "cli-interactive-one-turn",
      runId: "10000000-0000-4000-8000-000000000002",
      eventName: "local-jsonl",
    }),
  );
  await writeEvidenceRows(outputDirectory, rows);
  const report = await buildEvidenceReport(outputDirectory, {
    ...reportSelections,
    eventIdentityKind: "request_id",
  });
  assert.equal(report.productionGate, "closed");
  assert.equal(report.mechanicalCoverageComplete, true);
  assert.equal(report.hookHistoryIdentityReconciled, true);
  assert.equal(report.hookHistoryIdentityConflict, false);
  assert.equal(report.accountAliasConflict, false);
  assert.equal(report.selectedEventIdentityKind, "request_id");
  assert.equal(report.semanticCoverageComplete, false);
  assert.ok(report.semanticEvidence.subagent.length > 0);
  assert.equal(report.semanticEvidence.abortedError.exactUsageObserved, true);
  assert.equal(report.distinctLocallyLinkedAccounts, 2);
  assert.ok(Object.values(report.scenarioCoverage).every(Boolean));
  assert.ok(report.limitations.length >= 4);
  assert.ok(report.limitations.includes("production_gate_requires_authenticated_review"));
  assert.deepEqual(report.observedCandidateRelationships, [
    "total_equals_input_output_cache_read_cache_write",
  ]);

  const observationsDirectory = join(outputDirectory, "observations");
  add("desktop-one-turn", "desktop", runA, "single", "conflicting-account");
  const conflict = rows.at(-1);
  await writePrivateFile(
    join(observationsDirectory, `${conflict.observationId}.json`),
    `${JSON.stringify(conflict)}\n`,
  );
  const conflictingReport = await buildEvidenceReport(outputDirectory, {
    ...reportSelections,
    eventIdentityKind: "request_id",
  });
  assert.equal(conflictingReport.scenarioCoverage["desktop-one-turn"], false);
  assert.equal(conflictingReport.mechanicalCoverageComplete, false);
});

test("report closes coverage for global one-to-one account alias conflicts", async (testContext) => {
  for (const [name, payloads] of [
    [
      "email-to-ids",
      [
        { account_id: "account-A", user_email: "x@example.invalid" },
        { account_id: "account-B", user_email: "x@example.invalid" },
      ],
    ],
    [
      "id-to-emails",
      [
        { account_id: "account-A", user_email: "x@example.invalid" },
        { account_id: "account-A", user_email: "y@example.invalid" },
      ],
    ],
  ]) {
    const outputDirectory = await privateTemporaryDirectory(
      testContext,
      `viberacing-cursor-alias-${name}-`,
    );
    const cursorRoot = await privateTemporaryDirectory(testContext, "viberacing-cursor-hooks-");
    await installProbeHooks({
      outputDirectory,
      surface: "desktop",
      scenario: "desktop-one-turn",
      runId: runA,
      step: "single",
      event: "stop",
      hooksFile: join(cursorRoot, "hooks.json"),
    });
    await rm(join(outputDirectory, "runs"), { recursive: true, force: true });
    const observations = [];
    for (const [index, aliases] of payloads.entries()) {
      const observation = sanitizeCursorObservation(
        {
          ...usagePayload(`alias-${index}`),
          ...aliases,
          request_id: `alias-${index}`,
        },
        context({ eventName: "local-jsonl" }),
      );
      observations.push(observation);
    }
    await writeEvidenceRows(outputDirectory, observations);
    const report = await buildEvidenceReport(outputDirectory, {
      ...reportSelections,
      eventIdentityKind: "request_id",
    });
    assert.equal(report.accountAliasConflict, true, name);
    assert.ok(report.accountAliasConflictCount > 0, name);
    assert.equal(report.mechanicalCoverageComplete, false, name);
    assert.ok(report.limitations.includes("account_alias_conflict"), name);
  }
});

test("hook/history reconciliation requires a selected event identity and an exact event tuple", async (testContext) => {
  const outputDirectory = await privateTemporaryDirectory(testContext, "viberacing-cursor-output-");
  const cursorRoot = await privateTemporaryDirectory(testContext, "viberacing-cursor-hooks-");
  await installProbeHooks({
    outputDirectory,
    surface: "desktop",
    scenario: "desktop-one-turn",
    runId: runA,
    step: "single",
    event: "stop",
    hooksFile: join(cursorRoot, "hooks.json"),
  });
  await rm(join(outputDirectory, "runs"), { recursive: true, force: true });
  const observationsDirectory = join(outputDirectory, "observations");
  const hook = sanitizeCursorObservation(
    { ...usagePayload("a"), request_id: "reviewed-event", conversation_id: "shared-session" },
    context({ eventName: "stop" }),
  );
  const history = sanitizeCursorObservation(
    { ...usagePayload("a"), request_id: "reviewed-event", conversation_id: "shared-session" },
    context({ eventName: "local-jsonl" }),
  );
  await writeEvidenceRows(outputDirectory, [hook, history]);
  const unselected = await buildEvidenceReport(outputDirectory, reportSelections);
  assert.equal(unselected.hookHistoryIdentityReconciled, false);
  assert.ok(unselected.limitations.includes("hook_history_identity_kind_not_selected"));
  await assert.rejects(
    buildEvidenceReport(outputDirectory, { eventIdentityKind: "conversation_id" }),
    /event_id, request_id, or generation_id/,
  );
  const exact = await buildEvidenceReport(outputDirectory, {
    ...reportSelections,
    eventIdentityKind: "request_id",
  });
  assert.equal(exact.hookHistoryIdentityReconciled, true);
  assert.equal(exact.hookHistoryIdentityConflict, false);

  const missingTimestampPayload = usagePayload("a");
  delete missingTimestampPayload.timestamp;
  missingTimestampPayload.request_id = "reviewed-event";
  missingTimestampPayload.usage = {
    ...missingTimestampPayload.usage,
    inputTokens: 9,
    totalTokens: 99,
  };
  const missingTimestamp = sanitizeCursorObservation(
    missingTimestampPayload,
    context({ eventName: "local-jsonl", runId: runB }),
  );
  await writeEvidenceRows(outputDirectory, [missingTimestamp]);
  const incompleteConflict = await buildEvidenceReport(outputDirectory, {
    ...reportSelections,
    eventIdentityKind: "request_id",
  });
  assert.equal(incompleteConflict.hookHistoryIdentityReconciled, false);
  assert.equal(incompleteConflict.hookHistoryIdentityConflict, true);

  const ambiguousIdentity = sanitizeCursorObservation(
    {
      ...usagePayload("a"),
      request_id: "reviewed-event",
      nested: { request_id: "different-event" },
    },
    context({ eventName: "stop", runId: "33333333-3333-4333-8333-333333333333" }),
  );
  await writeEvidenceRows(outputDirectory, [ambiguousIdentity]);
  const ambiguous = await buildEvidenceReport(outputDirectory, {
    ...reportSelections,
    eventIdentityKind: "request_id",
  });
  assert.equal(ambiguous.selectedEventIdentityAmbiguousObservationCount, 0);
  assert.equal(ambiguous.hookHistoryIdentityReconciled, false);
  assert.equal(ambiguous.mechanicalCoverageComplete, false);
  assert.ok(!ambiguous.limitations.includes("selected_event_identity_ambiguous"));

  const conflicting = sanitizeCursorObservation(
    {
      ...usagePayload("a"),
      request_id: "reviewed-event",
      usage: { ...usagePayload("a").usage, outputTokens: 21, totalTokens: 101 },
    },
    context({
      eventName: "local-jsonl",
      runId: "44444444-4444-4444-8444-444444444444",
    }),
  );
  await writeEvidenceRows(outputDirectory, [conflicting]);
  const conflict = await buildEvidenceReport(outputDirectory, {
    ...reportSelections,
    eventIdentityKind: "request_id",
  });
  assert.equal(conflict.hookHistoryIdentityReconciled, false);
  assert.equal(conflict.hookHistoryIdentityConflict, true);
  assert.equal(conflict.mechanicalCoverageComplete, false);
});

test("report separates lifecycle contracts and rejects unbound non-parsed hook evidence", async (testContext) => {
  const outputDirectory = await privateTemporaryDirectory(testContext, "viberacing-cursor-output-");
  const cursorRoot = await privateTemporaryDirectory(testContext, "viberacing-cursor-hooks-");
  await installProbeHooks({
    outputDirectory,
    surface: "desktop",
    scenario: "desktop-one-turn",
    runId: runA,
    step: "single",
    event: "stop",
    hooksFile: join(cursorRoot, "hooks.json"),
  });
  await rm(join(outputDirectory, "runs"), { recursive: true, force: true });
  const observations = [
    sanitizeCursorObservation(usagePayload("a"), context({ eventName: "stop" })),
    sanitizeCursorObservation(
      {
        request_id: "after-response",
        timestamp: "2026-09-03T00:00:02.000Z",
        cursor_version: "3.18.0",
        status: "completed",
      },
      context({ eventName: "afterAgentResponse" }),
    ),
    sanitizeCursorObservation(null, context({ eventName: "sessionEnd" })),
  ];
  await writeEvidenceRows(outputDirectory, observations);
  const report = await buildEvidenceReport(outputDirectory, {
    ...reportSelections,
    eventIdentityKind: "request_id",
  });
  assert.equal(report.scenarioCoverage["desktop-one-turn"], true);
  assert.equal(report.hookEventCandidates.stop.usageObservationCount, 1);
  assert.equal(report.hookEventCandidates.afterAgentResponse.usageObservationCount, 0);
  assert.equal(report.nonParsedObservationCount, 0);
  assert.equal(report.invalidRunManifestCount, 1);
  assert.equal(report.mechanicalCoverageComplete, false);
  assert.ok(report.limitations.includes("run_manifest_incomplete_or_conflicting"));
});

test("the observation ceiling is itself treated as truncation", async (testContext) => {
  assert.equal(observationCapacityReached(9_999), false);
  assert.equal(observationCapacityReached(10_000), true);
  assert.equal(observationCapacityReached(10_001), true);

  const outputDirectory = await privateTemporaryDirectory(testContext, "viberacing-cursor-output-");
  const cursorRoot = await privateTemporaryDirectory(testContext, "viberacing-cursor-hooks-");
  await installProbeHooks({
    outputDirectory,
    surface: "desktop",
    scenario: "desktop-one-turn",
    runId: runA,
    step: "single",
    hooksFile: join(cursorRoot, "hooks.json"),
  });
  await rm(join(outputDirectory, "runs"), { recursive: true, force: true });
  const observations = [];
  for (const account of ["a", "b"]) {
    observations.push(
      sanitizeCursorObservation(usagePayload(account), context({ eventName: "local-jsonl" })),
    );
  }
  await writeEvidenceRows(outputDirectory, observations);
  const report = await buildEvidenceReport(outputDirectory, {
    ...reportSelections,
    maximumObservationCount: 2,
  });
  assert.equal(report.observationCount, 2);
  assert.equal(report.observationSetTruncated, true);
  assert.equal(report.mechanicalCoverageComplete, false);
});

test("empty evidence and truncated observations cannot open even the mechanical gate", async (testContext) => {
  const outputDirectory = await privateTemporaryDirectory(testContext, "viberacing-cursor-output-");
  const cursorRoot = await privateTemporaryDirectory(testContext, "viberacing-cursor-hooks-");
  await installProbeHooks({
    outputDirectory,
    surface: "desktop",
    scenario: "desktop-one-turn",
    runId: runA,
    step: "single",
    hooksFile: join(cursorRoot, "hooks.json"),
  });
  const report = await buildEvidenceReport(outputDirectory);
  assert.equal(report.productionGate, "closed");
  assert.equal(report.mechanicalCoverageComplete, false);
  assert.ok(report.limitations.length > 0);
});

test(
  "probe rejects a group-readable output directory",
  { skip: process.platform === "win32" },
  async (testContext) => {
    const outputDirectory = await privateTemporaryDirectory(
      testContext,
      "viberacing-cursor-output-",
    );
    await chmod(outputDirectory, 0o755);
    await assert.rejects(
      installProbeHooks({
        outputDirectory,
        surface: "desktop",
        scenario: "desktop-one-turn",
        runId: runA,
        step: "single",
        hooksFile: join(dirname(outputDirectory), "cursor-hooks.json"),
      }),
      /not owner-only/,
    );
  },
);

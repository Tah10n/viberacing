import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
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
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  ensureOwnerOnlyWindowsFile,
  inspectOwnerOnlyWindowsFile,
} from "../packages/connector/lib/windows-security.mjs";
import {
  buildEvidenceReport,
  installProbeHooks,
  observationCapacityReached,
  removeProbeHooks,
  runCursorCli,
  sanitizeCursorObservation,
} from "./cursor-evidence-probe.mjs";

const hmacKey = "a".repeat(43);
const runA = "11111111-1111-4111-8111-111111111111";
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
    ...overrides,
  };
}

async function privateTemporaryDirectory(testContext, prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  if (process.platform !== "win32") await chmod(directory, 0o700);
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
    "event_identity_limit",
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
    emailUpper.accountIdentityCandidates[1].hashes[0],
    emailLower.accountIdentityCandidates[1].hashes[0],
  );
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
      ? /^\.\\hooks\\viberacing-cursor-evidence-[0-9a-f-]+-[0-9a-f-]+\\scripts\\viberacing-cursor-evidence-probe\.cmd$/
      : /^\.\/hooks\/viberacing-cursor-evidence-[0-9a-f-]+-[0-9a-f-]+\/scripts\/viberacing-cursor-evidence-probe-hook\.mjs$/,
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
    "hooks",
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
      "hooks",
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
      "hooks",
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
      "hooks",
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
      runId: runA,
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
  const observationsDirectory = join(outputDirectory, "observations");
  await mkdir(observationsDirectory, { mode: 0o700 });
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
  for (const row of rows)
    await writePrivateFile(
      join(observationsDirectory, `${row.observationId}.json`),
      `${JSON.stringify(row)}\n`,
    );
  const report = await buildEvidenceReport(outputDirectory, {
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

  add("desktop-one-turn", "desktop", runA, "single", "conflicting-account");
  const conflict = rows.at(-1);
  await writePrivateFile(
    join(observationsDirectory, `${conflict.observationId}.json`),
    `${JSON.stringify(conflict)}\n`,
  );
  const conflictingReport = await buildEvidenceReport(outputDirectory, {
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
    const observationsDirectory = join(outputDirectory, "observations");
    await mkdir(observationsDirectory, { mode: 0o700 });
    for (const [index, aliases] of payloads.entries()) {
      const observation = sanitizeCursorObservation(
        {
          ...usagePayload(`alias-${index}`),
          ...aliases,
          request_id: `alias-${index}`,
        },
        context(),
      );
      await writePrivateFile(
        join(observationsDirectory, `${observation.observationId}.json`),
        `${JSON.stringify(observation)}\n`,
      );
    }
    const report = await buildEvidenceReport(outputDirectory, {
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
  const observationsDirectory = join(outputDirectory, "observations");
  await mkdir(observationsDirectory, { mode: 0o700 });
  const hook = sanitizeCursorObservation(
    { ...usagePayload("a"), request_id: "reviewed-event", conversation_id: "shared-session" },
    context({ eventName: "stop" }),
  );
  const history = sanitizeCursorObservation(
    { ...usagePayload("a"), request_id: "reviewed-event", conversation_id: "shared-session" },
    context({ eventName: "local-jsonl" }),
  );
  for (const observation of [hook, history])
    await writePrivateFile(
      join(observationsDirectory, `${observation.observationId}.json`),
      `${JSON.stringify(observation)}\n`,
    );
  const unselected = await buildEvidenceReport(outputDirectory);
  assert.equal(unselected.hookHistoryIdentityReconciled, false);
  assert.ok(unselected.limitations.includes("hook_history_identity_kind_not_selected"));
  await assert.rejects(
    buildEvidenceReport(outputDirectory, { eventIdentityKind: "conversation_id" }),
    /event_id, request_id, or generation_id/,
  );
  const exact = await buildEvidenceReport(outputDirectory, {
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
    context({ eventName: "local-jsonl" }),
  );
  await writePrivateFile(
    join(observationsDirectory, `${missingTimestamp.observationId}.json`),
    `${JSON.stringify(missingTimestamp)}\n`,
  );
  const incompleteConflict = await buildEvidenceReport(outputDirectory, {
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
    context({ eventName: "stop" }),
  );
  await writePrivateFile(
    join(observationsDirectory, `${ambiguousIdentity.observationId}.json`),
    `${JSON.stringify(ambiguousIdentity)}\n`,
  );
  const ambiguous = await buildEvidenceReport(outputDirectory, {
    eventIdentityKind: "request_id",
  });
  assert.equal(ambiguous.selectedEventIdentityAmbiguousObservationCount, 1);
  assert.equal(ambiguous.hookHistoryIdentityReconciled, false);
  assert.equal(ambiguous.mechanicalCoverageComplete, false);
  assert.ok(ambiguous.limitations.includes("selected_event_identity_ambiguous"));

  const conflicting = sanitizeCursorObservation(
    {
      ...usagePayload("a"),
      request_id: "reviewed-event",
      usage: { ...usagePayload("a").usage, outputTokens: 21, totalTokens: 101 },
    },
    context({ eventName: "local-jsonl" }),
  );
  await writePrivateFile(
    join(observationsDirectory, `${conflicting.observationId}.json`),
    `${JSON.stringify(conflicting)}\n`,
  );
  const conflict = await buildEvidenceReport(outputDirectory, {
    eventIdentityKind: "request_id",
  });
  assert.equal(conflict.hookHistoryIdentityReconciled, false);
  assert.equal(conflict.hookHistoryIdentityConflict, true);
  assert.equal(conflict.mechanicalCoverageComplete, false);
});

test("report separates lifecycle event contracts and exposes non-parsed mandatory evidence", async (testContext) => {
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
  const observationsDirectory = join(outputDirectory, "observations");
  await mkdir(observationsDirectory, { mode: 0o700 });
  const observations = [
    sanitizeCursorObservation(usagePayload("a"), context({ eventName: "stop" })),
    sanitizeCursorObservation(
      { timestamp: "2026-09-03T00:00:02.000Z", status: "completed" },
      context({ eventName: "afterAgentResponse" }),
    ),
    sanitizeCursorObservation(null, context({ eventName: "sessionEnd" })),
  ];
  for (const observation of observations)
    await writePrivateFile(
      join(observationsDirectory, `${observation.observationId}.json`),
      `${JSON.stringify(observation)}\n`,
    );
  const report = await buildEvidenceReport(outputDirectory, {
    eventIdentityKind: "request_id",
  });
  assert.equal(report.scenarioCoverage["desktop-one-turn"], true);
  assert.equal(report.hookEventCandidates.stop.usageObservationCount, 1);
  assert.equal(report.hookEventCandidates.afterAgentResponse.usageObservationCount, 0);
  assert.equal(report.nonParsedObservationCount, 1);
  assert.equal(report.mechanicalCoverageComplete, false);
  assert.ok(report.limitations.includes("non_parsed_required_observations_cannot_qualify"));
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
  const observationsDirectory = join(outputDirectory, "observations");
  await mkdir(observationsDirectory, { mode: 0o700 });
  for (const account of ["a", "b"]) {
    const observation = sanitizeCursorObservation(usagePayload(account), context());
    await writePrivateFile(
      join(observationsDirectory, `${observation.observationId}.json`),
      `${JSON.stringify(observation)}\n`,
    );
  }
  const report = await buildEvidenceReport(outputDirectory, { maximumObservationCount: 2 });
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

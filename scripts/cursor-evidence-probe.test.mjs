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
  assert.equal(
    first.command,
    process.platform === "win32"
      ? ".\\hooks\\viberacing-cursor-evidence-probe.cmd"
      : "./hooks/viberacing-cursor-evidence-probe-hook.mjs",
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
  const removed = await removeProbeHooks({ outputDirectory, hooksFile });
  assert.deepEqual(removed, { changed: true, artifactsRemoved: true });
  assert.deepEqual(JSON.parse(await readFile(hooksFile, "utf8")), foreign);
});

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
    for (const path of [
      join(outputDirectory, "cursor-evidence-state.json"),
      join(outputDirectory, "observations", observationName),
      join(cursorRoot, "hooks", "viberacing-cursor-evidence-probe-state.json"),
      join(cursorRoot, "hooks", "viberacing-cursor-evidence-probe-hook.mjs"),
      join(cursorRoot, "hooks", "viberacing-cursor-evidence-probe.cmd"),
    ])
      assert.equal(await inspectOwnerOnlyWindowsFile(path), true, path);
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
  await writePrivateFile(hooksFile, '{"version":1,"hooks":{}}\n');
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
          '{"version":1,"hooks":{"afterFileEdit":[{"command":"late-foreign"}]}}\n',
          { flag: "wx" },
        );
    },
  });
  assert.equal(result.changed, true);
  const document = JSON.parse(await readFile(hooksFile, "utf8"));
  assert.deepEqual(document.hooks.afterFileEdit, [{ command: "late-foreign" }]);
  assert.ok(document.hooks.stop.some(({ command }) => command === result.command));
});

test("hook mutation recovers a displaced hooks.json left by an interrupted publish", async (testContext) => {
  const outputDirectory = await privateTemporaryDirectory(testContext, "viberacing-cursor-output-");
  const cursorRoot = await privateTemporaryDirectory(testContext, "viberacing-cursor-hooks-");
  const hooksFile = join(cursorRoot, "hooks.json");
  const recovery = `${hooksFile}.viberacing-cursor-evidence.recovery`;
  await writePrivateFile(
    recovery,
    '{"version":1,"hooks":{"afterFileEdit":[{"command":"preserved"}]}}\n',
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
  assert.deepEqual(document.hooks.afterFileEdit, [{ command: "preserved" }]);
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
    const agent = join(outputDirectory, "fake-agent.mjs");
    const late = JSON.stringify({ ...usagePayload("late"), status: "completed" }) + "\n";
    await writeExecutable(
      agent,
      `#!/usr/bin/env node
import { spawn } from "node:child_process";
if (process.argv.includes("--version")) { process.stdout.write("1.2.3\\n"); process.exit(0); }
const first = Buffer.from(JSON.stringify({ ...${JSON.stringify(usagePayload("first"))}, note: "split-€-utf8" }) + "\\n");
const euro = first.indexOf(Buffer.from("€"));
process.stdout.write(first.subarray(0, euro + 1));
process.stdout.write(first.subarray(euro + 1));
process.stdout.write("{malformed}\\n");
spawn(process.execPath, ["-e", ${JSON.stringify(`setTimeout(() => process.stdout.write(${JSON.stringify(late)}), 60)`)}], { stdio: ["ignore", "inherit", "inherit"] }).unref();
`,
    );
    const saved = [];
    let writesInFlight = 0;
    const forwarded = [];
    const result = await runCursorCli({
      outputDirectory,
      executable: agent,
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
  const report = await buildEvidenceReport(outputDirectory);
  assert.equal(report.productionGate, "closed");
  assert.equal(report.mechanicalCoverageComplete, true);
  assert.equal(report.hookHistoryIdentityReconciled, true);
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
  const conflictingReport = await buildEvidenceReport(outputDirectory);
  assert.equal(conflictingReport.scenarioCoverage["desktop-one-turn"], false);
  assert.equal(conflictingReport.mechanicalCoverageComplete, false);
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

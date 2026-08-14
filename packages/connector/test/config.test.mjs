import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import {
  access,
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const connectorPath = fileURLToPath(new URL("../bin/viberacing.mjs", import.meta.url));

const sourceIds = new Map();
function source(agentId) {
  if (!sourceIds.has(agentId)) {
    const suffix = (sourceIds.size + 1).toString().padStart(12, "0");
    sourceIds.set(agentId, `00000000-0000-4000-8000-${suffix}`);
  }
  return { agentId, clientSourceId: sourceIds.get(agentId) };
}

function connectorEnvironment(home, extra = {}) {
  return {
    ...process.env,
    VIBERACING_STATE_DIR: join(home, ".viberacing"),
    CODEX_HOME: join(home, ".codex"),
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    KIMI_SHARE_DIR: join(home, ".kimi"),
    QWEN_HOME: join(home, ".qwen"),
    GEMINI_CLI_HOME: home,
    ...extra,
  };
}

function useModuleEnvironment(home) {
  const environment = connectorEnvironment(home);
  const names = [
    "VIBERACING_STATE_DIR",
    "CODEX_HOME",
    "CLAUDE_CONFIG_DIR",
    "KIMI_SHARE_DIR",
    "QWEN_HOME",
    "GEMINI_CLI_HOME",
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) process.env[name] = environment[name];
  return () => {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  };
}

async function writeLocalSources(directory, sources) {
  await writeFile(join(directory, "sources.json"), `${JSON.stringify({ version: 1, sources })}\n`);
}

async function readLocalSources(directory) {
  return JSON.parse(await readFile(join(directory, "sources.json"), "utf8")).sources;
}

async function writeCaptureInstallation(home, origin, options = {}) {
  const directory = join(home, ".viberacing");
  const clientSourceId = options.clientSourceId ?? "abababab-abab-4bab-8bab-abababababab";
  const capture = join(directory, "captures", `${clientSourceId}.jsonl`);
  const sourceId = options.sourceId ?? "89898989-8989-4989-8989-898989898989";
  const date = new Date().toISOString().slice(0, 10);
  await mkdir(join(directory, "captures"), { recursive: true });
  await writeFile(
    capture,
    `${JSON.stringify({
      id: options.eventId ?? "synthetic-network-event",
      date,
      usage: { date, totalTokens: "3", inputTokens: "1", outputTokens: "2" },
    })}\n`,
  );
  await writeLocalSources(directory, [
    {
      clientSourceId,
      agentId: "antigravity",
      dataPath: capture,
      collectionMethod: "antigravity_cli_capture",
      supportedSurface: "cli",
      suggestedLabel: "Antigravity",
    },
  ]);
  await writeFile(
    join(directory, "config.json"),
    `${JSON.stringify({
      version: 2,
      origin,
      deviceToken: "synthetic-device-token-that-is-long-enough",
      sources: [
        {
          clientSourceId,
          sourceId,
          agentId: "antigravity",
          accountLabel: "Antigravity",
          collectionMethod: "antigravity_cli_capture",
          lastAcceptedSyncSequence: "0",
        },
      ],
    })}\n`,
  );
  await writeFile(
    join(directory, "state.json"),
    `${JSON.stringify({ version: 1, sequences: { [sourceId]: "0" } })}\n`,
  );
  return { directory, capture, clientSourceId, sourceId };
}

async function writeMappedInstallation(home, origin, sources) {
  const directory = join(home, ".viberacing");
  await mkdir(directory, { recursive: true });
  await writeLocalSources(
    directory,
    sources.map(({ sourceId: _sourceId, accountLabel: _accountLabel, ...source }) => source),
  );
  await writeFile(
    join(directory, "config.json"),
    `${JSON.stringify({
      version: 2,
      origin,
      deviceToken: "synthetic-device-token-that-is-long-enough",
      sources: sources.map((source) => ({
        clientSourceId: source.clientSourceId,
        sourceId: source.sourceId,
        agentId: source.agentId,
        accountLabel: source.accountLabel ?? source.suggestedLabel,
        collectionMethod: source.collectionMethod,
        lastAcceptedSyncSequence: "0",
      })),
    })}\n`,
  );
  await writeFile(
    join(directory, "state.json"),
    `${JSON.stringify({
      version: 1,
      sequences: Object.fromEntries(sources.map((source) => [source.sourceId, "0"])),
    })}\n`,
  );
  return directory;
}

async function runWithInput(arguments_, environment, input) {
  const child = spawn(process.execPath, [connectorPath, ...arguments_], {
    env: environment,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
  child.stdin.end(input);
  const [code] = await once(child, "close");
  return { code, stdout, stderr };
}

async function waitFor(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for test condition");
    await delay(20);
  }
}

test("installs a runnable connector copy and additive, owned hooks", async () => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-connector-"));
  const restoreEnvironment = useModuleEnvironment(home);
  try {
    await mkdir(join(home, ".codex"));
    await writeFile(
      join(home, ".codex", "hooks.json"),
      JSON.stringify({
        hooks: {
          SessionEnd: [
            { hooks: [{ type: "command", command: "keep-me" }] },
            {
              hooks: [
                { type: "command", command: "node old --viberacing-hook-id=viberacing-hook-v2" },
              ],
            },
          ],
        },
      }),
    );
    const module = await import(`../lib/config.mjs?home=${encodeURIComponent(home)}`);
    await module.installHooks(new URL("../bin/viberacing.mjs", import.meta.url), [
      source("codex"),
      source("claude_code"),
      source("gemini_cli"),
      source("qwen_code"),
      source("kimi_code"),
    ]);
    for (const name of ["browser.mjs", "config.mjs", "readers.mjs", "registry.mjs", "runtime.mjs"])
      await access(join(home, ".viberacing", "lib", name));
    await access(join(home, ".viberacing", "lib", "adapters", "codex.mjs"));
    const codex = JSON.parse(await readFile(join(home, ".codex", "hooks.json"), "utf8"));
    const claude = JSON.parse(await readFile(join(home, ".claude", "settings.json"), "utf8"));
    const gemini = JSON.parse(await readFile(join(home, ".gemini", "settings.json"), "utf8"));
    const qwen = JSON.parse(await readFile(join(home, ".qwen", "settings.json"), "utf8"));
    const kimi = await readFile(join(home, ".kimi", "config.toml"), "utf8");
    assert.equal(codex.hooks.SessionEnd[0].hooks[0].command, "keep-me");
    const codexMarker = module.hookMarkerForSource(source("codex").clientSourceId);
    assert.equal(
      codex.hooks.SessionEnd.filter((group) => JSON.stringify(group).includes(codexMarker)).length,
      1,
    );
    assert.doesNotMatch(JSON.stringify(codex), /viberacing-hook-v2/);
    assert.match(JSON.stringify(claude), /viberacing-hook-v3:/);
    assert.match(JSON.stringify(gemini), /viberacing-hook-v3:/);
    assert.match(JSON.stringify(qwen), /viberacing-hook-v3:/);
    assert.equal(gemini.hooks.SessionEnd.at(-1).hooks[0].timeout, 10_000);
    assert.equal(qwen.hooks.SessionEnd.at(-1).hooks[0].timeout, 10_000);
    assert.match(kimi, /\[\[hooks\]\][\s\S]*Stop[\s\S]*viberacing-hook-v3:/);
    const hooks = await module.diagnoseHooks([
      source("codex"),
      source("claude_code"),
      source("gemini_cli"),
      source("qwen_code"),
      source("kimi_code"),
      source("opencode"),
      source("cursor"),
    ]);
    assert.deepEqual(hooks, {
      codex: "current",
      claude_code: "current",
      gemini_cli: "current",
      qwen_code: "current",
      kimi_code: "current",
      opencode: "manual-sync",
      cursor: "capture-wrapper",
    });
    await writeFile(
      join(home, ".claude", "settings.json"),
      JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [
                {
                  type: "command",
                  command: `node obsolete.mjs hook ${module.hookMarkerForSource(source("claude_code").clientSourceId)}`,
                },
              ],
            },
          ],
        },
      }),
    );
    assert.equal((await module.diagnoseHooks([source("claude_code")])).claude_code, "outdated");
    await module.installHooks(pathToFileURL(join(home, ".viberacing", "bin", "viberacing.mjs")), [
      source("codex"),
    ]);
    await module.removeHooks();
    assert.doesNotMatch(
      await readFile(join(home, ".codex", "hooks.json"), "utf8"),
      /viberacing-hook-v[23]/,
    );
    assert.match(await readFile(join(home, ".codex", "hooks.json"), "utf8"), /keep-me/);
    assert.doesNotMatch(
      await readFile(join(home, ".kimi", "config.toml"), "utf8"),
      /viberacing-hook-v[23]/,
    );
  } finally {
    restoreEnvironment();
  }
});

test("reports invalid existing hook settings instead of claiming success", async () => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-connector-invalid-settings-"));
  const restoreEnvironment = useModuleEnvironment(home);
  try {
    await mkdir(join(home, ".claude"));
    await writeFile(join(home, ".claude", "settings.json"), "{not-json");
    const module = await import(`../lib/config.mjs?invalid-home=${encodeURIComponent(home)}`);
    await assert.rejects(
      module.installHooks(new URL("../bin/viberacing.mjs", import.meta.url), [
        source("claude_code"),
      ]),
      /Cannot read hook settings/,
    );
  } finally {
    restoreEnvironment();
  }
});

test("source-owned hooks reconcile profiles independently and upgrade legacy markers", async () => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-source-hooks-"));
  const restoreEnvironment = useModuleEnvironment(home);
  try {
    const module = await import(`../lib/config.mjs?source-hooks=${encodeURIComponent(home)}`);
    const first = {
      clientSourceId: "71717171-7171-4171-8171-717171717171",
      agentId: "qwen_code",
      dataPath: join(home, "qwen-personal"),
      collectionMethod: "qwen_stats_jsonl",
      supportedSurface: "cli",
      suggestedLabel: "Personal",
    };
    const second = {
      ...first,
      clientSourceId: "72727272-7272-4272-8272-727272727272",
      dataPath: join(home, "qwen-work"),
      suggestedLabel: "Work",
    };
    for (const profile of [first, second]) {
      await mkdir(profile.dataPath, { recursive: true });
      await writeFile(
        join(profile.dataPath, "settings.json"),
        JSON.stringify({
          hooks: {
            SessionEnd: [
              { hooks: [{ type: "command", command: "keep-foreign-hook" }] },
              ...(profile === first
                ? [
                    {
                      hooks: [
                        {
                          type: "command",
                          command: `node old hook ${module.legacyHookMarker}`,
                        },
                      ],
                    },
                  ]
                : []),
            ],
          },
        }),
      );
    }
    await module.reconcileHooks(
      new URL("../bin/viberacing.mjs", import.meta.url),
      [first, second],
      [first, second],
    );
    const firstSettings = await readFile(join(first.dataPath, "settings.json"), "utf8");
    const secondSettings = await readFile(join(second.dataPath, "settings.json"), "utf8");
    assert.match(firstSettings, new RegExp(module.hookMarkerForSource(first.clientSourceId)));
    assert.match(firstSettings, new RegExp(`--source ${first.clientSourceId}`));
    assert.match(secondSettings, new RegExp(module.hookMarkerForSource(second.clientSourceId)));
    assert.match(secondSettings, new RegExp(`--source ${second.clientSourceId}`));
    assert.doesNotMatch(firstSettings, /viberacing-hook-v2/);
    assert.match(firstSettings, /keep-foreign-hook/);

    await module.removeHookForSource(first);
    assert.doesNotMatch(
      await readFile(join(first.dataPath, "settings.json"), "utf8"),
      new RegExp(module.hookMarkerForSource(first.clientSourceId)),
    );
    assert.match(
      await readFile(join(second.dataPath, "settings.json"), "utf8"),
      new RegExp(module.hookMarkerForSource(second.clientSourceId)),
    );
    assert.equal(await module.diagnoseHookForSource(first), "missing");
    await module.reconcileHooks(
      new URL("../bin/viberacing.mjs", import.meta.url),
      [first],
      [first, second],
    );
    assert.equal(await module.diagnoseHookForSource(first), "current");
    assert.equal(await module.diagnoseHookForSource(second), "missing");
    assert.match(
      await readFile(join(second.dataPath, "settings.json"), "utf8"),
      /keep-foreign-hook/,
    );
  } finally {
    restoreEnvironment();
  }
});

test("keeps installation identity stable and pairing state separate", async () => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-connector-identity-"));
  const restoreEnvironment = useModuleEnvironment(home);
  try {
    const module = await import(`../lib/config.mjs?identity-home=${encodeURIComponent(home)}`);
    const first = await module.readOrCreateInstallation();
    const second = await module.readOrCreateInstallation();
    assert.deepEqual(second, first);
    assert.match(first.id, /^[0-9a-f-]{36}$/);
    await module.writeConfig({ version: 2, origin: "https://example.test", sources: [] });
    assert.equal((await module.readConfig()).origin, "https://example.test");
    if (process.platform !== "win32") {
      assert.equal((await stat(join(home, ".viberacing"))).mode & 0o777, 0o700);
      assert.equal((await stat(join(home, ".viberacing", "config.json"))).mode & 0o777, 0o600);
      assert.equal(
        (await stat(join(home, ".viberacing", "installation.json"))).mode & 0o777,
        0o600,
      );
    }
    await mkdir(join(home, ".viberacing", "pending"));
    await writeFile(join(home, ".viberacing", "state.json"), "{}\n");
    await writeFile(join(home, ".viberacing", "pending", "stale.json"), "{}\n");
    await module.resetInstallation();
    await assert.rejects(access(join(home, ".viberacing", "config.json")));
    await assert.rejects(access(join(home, ".viberacing", "installation.json")));
    await assert.rejects(access(join(home, ".viberacing", "state.json")));
    await assert.rejects(access(join(home, ".viberacing", "pending")));
  } finally {
    restoreEnvironment();
  }
});

test("keeps source UUIDs stable when detected path order changes", async () => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-stable-sources-"));
  const restoreEnvironment = useModuleEnvironment(home);
  try {
    const module = await import(`../lib/config.mjs?stable-sources=${encodeURIComponent(home)}`);
    const firstPath = join(home, "opencode-a.db");
    const secondPath = join(home, "opencode-b.db");
    const shape = (dataPath, label) => ({
      agentId: "opencode",
      collectionMethod: "opencode_sqlite",
      dataPath,
      suggestedLabel: label,
      supportedSurface: "cli",
    });
    const first = await module.reconcileDetectedSources([
      shape(firstPath, "First"),
      shape(secondPath, "Second"),
    ]);
    const firstIds = new Map(first.map((item) => [item.dataPath, item.clientSourceId]));
    const reordered = await module.reconcileDetectedSources([
      shape(secondPath, "Second"),
      shape(firstPath, "First"),
      shape(firstPath, "Duplicate"),
    ]);
    assert.equal(reordered.length, 2);
    assert.equal(
      reordered.find((item) => item.dataPath === firstPath).clientSourceId,
      firstIds.get(firstPath),
    );
    assert.equal(
      reordered.find((item) => item.dataPath === secondPath).clientSourceId,
      firstIds.get(secondPath),
    );
  } finally {
    restoreEnvironment();
  }
});

test("prevents overlapping syncs with an atomic lock", async () => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-runtime-lock-"));
  const restoreEnvironment = useModuleEnvironment(home);
  try {
    const runtime = await import(`../lib/runtime.mjs?lock-home=${encodeURIComponent(home)}`);
    let release;
    const first = runtime.withSyncLock(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(await runtime.withSyncLock(() => "should-not-run"), { skipped: true });
    release("done");
    assert.equal(await first, "done");
    const sourceId = "11111111-1111-4111-8111-111111111111";
    await runtime.savePending({
      protocolVersion: 2,
      snapshots: [{ sourceId, syncSequence: "1", entries: [] }],
    });
    await runtime.savePending({
      protocolVersion: 2,
      snapshots: [{ sourceId, syncSequence: "2", entries: [] }],
    });
    const pending = await runtime.pendingPayloads();
    assert.equal(pending.length, 1);
    assert.equal((await runtime.readPending(pending[0])).snapshots[0].syncSequence, "2");
    const errorSourceId = "22222222-2222-4222-8222-222222222222";
    await runtime.savePending({
      protocolVersion: 2,
      snapshots: [],
      sourceErrors: [{ sourceId: errorSourceId, code: "collector_failed" }],
    });
    const payloads = await Promise.all(
      (await runtime.pendingPayloads()).map((path) => runtime.readPending(path)),
    );
    assert.deepEqual(runtime.mergePendingPayloads(payloads), {
      protocolVersion: 2,
      snapshots: [{ sourceId, syncSequence: "2", entries: [] }],
      sourceErrors: [{ sourceId: errorSourceId, code: "collector_failed" }],
    });
    const maximumBatch = runtime.mergePendingPayloads(
      Array.from({ length: 32 }, (_, index) => ({
        protocolVersion: 2,
        snapshots: [{ sourceId: `source-${index}`, syncSequence: "1", entries: [] }],
        sourceErrors: [],
      })),
    );
    assert.equal(maximumBatch.snapshots.length, 32);
    assert.equal(maximumBatch.sourceErrors.length, 0);
    await runtime.removePendingForSource(errorSourceId);
    assert.equal((await runtime.pendingPayloads()).length, 1);
  } finally {
    restoreEnvironment();
  }
});

test("coalesces dirty events with debounce, cooldown, and a bounded maximum delay", async () => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-auto-dirty-"));
  const restoreEnvironment = useModuleEnvironment(home);
  try {
    const runtime = await import(`../lib/runtime.mjs?auto-dirty=${encodeURIComponent(home)}`);
    const start = Date.parse("2026-08-14T08:00:00.000Z");
    const clientSourceId = "12121212-1212-4121-8121-121212121212";
    for (let index = 0; index < 20; index += 1) {
      await runtime.markDirty(clientSourceId, new Date(start + index * 1_500));
    }
    const dirty = await runtime.readDirty();
    const entry = dirty.sources[clientSourceId];
    assert.equal(entry.dirtySince, new Date(start).toISOString());
    assert.equal(entry.lastEventAt, new Date(start + 28_500).toISOString());
    assert.equal(runtime.automaticDueAt(dirty), start + 43_500);
    const delayed = structuredClone(dirty);
    delayed.sources[clientSourceId].lastEventAt = new Date(start + 300_000).toISOString();
    assert.equal(runtime.automaticDueAt(delayed, 0), start + 120_000);
    assert.equal(runtime.automaticDueAt(dirty, start + 50_000), start + 170_000);
    const secondSourceId = "23232323-2323-4232-8232-232323232323";
    await Promise.all([
      runtime.markDirty(clientSourceId, new Date(start + 30_000)),
      runtime.markDirty(secondSourceId, new Date(start + 30_000)),
    ]);
    const concurrent = await runtime.readDirty();
    assert.deepEqual(
      new Set(runtime.dirtyEntries(concurrent).map(([id]) => id)),
      new Set([clientSourceId, secondSourceId]),
    );
    const claims = runtime.dirtyClaims(concurrent);
    await runtime.markDirty(clientSourceId, new Date(start + 31_000));
    await runtime.clearDirty(claims);
    assert.deepEqual(
      runtime.dirtyEntries(await runtime.readDirty()).map(([id]) => id),
      [clientSourceId],
    );
    assert.deepEqual(
      runtime.configuredAutomaticSyncTimings({
        NODE_ENV: "test",
        VIBERACING_TEST_AUTOMATIC_SYNC_TIMINGS: "25,200,200",
      }),
      { debounceMs: 25, minimumIntervalMs: 200, maximumDelayMs: 200 },
    );
    assert.equal(
      runtime.configuredAutomaticSyncTimings({
        NODE_ENV: "production",
        VIBERACING_TEST_AUTOMATIC_SYNC_TIMINGS: "1,1,1",
      }),
      runtime.automaticSyncTimings,
    );
    const firstScheduler = await runtime.claimScheduler();
    assert.equal(typeof firstScheduler.ownershipToken, "string");
    assert.equal(await runtime.claimScheduler(), false);
    assert.equal(await runtime.ownsScheduler(firstScheduler.ownershipToken), true);
    assert.equal(await runtime.releaseScheduler(firstScheduler.ownershipToken), true);
    const { stateDirectory } = await import("../lib/config.mjs");
    const staleLock = join(stateDirectory, "scheduler.lock");
    const staleOwner = "stale-owner";
    await writeFile(staleLock, `1:${staleOwner}\n`);
    const staleTime = new Date(Date.now() - 11 * 60_000);
    await utimes(staleLock, staleTime, staleTime);
    const replacementScheduler = await runtime.claimScheduler();
    assert.equal(typeof replacementScheduler.ownershipToken, "string");
    assert.equal(await runtime.releaseScheduler(staleOwner), false);
    assert.equal(await runtime.ownsScheduler(replacementScheduler.ownershipToken), true);
    await runtime.releaseScheduler(replacementScheduler.ownershipToken);
  } finally {
    restoreEnvironment();
  }
});

test("capture compaction keeps only recent allowlisted usage metadata", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-capture-compaction-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const restoreEnvironment = useModuleEnvironment(home);
  try {
    const runtime = await import(`../lib/runtime.mjs?capture=${encodeURIComponent(home)}`);
    const path = join(home, "capture.jsonl");
    const usage = (date) => ({
      id: `event-${date}`,
      date,
      usage: { date, totalTokens: "12", inputTokens: "5", outputTokens: "7" },
      prompt: "must-not-survive",
    });
    await writeFile(
      path,
      `${JSON.stringify(usage("2026-07-09"))}\n${JSON.stringify(usage("2026-08-10"))}\n`,
    );
    assert.equal(await runtime.compactCapture(path, new Date("2026-08-14T12:00:00Z"), 1), true);
    const compacted = await readFile(path, "utf8");
    assert.doesNotMatch(compacted, /2026-07-09|prompt|must-not-survive/);
    assert.match(compacted, /2026-08-10/);
    assert.equal(await runtime.compactCapture(path, new Date("2026-08-14T12:00:00Z")), false);
  } finally {
    restoreEnvironment();
  }
});

test("capture compaction serializes concurrent safe appends", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-capture-lock-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const runtimeUrl = pathToFileURL(
    fileURLToPath(new URL("../lib/runtime.mjs", import.meta.url)),
  ).href;
  const script = `
    import { appendCapture, compactCapture } from ${JSON.stringify(runtimeUrl)};
    import { join } from "node:path";
    const date = "2026-08-10";
    const path = join(process.env.VIBERACING_STATE_DIR, "captures", "34343434-3434-4343-8343-343434343434.jsonl");
    const source = { agentId: "antigravity", clientSourceId: "34343434-3434-4343-8343-343434343434", dataPath: path };
    const usage = (id) => ({ id, date, usage: { date, totalTokens: "12", inputTokens: "5", outputTokens: "7" } });
    await appendCapture(source, [usage("initial")]);
    await Promise.all([
      ...Array.from({ length: 20 }, (_, index) => appendCapture(source, [usage(\`concurrent-\${index}\`)])),
      ...Array.from({ length: 5 }, () => compactCapture(path, new Date("2026-08-14T12:00:00Z"), 1)),
    ]);
  `;
  await execFileAsync(process.execPath, ["--input-type=module", "--eval", script], {
    env: connectorEnvironment(home),
  });
  const path = join(home, ".viberacing", "captures", "34343434-3434-4343-8343-343434343434.jsonl");
  const ids = (await readFile(path, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).id)
    .sort();
  assert.deepEqual(
    ids,
    ["initial", ...Array.from({ length: 20 }, (_, index) => `concurrent-${index}`)].sort(),
  );
  await assert.rejects(access(`${path}.lock`));
});

test("hook discards stdin, emits only contract JSON, and fails open", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-hook-lightweight-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const blockedState = join(home, "state-is-a-file");
  await writeFile(blockedState, "not a directory");
  const result = await runWithInput(
    ["hook", "--agent", "qwen_code"],
    { ...connectorEnvironment(home), VIBERACING_STATE_DIR: blockedState },
    '{"prompt":"synthetic-private-prompt","cwd":"/synthetic/private/path"}',
  );
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "{}\n");
  assert.equal(result.stderr, "");
  assert.equal(await readFile(blockedState, "utf8"), "not a directory");
});

test("real hooks coalesce into one batch and preserve an event arriving during sync", async (context) => {
  const bodies = [];
  const requestTimes = [];
  let firstRequestStarted;
  let releaseFirstResponse;
  const firstRequest = new Promise((resolve) => {
    firstRequestStarted = resolve;
  });
  const firstResponseCanFinish = new Promise((resolve) => {
    releaseFirstResponse = resolve;
  });
  context.after(() => releaseFirstResponse());
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      if (request.method !== "POST" || request.url !== "/api/usage") {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "not_found" }));
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      bodies.push(body);
      requestTimes.push(Date.now());
      if (bodies.length === 1) firstRequestStarted();
      const finish = () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            acceptedEntries: body.snapshots.reduce(
              (total, snapshot) => total + snapshot.entries.length,
              0,
            ),
            acceptedSnapshots: body.snapshots.length,
            sourceSequences: body.snapshots.map((snapshot) => ({
              sourceId: snapshot.sourceId,
              lastAcceptedSyncSequence: snapshot.syncSequence,
              accepted: true,
            })),
          }),
        );
      };
      if (bodies.length === 1) firstResponseCanFinish.then(finish);
      else finish();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-real-scheduler-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const installation = await writeCaptureInstallation(home, `http://127.0.0.1:${address.port}`);
  await writeFile(
    join(installation.directory, "state.json"),
    `${JSON.stringify({ version: 1, sequences: { [installation.sourceId]: "0" } })}\n`,
  );
  const environment = connectorEnvironment(home, {
    NODE_ENV: "test",
    VIBERACING_TEST_AUTOMATIC_SYNC_TIMINGS: "50,400,200",
  });

  const hookResults = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      runWithInput(
        ["hook", "--source", installation.clientSourceId, "--agent", "antigravity"],
        environment,
        JSON.stringify({ prompt: `private-${index}`, cwd: `/private/${index}` }),
      ),
    ),
  );
  assert.ok(hookResults.every((result) => result.code === 0 && result.stdout === ""));
  await firstRequest;
  const firstAutomaticSyncAt = JSON.parse(
    await readFile(join(installation.directory, "state.json"), "utf8"),
  ).lastAutomaticSyncAt;
  assert.equal(typeof firstAutomaticSyncAt, "number");

  const appendScript = `
    import { appendCapture } from ${JSON.stringify(pathToFileURL(fileURLToPath(new URL("../lib/runtime.mjs", import.meta.url))).href)};
    const date = new Date().toISOString().slice(0, 10);
    await appendCapture({
      agentId: "antigravity",
      clientSourceId: ${JSON.stringify(installation.clientSourceId)},
      dataPath: ${JSON.stringify(installation.capture)},
    }, [{
      id: "event-during-sync",
      date,
      usage: { date, totalTokens: "5", inputTokens: "2", outputTokens: "3" },
    }]);
  `;
  await execFileAsync(process.execPath, ["--input-type=module", "--eval", appendScript], {
    env: environment,
  });
  const secondHook = await runWithInput(
    ["hook", "--source", installation.clientSourceId, "--agent", "antigravity"],
    environment,
    '{"prompt":"private-during-sync"}',
  );
  assert.equal(secondHook.code, 0);
  releaseFirstResponse();

  await waitFor(() => bodies.length === 2);
  await delay(250);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].snapshots.length, 1);
  assert.equal(bodies[1].snapshots.length, 1);
  assert.equal(bodies[1].snapshots[0].entries[0].totalTokens, "8");
  assert.ok(requestTimes[1] >= firstAutomaticSyncAt + 400);
  await waitFor(async () => {
    try {
      await access(join(installation.directory, "scheduler.lock"));
      return false;
    } catch {
      return true;
    }
  });
});

test("a failed collector gets one automatic attempt per hook generation", async (context) => {
  let requests = 0;
  const server = createServer((request, response) => {
    if (request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "active", sources: [] }));
      return;
    }
    request.resume();
    request.on("end", () => {
      requests += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ acceptedEntries: 0, sourceSequences: [] }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-finite-collector-failure-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const source = {
    clientSourceId: "41414141-4141-4141-8141-414141414141",
    sourceId: "42424242-4242-4242-8242-424242424242",
    agentId: "claude_code",
    dataPath: join(home, "claude"),
    collectionMethod: "synthetic_invalid_collector",
    supportedSurface: "cli",
    suggestedLabel: "Broken collector",
  };
  const directory = await writeMappedInstallation(home, `http://127.0.0.1:${address.port}`, [
    source,
  ]);
  const trace = join(home, "collector-trace.txt");
  const environment = connectorEnvironment(home, {
    NODE_ENV: "test",
    VIBERACING_TEST_COLLECTOR_TRACE: trace,
    VIBERACING_TEST_AUTOMATIC_SYNC_TIMINGS: "20,80,40",
  });
  const hookArguments = ["hook", "--source", source.clientSourceId, "--agent", source.agentId];

  await runWithInput(hookArguments, environment, "{}");
  await waitFor(async () => {
    try {
      await access(join(directory, "scheduler.lock"));
      return false;
    } catch {
      return requests === 1;
    }
  });
  assert.deepEqual((await readFile(trace, "utf8")).trim().split("\n"), [source.clientSourceId]);
  await assert.rejects(access(join(directory, "dirty.json")));
  assert.equal(
    JSON.parse(await readFile(join(directory, "state.json"), "utf8")).fingerprints[source.sourceId]
      .length,
    64,
  );

  await delay(300);
  assert.equal(requests, 1);
  assert.equal((await readFile(trace, "utf8")).trim().split("\n").length, 1);

  await runWithInput(hookArguments, environment, "{}");
  await waitFor(async () => (await readFile(trace, "utf8")).trim().split("\n").length === 2);
  await waitFor(async () => {
    try {
      await access(join(directory, "scheduler.lock"));
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(requests, 1);
});

test("a permanent upload failure leaves one pending payload without background retries", async (context) => {
  let requests = 0;
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      requests += 1;
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "synthetic_unavailable" }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-finite-upload-failure-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const installation = await writeCaptureInstallation(home, `http://127.0.0.1:${address.port}`);
  const trace = join(home, "collector-trace.txt");
  const environment = connectorEnvironment(home, {
    NODE_ENV: "test",
    VIBERACING_TEST_COLLECTOR_TRACE: trace,
    VIBERACING_TEST_AUTOMATIC_SYNC_TIMINGS: "20,80,40",
  });
  const hookArguments = ["hook", "--source", installation.clientSourceId, "--agent", "antigravity"];

  await runWithInput(hookArguments, environment, "{}");
  await waitFor(() => requests === 3, 7_000);
  await waitFor(async () => {
    try {
      await access(join(installation.directory, "scheduler.lock"));
      return false;
    } catch {
      return true;
    }
  });
  assert.equal((await readFile(trace, "utf8")).trim().split("\n").length, 1);
  assert.equal((await readdir(join(installation.directory, "pending"))).length, 1);
  await assert.rejects(access(join(installation.directory, "dirty.json")));

  await delay(300);
  assert.equal(requests, 3);

  await runWithInput(hookArguments, environment, "{}");
  await waitFor(() => requests === 6, 7_000);
  await waitFor(async () => {
    try {
      await access(join(installation.directory, "scheduler.lock"));
      return false;
    } catch {
      return true;
    }
  });
  assert.equal((await readFile(trace, "utf8")).trim().split("\n").length, 1);
  assert.equal((await readdir(join(installation.directory, "pending"))).length, 1);
});

test("a Claude hook collects only its dirty source and unchanged data sends no HTTP", async (context) => {
  const bodies = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      bodies.push(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          acceptedEntries: body.snapshots.flatMap((snapshot) => snapshot.entries).length,
          sourceSequences: body.snapshots.map((snapshot) => ({
            sourceId: snapshot.sourceId,
            lastAcceptedSyncSequence: snapshot.syncSequence,
            accepted: true,
          })),
        }),
      );
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-targeted-claude-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const fixtureRoot = fileURLToPath(new URL("fixtures", import.meta.url));
  const sources = [
    {
      clientSourceId: "10101010-1010-4010-8010-101010101010",
      sourceId: "11111111-1010-4010-8010-101010101010",
      agentId: "claude_code",
      dataPath: fixtureRoot,
      collectionMethod: "claude_jsonl",
      supportedSurface: "cli",
      suggestedLabel: "Claude",
    },
    {
      clientSourceId: "20202020-2020-4020-8020-202020202020",
      sourceId: "22222222-2020-4020-8020-202020202020",
      agentId: "codex",
      dataPath: join(home, "codex-profile"),
      collectionMethod: "codex_app_server",
      supportedSurface: "cli",
      suggestedLabel: "Codex",
    },
    {
      clientSourceId: "30303030-3030-4030-8030-303030303030",
      sourceId: "33333333-3030-4030-8030-303030303030",
      agentId: "opencode",
      dataPath: join(home, "must-not-open.db"),
      collectionMethod: "opencode_sqlite",
      supportedSurface: "cli",
      suggestedLabel: "OpenCode",
    },
  ];
  const directory = await writeMappedInstallation(
    home,
    `http://127.0.0.1:${address.port}`,
    sources,
  );
  const bin = join(home, "bin");
  const codexLaunch = join(home, "codex-launched");
  await mkdir(bin);
  await writeFile(
    join(bin, "codex"),
    `#!/usr/bin/env node\nimport { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(codexLaunch)}, "launched");\n`,
  );
  await chmod(join(bin, "codex"), 0o700);
  const trace = join(home, "collector-trace.txt");
  const environment = connectorEnvironment(home, {
    NODE_ENV: "test",
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    VIBERACING_TEST_COLLECTOR_TRACE: trace,
    VIBERACING_TEST_AUTOMATIC_SYNC_TIMINGS: "25,150,100",
  });
  const hookArguments = ["hook", "--source", sources[0].clientSourceId, "--agent", "claude_code"];
  await runWithInput(hookArguments, environment, '{"prompt":"private"}');
  await waitFor(() => bodies.length === 1);
  assert.deepEqual((await readFile(trace, "utf8")).trim().split("\n"), [sources[0].clientSourceId]);
  assert.equal(bodies[0].snapshots.length, 1);
  assert.equal(bodies[0].snapshots[0].sourceId, sources[0].sourceId);
  await assert.rejects(access(codexLaunch));

  await runWithInput(hookArguments, environment, '{"response":"private"}');
  await waitFor(async () => (await readFile(trace, "utf8")).trim().split("\n").length === 2);
  await waitFor(async () => {
    try {
      await access(join(directory, "scheduler.lock"));
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(bodies.length, 1);
  assert.deepEqual((await readFile(trace, "utf8")).trim().split("\n"), [
    sources[0].clientSourceId,
    sources[0].clientSourceId,
  ]);
  await assert.rejects(access(codexLaunch));
});

test("events from Claude and Kimi coalesce without collecting other sources", async (context) => {
  const bodies = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      bodies.push(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          acceptedEntries: body.snapshots.flatMap((snapshot) => snapshot.entries).length,
          sourceSequences: body.snapshots.map((snapshot) => ({
            sourceId: snapshot.sourceId,
            lastAcceptedSyncSequence: snapshot.syncSequence,
            accepted: true,
          })),
        }),
      );
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  const home = await mkdtemp(join(tmpdir(), "viberacing-targeted-coalesced-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const fixtureRoot = fileURLToPath(new URL("fixtures", import.meta.url));
  const sources = [
    {
      clientSourceId: "40404040-4040-4040-8040-404040404040",
      sourceId: "44444444-4040-4040-8040-404040404040",
      agentId: "claude_code",
      dataPath: fixtureRoot,
      collectionMethod: "claude_jsonl",
      supportedSurface: "cli",
      suggestedLabel: "Claude",
    },
    {
      clientSourceId: "50505050-5050-4050-8050-505050505050",
      sourceId: "55555555-5050-4050-8050-505050505050",
      agentId: "kimi_code",
      dataPath: fixtureRoot,
      collectionMethod: "kimi_wire_jsonl",
      supportedSurface: "cli",
      suggestedLabel: "Kimi",
    },
    {
      clientSourceId: "60606060-6060-4060-8060-606060606060",
      sourceId: "66666666-6060-4060-8060-606060606060",
      agentId: "opencode",
      dataPath: join(home, "must-not-open.db"),
      collectionMethod: "opencode_sqlite",
      supportedSurface: "cli",
      suggestedLabel: "OpenCode",
    },
  ];
  const directory = await writeMappedInstallation(
    home,
    `http://127.0.0.1:${address.port}`,
    sources,
  );
  const trace = join(home, "collector-trace.txt");
  const environment = connectorEnvironment(home, {
    NODE_ENV: "test",
    VIBERACING_TEST_COLLECTOR_TRACE: trace,
    VIBERACING_TEST_AUTOMATIC_SYNC_TIMINGS: "50,200,150",
  });
  await Promise.all(
    sources
      .slice(0, 2)
      .map((source) =>
        runWithInput(
          ["hook", "--source", source.clientSourceId, "--agent", source.agentId],
          environment,
          "{}",
        ),
      ),
  );
  await waitFor(() => bodies.length === 1);
  assert.deepEqual(
    new Set((await readFile(trace, "utf8")).trim().split("\n")),
    new Set(sources.slice(0, 2).map((source) => source.clientSourceId)),
  );
  assert.deepEqual(
    new Set(bodies[0].snapshots.map((snapshot) => snapshot.sourceId)),
    new Set(sources.slice(0, 2).map((source) => source.sourceId)),
  );
  await waitFor(async () => {
    try {
      await access(join(directory, "scheduler.lock"));
      return false;
    } catch {
      return true;
    }
  });
});

test("manual sync collects every active source and clears only its prior dirty generations", async (context) => {
  const bodies = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      bodies.push(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          acceptedEntries: body.snapshots.flatMap((snapshot) => snapshot.entries).length,
          sourceSequences: body.snapshots.map((snapshot) => ({
            sourceId: snapshot.sourceId,
            lastAcceptedSyncSequence: snapshot.syncSequence,
            accepted: true,
          })),
        }),
      );
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  const home = await mkdtemp(join(tmpdir(), "viberacing-manual-dirty-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const directory = join(home, ".viberacing");
  const date = new Date().toISOString().slice(0, 10);
  const sources = [0, 1].map((index) => ({
    clientSourceId: `${index + 7}0707070-7070-4070-8070-70707070707${index}`,
    sourceId: `${index + 8}0808080-8080-4080-8080-80808080808${index}`,
    agentId: "antigravity",
    dataPath: join(directory, "captures", `${index}.jsonl`),
    collectionMethod: "antigravity_cli_capture",
    supportedSurface: "cli",
    suggestedLabel: `Antigravity ${index}`,
  }));
  await mkdir(join(directory, "captures"), { recursive: true });
  for (const [index, source] of sources.entries())
    await writeFile(
      source.dataPath,
      `${JSON.stringify({
        id: `manual-${index}`,
        date,
        usage: { date, totalTokens: `${index + 1}` },
      })}\n`,
    );
  await writeMappedInstallation(home, `http://127.0.0.1:${address.port}`, sources);
  await writeFile(
    join(directory, "dirty.json"),
    `${JSON.stringify({
      version: 2,
      sources: Object.fromEntries(
        sources.map((source, index) => [
          source.clientSourceId,
          {
            dirtySince: new Date().toISOString(),
            lastEventAt: new Date().toISOString(),
            generation: `90909090-9090-4090-8090-90909090909${index}`,
          },
        ]),
      ),
    })}\n`,
  );
  const trace = join(home, "manual-trace.txt");
  const environment = connectorEnvironment(home, {
    NODE_ENV: "test",
    VIBERACING_TEST_COLLECTOR_TRACE: trace,
  });
  await execFileAsync(process.execPath, [connectorPath, "sync"], { env: environment });
  assert.deepEqual(
    new Set((await readFile(trace, "utf8")).trim().split("\n")),
    new Set(sources.map((source) => source.clientSourceId)),
  );
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].snapshots.length, 2);
  await assert.rejects(access(join(directory, "dirty.json")));
  await assert.rejects(access(join(directory, "scheduler.lock")));

  await execFileAsync(process.execPath, [connectorPath, "sync"], { env: environment });
  assert.equal(bodies.length, 1);
  assert.equal((await readFile(trace, "utf8")).trim().split("\n").length, 4);
});

test("an event arriving during manual sync survives for the next targeted batch", async (context) => {
  const bodies = [];
  let firstRequestStarted;
  let releaseFirstResponse;
  const firstRequest = new Promise((resolve) => (firstRequestStarted = resolve));
  const firstResponseCanFinish = new Promise((resolve) => (releaseFirstResponse = resolve));
  context.after(() => releaseFirstResponse());
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      bodies.push(body);
      if (bodies.length === 1) firstRequestStarted();
      const finish = () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            acceptedEntries: body.snapshots.flatMap((snapshot) => snapshot.entries).length,
            sourceSequences: body.snapshots.map((snapshot) => ({
              sourceId: snapshot.sourceId,
              lastAcceptedSyncSequence: snapshot.syncSequence,
              accepted: true,
            })),
          }),
        );
      };
      if (bodies.length === 1) firstResponseCanFinish.then(finish);
      else finish();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  const home = await mkdtemp(join(tmpdir(), "viberacing-manual-event-race-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const installation = await writeCaptureInstallation(home, `http://127.0.0.1:${address.port}`);
  const now = new Date().toISOString();
  await writeFile(
    join(installation.directory, "dirty.json"),
    `${JSON.stringify({
      version: 2,
      sources: {
        [installation.clientSourceId]: {
          dirtySince: now,
          lastEventAt: now,
          generation: "91919191-9191-4191-8191-919191919191",
        },
      },
    })}\n`,
  );
  const trace = join(home, "manual-race-trace.txt");
  const environment = connectorEnvironment(home, {
    NODE_ENV: "test",
    VIBERACING_TEST_COLLECTOR_TRACE: trace,
    VIBERACING_TEST_AUTOMATIC_SYNC_TIMINGS: "25,150,100",
  });
  const manual = execFileAsync(process.execPath, [connectorPath, "sync"], { env: environment });
  await firstRequest;
  const date = new Date().toISOString().slice(0, 10);
  await appendFile(
    installation.capture,
    `${JSON.stringify({
      id: "manual-race-second-event",
      date,
      usage: { date, totalTokens: "5", inputTokens: "2", outputTokens: "3" },
    })}\n`,
  );
  await runWithInput(
    ["hook", "--source", installation.clientSourceId, "--agent", "antigravity"],
    environment,
    "{}",
  );
  releaseFirstResponse();
  await manual;
  await waitFor(() => bodies.length === 2);
  assert.equal(bodies[1].snapshots[0].entries[0].totalTokens, "8");
  assert.deepEqual((await readFile(trace, "utf8")).trim().split("\n"), [
    installation.clientSourceId,
    installation.clientSourceId,
  ]);
  await waitFor(async () => {
    try {
      await access(join(installation.directory, "dirty.json"));
      return false;
    } catch {
      return true;
    }
  });
});

test("requires an explicit safe label when adding a local data root", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-source-label-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const state = join(home, ".viberacing");
  const sensitivePath = join(home, "client-secret-repository");
  const environment = connectorEnvironment(home);
  await assert.rejects(
    execFileAsync(
      process.execPath,
      [connectorPath, "source", "add", "--agent", "claude_code", "--data-dir", sensitivePath],
      { env: environment },
    ),
    (error) => {
      assert.match(error.stderr, /--name NAME/);
      return true;
    },
  );
  await assert.rejects(access(join(state, "sources.json")));

  await execFileAsync(
    process.execPath,
    [
      connectorPath,
      "source",
      "add",
      "--agent",
      "claude_code",
      "--name",
      "Work",
      "--data-dir",
      sensitivePath,
    ],
    { env: environment },
  );
  const local = JSON.parse(await readFile(join(state, "sources.json"), "utf8"));
  assert.equal(local.sources[0].suggestedLabel, "Work");
  assert.match(local.sources[0].clientSourceId, /^[0-9a-f-]{36}$/);
  await assert.rejects(access(join(state, "config.json")));
});

test("removes a source online with all local state and remains idempotent", async (context) => {
  const server = createServer((_request, response) => {
    response.writeHead(204);
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-source-remove-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const directory = join(home, ".viberacing");
  const pending = join(directory, "pending");
  await mkdir(pending, { recursive: true });
  const sourceId = "33333333-3333-4333-8333-333333333333";
  const clientSourceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await writeFile(
    join(directory, "config.json"),
    `${JSON.stringify({
      version: 2,
      origin: `http://127.0.0.1:${address.port}`,
      deviceToken: "synthetic-device-token",
      sources: [
        {
          clientSourceId,
          sourceId,
          agentId: "claude_code",
          accountLabel: "Work",
          dataPath: join(home, "claude"),
          collectionMethod: "claude_jsonl",
          supportedSurface: "cli",
          suggestedLabel: "Work",
        },
      ],
    })}\n`,
  );
  await writeLocalSources(directory, [
    {
      clientSourceId,
      agentId: "claude_code",
      dataPath: join(home, "claude"),
      collectionMethod: "claude_jsonl",
      supportedSurface: "cli",
      suggestedLabel: "Work",
    },
  ]);
  await writeFile(
    join(directory, "state.json"),
    `${JSON.stringify({
      version: 1,
      sequences: { [sourceId]: "4" },
      adapters: { [sourceId]: { cursor: 1 } },
      fingerprints: { [sourceId]: "fingerprint" },
      quarantine: { [sourceId]: "invalid_payload" },
    })}\n`,
  );
  await writeFile(
    join(pending, `${sourceId}.json`),
    `${JSON.stringify({
      protocolVersion: 2,
      snapshots: [{ sourceId, syncSequence: "4", entries: [] }],
      sourceErrors: [],
    })}\n`,
  );
  await mkdir(join(pending, "quarantine"));
  await writeFile(join(pending, "quarantine", `${sourceId}.json`), "{}\n");
  await writeFile(
    join(directory, "dirty.json"),
    `${JSON.stringify({
      version: 2,
      sources: {
        [clientSourceId]: {
          dirtySince: new Date().toISOString(),
          lastEventAt: new Date().toISOString(),
          generation: "81818181-8181-4181-8181-818181818181",
        },
      },
    })}\n`,
  );
  await mkdir(join(home, "claude"), { recursive: true });
  await writeFile(
    join(home, "claude", "settings.json"),
    JSON.stringify({
      hooks: {
        Stop: [
          { hooks: [{ type: "command", command: "keep-foreign" }] },
          {
            hooks: [
              {
                type: "command",
                command: `node hook --viberacing-hook-id=viberacing-hook-v3:${clientSourceId}`,
              },
            ],
          },
        ],
      },
    }),
  );

  await execFileAsync(process.execPath, [connectorPath, "source", "remove", clientSourceId], {
    env: connectorEnvironment(home),
  });
  const config = JSON.parse(await readFile(join(directory, "config.json"), "utf8"));
  const localState = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
  assert.deepEqual(config.sources, []);
  assert.equal(localState.sequences[sourceId], undefined);
  assert.equal(localState.adapters[sourceId], undefined);
  assert.equal(localState.fingerprints[sourceId], undefined);
  assert.equal(localState.quarantine[sourceId], undefined);
  await assert.rejects(access(join(pending, `${sourceId}.json`)));
  await assert.rejects(access(join(pending, "quarantine", `${sourceId}.json`)));
  await assert.rejects(access(join(directory, "dirty.json")));
  const hookSettings = await readFile(join(home, "claude", "settings.json"), "utf8");
  assert.doesNotMatch(hookSettings, /viberacing-hook-v3/);
  assert.match(hookSettings, /keep-foreign/);
  const repeated = await execFileAsync(
    process.execPath,
    [connectorPath, "source", "remove", clientSourceId],
    { env: connectorEnvironment(home) },
  );
  assert.match(repeated.stdout, /already absent/i);
});

test("source removal is offline-safe and stops its local hook", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-source-remove-offline-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const clientSourceId = "82828282-8282-4282-8282-828282828282";
  const sourceId = "83838383-8383-4383-8383-838383838383";
  const root = join(home, "qwen-custom");
  const local = {
    clientSourceId,
    agentId: "qwen_code",
    dataPath: root,
    collectionMethod: "qwen_stats_jsonl",
    supportedSurface: "cli",
    suggestedLabel: "Offline",
  };
  const directory = await writeMappedInstallation(home, "http://127.0.0.1:1", [
    { ...local, sourceId },
  ]);
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "settings.json"),
    JSON.stringify({
      hooks: {
        SessionEnd: [
          {
            hooks: [
              {
                type: "command",
                command: `node hook --viberacing-hook-id=viberacing-hook-v3:${clientSourceId}`,
              },
            ],
          },
        ],
      },
    }),
  );
  const result = await execFileAsync(
    process.execPath,
    [connectorPath, "source", "remove", clientSourceId],
    { env: connectorEnvironment(home) },
  );
  assert.match(result.stderr, /remote source disconnect could not be confirmed/i);
  assert.doesNotMatch(await readFile(join(root, "settings.json"), "utf8"), /viberacing-hook/);
  assert.deepEqual(await readLocalSources(directory), []);
  assert.deepEqual(JSON.parse(await readFile(join(directory, "config.json"), "utf8")).sources, []);
});

test("source removal keeps custom-root metadata when hook cleanup fails", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-source-remove-hook-failure-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const clientSourceId = "84848484-8484-4484-8484-848484848484";
  const root = join(home, "claude-invalid");
  const local = {
    clientSourceId,
    agentId: "claude_code",
    dataPath: root,
    collectionMethod: "claude_jsonl",
    supportedSurface: "cli",
    suggestedLabel: "Retry cleanup",
  };
  const directory = join(home, ".viberacing");
  await mkdir(root, { recursive: true });
  await mkdir(directory, { recursive: true });
  await writeLocalSources(directory, [local]);
  await writeFile(join(root, "settings.json"), "{invalid-json");
  await assert.rejects(
    execFileAsync(process.execPath, [connectorPath, "source", "remove", clientSourceId], {
      env: connectorEnvironment(home),
    }),
    /metadata was kept for retry/,
  );
  assert.equal((await readLocalSources(directory))[0].clientSourceId, clientSourceId);
  assert.equal(await readFile(join(root, "settings.json"), "utf8"), "{invalid-json");
});

test("quarantines a server-disconnected pending source without poisoning future syncs", async (context) => {
  let requests = 0;
  const server = createServer((request, response) => {
    if (request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ sources: [] }));
      return;
    }
    requests += 1;
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "unsupported_source" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-pending-retire-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const directory = join(home, ".viberacing");
  const pending = join(directory, "pending");
  await mkdir(pending, { recursive: true });
  const sourceId = "44444444-4444-4444-8444-444444444444";
  const clientSourceId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await writeFile(
    join(directory, "config.json"),
    `${JSON.stringify({
      version: 2,
      origin: `http://127.0.0.1:${address.port}`,
      deviceToken: "synthetic-device-token",
      sources: [
        {
          clientSourceId,
          sourceId,
          agentId: "claude_code",
          accountLabel: "Retired",
          dataPath: join(home, "claude"),
          collectionMethod: "claude_jsonl",
          supportedSurface: "cli",
          suggestedLabel: "Retired",
        },
      ],
    })}\n`,
  );
  await writeLocalSources(directory, [
    {
      clientSourceId,
      agentId: "claude_code",
      dataPath: join(home, "claude"),
      collectionMethod: "claude_jsonl",
      supportedSurface: "cli",
      suggestedLabel: "Retired",
    },
  ]);
  await writeFile(
    join(directory, "state.json"),
    `${JSON.stringify({ version: 1, sequences: { [sourceId]: "1" } })}\n`,
  );
  await writeFile(
    join(pending, `${sourceId}.json`),
    `${JSON.stringify({
      protocolVersion: 2,
      snapshots: [{ sourceId, syncSequence: "1", entries: [] }],
      sourceErrors: [],
    })}\n`,
  );
  await mkdir(join(home, "claude"), { recursive: true });
  await writeFile(
    join(home, "claude", "settings.json"),
    JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: `node hook --viberacing-hook-id=viberacing-hook-v3:${clientSourceId}`,
              },
            ],
          },
        ],
      },
    }),
  );
  await writeFile(
    join(directory, "dirty.json"),
    `${JSON.stringify({
      version: 2,
      sources: {
        [clientSourceId]: {
          dirtySince: new Date().toISOString(),
          lastEventAt: new Date().toISOString(),
          generation: "85858585-8585-4585-8585-858585858585",
        },
      },
    })}\n`,
  );

  await execFileAsync(process.execPath, [connectorPath, "sync"], {
    env: connectorEnvironment(home),
  });
  assert.equal(requests, 1);
  assert.deepEqual(JSON.parse(await readFile(join(directory, "config.json"), "utf8")).sources, []);
  assert.deepEqual(await import("node:fs/promises").then(({ readdir }) => readdir(pending)), []);
  assert.equal((await readLocalSources(directory))[0].clientSourceId, clientSourceId);
  assert.doesNotMatch(
    await readFile(join(home, "claude", "settings.json"), "utf8"),
    /viberacing-hook/,
  );
  await assert.rejects(access(join(directory, "dirty.json")));
  await runWithInput(
    ["hook", "--source", clientSourceId, "--agent", "claude_code"],
    connectorEnvironment(home),
    "{}",
  );
  await assert.rejects(access(join(directory, "scheduler.lock")));
  await assert.rejects(access(join(directory, "dirty.json")));
});

test("doctor collects Claude diagnostics with the required UTC range", async (context) => {
  const sourceId = "55555555-5555-4555-8555-555555555555";
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        status: "active",
        lastSyncAt: null,
        sources: [{ sourceId, status: "active", lastAcceptedSyncSequence: "0" }],
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-doctor-claude-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const directory = join(home, ".viberacing");
  const clientSourceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "config.json"),
    `${JSON.stringify({
      version: 2,
      origin: `http://127.0.0.1:${address.port}`,
      deviceToken: "synthetic-device-token",
      sources: [
        {
          clientSourceId,
          sourceId,
          agentId: "claude_code",
          accountLabel: "Work",
          dataPath: fileURLToPath(new URL("fixtures", import.meta.url)),
          collectionMethod: "claude_jsonl",
          supportedSurface: "cli",
          suggestedLabel: "Work",
        },
      ],
    })}\n`,
  );
  await writeLocalSources(directory, [
    {
      clientSourceId,
      agentId: "claude_code",
      dataPath: fileURLToPath(new URL("fixtures", import.meta.url)),
      collectionMethod: "claude_jsonl",
      supportedSurface: "cli",
      suggestedLabel: "Work",
    },
  ]);
  const result = await execFileAsync(process.execPath, [connectorPath, "doctor"], {
    env: connectorEnvironment(home, { PATH: "" }),
  });
  assert.match(result.stdout, /claude_code \(Work\): ok/);
  assert.doesNotMatch(result.stdout, /reading 'rangeStart'/);
});

test("doctor disables a revoked installation and recommends reconnecting", async (context) => {
  const server = createServer((_request, response) => {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "unauthorized" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-doctor-revoked-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const installation = await writeCaptureInstallation(home, `http://127.0.0.1:${address.port}`);
  await writeFile(
    join(installation.directory, "dirty.json"),
    `${JSON.stringify({ dirtySince: new Date().toISOString(), lastEventAt: new Date().toISOString() })}\n`,
  );

  const result = await execFileAsync(process.execPath, [connectorPath, "doctor"], {
    env: connectorEnvironment(home),
  });

  assert.match(result.stdout, /authorization was revoked/i);
  assert.match(result.stdout, /viberacing connect/i);
  await assert.rejects(access(join(installation.directory, "config.json")));
  await assert.rejects(access(join(installation.directory, "dirty.json")));
});

test("doctor removes a hook after dashboard-side source disconnect", async (context) => {
  const sourceId = "86868686-8686-4686-8686-868686868686";
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        status: "active",
        sources: [{ sourceId, status: "disconnected", lastAcceptedSyncSequence: "0" }],
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  const home = await mkdtemp(join(tmpdir(), "viberacing-dashboard-disconnect-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const clientSourceId = "87878787-8787-4787-8787-878787878787";
  const root = join(home, "qwen-dashboard");
  const local = {
    clientSourceId,
    sourceId,
    agentId: "qwen_code",
    dataPath: root,
    collectionMethod: "qwen_stats_jsonl",
    supportedSurface: "cli",
    suggestedLabel: "Dashboard",
  };
  const directory = await writeMappedInstallation(home, `http://127.0.0.1:${address.port}`, [
    local,
  ]);
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "settings.json"),
    JSON.stringify({
      hooks: {
        SessionEnd: [
          {
            hooks: [
              {
                type: "command",
                command: `node hook --viberacing-hook-id=viberacing-hook-v3:${clientSourceId}`,
              },
            ],
          },
        ],
      },
    }),
  );
  await execFileAsync(process.execPath, [connectorPath, "doctor"], {
    env: connectorEnvironment(home),
  });
  assert.deepEqual(JSON.parse(await readFile(join(directory, "config.json"), "utf8")).sources, []);
  assert.equal((await readLocalSources(directory))[0].clientSourceId, clientSourceId);
  assert.doesNotMatch(await readFile(join(root, "settings.json"), "utf8"), /viberacing-hook/);
});

test("automatic sync reconciles a dashboard disconnect before unchanged collection", async (context) => {
  let currentRequests = 0;
  let usageRequests = 0;
  const sourceId = "a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1";
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      if (request.method === "GET" && request.url === "/api/installations/current") {
        currentRequests += 1;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            status: "active",
            sources: [{ sourceId, status: "disconnected", lastAcceptedSyncSequence: "0" }],
          }),
        );
        return;
      }
      usageRequests += 1;
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "unexpected_usage" }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-auto-dashboard-disconnect-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const clientSourceId = "a2a2a2a2-a2a2-42a2-82a2-a2a2a2a2a2a2";
  const root = join(home, "claude-dashboard");
  const source = {
    clientSourceId,
    sourceId,
    agentId: "claude_code",
    dataPath: root,
    collectionMethod: "claude_jsonl",
    supportedSurface: "cli",
    suggestedLabel: "Dashboard",
  };
  const directory = await writeMappedInstallation(home, `http://127.0.0.1:${address.port}`, [
    source,
  ]);
  await writeFile(
    join(directory, "state.json"),
    `${JSON.stringify({
      version: 1,
      sequences: { [sourceId]: "0" },
      adapters: { [sourceId]: { offset: 12 } },
      fingerprints: { [sourceId]: "synthetic-fingerprint" },
      lastRemoteReconciliationAt: 0,
    })}\n`,
  );
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "settings.json"),
    JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: `node hook --viberacing-hook-id=viberacing-hook-v3:${clientSourceId}`,
              },
            ],
          },
        ],
      },
    }),
  );
  const trace = join(home, "collector-trace.txt");
  const environment = connectorEnvironment(home, {
    NODE_ENV: "test",
    VIBERACING_TEST_COLLECTOR_TRACE: trace,
    VIBERACING_TEST_AUTOMATIC_SYNC_TIMINGS: "20,80,40",
    VIBERACING_TEST_REMOTE_RECONCILIATION_INTERVAL_MS: "1",
  });

  await runWithInput(
    ["hook", "--source", clientSourceId, "--agent", "claude_code"],
    environment,
    "{}",
  );
  await waitFor(async () => {
    const config = JSON.parse(await readFile(join(directory, "config.json"), "utf8"));
    return currentRequests === 1 && config.sources.length === 0;
  });
  await waitFor(async () => {
    try {
      await access(join(directory, "scheduler.lock"));
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(usageRequests, 0);
  await assert.rejects(access(trace));
  assert.doesNotMatch(await readFile(join(root, "settings.json"), "utf8"), /viberacing-hook/);
  const state = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
  assert.equal(state.sequences?.[sourceId], undefined);
  assert.equal(state.adapters?.[sourceId], undefined);
  assert.equal(state.fingerprints?.[sourceId], undefined);
  assert.equal((await readLocalSources(directory))[0].clientSourceId, clientSourceId);

  await runWithInput(
    ["hook", "--source", clientSourceId, "--agent", "claude_code"],
    environment,
    "{}",
  );
  await delay(150);
  assert.equal(currentRequests, 1);
  assert.equal(usageRequests, 0);
  await assert.rejects(access(trace));
});

test("remote reconciliation cannot restore retired runtime state from a stale snapshot", async (context) => {
  const retiredSourceId = "b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1";
  const activeSourceId = "b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2";
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        status: "active",
        sources: [
          {
            sourceId: retiredSourceId,
            agentId: "qwen_code",
            collectionMethod: "qwen_stats_jsonl",
            status: "disconnected",
            lastAcceptedSyncSequence: "4",
          },
          {
            sourceId: activeSourceId,
            agentId: "antigravity",
            collectionMethod: "antigravity_cli_capture",
            status: "active",
            lastAcceptedSyncSequence: "7",
          },
        ],
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-reconcile-fresh-state-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const qwenRoot = join(home, "qwen-retired");
  const capture = join(home, "active-capture.jsonl");
  const date = new Date().toISOString().slice(0, 10);
  await writeFile(
    capture,
    `${JSON.stringify({
      id: "active-event",
      date,
      usage: { date, totalTokens: "7", inputTokens: "3", outputTokens: "4" },
    })}\n`,
  );
  const retired = {
    clientSourceId: "b3b3b3b3-b3b3-43b3-83b3-b3b3b3b3b3b3",
    sourceId: retiredSourceId,
    agentId: "qwen_code",
    dataPath: qwenRoot,
    collectionMethod: "qwen_stats_jsonl",
    supportedSurface: "cli",
    suggestedLabel: "Retired",
  };
  const active = {
    clientSourceId: "b4b4b4b4-b4b4-44b4-84b4-b4b4b4b4b4b4",
    sourceId: activeSourceId,
    agentId: "antigravity",
    dataPath: capture,
    collectionMethod: "antigravity_cli_capture",
    supportedSurface: "cli",
    suggestedLabel: "Active",
  };
  const directory = await writeMappedInstallation(home, `http://127.0.0.1:${address.port}`, [
    retired,
    active,
  ]);
  await mkdir(qwenRoot, { recursive: true });
  await writeFile(
    join(qwenRoot, "settings.json"),
    JSON.stringify({
      hooks: {
        SessionEnd: [
          {
            hooks: [
              {
                type: "command",
                command: `node hook --viberacing-hook-id=viberacing-hook-v3:${retired.clientSourceId}`,
              },
            ],
          },
        ],
      },
    }),
  );
  await writeFile(
    join(directory, "state.json"),
    `${JSON.stringify({
      version: 1,
      sequences: { [retiredSourceId]: "4", [activeSourceId]: "0" },
      adapters: { [retiredSourceId]: { offset: 99 } },
      fingerprints: { [retiredSourceId]: "retired-fingerprint" },
      quarantine: { [retiredSourceId]: "invalid_payload" },
    })}\n`,
  );

  await execFileAsync(process.execPath, [connectorPath, "doctor"], {
    env: connectorEnvironment(home),
  });
  const state = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
  assert.equal(state.sequences[activeSourceId], "7");
  assert.equal(state.sequences[retiredSourceId], undefined);
  assert.equal(state.adapters?.[retiredSourceId], undefined);
  assert.equal(state.fingerprints?.[retiredSourceId], undefined);
  assert.equal(state.quarantine?.[retiredSourceId], undefined);
  assert.doesNotMatch(await readFile(join(qwenRoot, "settings.json"), "utf8"), /viberacing/);
});

test("recovers a missing local sequence from 500 and sends snapshot 501", async (context) => {
  let uploaded;
  let uploadCount = 0;
  const sourceId = "66666666-6666-4666-8666-666666666666";
  const server = createServer((request, response) => {
    if (request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          status: "active",
          sources: [{ sourceId, status: "active", lastAcceptedSyncSequence: "500" }],
        }),
      );
      return;
    }
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      uploadCount += 1;
      uploaded = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          acceptedEntries: 1,
          acceptedSnapshots: 1,
          staleSnapshots: 0,
          sourceSequences: [{ sourceId, lastAcceptedSyncSequence: "501", accepted: true }],
        }),
      );
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-sequence-recovery-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const directory = join(home, ".viberacing");
  const capture = join(directory, "captures", "cursor.jsonl");
  await mkdir(join(directory, "captures"), { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  await writeFile(
    capture,
    `${JSON.stringify({
      id: "synthetic-sequence-event",
      date: today,
      usage: {
        date: today,
        totalTokens: "1",
        inputTokens: "1",
        outputTokens: "0",
        cacheReadTokens: "0",
        cacheWriteTokens: "0",
        reasoningTokens: "0",
      },
    })}\n`,
  );
  const clientSourceId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  await writeLocalSources(directory, [
    {
      clientSourceId,
      agentId: "cursor",
      dataPath: capture,
      collectionMethod: "cursor_cli_capture",
      supportedSurface: "cli",
      suggestedLabel: "Cursor",
    },
  ]);
  await writeFile(
    join(directory, "config.json"),
    `${JSON.stringify({
      version: 2,
      origin: `http://127.0.0.1:${address.port}`,
      deviceToken: "synthetic-device-token",
      sources: [
        {
          clientSourceId,
          sourceId,
          agentId: "cursor",
          accountLabel: "Cursor",
          collectionMethod: "cursor_cli_capture",
          lastAcceptedSyncSequence: "0",
        },
      ],
    })}\n`,
  );
  await execFileAsync(process.execPath, [connectorPath, "sync"], {
    env: connectorEnvironment(home),
  });
  assert.equal(uploaded.snapshots[0].syncSequence, "501");
  assert.equal(
    JSON.parse(await readFile(join(directory, "state.json"), "utf8")).sequences[sourceId],
    "501",
  );
  const unchanged = await execFileAsync(process.execPath, [connectorPath, "sync"], {
    env: connectorEnvironment(home),
  });
  assert.equal(uploadCount, 1);
  assert.match(unchanged.stdout, /no request was sent/i);
});

test("repairs one stale pending snapshot and still delivers the newly collected snapshot", async (context) => {
  const bodies = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      bodies.push(body);
      const sequence = bodies.length === 1 ? "500" : bodies.length === 2 ? "501" : "502";
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          acceptedEntries: bodies.length === 3 ? 1 : 0,
          acceptedSnapshots: bodies.length === 1 ? 0 : 1,
          staleSnapshots: bodies.length === 1 ? 1 : 0,
          sourceSequences: [
            {
              sourceId: body.snapshots[0].sourceId,
              lastAcceptedSyncSequence: sequence,
              accepted: bodies.length !== 1,
            },
          ],
        }),
      );
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  const home = await mkdtemp(join(tmpdir(), "viberacing-stale-pending-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const installation = await writeCaptureInstallation(home, `http://127.0.0.1:${address.port}`);
  await mkdir(join(installation.directory, "pending"), { recursive: true });
  await writeFile(
    join(installation.directory, "state.json"),
    `${JSON.stringify({ version: 1, sequences: { [installation.sourceId]: "1" } })}\n`,
  );
  await writeFile(
    join(installation.directory, "pending", `${installation.sourceId}.json`),
    `${JSON.stringify({
      protocolVersion: 2,
      snapshots: [
        {
          sourceId: installation.sourceId,
          syncSequence: "1",
          rangeStart: "2026-07-15",
          rangeEnd: "2026-08-14",
          completeness: "complete",
          entries: [],
        },
      ],
      sourceErrors: [],
    })}\n`,
  );

  await execFileAsync(process.execPath, [connectorPath, "sync"], {
    env: connectorEnvironment(home),
  });
  assert.deepEqual(
    bodies.map((body) => body.snapshots[0].syncSequence),
    ["1", "501", "502"],
  );
  assert.equal(
    JSON.parse(await readFile(join(installation.directory, "state.json"), "utf8")).sequences[
      installation.sourceId
    ],
    "502",
  );
});

test("retries transient uploads at most three times and clears the compact pending snapshot", async (context) => {
  let requests = 0;
  const server = createServer((request, response) => {
    if (request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ sources: [] }));
      return;
    }
    requests += 1;
    response.writeHead(requests < 3 ? 503 : 200, { "content-type": "application/json" });
    response.end(
      JSON.stringify(
        requests < 3 ? { error: "server_error" } : { acceptedEntries: 1, acceptedSnapshots: 1 },
      ),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  const home = await mkdtemp(join(tmpdir(), "viberacing-transient-retry-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const installation = await writeCaptureInstallation(home, `http://127.0.0.1:${address.port}`);

  await execFileAsync(process.execPath, [connectorPath, "sync"], {
    env: connectorEnvironment(home),
  });
  assert.equal(requests, 3);
  assert.deepEqual(
    await import("node:fs/promises").then(({ readdir }) =>
      readdir(join(installation.directory, "pending")),
    ),
    [],
  );
});

test("quarantines a permanent 400 once without blocking the next corrected snapshot", async (context) => {
  let requests = 0;
  const bodies = [];
  const server = createServer((request, response) => {
    if (request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ sources: [] }));
      return;
    }
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      requests += 1;
      bodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      response.writeHead(requests === 1 ? 400 : 200, { "content-type": "application/json" });
      response.end(
        JSON.stringify(
          requests === 1
            ? { error: "token_components_mismatch" }
            : { acceptedEntries: 1, acceptedSnapshots: 1 },
        ),
      );
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  const home = await mkdtemp(join(tmpdir(), "viberacing-permanent-quarantine-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const installation = await writeCaptureInstallation(home, `http://127.0.0.1:${address.port}`);

  const rejected = await execFileAsync(process.execPath, [connectorPath, "sync"], {
    env: connectorEnvironment(home),
  });
  assert.equal(requests, 1);
  assert.match(rejected.stderr, /payload quarantined/);
  const quarantine = join(
    installation.directory,
    "pending",
    "quarantine",
    `${installation.sourceId}.json`,
  );
  await access(quarantine);

  const capture = JSON.parse((await readFile(installation.capture, "utf8")).trim());
  capture.id = "synthetic-corrected-event-with-a-longer-id";
  capture.usage.totalTokens = "4";
  capture.usage.outputTokens = "3";
  await writeFile(installation.capture, `${JSON.stringify(capture)}\n`);
  await execFileAsync(process.execPath, [connectorPath, "sync"], {
    env: connectorEnvironment(home),
  });
  assert.equal(requests, 2);
  assert.equal(bodies[1].snapshots[0].syncSequence, "2");
  await assert.rejects(access(quarantine));
});

test("revoked authorization removes pairing config and stops automatic scheduling", async (context) => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "unauthorized" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  const home = await mkdtemp(join(tmpdir(), "viberacing-revoked-auth-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const installation = await writeCaptureInstallation(home, `http://127.0.0.1:${address.port}`);
  await writeFile(
    join(installation.directory, "dirty.json"),
    `${JSON.stringify({ dirtySince: new Date().toISOString(), lastEventAt: new Date().toISOString() })}\n`,
  );

  await assert.rejects(
    execFileAsync(process.execPath, [connectorPath, "sync"], {
      env: connectorEnvironment(home),
    }),
    /authorization was revoked/,
  );
  assert.equal(requests, 1);
  await assert.rejects(access(join(installation.directory, "config.json")));
  await assert.rejects(access(join(installation.directory, "dirty.json")));
});

test("uploads the supported 32 sources in bounded batches below the server rate limit", async (context) => {
  const bodies = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      bodies.push(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          acceptedEntries: body.snapshots.reduce(
            (total, snapshot) => total + snapshot.entries.length,
            0,
          ),
        }),
      );
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-maximum-batch-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const directory = join(home, ".viberacing");
  const pending = join(directory, "pending");
  await mkdir(pending, { recursive: true });
  const sources = Array.from({ length: 32 }, (_, index) => {
    const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    return {
      clientSourceId: id,
      sourceId: id,
      agentId: "unsupported",
      collectionMethod: "unsupported",
      supportedSurface: "cli",
    };
  });
  await writeFile(
    join(directory, "config.json"),
    `${JSON.stringify({
      version: 2,
      origin: `http://127.0.0.1:${address.port}`,
      deviceToken: "synthetic-device-token",
      sources,
    })}\n`,
  );
  await writeLocalSources(
    directory,
    sources.map((source, index) => ({
      clientSourceId: source.clientSourceId,
      agentId: source.agentId,
      dataPath: join(home, `unsupported-${index}`),
      collectionMethod: source.collectionMethod,
      supportedSurface: source.supportedSurface,
      suggestedLabel: `Unsupported ${index}`,
    })),
  );
  await writeFile(
    join(directory, "state.json"),
    `${JSON.stringify({
      version: 1,
      sequences: Object.fromEntries(sources.map((source) => [source.sourceId, "1"])),
    })}\n`,
  );
  for (const source of sources)
    await writeFile(
      join(pending, `${source.sourceId}.json`),
      `${JSON.stringify({
        protocolVersion: 2,
        snapshots: [{ sourceId: source.sourceId, syncSequence: "1", entries: [] }],
        sourceErrors: [],
      })}\n`,
    );

  await assert.rejects(
    execFileAsync(process.execPath, [connectorPath, "sync"], {
      env: connectorEnvironment(home),
    }),
    /Unsupported configured source/,
  );
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].snapshots.length, 32);
  assert.equal(bodies[1].sourceErrors.length, 32);
});

test("disconnect serializes with an in-flight sync and prevents state resurrection", async (context) => {
  const methods = [];
  let releaseUpload;
  let uploadStarted;
  const firstUpload = new Promise((resolve) => {
    uploadStarted = resolve;
  });
  const uploadCanFinish = new Promise((resolve) => {
    releaseUpload = resolve;
  });
  context.after(() => releaseUpload());
  const server = createServer((request, response) => {
    methods.push(request.method);
    request.resume();
    request.on("end", () => {
      if (request.method === "DELETE") {
        response.writeHead(204);
        response.end();
        return;
      }
      uploadStarted();
      uploadCanFinish.then(() => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            acceptedEntries: 1,
            sourceSequences: [
              {
                sourceId: installation.sourceId,
                lastAcceptedSyncSequence: "1",
                accepted: true,
              },
            ],
          }),
        );
      });
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-disconnect-sync-race-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const installation = await writeCaptureInstallation(home, `http://127.0.0.1:${address.port}`);
  const environment = connectorEnvironment(home);
  const syncPromise = execFileAsync(process.execPath, [connectorPath, "sync"], {
    env: environment,
  });
  await firstUpload;
  const disconnectPromise = execFileAsync(process.execPath, [connectorPath, "disconnect"], {
    env: environment,
  });
  assert.equal(
    await Promise.race([
      disconnectPromise.then(() => "finished"),
      delay(100).then(() => "waiting"),
    ]),
    "waiting",
  );

  releaseUpload();
  const syncResult = await syncPromise.catch((error) => error);
  assert.equal(syncResult.code, 1);
  assert.match(syncResult.stderr, /stopped by a local lifecycle operation/i);
  await disconnectPromise;
  assert.deepEqual(methods, ["POST", "DELETE"]);
  await assert.rejects(access(join(installation.directory, "config.json")));
  await assert.rejects(access(join(installation.directory, "dirty.json")));
  assert.deepEqual(
    await readdir(join(installation.directory, "pending")).catch((error) =>
      error?.code === "ENOENT" ? [] : Promise.reject(error),
    ),
    [],
  );
  await delay(150);
  assert.deepEqual(methods, ["POST", "DELETE"]);
});

test("disconnect removes local hooks, token, dirty state, and pending data when offline", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-offline-disconnect-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const directory = join(home, ".viberacing");
  const qwenRoot = join(home, ".qwen");
  const qwenUsage = join(qwenRoot, "usage");
  await mkdir(join(directory, "pending"), { recursive: true });
  await mkdir(qwenUsage, { recursive: true });
  await mkdir(join(home, ".claude"), { recursive: true });
  await writeFile(join(home, ".claude", "settings.json"), "{invalid-json");
  const clientSourceId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const sourceId = "77777777-7777-4777-8777-777777777777";
  await writeLocalSources(directory, [
    {
      clientSourceId,
      agentId: "qwen_code",
      dataPath: qwenUsage,
      collectionMethod: "qwen_stats_jsonl",
      supportedSurface: "cli",
      suggestedLabel: "Qwen",
    },
  ]);
  await writeFile(
    join(directory, "config.json"),
    `${JSON.stringify({
      version: 2,
      origin: "http://127.0.0.1:1",
      deviceToken: "synthetic-device-token-that-is-long-enough",
      sources: [
        {
          clientSourceId,
          sourceId,
          agentId: "qwen_code",
          accountLabel: "Qwen",
          collectionMethod: "qwen_stats_jsonl",
        },
      ],
    })}\n`,
  );
  await writeFile(
    join(qwenRoot, "settings.json"),
    JSON.stringify({
      hooks: {
        SessionEnd: [
          { hooks: [{ type: "command", command: "keep-me" }] },
          {
            hooks: [
              {
                type: "command",
                command: "node hook --viberacing-hook-id=viberacing-hook-v2",
              },
            ],
          },
        ],
      },
    }),
  );
  await writeFile(
    join(directory, "pending", `${sourceId}.json`),
    `${JSON.stringify({
      protocolVersion: 2,
      snapshots: [{ sourceId, syncSequence: "1", entries: [] }],
      sourceErrors: [],
    })}\n`,
  );
  await writeFile(
    join(directory, "dirty.json"),
    `${JSON.stringify({ dirtySince: new Date().toISOString(), lastEventAt: new Date().toISOString() })}\n`,
  );
  const result = await execFileAsync(process.execPath, [connectorPath, "disconnect"], {
    env: connectorEnvironment(home),
  });
  assert.match(result.stderr, /remote revoke could not be confirmed/);
  assert.match(result.stderr, /auxiliary cleanup steps/);
  await assert.rejects(access(join(directory, "config.json")));
  await assert.rejects(access(join(directory, "dirty.json")));
  await assert.rejects(access(join(directory, "pending", `${sourceId}.json`)));
  assert.match(await readFile(join(qwenRoot, "settings.json"), "utf8"), /keep-me/);
  assert.doesNotMatch(
    await readFile(join(qwenRoot, "settings.json"), "utf8"),
    /viberacing-hook-v2/,
  );
  assert.equal((await readLocalSources(directory)).length, 1);
});

test("uninstall removes v2 and source-owned hooks from remembered custom roots", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-uninstall-custom-roots-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const directory = join(home, ".viberacing");
  const root = join(home, "gemini-custom");
  const clientSourceId = "88888888-8888-4888-8888-888888888888";
  await mkdir(root, { recursive: true });
  await mkdir(directory, { recursive: true });
  await writeLocalSources(directory, [
    {
      clientSourceId,
      agentId: "gemini_cli",
      dataPath: root,
      collectionMethod: "gemini_session_json",
      supportedSurface: "cli",
      suggestedLabel: "Custom",
    },
  ]);
  await writeFile(
    join(root, "settings.json"),
    JSON.stringify({
      hooks: {
        SessionEnd: [
          { hooks: [{ type: "command", command: "keep-foreign" }] },
          {
            hooks: [
              {
                type: "command",
                command: "node legacy --viberacing-hook-id=viberacing-hook-v2",
              },
              {
                type: "command",
                command: `node current --viberacing-hook-id=viberacing-hook-v3:${clientSourceId}`,
              },
            ],
          },
        ],
      },
    }),
  );
  await execFileAsync(process.execPath, [connectorPath, "uninstall"], {
    env: connectorEnvironment(home),
  });
  await assert.rejects(access(directory));
  const settings = await readFile(join(root, "settings.json"), "utf8");
  assert.match(settings, /keep-foreign/);
  assert.doesNotMatch(settings, /viberacing-hook-v[23]/);
});

test("uninstall cleans later roots and retains failed-root metadata for an idempotent retry", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-uninstall-partial-hooks-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const directory = join(home, ".viberacing");
  const brokenRoot = join(home, "broken-qwen");
  const geminiRoot = join(home, "gemini-work");
  const claudeRoot = join(home, "claude-personal");
  const sources = [
    {
      clientSourceId: "91919191-9191-4191-8191-919191919191",
      sourceId: "92929292-9292-4292-8292-929292929292",
      agentId: "qwen_code",
      dataPath: brokenRoot,
      collectionMethod: "qwen_stats_jsonl",
      supportedSurface: "cli",
      suggestedLabel: "Broken first",
    },
    {
      clientSourceId: "93939393-9393-4393-8393-939393939393",
      sourceId: "94949494-9494-4494-8494-949494949494",
      agentId: "gemini_cli",
      dataPath: geminiRoot,
      collectionMethod: "gemini_session_json",
      supportedSurface: "cli",
      suggestedLabel: "Gemini after",
    },
    {
      clientSourceId: "95959595-9595-4595-8595-959595959595",
      sourceId: "96969696-9696-4696-8696-969696969696",
      agentId: "claude_code",
      dataPath: claudeRoot,
      collectionMethod: "claude_jsonl",
      supportedSurface: "cli",
      suggestedLabel: "Claude after",
    },
  ];
  await writeMappedInstallation(home, "http://127.0.0.1:1", sources);
  await mkdir(join(directory, "bin"), { recursive: true });
  await writeFile(join(directory, "bin", "viberacing.mjs"), "// retained cleanup runtime\n");
  await writeFile(
    join(directory, "installation.json"),
    `${JSON.stringify({ version: 1, installationId: "synthetic-secret" })}\n`,
  );
  for (const root of [brokenRoot, geminiRoot, claudeRoot]) await mkdir(root, { recursive: true });
  await writeFile(join(brokenRoot, "settings.json"), "{ invalid json");
  const ownedSettings = (source, event) =>
    JSON.stringify({
      hooks: {
        [event]: [
          { hooks: [{ type: "command", command: "keep-foreign" }] },
          {
            hooks: [
              {
                type: "command",
                command: `node hook --viberacing-hook-id=viberacing-hook-v3:${source.clientSourceId}`,
              },
            ],
          },
        ],
      },
    });
  await writeFile(join(geminiRoot, "settings.json"), ownedSettings(sources[1], "SessionEnd"));
  await writeFile(join(claudeRoot, "settings.json"), ownedSettings(sources[2], "Stop"));
  const environment = connectorEnvironment(home);

  const first = await runWithInput(["uninstall"], environment, "");
  assert.equal(first.code, 1);
  assert.match(first.stderr, /1 owned hook root/i);
  assert.match(first.stderr, /broken-qwen/);
  assert.doesNotMatch(await readFile(join(geminiRoot, "settings.json"), "utf8"), /viberacing/);
  assert.doesNotMatch(await readFile(join(claudeRoot, "settings.json"), "utf8"), /viberacing/);
  assert.match(await readFile(join(geminiRoot, "settings.json"), "utf8"), /keep-foreign/);
  assert.match(await readFile(join(claudeRoot, "settings.json"), "utf8"), /keep-foreign/);
  assert.equal((await readLocalSources(directory)).length, 3);
  await access(join(directory, "bin", "viberacing.mjs"));
  await assert.rejects(access(join(directory, "config.json")));
  await assert.rejects(access(join(directory, "installation.json")));

  await writeFile(join(brokenRoot, "settings.json"), ownedSettings(sources[0], "SessionEnd"));
  const second = await runWithInput(["uninstall"], environment, "");
  assert.equal(second.code, 0);
  await assert.rejects(access(directory));
  assert.doesNotMatch(await readFile(join(brokenRoot, "settings.json"), "utf8"), /viberacing/);
});

test(
  "wrappers pass exact argv and preserve native output, exit status, and safe metadata",
  { skip: process.platform === "win32" },
  async (context) => {
    const home = await mkdtemp(join(tmpdir(), "viberacing-wrapper-executable-"));
    context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
    const bin = join(home, "bin");
    await mkdir(bin, { recursive: true });
    const cursorArgv = join(home, "cursor-argv.json");
    const antigravityArgv = join(home, "antigravity-argv.json");
    const cursorExecutable = join(bin, "cursor-agent");
    const antigravityExecutable = join(bin, "agy");
    await writeFile(
      cursorExecutable,
      `#!/usr/bin/env node\nimport { writeFileSync } from "node:fs";\nwriteFileSync(process.env.SYNTHETIC_ARGV_PATH, JSON.stringify(process.argv.slice(2)));\nprocess.stdout.write(JSON.stringify({type:"result",subtype:"success",result:"synthetic private response",session_id:"00000000-0000-4000-8000-000000000001"})+"\\n");\nprocess.stderr.write("native cursor stderr\\n");\nprocess.exitCode=7;\n`,
    );
    await writeFile(
      antigravityExecutable,
      `#!/usr/bin/env node\nimport { writeFileSync } from "node:fs";\nwriteFileSync(process.env.SYNTHETIC_ARGV_PATH, JSON.stringify(process.argv.slice(2)));\nprocess.stdout.write(JSON.stringify({type:"result",session_id:"safe-session",timestamp:new Date().toISOString(),prompt:"synthetic private prompt",response:"synthetic private response",usage:{input_tokens:1,output_tokens:2,cache_read_tokens:0,cache_write_tokens:0}})+"\\n");\n`,
    );
    await chmod(cursorExecutable, 0o700);
    await chmod(antigravityExecutable, 0o700);
    const environment = connectorEnvironment(home, {
      PATH: `${bin}${delimiter}${process.env.PATH}`,
    });

    await assert.rejects(
      execFileAsync(process.execPath, [connectorPath, "run", "cursor", "--", "hello"], {
        env: { ...environment, SYNTHETIC_ARGV_PATH: cursorArgv },
      }),
      (error) => {
        assert.equal(error.code, 7);
        assert.match(error.stdout, /synthetic private response/);
        assert.match(error.stderr, /native cursor stderr/);
        return true;
      },
    );
    assert.deepEqual(JSON.parse(await readFile(cursorArgv, "utf8")), [
      "--print",
      "hello",
      "--output-format",
      "stream-json",
    ]);
    await assert.rejects(access(join(home, ".viberacing", "captures", "cursor.jsonl")));

    await execFileAsync(
      process.execPath,
      [connectorPath, "run", "antigravity", "--", "-p", "hello", "--output-format=stream-json"],
      { env: { ...environment, SYNTHETIC_ARGV_PATH: antigravityArgv } },
    );
    assert.deepEqual(JSON.parse(await readFile(antigravityArgv, "utf8")), [
      "-p",
      "hello",
      "--output-format=stream-json",
    ]);
    const antigravitySource = (await readLocalSources(join(home, ".viberacing"))).find(
      (source) => source.agentId === "antigravity",
    );
    assert.ok(antigravitySource);
    assert.match(
      antigravitySource.dataPath,
      new RegExp(`${antigravitySource.clientSourceId}\\.jsonl$`),
    );
    const capture = await readFile(antigravitySource.dataPath, "utf8");
    assert.match(capture, /safe-session/);
    assert.doesNotMatch(capture, /prompt|response|synthetic private/);
    await execFileAsync(process.execPath, [connectorPath, "disconnect"], { env: environment });
  },
);

test(
  "wrapper forwards SIGINT to the native executable",
  { skip: process.platform === "win32" },
  async (context) => {
    const home = await mkdtemp(join(tmpdir(), "viberacing-wrapper-signal-"));
    context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
    const bin = join(home, "bin");
    await mkdir(bin, { recursive: true });
    const executable = join(bin, "cursor-agent");
    await writeFile(
      executable,
      '#!/usr/bin/env node\nprocess.stdout.write("ready\\n");\nsetInterval(() => {}, 1000);\n',
    );
    await chmod(executable, 0o700);
    const child = spawn(process.execPath, [connectorPath, "run", "cursor", "--", "hello"], {
      env: connectorEnvironment(home, { PATH: `${bin}${delimiter}${process.env.PATH}` }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    context.after(() => child.kill("SIGKILL"));
    child.stdout.setEncoding("utf8");
    await new Promise((resolve) => child.stdout.once("data", resolve));
    child.kill("SIGINT");
    const [code, signal] = await once(child, "close");
    assert.equal(code, null);
    assert.equal(signal, "SIGINT");
  },
);

test(
  "Antigravity and Cursor wrappers select source-specific profiles",
  { skip: process.platform === "win32" },
  async (context) => {
    const home = await mkdtemp(join(tmpdir(), "viberacing-wrapper-profiles-"));
    context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
    const bin = join(home, "bin");
    await mkdir(bin, { recursive: true });
    await writeFile(
      join(bin, "agy"),
      `#!/usr/bin/env node\nimport { writeFileSync } from "node:fs"; writeFileSync(process.env.SYNTHETIC_ARGV_PATH, JSON.stringify(process.argv.slice(2))); process.stdout.write(JSON.stringify({type:"result",session_id:process.env.SYNTHETIC_SESSION_ID,timestamp:new Date().toISOString(),prompt:"private",response:"private",usage:{input_tokens:2,output_tokens:3}})+"\\n");\n`,
    );
    await writeFile(
      join(bin, "cursor-agent"),
      `#!/usr/bin/env node\nimport { writeFileSync } from "node:fs"; writeFileSync(process.env.SYNTHETIC_ARGV_PATH, JSON.stringify(process.argv.slice(2))); process.stdout.write(JSON.stringify({type:"result",session_id:"cursor-no-counters",result:"private"})+"\\n");\n`,
    );
    await chmod(join(bin, "agy"), 0o700);
    await chmod(join(bin, "cursor-agent"), 0o700);
    const environment = connectorEnvironment(home, {
      PATH: `${bin}${delimiter}${process.env.PATH}`,
    });
    for (const name of ["Personal", "Work"])
      await execFileAsync(
        process.execPath,
        [connectorPath, "source", "add", "--agent", "antigravity", "--name", name],
        { env: environment },
      );
    const antigravitySources = (await readLocalSources(join(home, ".viberacing"))).filter(
      (source) => source.agentId === "antigravity",
    );
    assert.equal(antigravitySources.length, 2);
    assert.notEqual(antigravitySources[0].dataPath, antigravitySources[1].dataPath);
    for (const source of antigravitySources)
      assert.match(source.dataPath, new RegExp(`${source.clientSourceId}\\.jsonl$`));
    await assert.rejects(
      execFileAsync(process.execPath, [connectorPath, "run", "antigravity", "--", "review"], {
        env: environment,
      }),
      /Multiple antigravity sources.*--source/,
    );
    for (let index = 0; index < antigravitySources.length; index += 1) {
      const source = antigravitySources[index];
      const argvPath = join(home, `agy-argv-${index}.json`);
      await execFileAsync(
        process.execPath,
        [
          connectorPath,
          "run",
          "antigravity",
          "--source",
          source.clientSourceId,
          "--",
          `native-${index}`,
        ],
        {
          env: {
            ...environment,
            SYNTHETIC_ARGV_PATH: argvPath,
            SYNTHETIC_SESSION_ID: `profile-${index}`,
          },
        },
      );
      assert.deepEqual(JSON.parse(await readFile(argvPath, "utf8")), [
        "--print",
        `native-${index}`,
        "--output-format",
        "stream-json",
      ]);
      const capture = await readFile(source.dataPath, "utf8");
      assert.match(capture, new RegExp(`profile-${index}`));
      assert.doesNotMatch(capture, /prompt|response|private/);
    }
    assert.doesNotMatch(await readFile(antigravitySources[0].dataPath, "utf8"), /profile-1/);
    assert.doesNotMatch(await readFile(antigravitySources[1].dataPath, "utf8"), /profile-0/);

    for (const name of ["Personal", "Work"])
      await execFileAsync(
        process.execPath,
        [connectorPath, "source", "add", "--agent", "cursor", "--name", name],
        { env: environment },
      );
    const allSources = await readLocalSources(join(home, ".viberacing"));
    const cursorSources = allSources.filter((source) => source.agentId === "cursor");
    await assert.rejects(
      execFileAsync(process.execPath, [connectorPath, "run", "cursor", "--", "inspect"], {
        env: environment,
      }),
      /Multiple cursor sources.*--source/,
    );
    const cursorArgv = join(home, "cursor-selected-argv.json");
    await execFileAsync(
      process.execPath,
      [
        connectorPath,
        "run",
        "cursor",
        "--source",
        cursorSources[0].clientSourceId,
        "--",
        "inspect",
      ],
      { env: { ...environment, SYNTHETIC_ARGV_PATH: cursorArgv } },
    );
    assert.deepEqual(JSON.parse(await readFile(cursorArgv, "utf8")), [
      "--print",
      "inspect",
      "--output-format",
      "stream-json",
    ]);
    await assert.rejects(access(cursorSources[0].dataPath));
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [
          connectorPath,
          "run",
          "cursor",
          "--source",
          antigravitySources[0].clientSourceId,
          "--",
          "inspect",
        ],
        { env: environment },
      ),
      /belongs to antigravity/,
    );
  },
);

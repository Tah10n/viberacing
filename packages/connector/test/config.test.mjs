import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { access, chmod, mkdir, mkdtemp, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const connectorPath = fileURLToPath(new URL("../bin/viberacing.mjs", import.meta.url));

function source(agentId) {
  return { agentId };
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
  const capture = join(directory, "captures", "antigravity.jsonl");
  const clientSourceId = options.clientSourceId ?? "abababab-abab-4bab-8bab-abababababab";
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
  return { directory, capture, clientSourceId, sourceId };
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
    assert.equal(
      codex.hooks.SessionEnd.filter((group) => JSON.stringify(group).includes(module.hookMarker))
        .length,
      1,
    );
    assert.match(JSON.stringify(claude), /viberacing-hook-v2/);
    assert.match(JSON.stringify(gemini), /viberacing-hook-v2/);
    assert.match(JSON.stringify(qwen), /viberacing-hook-v2/);
    assert.equal(gemini.hooks.SessionEnd.at(-1).hooks[0].timeout, 10_000);
    assert.equal(qwen.hooks.SessionEnd.at(-1).hooks[0].timeout, 10_000);
    assert.match(kimi, /\[\[hooks\]\][\s\S]*Stop[\s\S]*viberacing-hook-v2/);
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
                  command: "node obsolete.mjs hook --viberacing-hook-id=viberacing-hook-v2",
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
      /viberacing-hook-v2/,
    );
    assert.match(await readFile(join(home, ".codex", "hooks.json"), "utf8"), /keep-me/);
    assert.doesNotMatch(
      await readFile(join(home, ".kimi", "config.toml"), "utf8"),
      /viberacing-hook-v2/,
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
    for (let index = 0; index < 20; index += 1) {
      await runtime.markDirty(new Date(start + index * 1_500));
    }
    const dirty = await runtime.readDirty();
    assert.equal(dirty.dirtySince, new Date(start).toISOString());
    assert.equal(dirty.lastEventAt, new Date(start + 28_500).toISOString());
    assert.equal(runtime.automaticDueAt(dirty), start + 43_500);
    assert.equal(
      runtime.automaticDueAt({ ...dirty, lastEventAt: new Date(start + 300_000).toISOString() }, 0),
      start + 120_000,
    );
    assert.equal(runtime.automaticDueAt(dirty, start + 50_000), start + 170_000);
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
    assert.equal(await runtime.claimScheduler(), true);
    assert.equal(await runtime.claimScheduler(), false);
    await runtime.releaseScheduler();
    const { stateDirectory } = await import("../lib/config.mjs");
    const staleLock = join(stateDirectory, "scheduler.lock");
    await writeFile(staleLock, "stale\n");
    const staleTime = new Date(Date.now() - 11 * 60_000);
    await utimes(staleLock, staleTime, staleTime);
    assert.equal(await runtime.claimScheduler(), true);
    await runtime.releaseScheduler();
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
    const usage = (id) => ({ id, date, usage: { date, totalTokens: "12", inputTokens: "5", outputTokens: "7" } });
    await appendCapture("antigravity", [usage("initial")]);
    const path = join(process.env.VIBERACING_STATE_DIR, "captures", "antigravity.jsonl");
    await Promise.all([
      ...Array.from({ length: 20 }, (_, index) => appendCapture("antigravity", [usage(\`concurrent-\${index}\`)])),
      ...Array.from({ length: 5 }, () => compactCapture(path, new Date("2026-08-14T12:00:00Z"), 1)),
    ]);
  `;
  await execFileAsync(process.execPath, ["--input-type=module", "--eval", script], {
    env: connectorEnvironment(home),
  });
  const path = join(home, ".viberacing", "captures", "antigravity.jsonl");
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
        ["hook", "--agent", "antigravity"],
        environment,
        JSON.stringify({ prompt: `private-${index}`, cwd: `/private/${index}` }),
      ),
    ),
  );
  assert.ok(hookResults.every((result) => result.code === 0 && result.stdout === ""));
  await firstRequest;

  const appendScript = `
    import { appendCapture } from ${JSON.stringify(pathToFileURL(fileURLToPath(new URL("../lib/runtime.mjs", import.meta.url))).href)};
    const date = new Date().toISOString().slice(0, 10);
    await appendCapture("antigravity", [{
      id: "event-during-sync",
      date,
      usage: { date, totalTokens: "5", inputTokens: "2", outputTokens: "3" },
    }]);
  `;
  await execFileAsync(process.execPath, ["--input-type=module", "--eval", appendScript], {
    env: environment,
  });
  const secondHook = await runWithInput(
    ["hook", "--agent", "antigravity"],
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
  assert.ok(requestTimes[1] - requestTimes[0] >= 300);
  await waitFor(async () => {
    try {
      await access(join(installation.directory, "scheduler.lock"));
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

test("removes an already-disconnected source and its pending state idempotently", async (context) => {
  const server = createServer((_request, response) => {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "source_not_found" }));
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

  await execFileAsync(process.execPath, [connectorPath, "source", "remove", clientSourceId], {
    env: connectorEnvironment(home),
  });
  const config = JSON.parse(await readFile(join(directory, "config.json"), "utf8"));
  const localState = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
  assert.deepEqual(config.sources, []);
  assert.equal(localState.sequences[sourceId], undefined);
  assert.equal(localState.adapters[sourceId], undefined);
  await assert.rejects(access(join(pending, `${sourceId}.json`)));
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

  await execFileAsync(process.execPath, [connectorPath, "sync"], {
    env: connectorEnvironment(home),
  });
  assert.equal(requests, 1);
  assert.deepEqual(JSON.parse(await readFile(join(directory, "config.json"), "utf8")).sources, []);
  assert.deepEqual(await import("node:fs/promises").then(({ readdir }) => readdir(pending)), []);
});

test("doctor collects Claude diagnostics with the required UTC range", async (context) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "active", lastSyncAt: null, sources: [] }));
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
          sourceId: "55555555-5555-4555-8555-555555555555",
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
          sources: [{ sourceId, lastAcceptedSyncSequence: "500" }],
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
    const capture = await readFile(
      join(home, ".viberacing", "captures", "antigravity.jsonl"),
      "utf8",
    );
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

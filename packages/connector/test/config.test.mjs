import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const connectorPath = fileURLToPath(new URL("../bin/viberacing.mjs", import.meta.url));

function source(agentId) {
  return { agentId };
}

test("installs a runnable connector copy and additive, owned hooks", async () => {
  const previousHome = process.env.HOME;
  const home = await mkdtemp(join(tmpdir(), "viberacing-connector-"));
  process.env.HOME = home;
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
    const kimi = await readFile(join(home, ".kimi-code", "config.toml"), "utf8");
    assert.equal(codex.hooks.SessionEnd[0].hooks[0].command, "keep-me");
    assert.equal(
      codex.hooks.SessionEnd.filter((group) => JSON.stringify(group).includes(module.hookMarker))
        .length,
      1,
    );
    assert.match(JSON.stringify(claude), /viberacing-hook-v2/);
    assert.match(JSON.stringify(gemini), /viberacing-hook-v2/);
    assert.match(JSON.stringify(qwen), /viberacing-hook-v2/);
    assert.match(kimi, /\[\[hooks\]\][\s\S]*SessionEnd[\s\S]*viberacing-hook-v2/);
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
      await readFile(join(home, ".kimi-code", "config.toml"), "utf8"),
      /viberacing-hook-v2/,
    );
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }
});

test("reports invalid existing hook settings instead of claiming success", async () => {
  const previousHome = process.env.HOME;
  const home = await mkdtemp(join(tmpdir(), "viberacing-connector-invalid-settings-"));
  process.env.HOME = home;
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
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }
});

test("keeps installation identity stable and pairing state separate", async () => {
  const previousHome = process.env.HOME;
  const home = await mkdtemp(join(tmpdir(), "viberacing-connector-identity-"));
  process.env.HOME = home;
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
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }
});

test("prevents overlapping syncs with an atomic lock", async () => {
  const previousHome = process.env.HOME;
  const home = await mkdtemp(join(tmpdir(), "viberacing-runtime-lock-"));
  process.env.HOME = home;
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
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }
});

test("requires an explicit safe label when adding a local data root", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-source-label-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const state = join(home, ".viberacing");
  await mkdir(state);
  await writeFile(
    join(state, "config.json"),
    `${JSON.stringify({ version: 2, origin: "https://example.test", sources: [] })}\n`,
  );
  const sensitivePath = join(home, "client-secret-repository");
  const environment = { ...process.env, HOME: home };
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
  assert.deepEqual(JSON.parse(await readFile(join(state, "config.json"), "utf8")).sources, []);

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
  const config = JSON.parse(await readFile(join(state, "config.json"), "utf8"));
  assert.equal(config.sources[0].suggestedLabel, "Work");
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
  const clientSourceId = "claude_code:manual";
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
    env: { ...process.env, HOME: home },
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
  const server = createServer((_request, response) => {
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
  await writeFile(
    join(directory, "config.json"),
    `${JSON.stringify({
      version: 2,
      origin: `http://127.0.0.1:${address.port}`,
      deviceToken: "synthetic-device-token",
      sources: [
        {
          clientSourceId: "claude_code:retired",
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
  await writeFile(
    join(pending, `${sourceId}.json`),
    `${JSON.stringify({
      protocolVersion: 2,
      snapshots: [{ sourceId, syncSequence: "1", entries: [] }],
      sourceErrors: [],
    })}\n`,
  );

  await assert.rejects(
    execFileAsync(process.execPath, [connectorPath, "sync"], {
      env: { ...process.env, HOME: home },
    }),
    /No configured collectors succeeded/,
  );
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
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "config.json"),
    `${JSON.stringify({
      version: 2,
      origin: `http://127.0.0.1:${address.port}`,
      deviceToken: "synthetic-device-token",
      sources: [
        {
          clientSourceId: "claude_code:doctor",
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
  const result = await execFileAsync(process.execPath, [connectorPath, "doctor"], {
    env: { ...process.env, HOME: home, PATH: "" },
  });
  assert.match(result.stdout, /claude_code \(Work\): ok/);
  assert.doesNotMatch(result.stdout, /reading 'rangeStart'/);
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
  const sources = Array.from({ length: 32 }, (_, index) => ({
    clientSourceId: `unsupported:${index}`,
    sourceId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    agentId: "unsupported",
    collectionMethod: "unsupported",
    supportedSurface: "cli",
  }));
  await writeFile(
    join(directory, "config.json"),
    `${JSON.stringify({
      version: 2,
      origin: `http://127.0.0.1:${address.port}`,
      deviceToken: "synthetic-device-token",
      sources,
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
      env: { ...process.env, HOME: home },
    }),
    /Unsupported configured source/,
  );
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].snapshots.length, 32);
  assert.equal(bodies[1].sourceErrors.length, 32);
});

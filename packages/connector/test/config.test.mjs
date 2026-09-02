import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import {
  access,
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  diagnosticCodesByPhase,
  pendingDiagnosticEvents,
  reconcileDiagnosticPhase,
} from "../lib/diagnostics.mjs";
import { connectorProtocolVersion } from "../lib/protocol.mjs";
import { ensureOwnerOnlyWindowsFile } from "../lib/windows-security.mjs";
import {
  inspectOpenCodePlugin,
  openCodePluginLocation,
  reconcileOpenCodePlugin,
} from "../lib/opencode-plugin.mjs";
import { deriveCodexProviderAccountKey } from "../lib/readers.mjs";
import { connectorVersion } from "../lib/version.mjs";

const execFileAsync = promisify(execFile);
const connectorPath = fileURLToPath(new URL("../bin/viberacing.mjs", import.meta.url));
const connector043Path = fileURLToPath(
  new URL("../../../node_modules/@viberacing/connector-0.4.3/bin/viberacing.mjs", import.meta.url),
);
const connector044Path = fileURLToPath(
  new URL("../../../node_modules/@viberacing/connector-0.4.4/bin/viberacing.mjs", import.meta.url),
);
const connectionStateChildPath = fileURLToPath(
  new URL("../test-support/connection-state-child.mjs", import.meta.url),
);

const sourceIds = new Map();
function source(agentId) {
  if (!sourceIds.has(agentId)) {
    const suffix = (sourceIds.size + 1).toString().padStart(12, "0");
    sourceIds.set(agentId, `00000000-0000-4000-8000-${suffix}`);
  }
  return { agentId, clientSourceId: sourceIds.get(agentId) };
}

function swapUtf16TestBytes(value) {
  const swapped = Buffer.alloc(value.length);
  for (let index = 0; index < value.length; index += 2) {
    swapped[index] = value[index + 1];
    swapped[index + 1] = value[index];
  }
  return swapped;
}

function encodedTestJson(value, encoding) {
  const json = `${JSON.stringify(value, null, 2)}\n`;
  if (encoding === "utf16le")
    return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(json, "utf16le")]);
  if (encoding === "utf16be")
    return Buffer.concat([
      Buffer.from([0xfe, 0xff]),
      swapUtf16TestBytes(Buffer.from(json, "utf16le")),
    ]);
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(json, "utf8")]);
}

function decodedTestJson(value, encoding) {
  if (encoding === "utf16le") return JSON.parse(value.subarray(2).toString("utf16le"));
  if (encoding === "utf16be")
    return JSON.parse(swapUtf16TestBytes(value.subarray(2)).toString("utf16le"));
  return JSON.parse(value.subarray(3).toString("utf8"));
}

function usageResponse(body, overrides = {}) {
  const snapshots = body.snapshots ?? [];
  const sourceErrors = body.sourceErrors ?? [];
  const sequenceById = new Map(
    snapshots.map((snapshot) => [snapshot.sourceId, snapshot.syncSequence]),
  );
  return {
    acceptedEntries: snapshots.flatMap((snapshot) => snapshot.entries ?? []).length,
    acceptedSnapshots: snapshots.length,
    acceptedSourceErrors: sourceErrors.length,
    staleSourceErrors: 0,
    legacySourceErrorsIgnored: 0,
    staleSnapshots: 0,
    sourceSequences: [...snapshots, ...sourceErrors].map((item) => ({
      sourceId: item.sourceId,
      lastAcceptedSyncSequence: sequenceById.get(item.sourceId) ?? "0",
      accepted: sequenceById.has(item.sourceId),
    })),
    ...overrides,
  };
}

function reconciliationResponse(sources) {
  return {
    sources: sources.map((source) => ({
      sourceId: source.sourceId,
      status: source.status ?? "active",
      lastAcceptedSyncSequence: source.lastAcceptedSyncSequence ?? "0",
      historyBackfillYear: source.historyBackfillYear ?? new Date().getUTCFullYear(),
      historyBackfillStatus: source.historyBackfillStatus ?? "complete",
    })),
  };
}

function connectorEnvironment(home, extra = {}) {
  return {
    ...process.env,
    VIBERACING_STATE_DIR: join(home, ".viberacing"),
    CODEX_HOME: join(home, ".codex"),
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    KIMI_CODE_HOME: join(home, ".kimi-code"),
    KIMI_SHARE_DIR: join(home, ".kimi"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_CONFIG_HOME: join(home, ".config"),
    OPENCODE_DB: "",
    QWEN_HOME: join(home, ".qwen"),
    QWEN_RUNTIME_DIR: "",
    GEMINI_CLI_HOME: home,
    ...extra,
  };
}

function defaultStateConnectorEnvironment(home, extra = {}) {
  return connectorEnvironment(home, {
    HOME: home,
    USERPROFILE: home,
    ...extra,
  });
}

function useModuleEnvironment(home) {
  const environment = connectorEnvironment(home);
  const names = [
    "VIBERACING_STATE_DIR",
    "CODEX_HOME",
    "CLAUDE_CONFIG_DIR",
    "KIMI_CODE_HOME",
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
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, ".viberacing-state"), '{"format":1}\n');
  await writeFile(join(directory, "sources.json"), `${JSON.stringify({ version: 1, sources })}\n`);
}

async function readLocalSources(directory) {
  return JSON.parse(await readFile(join(directory, "sources.json"), "utf8")).sources;
}

async function snapshotStateTree(directory, relative = "") {
  const result = [];
  for (const entry of (await readdir(join(directory, relative), { withFileTypes: true })).sort(
    (left, right) => left.name.localeCompare(right.name),
  )) {
    const child = join(relative, entry.name);
    if (entry.isSymbolicLink()) {
      result.push({
        path: child,
        type: "symlink",
        target: await readlink(join(directory, child)),
      });
      continue;
    }
    const info = await stat(join(directory, child));
    if (entry.isDirectory()) {
      result.push({ path: child, type: "directory", mode: info.mode & 0o777 });
      result.push(...(await snapshotStateTree(directory, child)));
    } else {
      result.push({
        path: child,
        type: "file",
        mode: info.mode & 0o777,
        contents: (await readFile(join(directory, child))).toString("base64"),
      });
    }
  }
  return result;
}

function openCodeCleanupTargets(value) {
  return value.version === 1
    ? [
        {
          installationId: value.installationId,
          openCodePluginPath: value.openCodePluginPath,
        },
      ]
    : value.targets;
}

async function writeOpenCode043Installation(home, origin) {
  const sourceId = "74747474-7474-4474-8474-747474747474";
  const clientSourceId = "75757575-7575-4575-8575-757575757575";
  const databasePath = join(home, "opencode.db");
  const date = new Date().toISOString().slice(0, 10);
  const database = new DatabaseSync(databasePath);
  database.exec("CREATE TABLE message (id TEXT PRIMARY KEY, time_created INTEGER, data TEXT)");
  database
    .prepare("INSERT INTO message (id, time_created, data) VALUES (?, ?, ?)")
    .run(
      "accepted-before-upgrade",
      Date.parse(`${date}T08:00:00.000Z`),
      JSON.stringify({ role: "assistant", tokens: { input: 60, output: 40, total: 100 } }),
    );
  database.close();
  const directory = await writeMappedInstallation(home, origin, [
    {
      sourceId,
      clientSourceId,
      agentId: "opencode",
      dataPath: databasePath,
      collectionMethod: "opencode_sqlite",
      supportedSurface: "cli",
      suggestedLabel: "OpenCode",
      accountLabel: "OpenCode",
    },
  ]);
  const config = JSON.parse(await readFile(join(directory, "config.json"), "utf8"));
  config.sources[0].lastAcceptedSyncSequence = "1";
  await writeFile(join(directory, "config.json"), `${JSON.stringify(config)}\n`);
  await writeFile(
    join(directory, "state.json"),
    `${JSON.stringify({ version: 1, sequences: { [sourceId]: "1" }, adapters: {} })}\n`,
  );
  return { clientSourceId, databasePath, date, directory, sourceId };
}

function openCodeUpgradeServer(currentInstallation) {
  const requests = [];
  const usageBodies = [];
  let acceptedSequence = "1";
  let acceptedAt = new Date().toISOString();
  let baselineEntries;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const installation = currentInstallation();
      baselineEntries ??= [{ date: installation.date, totalTokens: "100" }];
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
      requests.push({ method: request.method, url: request.url });
      response.setHeader("content-type", "application/json");
      if (request.url === "/api/installations/current/sync/claim") {
        response.end(
          JSON.stringify({ requestId: body.requestId, sourceIds: [installation.sourceId] }),
        );
        return;
      }
      if (request.url === "/api/installations/current/sync/result") {
        response.statusCode = 204;
        response.end();
        return;
      }
      if (request.url === "/api/installations/current") {
        response.end(
          JSON.stringify({
            ...reconciliationResponse([
              { sourceId: installation.sourceId, lastAcceptedSyncSequence: acceptedSequence },
            ]),
            ...(body?.bootstrapSourceIds === undefined
              ? {}
              : {
                  sourceBaselines: [
                    {
                      sourceId: installation.sourceId,
                      acceptedAt,
                      entries: baselineEntries,
                    },
                  ],
                }),
          }),
        );
        return;
      }
      if (request.url === "/api/usage") {
        usageBodies.push(body);
        const snapshot = body.snapshots?.find(
          (candidate) => candidate.sourceId === installation.sourceId,
        );
        if (snapshot) {
          acceptedSequence = snapshot.syncSequence;
          acceptedAt = new Date().toISOString();
          if (usageBodies.length === 1)
            baselineEntries = snapshot.entries.map(({ date, totalTokens }) => ({
              date,
              totalTokens,
            }));
        }
        response.end(JSON.stringify(usageResponse(body)));
        return;
      }
      response.statusCode = 500;
      response.end(JSON.stringify({ error: "unexpected_request" }));
    });
  });
  return { requests, server, usageBodies };
}

async function pointInstallationAtServer(installation, port) {
  const configPath = join(installation.directory, "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.origin = `http://127.0.0.1:${port}`;
  await writeFile(configPath, `${JSON.stringify(config)}\n`);
}

async function writeCaptureInstallation(home, origin, options = {}) {
  const directory = join(home, ".viberacing");
  const clientSourceId = options.clientSourceId ?? "abababab-abab-4bab-8bab-abababababab";
  const capture = join(directory, "captures", `${clientSourceId}.jsonl`);
  const sourceId = options.sourceId ?? "89898989-8989-4989-8989-898989898989";
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  await mkdir(join(directory, "captures"), { recursive: true });
  await writeFile(join(directory, ".viberacing-state"), '{"format":1}\n');
  const events = options.events ?? [
    {
      id: options.eventId ?? "synthetic-network-event",
      date,
      usage: { date, totalTokens: "3", inputTokens: "1", outputTokens: "2" },
    },
  ];
  await writeFile(capture, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
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
      ...(options.installationId === undefined ? {} : { installationId: options.installationId }),
      deviceToken: "synthetic-device-token-that-is-long-enough",
      sources: [
        {
          clientSourceId,
          sourceId,
          agentId: "antigravity",
          accountLabel: "Antigravity",
          collectionMethod: "antigravity_cli_capture",
          lastAcceptedSyncSequence: "0",
          historyBackfillYear: options.historyBackfillYear ?? new Date().getUTCFullYear(),
          historyBackfillStatus: options.historyBackfillStatus ?? "complete",
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
  await writeFile(join(directory, ".viberacing-state"), '{"format":1}\n');
  await writeLocalSources(
    directory,
    sources.map(
      ({
        sourceId: _sourceId,
        accountLabel: _accountLabel,
        historyBackfillYear: _historyBackfillYear,
        historyBackfillStatus: _historyBackfillStatus,
        ...source
      }) => source,
    ),
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
        ...(source.agentAccountId === undefined ? {} : { agentAccountId: source.agentAccountId }),
        agentId: source.agentId,
        accountLabel: source.accountLabel ?? source.suggestedLabel,
        collectionMethod: source.collectionMethod,
        lastAcceptedSyncSequence: "0",
        historyBackfillYear: source.historyBackfillYear ?? new Date().getUTCFullYear(),
        historyBackfillStatus: source.historyBackfillStatus ?? "complete",
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

async function writeMappedOpenCodeInstallation(home, origin, installationId = randomUUID()) {
  const source = {
    clientSourceId: randomUUID(),
    sourceId: randomUUID(),
    agentId: "opencode",
    dataPath: join(home, ".local", "share", "opencode", "opencode.db"),
    collectionMethod: "opencode_sqlite",
    supportedSurface: "cli",
    suggestedLabel: "OpenCode",
    accountLabel: "OpenCode",
  };
  const directory = await writeMappedInstallation(home, origin, [source]);
  const configPath = join(directory, "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  await writeFile(configPath, `${JSON.stringify({ ...config, installationId })}\n`, {
    mode: 0o600,
  });
  return { directory, installationId, source };
}

async function runWithInput(arguments_, environment, input, script = connectorPath, options = {}) {
  const child = spawn(process.execPath, [script, ...arguments_], {
    env: environment,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
  child.stdin.end(input);
  const [code] = await once(child, "close");
  return { code, stdout, stderr, pid: child.pid };
}

async function writeExecutableNodeScript(path, contents) {
  const scriptPath = process.platform === "win32" ? path.replace(/\.cmd$/i, ".mjs") : path;
  await writeFile(scriptPath, contents);
  if (process.platform === "win32") {
    await writeFile(
      path,
      `@echo off\r\n"${process.execPath}" "%~dp0${basename(scriptPath)}" %*\r\n`,
    );
  }
  await chmod(path, 0o700);
}

async function writeFakeCodexHookServer(path) {
  await writeExecutableNodeScript(
    path,
    `#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.id === 0 && message.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: 0, result: { userAgent: "synthetic-codex" } }) + "\\n");
    continue;
  }
  if (message.id !== 1 || message.method !== "hooks/list") continue;
  const sourcePath = join(process.env.CODEX_HOME, "hooks.json");
  const settings = JSON.parse(readFileSync(sourcePath, "utf8"));
  const handler = (settings.hooks?.Stop ?? [])
    .flatMap((group) => group.hooks ?? [])
    .find((hook) => String(hook.command).includes("--viberacing-hook-id=viberacing-hook-v3:"));
  process.stdout.write(
    JSON.stringify({
      id: 1,
      result: {
        data: [{
          cwd: message.params.cwds[0],
          errors: [],
          warnings: [],
          hooks: [{
            eventName: "stop",
            sourcePath,
            command: handler.command,
            enabled: process.env.VIBERACING_TEST_CODEX_HOOK_TRUST !== "disabled",
            trustStatus: process.env.VIBERACING_TEST_CODEX_HOOK_TRUST ?? "untrusted",
          }],
        }],
      },
    }) + "\\n",
  );
}
`,
  );
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
    const installedRuntime = join(home, ".viberacing", "runtime", connectorVersion);
    const installedLibrary = join(installedRuntime, "lib");
    for (const name of [
      "browser.mjs",
      "connection-lifecycle.mjs",
      "config.mjs",
      "executables.mjs",
      "owned-lock.mjs",
      "opencode-cleanup.mjs",
      "readers.mjs",
      "registry.mjs",
      "runtime.mjs",
    ])
      await access(join(installedLibrary, name));
    await access(join(installedLibrary, "adapters", "codex.mjs"));
    const stagedVersion = await execFileAsync(
      process.execPath,
      [join(installedRuntime, "bin", "viberacing.mjs"), "--version"],
      { env: connectorEnvironment(home) },
    );
    assert.equal(stagedVersion.stdout, `${connectorVersion}\n`);
    assert.equal(stagedVersion.stderr, "");
    const stableHookLauncher = join(home, ".viberacing", "bin", "viberacing-hook.mjs");
    const launchedVersion = await execFileAsync(
      process.execPath,
      [stableHookLauncher, "--version"],
      {
        env: connectorEnvironment(home),
      },
    );
    assert.equal(launchedVersion.stdout, `${connectorVersion}\n`);
    assert.equal(launchedVersion.stderr, "");
    const codex = JSON.parse(await readFile(join(home, ".codex", "hooks.json"), "utf8"));
    const claude = JSON.parse(await readFile(join(home, ".claude", "settings.json"), "utf8"));
    const gemini = JSON.parse(await readFile(join(home, ".gemini", "settings.json"), "utf8"));
    const qwen = JSON.parse(await readFile(join(home, ".qwen", "settings.json"), "utf8"));
    const kimi = await readFile(join(home, ".kimi-code", "config.toml"), "utf8");
    assert.equal(codex.hooks.SessionEnd[0].hooks[0].command, "keep-me");
    const codexMarker = module.hookMarkerForSource(source("codex").clientSourceId);
    assert.equal(
      codex.hooks.SessionEnd.filter((group) => JSON.stringify(group).includes(codexMarker)).length,
      0,
    );
    assert.equal(
      codex.hooks.Stop.filter((group) => JSON.stringify(group).includes(codexMarker)).length,
      1,
    );
    assert.equal(codex.hooks.Stop.at(-1).hooks[0].timeout, 3);
    assert.match(codex.hooks.Stop.at(-1).hooks[0].command, /bin[/\\]viberacing-hook\.mjs/);
    assert.doesNotMatch(codex.hooks.Stop.at(-1).hooks[0].command, /runtime[/\\][^/\\]+/);
    assert.doesNotMatch(JSON.stringify(codex), /viberacing-hook-v2/);
    assert.match(JSON.stringify(claude), /viberacing-hook-v3:/);
    assert.match(JSON.stringify(gemini), /viberacing-hook-v3:/);
    assert.match(JSON.stringify(qwen), /viberacing-hook-v3:/);
    assert.equal(gemini.hooks.SessionEnd.at(-1).hooks[0].timeout, 10_000);
    assert.equal(qwen.hooks.SessionEnd.at(-1).hooks[0].timeout, 10_000);
    assert.match(kimi, /\[\[hooks\]\][\s\S]*Stop[\s\S]*viberacing-hook-v3:/);
    const hooks = await module.diagnoseHooks(
      [
        source("codex"),
        source("claude_code"),
        source("gemini_cli"),
        source("qwen_code"),
        source("kimi_code"),
        source("opencode"),
      ],
      { inspectCodexHookTrust: async () => "current" },
    );
    assert.deepEqual(hooks, {
      codex: "current",
      claude_code: "current",
      gemini_cli: "current",
      qwen_code: "current",
      kimi_code: "current",
    });
    assert.equal(
      await module.diagnoseHookForSource(source("codex"), {
        inspectCodexHookTrust: async () => "untrusted",
      }),
      "untrusted",
    );
    assert.equal(
      await module.diagnoseHookForSource(source("codex"), {
        inspectCodexHookTrust: async () => {
          throw new Error("synthetic unavailable inspector");
        },
      }),
      "trust-unknown",
    );
    const codexSettingsBeforeRepeat = await readFile(join(home, ".codex", "hooks.json"), "utf8");
    const repeated = await module.installHooks(
      pathToFileURL(join(installedRuntime, "bin", "viberacing.mjs")),
      [source("codex")],
    );
    assert.equal(repeated[source("codex").clientSourceId], false);
    assert.equal(
      await readFile(join(home, ".codex", "hooks.json"), "utf8"),
      codexSettingsBeforeRepeat,
    );
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
    await module.installHooks(
      pathToFileURL(
        join(home, ".viberacing", "runtime", connectorVersion, "bin", "viberacing.mjs"),
      ),
      [source("codex")],
    );
    await module.removeHooks();
    assert.doesNotMatch(
      await readFile(join(home, ".codex", "hooks.json"), "utf8"),
      /viberacing-hook-v[23]/,
    );
    assert.match(await readFile(join(home, ".codex", "hooks.json"), "utf8"), /keep-me/);
    assert.doesNotMatch(
      await readFile(join(home, ".kimi-code", "config.toml"), "utf8"),
      /viberacing-hook-v[23]/,
    );
  } finally {
    restoreEnvironment();
  }
});

test("preserves BOM-encoded JSON hook settings while installing owned hooks", async () => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-hook-encoding-"));
  const restoreEnvironment = useModuleEnvironment(home);
  const fixtures = [
    { agentId: "codex", directory: ".codex", file: "hooks.json", encoding: "utf8-bom" },
    {
      agentId: "claude_code",
      directory: ".claude",
      file: "settings.json",
      encoding: "utf16le",
    },
    {
      agentId: "gemini_cli",
      directory: ".gemini",
      file: "settings.json",
      encoding: "utf16be",
    },
  ];
  try {
    for (const fixture of fixtures) {
      await mkdir(join(home, fixture.directory), { recursive: true });
      await writeFile(
        join(home, fixture.directory, fixture.file),
        encodedTestJson({ retained: fixture.agentId }, fixture.encoding),
      );
    }
    const module = await import(`../lib/config.mjs?hook-encoding=${encodeURIComponent(home)}`);
    await module.installHooks(
      new URL("../bin/viberacing.mjs", import.meta.url),
      fixtures.map((fixture) => source(fixture.agentId)),
    );
    for (const fixture of fixtures) {
      const raw = await readFile(join(home, fixture.directory, fixture.file));
      const settings = decodedTestJson(raw, fixture.encoding);
      assert.equal(settings.retained, fixture.agentId);
      assert.match(JSON.stringify(settings.hooks), /viberacing-hook-v3:/);
      if (fixture.encoding === "utf8-bom")
        assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
      else if (fixture.encoding === "utf16le")
        assert.deepEqual([...raw.subarray(0, 2)], [0xff, 0xfe]);
      else assert.deepEqual([...raw.subarray(0, 2)], [0xfe, 0xff]);
    }
    assert.deepEqual(
      await module.diagnoseHooks(
        fixtures.map((fixture) => source(fixture.agentId)),
        {
          inspectCodexHookTrust: async () => "current",
        },
      ),
      {
        codex: "current",
        claude_code: "current",
        gemini_cli: "current",
      },
    );
  } finally {
    restoreEnvironment();
    await rm(home, { recursive: true, force: true });
  }
});

test("rejects truncated UTF-16 hook settings without changing them", async () => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-hook-truncated-"));
  const restoreEnvironment = useModuleEnvironment(home);
  const path = join(home, ".claude", "settings.json");
  const original = Buffer.from([0xff, 0xfe, 0x7b]);
  try {
    await mkdir(join(home, ".claude"), { recursive: true });
    await writeFile(path, original);
    const module = await import(`../lib/config.mjs?hook-truncated=${encodeURIComponent(home)}`);
    await assert.rejects(
      module.installHooks(new URL("../bin/viberacing.mjs", import.meta.url), [
        source("claude_code"),
      ]),
      /truncated UTF-16/,
    );
    assert.deepEqual(await readFile(path), original);
  } finally {
    restoreEnvironment();
    await rm(home, { recursive: true, force: true });
  }
});

test("rejects an incomplete runtime before pairing-compatible staging completes", async () => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-runtime-staging-"));
  const restoreEnvironment = useModuleEnvironment(home);
  try {
    const brokenRoot = join(home, "broken-package");
    const brokenScript = join(brokenRoot, "bin", "viberacing.mjs");
    await mkdir(join(brokenRoot, "bin"), { recursive: true });
    await writeFile(brokenScript, "import '../lib/protocol.mjs';\n");
    const module = await import(`../lib/config.mjs?staging=${encodeURIComponent(home)}`);
    await assert.rejects(module.prepareRuntime(pathToFileURL(brokenScript)));
    await assert.rejects(
      access(join(home, ".viberacing", "runtime", connectorVersion, "bin", "viberacing.mjs")),
    );
    assert.deepEqual(await readdir(join(home, ".viberacing", "runtime")), []);
  } finally {
    restoreEnvironment();
    await rm(home, { recursive: true, force: true });
  }
});

test("forced runtime repair restages truncated, changed, and missing files of the same version", async () => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-runtime-force-repair-"));
  const restoreEnvironment = useModuleEnvironment(home);
  try {
    const module = await import(`../lib/config.mjs?force-repair=${encodeURIComponent(home)}`);
    const sourceUrl = new URL("../bin/viberacing.mjs", import.meta.url);
    const sourceRuntime = await readFile(new URL("../lib/runtime.mjs", import.meta.url));
    const installedScript = await module.prepareRuntime(sourceUrl);
    const installedRuntime = join(
      home,
      ".viberacing",
      "runtime",
      connectorVersion,
      "lib",
      "runtime.mjs",
    );
    assert.equal(
      installedScript,
      join(home, ".viberacing", "runtime", connectorVersion, "bin", "viberacing.mjs"),
    );

    const mutations = [
      () => writeFile(installedRuntime, sourceRuntime.subarray(0, 32)),
      () => writeFile(installedRuntime, Buffer.alloc(sourceRuntime.length, 0x78)),
      () => unlink(installedRuntime),
    ];
    for (const mutate of mutations) {
      await mutate();
      await module.prepareRuntime(sourceUrl, { force: true });
      assert.deepEqual(await readFile(installedRuntime), sourceRuntime);
    }
  } finally {
    restoreEnvironment();
    await rm(home, { recursive: true, force: true });
  }
});

test("recovers a connection commit interrupted before the source registry is published", async () => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-connection-commit-"));
  const restoreEnvironment = useModuleEnvironment(home);
  try {
    const module = await import(`../lib/config.mjs?connection-commit=${encodeURIComponent(home)}`);
    const directory = join(home, ".viberacing");
    const localSource = {
      clientSourceId: "84848484-8484-4484-8484-848484848484",
      agentId: "codex",
      collectionMethod: "codex_app_server",
      dataPath: join(home, ".codex"),
      suggestedLabel: "Codex",
      supportedSurface: "desktop",
    };
    const mappedSource = {
      ...localSource,
      sourceId: "85858585-8585-4585-8585-858585858585",
      agentAccountId: "86868686-8686-4686-8686-868686868686",
      accountLabel: "Personal",
      lastAcceptedSyncSequence: "7",
    };
    await assert.rejects(
      module.commitConnectionState(
        {
          version: 2,
          origin: "https://viberacing.example",
          installationId: "87878787-8787-4787-8787-878787878787",
          deviceToken: "recoverable_device_token_that_is_long_enough",
          sources: [mappedSource],
          protocol: { version: 2, snapshotDays: 31, maximumSources: 32, maximumEntries: 1_024 },
        },
        [localSource],
        {
          afterConfigCommit() {
            throw new Error("Synthetic interruption between connection files");
          },
        },
      ),
      /Synthetic interruption between connection files/,
    );
    await access(join(directory, "config.json"));
    await access(join(directory, "connection-commit.json"));
    await assert.rejects(access(join(directory, "sources.json")));

    const recovered = await module.readConfig();
    assert.equal(recovered.deviceToken, "recoverable_device_token_that_is_long_enough");
    assert.deepEqual(
      recovered.sources.map((source) => ({
        clientSourceId: source.clientSourceId,
        sourceId: source.sourceId,
        dataPath: source.dataPath,
      })),
      [
        {
          clientSourceId: localSource.clientSourceId,
          sourceId: mappedSource.sourceId,
          dataPath: localSource.dataPath,
        },
      ],
    );
    assert.deepEqual(await module.readSources(), [localSource]);
    await assert.rejects(access(join(directory, "connection-commit.json")));

    await assert.rejects(
      module.commitConnectionState(
        {
          ...recovered,
          deviceToken: "token_that_must_not_be_restored_after_disconnect",
        },
        [localSource],
        {
          afterConfigCommit() {
            throw new Error("Synthetic interruption before explicit disconnect");
          },
        },
      ),
      /Synthetic interruption before explicit disconnect/,
    );
    await access(join(directory, "connection-commit.json"));
    await module.removeConfig();
    await assert.rejects(access(join(directory, "config.json")));
    await assert.rejects(access(join(directory, "connection-commit.json")));
    await assert.rejects(module.readConfig(), { code: "ENOENT" });
    assert.deepEqual(await module.readSources(), [localSource]);
  } finally {
    restoreEnvironment();
    await rm(home, { recursive: true, force: true });
  }
});

test("connection, source, and installation mutations invalidate a pending connect generation", async () => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-connect-generation-"));
  const restoreEnvironment = useModuleEnvironment(home);
  try {
    const module = await import(`../lib/config.mjs?connect-generation=${encodeURIComponent(home)}`);
    const directory = join(home, ".viberacing");
    const installationId = "81818181-8181-4181-8181-818181818181";
    const localSource = {
      clientSourceId: "82828282-8282-4282-8282-828282828282",
      agentId: "claude_code",
      collectionMethod: "claude_jsonl",
      dataPath: join(home, ".claude"),
      suggestedLabel: "Claude",
      supportedSurface: "cli",
    };
    const mappedSource = {
      ...localSource,
      sourceId: "83838383-8383-4383-8383-838383838383",
      agentAccountId: "84848484-8484-4484-8484-848484848484",
      accountLabel: "Claude",
      lastAcceptedSyncSequence: "0",
    };
    const nextConfig = {
      version: 2,
      origin: "https://viberacing.example",
      installationId,
      deviceToken: "generation_device_token_that_is_long_enough",
      sources: [mappedSource],
      protocol: { version: 2, snapshotDays: 31, maximumSources: 32, maximumEntries: 1_024 },
    };
    await module.writeSources([localSource]);
    await writeFile(
      join(directory, "installation.json"),
      `${JSON.stringify({
        version: 1,
        id: installationId,
        secret: "generation_installation_secret_that_is_long_enough",
      })}\n`,
    );

    const addedAttempt = await module.beginConnectAttempt({
      installationId,
      origin: nextConfig.origin,
      expectedSources: [localSource],
      expectedConnectionSnapshot: module.connectionSnapshot(null),
    });
    const addedSource = {
      clientSourceId: "85858585-8585-4585-8585-858585858585",
      agentId: "kimi_code",
      collectionMethod: "kimi_wire_jsonl",
      dataPath: join(home, ".kimi-code"),
      suggestedLabel: "Kimi",
      supportedSurface: "cli",
    };
    await module.addSource(addedSource);
    await assert.rejects(
      module.commitConnectionState(nextConfig, [localSource], { connectAttempt: addedAttempt }),
      { code: "connect_attempt_stale" },
    );

    const sourcesWithAddition = await module.readSources();
    const removedAttempt = await module.beginConnectAttempt({
      installationId,
      origin: nextConfig.origin,
      expectedSources: sourcesWithAddition,
      expectedConnectionSnapshot: module.connectionSnapshot(null),
    });
    await module.removeSource(addedSource.clientSourceId);
    await assert.rejects(
      module.commitConnectionState(nextConfig, [localSource], { connectAttempt: removedAttempt }),
      { code: "connect_attempt_stale" },
    );

    await module.writeConfig(nextConfig);
    await assert.rejects(
      module.beginConnectAttempt({
        installationId,
        origin: nextConfig.origin,
        expectedSources: [localSource],
        expectedConnectionSnapshot: module.connectionSnapshot(null),
      }),
      { code: "connect_attempt_stale" },
    );
    const previousConnectionSnapshot = module.connectionSnapshot(nextConfig);
    await module.writeConfig({
      ...nextConfig,
      deviceToken: "replacement_generation_device_token_that_is_long_enough",
    });
    await assert.rejects(
      module.beginConnectAttempt({
        installationId,
        origin: nextConfig.origin,
        expectedSources: [localSource],
        expectedConnectionSnapshot: previousConnectionSnapshot,
      }),
      { code: "connect_attempt_stale" },
    );
    await module.removeConfig();

    const resetAttempt = await module.beginConnectAttempt({
      installationId,
      origin: nextConfig.origin,
      expectedSources: [localSource],
      expectedConnectionSnapshot: module.connectionSnapshot(null),
    });
    await module.resetInstallation();
    await assert.rejects(
      module.commitConnectionState(nextConfig, [localSource], { connectAttempt: resetAttempt }),
      { code: "connect_attempt_stale" },
    );
    await assert.rejects(access(join(directory, "connect-attempt.json")));
    await assert.rejects(access(join(directory, "config.json")));
  } finally {
    restoreEnvironment();
    await rm(home, { recursive: true, force: true });
  }
});

test("Codex source schema v2 binds at most eight local identities to one physical profile", async () => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-codex-identities-"));
  const restoreEnvironment = useModuleEnvironment(home);
  try {
    const module = await import(`../lib/config.mjs?codex-identities=${encodeURIComponent(home)}`);
    const primary = {
      clientSourceId: "91919191-9191-4191-8191-919191919191",
      agentId: "codex",
      collectionMethod: "codex_app_server",
      dataPath: join(home, ".codex"),
      suggestedLabel: "Codex",
      supportedSurface: "desktop",
    };
    await module.writeSources([primary]);
    await writeFile(
      join(home, ".viberacing", "sources.json"),
      `${JSON.stringify({ version: 1, sources: [primary] })}\n`,
    );
    await writeFile(
      join(home, ".viberacing", `sources.json.${process.pid}.tmp`),
      "interrupted migration must not replace the committed registry\n",
    );
    assert.equal(await module.migrateSourcesSchema(), true);
    assert.equal(await module.migrateSourcesSchema(), false);
    const firstKey = `acct1_${"a".repeat(43)}`;
    const first = await module.bindCodexProviderAccount(primary.clientSourceId, firstKey);
    assert.equal(first.boundPrimary, true);
    assert.equal(first.source.clientSourceId, primary.clientSourceId);
    for (let index = 1; index < 8; index += 1) {
      const key = `acct1_${String.fromCharCode(97 + index).repeat(43)}`;
      const binding = await module.bindCodexProviderAccount(primary.clientSourceId, key);
      assert.equal(binding.added, true);
      assert.equal(binding.source.profileClientSourceId, primary.clientSourceId);
      assert.equal(binding.source.suggestedLabel, "Codex account");
    }
    const sources = await module.readSources();
    assert.equal(sources.length, 8);
    assert.equal(JSON.parse(await readFile(join(home, ".viberacing", "sources.json"))).version, 2);
    await assert.rejects(
      module.bindCodexProviderAccount(primary.clientSourceId, `acct1_${"z".repeat(43)}`),
      (error) => error?.diagnosticCode === "provider_account_limit_reached",
    );
    assert.equal(
      await module.installHookForSource(sources[1], join(home, "installed-runtime.mjs")),
      false,
    );

    const sourcesPath = join(home, ".viberacing", "sources.json");
    const validRegistry = await readFile(sourcesPath, "utf8");
    const corruptRegistry = `${JSON.stringify({
      version: 2,
      sources: [
        primary,
        {
          ...primary,
          clientSourceId: "92929292-9292-4292-8292-929292929292",
          profileClientSourceId: primary.clientSourceId,
          providerAccountKey: `acct1_${"q".repeat(43)}`,
          supportedSurface: "cli",
        },
      ],
    })}\n`;
    await writeFile(sourcesPath, corruptRegistry);
    await assert.rejects(module.readSources(), /unsupported/);
    assert.equal(await readFile(sourcesPath, "utf8"), corruptRegistry);

    const futureRegistry = `${JSON.stringify({ version: 3, sources: [primary] })}\n`;
    await writeFile(sourcesPath, futureRegistry);
    await assert.rejects(module.readSources(), /unsupported/);
    assert.equal(await readFile(sourcesPath, "utf8"), futureRegistry);
    await writeFile(sourcesPath, validRegistry);
  } finally {
    restoreEnvironment();
    await rm(home, { recursive: true, force: true });
  }
});

test("provider identity salt and exactly two Codex logical accounts survive reset-installation", async () => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-codex-reset-identities-"));
  const restoreEnvironment = useModuleEnvironment(home);
  try {
    const module = await import(`../lib/config.mjs?codex-reset=${encodeURIComponent(home)}`);
    const primary = {
      clientSourceId: "93939393-9393-4393-8393-939393939393",
      agentId: "codex",
      collectionMethod: "codex_app_server",
      dataPath: join(home, ".codex"),
      suggestedLabel: "Codex",
      supportedSurface: "desktop",
    };
    await module.writeSources([primary]);
    const saltBefore = await module.readOrCreateProviderIdentitySalt();
    const firstKey = `acct1_${"a".repeat(43)}`;
    const secondKey = `acct1_${"b".repeat(43)}`;
    await module.bindCodexProviderAccount(primary.clientSourceId, firstKey);
    await module.bindCodexProviderAccount(primary.clientSourceId, secondKey);
    assert.equal((await module.readSources()).length, 2);

    await module.readOrCreateInstallation();
    await module.resetInstallation();
    assert.equal(await module.readOrCreateProviderIdentitySalt(), saltBefore);
    assert.equal(
      (await module.bindCodexProviderAccount(primary.clientSourceId, firstKey)).added,
      false,
    );
    assert.equal(
      (await module.bindCodexProviderAccount(primary.clientSourceId, secondKey)).added,
      false,
    );
    assert.equal((await module.readSources()).length, 2);
    assert.equal(
      JSON.parse(await readFile(join(home, ".viberacing", "provider-identity.json"))).salt,
      saltBefore,
    );
  } finally {
    restoreEnvironment();
    await rm(home, { recursive: true, force: true });
  }
});

test("disconnect wins both connection-state lock orders and provider hooks cannot resurrect state", async () => {
  for (const order of ["recovery-first", "disconnect-first"]) {
    const home = await mkdtemp(join(tmpdir(), `viberacing-connection-race-${order}-`));
    const restoreEnvironment = useModuleEnvironment(home);
    const environment = connectorEnvironment(home, { NODE_ENV: "test" });
    const directory = join(home, ".viberacing");
    const barrier = join(home, `connection-${order}`);
    const disconnectBarrier = `${barrier}-disconnect`;
    const clientSourceId = "88888888-8888-4888-8888-888888888888";
    const sourceId = "89898989-8989-4989-8989-898989898989";
    const deviceToken = `device_token_that_must_not_survive_${order}_race`;
    const hookRoot = join(home, ".claude");
    const localSource = {
      clientSourceId,
      agentId: "claude_code",
      collectionMethod: "claude_jsonl",
      dataPath: hookRoot,
      suggestedLabel: "Claude",
      supportedSurface: "cli",
      hookConfigRoot: hookRoot,
    };
    let recovery;
    let disconnect;
    try {
      const module = await import(
        `../lib/config.mjs?connection-race=${order}-${encodeURIComponent(home)}`
      );
      await mkdir(hookRoot, { recursive: true });
      await module.writeSources([localSource]);
      await writeFile(
        join(hookRoot, "settings.json"),
        `${JSON.stringify({
          hooks: {
            Stop: [
              {
                hooks: [
                  {
                    type: "command",
                    command: `node hook ${module.hookMarkerForSource(clientSourceId)}`,
                  },
                ],
              },
            ],
          },
        })}\n`,
      );
      await assert.rejects(
        module.commitConnectionState(
          {
            version: 2,
            origin: "https://viberacing.example",
            installationId: "87878787-8787-4787-8787-878787878787",
            deviceToken,
            sources: [
              {
                ...localSource,
                sourceId,
                agentAccountId: "86868686-8686-4686-8686-868686868686",
                accountLabel: "Personal",
                lastAcceptedSyncSequence: "7",
              },
            ],
            protocol: { version: 2, snapshotDays: 31, maximumSources: 32, maximumEntries: 1_024 },
          },
          [localSource],
          {
            afterConfigCommit() {
              throw new Error("Synthetic interrupted connection commit");
            },
          },
        ),
        /Synthetic interrupted connection commit/,
      );
      await mkdir(join(directory, "pending"), { recursive: true });
      await writeFile(join(directory, "pending", `${sourceId}.json`), '{"pending":true}\n');
      await writeFile(join(directory, "dirty.json"), '{"version":2,"sources":{}}\n');
      restoreEnvironment();

      const spawnStateChild = (action, pause, barrierPath = barrier) => {
        const child = spawn(process.execPath, [connectionStateChildPath, action], {
          env: {
            ...environment,
            ...(pause
              ? {
                  VIBERACING_TEST_CONNECTION_STATE_PAUSE: pause,
                  VIBERACING_TEST_CONNECTION_STATE_BARRIER: barrierPath,
                }
              : {}),
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stderr = "";
        child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
        return {
          child,
          result: once(child, "close").then(([code]) => ({ code, stderr })),
        };
      };

      if (order === "recovery-first") {
        recovery = spawnStateChild("recover", "recovery_after_read");
        await waitFor(() =>
          access(`${barrier}.ready`)
            .then(() => true)
            .catch(() => false),
        );
        disconnect = spawnStateChild("disconnect-local", "remove_after_lock", disconnectBarrier);
        await waitFor(() =>
          access(join(directory, "lifecycle.lock"))
            .then(() => true)
            .catch(() => false),
        );
        await writeFile(`${barrier}.continue`, "continue\n");
        await waitFor(() =>
          access(`${disconnectBarrier}.ready`)
            .then(() => true)
            .catch(() => false),
        );
      } else {
        disconnect = spawnStateChild("disconnect-local", "remove_after_lock");
        await waitFor(() =>
          access(`${barrier}.ready`)
            .then(() => true)
            .catch(() => false),
        );
        recovery = spawnStateChild("recover-optional");
        await delay(50);
        assert.equal(recovery.child.exitCode, null, "recovery did not wait for disconnect lock");
      }

      const hook = await runWithInput(
        ["hook", "--source", clientSourceId, "--agent", "claude_code"],
        environment,
        '{"private":"discarded"}',
      );
      assert.equal(hook.code, 0);
      await writeFile(
        `${order === "recovery-first" ? disconnectBarrier : barrier}.continue`,
        "continue\n",
      );
      const [recoveryResult, disconnectResult] = await Promise.all([
        recovery.result,
        disconnect.result,
      ]);
      assert.deepEqual(recoveryResult, { code: 0, stderr: "" });
      assert.deepEqual(disconnectResult, { code: 0, stderr: "" });

      for (const name of [
        "config.json",
        "connection-commit.json",
        "connection-state.lock",
        "dirty.json",
        "scheduler.lock",
        "lifecycle.lock",
        "lifecycle-revoking.lock",
      ])
        await assert.rejects(access(join(directory, name)), undefined, name);
      assert.deepEqual(
        (await readdir(join(directory, "pending"))).filter((name) => name.endsWith(".json")),
        [],
      );
      assert.doesNotMatch(await readFile(join(hookRoot, "settings.json"), "utf8"), /viberacing/);
    } finally {
      restoreEnvironment();
      recovery?.child.kill();
      disconnect?.child.kill();
      await rm(home, { recursive: true, force: true });
    }
  }
});

test("keeps a manual Qwen hook root through reconnect and uninstall", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-qwen-hook-root-"));
  context.after(() => rm(home, { force: true, recursive: true }));
  const restoreEnvironment = useModuleEnvironment(home);
  try {
    const qwenHome = join(home, ".qwen");
    const runtimeRoot = join(home, "qwen-runtime");
    const usageRoot = join(runtimeRoot, "usage");
    await mkdir(qwenHome, { recursive: true });
    await mkdir(usageRoot, { recursive: true });
    await writeFile(
      join(qwenHome, "settings.json"),
      `{
        // Preserve this user comment.
        "advanced": { "runtimeOutputDir": ${JSON.stringify(runtimeRoot)} },
        "unknownSetting": { "keep": true }
      }\n`,
    );

    await execFileAsync(
      process.execPath,
      [
        connectorPath,
        "source",
        "add",
        "--agent",
        "qwen_code",
        "--name",
        "Work",
        "--data-dir",
        usageRoot,
      ],
      { env: connectorEnvironment(home, { PATH: "" }) },
    );
    let sources = await readLocalSources(join(home, ".viberacing"));
    assert.equal(sources.length, 1);
    assert.equal(sources[0].dataPath, usageRoot);
    assert.equal(sources[0].hookConfigRoot, qwenHome);

    const module = await import(`../lib/config.mjs?qwen-hook-root=${encodeURIComponent(home)}`);
    await module.reconcileDetectedSources([
      {
        agentId: "qwen_code",
        dataPath: usageRoot,
        hookConfigRoot: qwenHome,
        collectionMethod: "qwen_stats_jsonl",
        supportedSurface: "cli",
        suggestedLabel: "Qwen Code",
      },
    ]);
    sources = await module.readSources();
    assert.equal(sources[0].hookConfigRoot, qwenHome);
    await module.installHooks(new URL("../bin/viberacing.mjs", import.meta.url), sources);
    const installed = await readFile(join(qwenHome, "settings.json"), "utf8");
    assert.match(installed, /Preserve this user comment/);
    assert.match(installed, /"unknownSetting"[\s\S]*"keep": true/);
    assert.match(installed, /viberacing-hook-v3:/);
    assert.match(installed, /--source/);
    assert.match(installed, new RegExp(sources[0].clientSourceId));
    assert.match(installed, /--agent/);
    assert.match(installed, /qwen_code/);
    await assert.rejects(access(join(runtimeRoot, "settings.json")));
    assert.deepEqual(await module.diagnoseHooks(sources), { qwen_code: "current" });

    const removed = await module.removeHooks();
    assert.equal(removed.failures.length, 0);
    const cleaned = await readFile(join(qwenHome, "settings.json"), "utf8");
    assert.match(cleaned, /Preserve this user comment/);
    assert.match(cleaned, /"unknownSetting"[\s\S]*"keep": true/);
    assert.doesNotMatch(cleaned, /viberacing-hook-v3:/);
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

test("reconciles healthy hooks when another source settings file is damaged", async () => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-best-effort-hooks-"));
  const restoreEnvironment = useModuleEnvironment(home);
  try {
    const module = await import(`../lib/config.mjs?best-effort=${encodeURIComponent(home)}`);
    const broken = {
      ...source("claude_code"),
      dataPath: join(home, "broken-claude", "projects"),
    };
    const healthy = {
      ...source("qwen_code"),
      dataPath: join(home, "healthy-qwen", "usage"),
      hookConfigRoot: join(home, "healthy-qwen"),
    };
    await mkdir(join(home, "broken-claude"), { recursive: true });
    await writeFile(join(home, "broken-claude", "settings.json"), "{not-json");
    const result = await module.reconcileHooks(
      new URL("../bin/viberacing.mjs", import.meta.url),
      [broken, healthy],
      [broken, healthy],
    );
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].clientSourceId, broken.clientSourceId);
    assert.match(
      await readFile(join(home, "healthy-qwen", "settings.json"), "utf8"),
      /viberacing-hook-v3/,
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
      hookConfigRoot: join(home, "qwen-personal"),
      collectionMethod: "qwen_stats_jsonl",
      supportedSurface: "cli",
      suggestedLabel: "Personal",
    };
    const second = {
      ...first,
      clientSourceId: "72727272-7272-4272-8272-727272727272",
      dataPath: join(home, "qwen-work"),
      hookConfigRoot: join(home, "qwen-work"),
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
    assert.match(firstSettings, /--source/);
    assert.match(firstSettings, new RegExp(first.clientSourceId));
    assert.match(secondSettings, new RegExp(module.hookMarkerForSource(second.clientSourceId)));
    assert.match(secondSettings, /--source/);
    assert.match(secondSettings, new RegExp(second.clientSourceId));
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
    const openCodePluginPath = join(
      home,
      ".config",
      "opencode",
      "plugins",
      `viberacing-${first.id}.js`,
    );
    assert.equal(await module.rememberOpenCodePluginPath(first.id, openCodePluginPath), true);
    assert.equal(await module.rememberOpenCodePluginPath(first.id, openCodePluginPath), false);
    assert.equal((await module.readExistingInstallation()).openCodePluginPath, openCodePluginPath);
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

test("retains only owner-only OpenCode cleanup metadata after secrets are reset", async () => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-opencode-cleanup-metadata-"));
  const restoreEnvironment = useModuleEnvironment(home);
  try {
    const module = await import(`../lib/config.mjs?cleanup-metadata=${encodeURIComponent(home)}`);
    const installation = await module.readOrCreateInstallation();
    const pluginPath = join(
      home,
      ".config",
      "opencode",
      "plugins",
      `viberacing-${installation.id}.js`,
    );
    assert.equal(await module.rememberOpenCodePluginCleanup(installation.id, pluginPath), true);
    assert.deepEqual(await module.readOpenCodePluginCleanup(), {
      version: 1,
      installationId: installation.id,
      openCodePluginPath: pluginPath,
    });
    await module.resetInstallation();
    await assert.rejects(access(join(home, ".viberacing", "installation.json")));
    const cleanupPath = join(home, ".viberacing", "opencode-plugin-cleanup.json");
    const serialized = await readFile(cleanupPath, "utf8");
    assert.equal(serialized.includes(installation.secret), false);
    assert.deepEqual(JSON.parse(serialized), {
      version: 1,
      installationId: installation.id,
      openCodePluginPath: pluginPath,
    });
    if (process.platform !== "win32") assert.equal((await stat(cleanupPath)).mode & 0o777, 0o600);
    await module.clearOpenCodePluginCleanup();
    assert.equal(await module.readOpenCodePluginCleanup(), null);
  } finally {
    restoreEnvironment();
    await rm(home, { recursive: true, force: true });
  }
});

test("OpenCode cleanup metadata preserves distinct known and unresolved targets", async () => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-opencode-cleanup-targets-"));
  const restoreEnvironment = useModuleEnvironment(home);
  try {
    const module = await import(`../lib/config.mjs?cleanup-targets=${encodeURIComponent(home)}`);
    const installationId = "83838383-8383-4383-8383-838383838383";
    const firstPath = join(
      home,
      "config-a",
      "opencode",
      "plugins",
      `viberacing-${installationId}.js`,
    );
    const secondPath = join(
      home,
      "config-b",
      "opencode",
      "plugins",
      `viberacing-${installationId}.js`,
    );
    assert.equal(await module.rememberOpenCodePluginCleanup(installationId, firstPath), true);
    assert.equal(await module.rememberOpenCodePluginCleanup(installationId, secondPath), true);
    assert.equal(await module.rememberOpenCodePluginCleanup(installationId), true);
    assert.deepEqual(await module.readOpenCodePluginCleanups(), [
      { installationId, openCodePluginPath: firstPath },
      { installationId, openCodePluginPath: secondPath },
      { installationId },
    ]);
    assert.equal(await module.clearOpenCodePluginCleanupTarget(installationId, firstPath), true);
    assert.equal(await module.clearOpenCodePluginCleanupTarget(installationId), true);
    assert.deepEqual(await module.readOpenCodePluginCleanup(), {
      version: 1,
      installationId,
      openCodePluginPath: secondPath,
    });
    assert.deepEqual(
      JSON.parse(await readFile(join(home, ".viberacing", "opencode-plugin-cleanup.json"), "utf8")),
      { version: 1, installationId, openCodePluginPath: secondPath },
    );
  } finally {
    restoreEnvironment();
    await rm(home, { recursive: true, force: true });
  }
});

test("OpenCode cleanup metadata accepts only exact stage, probe, and quarantine paths", async () => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-opencode-cleanup-recovery-path-"));
  const restoreEnvironment = useModuleEnvironment(home);
  try {
    const module = await import(`../lib/config.mjs?cleanup-recovery=${encodeURIComponent(home)}`);
    const installation = await module.readOrCreateInstallation();
    const canonical = join(
      home,
      ".config",
      "opencode",
      "plugins",
      `viberacing-${installation.id}.js`,
    );
    const recovery = `${canonical}.quarantine-${randomUUID()}`;
    const nestedRecovery = `${recovery}.quarantine-${randomUUID()}`;
    const stage = `${canonical}.${process.pid}.${randomUUID()}.stage`;
    const probe = `${stage}.probe-${randomUUID()}`;
    const stagedRecovery = `${stage}.quarantine-${randomUUID()}`;
    await assert.rejects(
      module.rememberOpenCodePluginPath(installation.id, recovery),
      /Invalid OpenCode plugin path/,
    );
    assert.equal(await module.rememberOpenCodePluginCleanup(installation.id, recovery), true);
    assert.equal(await module.rememberOpenCodePluginCleanup(installation.id, nestedRecovery), true);
    assert.equal(await module.rememberOpenCodePluginCleanup(installation.id, stage), true);
    assert.equal(await module.rememberOpenCodePluginCleanup(installation.id, probe), true);
    assert.equal(await module.rememberOpenCodePluginCleanup(installation.id, stagedRecovery), true);
    await assert.rejects(
      module.rememberOpenCodePluginCleanup(installation.id, `${canonical}.quarantine-not-a-uuid`),
      /cleanup metadata is invalid/,
    );
    await assert.rejects(
      module.rememberOpenCodePluginCleanup(installation.id, `${stage}.probe-not-a-uuid`),
      /cleanup metadata is invalid/,
    );
    await assert.rejects(
      module.rememberOpenCodePluginCleanup(
        installation.id,
        `${canonical}.not-a-pid.${randomUUID()}.stage`,
      ),
      /cleanup metadata is invalid/,
    );
    assert.deepEqual(await module.readOpenCodePluginCleanups(), [
      { installationId: installation.id, openCodePluginPath: recovery },
      { installationId: installation.id, openCodePluginPath: nestedRecovery },
      { installationId: installation.id, openCodePluginPath: stage },
      { installationId: installation.id, openCodePluginPath: probe },
      { installationId: installation.id, openCodePluginPath: stagedRecovery },
    ]);
  } finally {
    restoreEnvironment();
    await rm(home, { recursive: true, force: true });
  }
});

test("an interrupted atomic config commit preserves the prior device token", async () => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-config-atomic-"));
  const restoreEnvironment = useModuleEnvironment(home);
  try {
    const module = await import(`../lib/config.mjs?atomic-config=${encodeURIComponent(home)}`);
    const previous = {
      version: 2,
      origin: "https://example.test",
      installationId: "91919191-9191-4191-8191-919191919191",
      deviceToken: "previous_device_token_that_is_long_enough_12",
      sources: [],
    };
    await module.writeConfig(previous);
    const before = await readFile(join(home, ".viberacing", "config.json"));
    await assert.rejects(
      module.writeConfig(
        {
          ...previous,
          deviceToken: "replacement_device_token_that_is_long_enough",
        },
        {
          beforeRename() {
            throw new Error("synthetic interruption before config rename");
          },
        },
      ),
      /synthetic interruption/,
    );
    assert.deepEqual(await readFile(join(home, ".viberacing", "config.json")), before);
    assert.deepEqual(
      (await readdir(join(home, ".viberacing"))).filter((name) => name.endsWith(".tmp")),
      [],
    );
  } finally {
    restoreEnvironment();
    await rm(home, { recursive: true, force: true });
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

test("migrates only legacy auto-generated OpenCode labels", async () => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-opencode-label-migration-"));
  const restoreEnvironment = useModuleEnvironment(home);
  try {
    const module = await import(`../lib/config.mjs?opencode-labels=${encodeURIComponent(home)}`);
    const legacyPath = join(home, "opencode-custom-channel.db");
    const customPath = join(home, "opencode-personal.db");
    await module.writeSources([
      {
        clientSourceId: "51515151-5151-4151-8151-515151515151",
        agentId: "opencode",
        collectionMethod: "opencode_sqlite",
        dataPath: legacyPath,
        suggestedLabel: "OpenCode custom-channel",
        supportedSurface: "cli",
      },
      {
        clientSourceId: "52525252-5252-4252-8252-525252525252",
        agentId: "opencode",
        collectionMethod: "opencode_sqlite",
        dataPath: customPath,
        suggestedLabel: "My private profile",
        supportedSurface: "cli",
      },
    ]);

    const reconciled = await module.reconcileDetectedSources([
      {
        agentId: "opencode",
        collectionMethod: "opencode_sqlite",
        dataPath: legacyPath,
        suggestedLabel: "OpenCode profile 2",
        legacyAutoSuggestedLabel: "OpenCode custom-channel",
        supportedSurface: "cli",
      },
      {
        agentId: "opencode",
        collectionMethod: "opencode_sqlite",
        dataPath: customPath,
        suggestedLabel: "OpenCode profile 3",
        legacyAutoSuggestedLabel: "OpenCode personal",
        supportedSurface: "cli",
      },
    ]);

    assert.equal(reconciled[0].suggestedLabel, "OpenCode profile 2");
    assert.equal(reconciled[1].suggestedLabel, "My private profile");
    assert.deepEqual(
      (await module.readSources()).map((source) => source.suggestedLabel),
      ["OpenCode profile 2", "My private profile"],
    );
  } finally {
    restoreEnvironment();
    await rm(home, { recursive: true, force: true });
  }
});

test("deduplicates a configured token root through its symlink without changing display path", async () => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-symlink-source-"));
  const restoreEnvironment = useModuleEnvironment(home);
  try {
    const module = await import(`../lib/config.mjs?symlink-source=${encodeURIComponent(home)}`);
    const root = join(home, "usage-root");
    const alias = join(home, "usage-alias");
    await mkdir(root);
    await symlink(root, alias, process.platform === "win32" ? "junction" : "dir");
    const direct = await module.addSource({
      agentId: "claude_code",
      collectionMethod: "claude_jsonl",
      dataPath: root,
      suggestedLabel: "Claude",
      supportedSurface: "cli",
    });
    const duplicate = await module.addSource({
      agentId: "claude_code",
      collectionMethod: "claude_jsonl",
      dataPath: alias,
      suggestedLabel: "Claude alias",
      supportedSurface: "cli",
    });
    assert.equal(direct.added, true);
    assert.equal(duplicate.added, false);
    assert.equal(duplicate.source.clientSourceId, direct.source.clientSourceId);
    assert.equal((await module.readSources())[0].dataPath, root);
  } finally {
    restoreEnvironment();
  }
});

test("prefers the current Kimi root and removes the auto-added default legacy root", async () => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-kimi-preference-"));
  const restoreEnvironment = useModuleEnvironment(home);
  try {
    const module = await import(`../lib/config.mjs?kimi-preference=${encodeURIComponent(home)}`);
    await module.writeSources([
      {
        clientSourceId: "81818181-8181-4181-8181-818181818181",
        agentId: "kimi_code",
        collectionMethod: "kimi_wire_jsonl",
        dataPath: join(home, ".kimi", "sessions"),
        suggestedLabel: "Kimi Code",
        supportedSurface: "cli",
      },
      {
        clientSourceId: "82828282-8282-4282-8282-828282828282",
        agentId: "kimi_code",
        collectionMethod: "kimi_legacy_wire_jsonl",
        dataPath: join(home, "archived-kimi", "sessions"),
        suggestedLabel: "Kimi archive",
        supportedSurface: "cli",
      },
    ]);
    const detected = [
      {
        agentId: "kimi_code",
        collectionMethod: "kimi_wire_jsonl",
        dataPath: join(home, ".kimi-code", "sessions"),
        suggestedLabel: "Kimi Code",
        supportedSurface: "cli",
        supersedesDataPaths: [join(home, ".kimi", "sessions")],
      },
    ];
    const preview = await module.reconcileDetectedSources(detected, { persist: false });
    assert.deepEqual(
      preview.map((source) => source.dataPath).sort(),
      [join(home, ".kimi-code", "sessions"), join(home, "archived-kimi", "sessions")].sort(),
    );
    assert.deepEqual(
      (await module.readSources()).map((source) => source.dataPath).sort(),
      [join(home, ".kimi", "sessions"), join(home, "archived-kimi", "sessions")].sort(),
    );
    const sources = await module.reconcileDetectedSources(detected);
    assert.deepEqual(
      sources.map((source) => source.dataPath).sort(),
      [join(home, ".kimi-code", "sessions"), join(home, "archived-kimi", "sessions")].sort(),
    );
  } finally {
    restoreEnvironment();
  }
});

test("persists a resolved portable executable only in local source metadata", async () => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-portable-executable-"));
  const restoreEnvironment = useModuleEnvironment(home);
  try {
    const module = await import(
      `../lib/config.mjs?portable-executable=${encodeURIComponent(home)}`
    );
    const clientSourceId = "83838383-8383-4383-8383-838383838383";
    await module.writeSources([
      {
        clientSourceId,
        agentId: "codex",
        collectionMethod: "codex_app_server",
        dataPath: join(home, ".codex"),
        suggestedLabel: "Codex",
        supportedSurface: "desktop",
      },
    ]);
    const portable = join(home, "portable", "codex");
    assert.equal(await module.rememberSourceExecutable(clientSourceId, portable), true);
    assert.equal((await module.readSources())[0].executablePath, portable);
    await module.writeConfig({
      version: 2,
      origin: "https://example.test",
      sources: [
        {
          clientSourceId,
          sourceId: "84848484-8484-4484-8484-848484848484",
          agentAccountId: "85858585-8585-4585-8585-858585858585",
          agentId: "codex",
          accountLabel: "Codex",
          collectionMethod: "codex_app_server",
        },
      ],
    });
    assert.doesNotMatch(
      await readFile(join(home, ".viberacing", "config.json"), "utf8"),
      /portable/,
    );
    assert.equal((await module.readConfig()).sources[0].executablePath, portable);
  } finally {
    restoreEnvironment();
  }
});

test("refreshes the executable path of an existing detected source", async () => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-existing-executable-"));
  const restoreEnvironment = useModuleEnvironment(home);
  try {
    const module = await import(
      `../lib/config.mjs?existing-executable=${encodeURIComponent(home)}`
    );
    const clientSourceId = "86868686-8686-4686-8686-868686868686";
    const dataPath = join(home, ".codex");
    await module.writeSources([
      {
        clientSourceId,
        agentId: "codex",
        collectionMethod: "codex_app_server",
        dataPath,
        suggestedLabel: "Codex",
        supportedSurface: "desktop",
      },
    ]);
    const executablePath = join(home, "portable", "codex");
    const sources = await module.reconcileDetectedSources([
      {
        agentId: "codex",
        collectionMethod: "codex_app_server",
        dataPath,
        executablePath,
        suggestedLabel: "Codex",
        supportedSurface: "desktop",
      },
    ]);
    assert.equal(sources[0].clientSourceId, clientSourceId);
    assert.equal(sources[0].executablePath, executablePath);
    assert.equal((await module.readSources())[0].executablePath, executablePath);
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
    assert.deepEqual(
      runtime.mergePendingPayloads([
        {
          protocolVersion: 4,
          snapshots: [],
          sourceErrors: [
            {
              sourceId: errorSourceId,
              code: "collector_failed",
              observedAfterSequence: "5",
            },
          ],
        },
      ]).sourceErrors,
      [{ sourceId: errorSourceId, code: "collector_failed", observedAfterSequence: "5" }],
    );
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

test("manual sync reports a busy lock after a bounded wait", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-manual-sync-busy-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const installation = await writeCaptureInstallation(home, "http://127.0.0.1:1");
  await writeFile(join(installation.directory, "sync.lock"), "synthetic-owner\n");

  const startedAt = Date.now();
  await assert.rejects(
    execFileAsync(process.execPath, [connectorPath, "sync"], {
      env: connectorEnvironment(home, {
        NODE_ENV: "test",
        VIBERACING_TEST_MANUAL_SYNC_LOCK_WAIT_MS: "100",
      }),
    }),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Another sync is already running\./);
      return true;
    },
  );
  assert.ok(Date.now() - startedAt >= 80);
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
    assert.equal(await runtime.ownsScheduler(firstScheduler), true);
    assert.equal(await runtime.releaseScheduler(firstScheduler), true);
    const { stateDirectory } = await import("../lib/config.mjs");
    const staleLock = join(stateDirectory, "scheduler.lock");
    const staleOwner = "stale-owner";
    await writeFile(staleLock, `99999999:${staleOwner}\n`);
    const staleTime = new Date(Date.now() - 11 * 60_000);
    await utimes(staleLock, staleTime, staleTime);
    const replacementScheduler = await runtime.claimScheduler();
    assert.equal(typeof replacementScheduler.ownershipToken, "string");
    assert.equal(
      await runtime.releaseScheduler({ ...replacementScheduler, owner: staleOwner }),
      false,
    );
    assert.equal(await runtime.ownsScheduler(replacementScheduler), true);
    await runtime.releaseScheduler(replacementScheduler);
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

test("bulk OpenCode hook dirties every active mapped source once and stale events are inert", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-opencode-bulk-hook-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const directory = join(home, ".viberacing");
  const installationId = "10101010-1010-4010-8010-101010101010";
  const firstClientSourceId = "11111111-1010-4010-8010-101010101010";
  const secondClientSourceId = "12121212-1010-4010-8010-101010101010";
  const claudeClientSourceId = "13131313-1010-4010-8010-101010101010";
  const unmappedClientSourceId = "14141414-1010-4010-8010-101010101010";
  const firstSourceId = "15151515-1010-4010-8010-101010101010";
  const secondSourceId = "16161616-1010-4010-8010-101010101010";
  const claudeSourceId = "17171717-1010-4010-8010-101010101010";
  const localSources = [
    {
      clientSourceId: firstClientSourceId,
      agentId: "opencode",
      collectionMethod: "opencode_sqlite",
      dataPath: join(home, "opencode.db"),
      suggestedLabel: "OpenCode",
      supportedSurface: "cli",
    },
    {
      clientSourceId: secondClientSourceId,
      agentId: "opencode",
      collectionMethod: "opencode_sqlite",
      dataPath: join(home, "opencode-dev.db"),
      suggestedLabel: "OpenCode dev",
      supportedSurface: "cli",
    },
    {
      clientSourceId: claudeClientSourceId,
      agentId: "claude_code",
      collectionMethod: "claude_jsonl",
      dataPath: join(home, ".claude"),
      suggestedLabel: "Claude",
      supportedSurface: "cli",
    },
    {
      clientSourceId: unmappedClientSourceId,
      agentId: "opencode",
      collectionMethod: "opencode_sqlite",
      dataPath: join(home, "opencode-local.db"),
      suggestedLabel: "OpenCode local",
      supportedSurface: "cli",
    },
  ];
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, ".viberacing-state"), '{"format":1}\n');
  await writeFile(
    join(directory, "installation.json"),
    `${JSON.stringify({
      version: 1,
      id: installationId,
      secret: "bulk_hook_installation_secret_that_is_long_enough",
    })}\n`,
  );
  await writeFile(
    join(directory, "sources.json"),
    `${JSON.stringify({ version: 2, sources: localSources })}\n`,
  );
  const mappings = [
    [firstClientSourceId, firstSourceId, "opencode", "opencode_sqlite"],
    [secondClientSourceId, secondSourceId, "opencode", "opencode_sqlite"],
    [claudeClientSourceId, claudeSourceId, "claude_code", "claude_jsonl"],
  ].map(([clientSourceId, sourceId, agentId, collectionMethod]) => ({
    clientSourceId,
    sourceId,
    agentId,
    collectionMethod,
    accountLabel: agentId,
    lastAcceptedSyncSequence: "0",
  }));
  await writeFile(
    join(directory, "config.json"),
    `${JSON.stringify({
      version: 2,
      origin: "http://127.0.0.1:9",
      installationId,
      deviceToken: "bulk_hook_device_token_that_is_long_enough",
      sources: mappings,
    })}\n`,
  );
  await writeFile(
    join(directory, "state.json"),
    `${JSON.stringify({
      version: 2,
      sequences: { [firstSourceId]: "0", [secondSourceId]: "0", [claudeSourceId]: "0" },
    })}\n`,
  );
  const oldTimestamp = "2026-08-20T00:00:00.000Z";
  const firstGeneration = randomUUID();
  const claudeGeneration = randomUUID();
  await writeFile(
    join(directory, "dirty.json"),
    `${JSON.stringify({
      version: 2,
      sources: {
        [firstClientSourceId]: {
          dirtySince: oldTimestamp,
          lastEventAt: oldTimestamp,
          generation: firstGeneration,
        },
        [claudeClientSourceId]: {
          dirtySince: oldTimestamp,
          lastEventAt: oldTimestamp,
          generation: claudeGeneration,
        },
      },
    })}\n`,
  );
  await writeFile(join(directory, "scheduler-launch.lock"), `${process.pid}:${randomUUID()}\n`);
  const trace = join(home, "scheduler-trace.log");
  const environment = connectorEnvironment(home, {
    NODE_ENV: "test",
    VIBERACING_TEST_SCHEDULER_TRACE: trace,
  });
  const command = [
    "hook",
    "--agent",
    "opencode",
    "--all-sources",
    "--installation",
    installationId,
  ];
  const result = await runWithInput(command, environment, "");
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  const dirty = JSON.parse(await readFile(join(directory, "dirty.json"), "utf8"));
  assert.equal(dirty.sources[firstClientSourceId].dirtySince, oldTimestamp);
  assert.notEqual(dirty.sources[firstClientSourceId].generation, firstGeneration);
  assert.equal(
    dirty.sources[firstClientSourceId].lastEventAt,
    dirty.sources[secondClientSourceId].lastEventAt,
  );
  assert.equal(
    dirty.sources[secondClientSourceId].dirtySince,
    dirty.sources[secondClientSourceId].lastEventAt,
  );
  assert.deepEqual(dirty.sources[claudeClientSourceId], {
    dirtySince: oldTimestamp,
    lastEventAt: oldTimestamp,
    generation: claudeGeneration,
  });
  assert.equal(dirty.sources[unmappedClientSourceId], undefined);
  assert.deepEqual((await readFile(trace, "utf8")).trim().split("\n"), [
    `hook-launch-busy:${result.pid}`,
  ]);

  const beforeMismatch = await readFile(join(directory, "dirty.json"));
  await runWithInput(
    [...command.slice(0, -1), "18181818-1010-4010-8010-101010101010"],
    environment,
    "",
  );
  assert.deepEqual(await readFile(join(directory, "dirty.json")), beforeMismatch);
  await runWithInput([...command, "--source", firstClientSourceId], environment, "");
  assert.deepEqual(await readFile(join(directory, "dirty.json")), beforeMismatch);

  await rm(directory, { recursive: true, force: true });
  await runWithInput(command, environment, "");
  await assert.rejects(access(directory), { code: "ENOENT" });
});

test("pre-connect source removal cleans an owned stale OpenCode plugin", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-opencode-preconnect-remove-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const environment = connectorEnvironment(home, { HOME: home, USERPROFILE: home });
  const directory = environment.VIBERACING_STATE_DIR;
  const installationId = "19191919-1010-4010-8010-101010101010";
  const clientSourceId = "20202020-1010-4010-8010-101010101010";
  const source = {
    clientSourceId,
    agentId: "opencode",
    collectionMethod: "opencode_sqlite",
    dataPath: join(home, "opencode.db"),
    suggestedLabel: "OpenCode",
    supportedSurface: "cli",
  };
  await writeLocalSources(directory, [source]);
  await writeFile(
    join(directory, "installation.json"),
    `${JSON.stringify({
      version: 1,
      id: installationId,
      secret: "preconnect_installation_secret_that_is_long_enough",
    })}\n`,
  );
  const pluginOptions = {
    installationId,
    stateRoot: directory,
    environment,
    homeDirectory: home,
  };
  assert.equal(
    (await reconcileOpenCodePlugin({ ...pluginOptions, desired: true })).action,
    "created",
  );
  const pluginPath = openCodePluginLocation(pluginOptions).path;
  await access(pluginPath);

  const removed = await runWithInput(["source", "remove", clientSourceId], environment, "");
  assert.equal(removed.code, 0);
  assert.match(removed.stdout, /removed locally/);
  assert.equal((await inspectOpenCodePlugin(pluginOptions)).status, "missing");
  await assert.rejects(access(pluginPath), { code: "ENOENT" });
});

test("disconnect cleans the recorded OpenCode plugin after XDG_CONFIG_HOME changes", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-opencode-recorded-cleanup-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const installedEnvironment = connectorEnvironment(home, {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, "config-a"),
  });
  const teardownEnvironment = {
    ...installedEnvironment,
    XDG_CONFIG_HOME: join(home, "config-b"),
  };
  const directory = installedEnvironment.VIBERACING_STATE_DIR;
  const installationId = "21212121-1010-4010-8010-101010101010";
  const clientSourceId = "22222222-1010-4010-8010-101010101010";
  const sourceId = "23232323-1010-4010-8010-101010101010";
  const local = {
    clientSourceId,
    agentId: "opencode",
    collectionMethod: "opencode_sqlite",
    dataPath: join(home, "opencode.db"),
    suggestedLabel: "OpenCode",
    supportedSurface: "cli",
  };
  const pluginOptions = {
    installationId,
    stateRoot: directory,
    environment: installedEnvironment,
    homeDirectory: home,
  };
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, ".viberacing-state"), '{"format":1}\n');
  await writeFile(
    join(directory, "sources.json"),
    `${JSON.stringify({ version: 2, sources: [local] })}\n`,
  );
  const installed = await reconcileOpenCodePlugin({ ...pluginOptions, desired: true });
  const pluginPath = installed.path;
  await writeFile(
    join(directory, "installation.json"),
    `${JSON.stringify({
      version: 1,
      id: installationId,
      secret: "recorded_cleanup_installation_secret_that_is_long_enough",
      openCodePluginPath: pluginPath,
    })}\n`,
  );
  await writeFile(
    join(directory, "config.json"),
    `${JSON.stringify({
      version: 2,
      origin: "http://127.0.0.1:9",
      installationId,
      deviceToken: "recorded_cleanup_device_token_that_is_long_enough",
      sources: [
        {
          clientSourceId,
          sourceId,
          agentId: "opencode",
          accountLabel: "OpenCode",
          collectionMethod: "opencode_sqlite",
          lastAcceptedSyncSequence: "0",
        },
      ],
    })}\n`,
  );
  await writeFile(
    join(directory, "state.json"),
    `${JSON.stringify({ version: 2, sequences: { [sourceId]: "0" } })}\n`,
  );

  const result = await runWithInput(["disconnect"], teardownEnvironment, "");
  assert.equal(result.code, 0, result.stderr);
  assert.equal((await inspectOpenCodePlugin({ ...pluginOptions, pluginPath })).status, "missing");
  await assert.rejects(access(pluginPath), { code: "ENOENT" });
  await assert.rejects(
    access(
      openCodePluginLocation({
        installationId,
        environment: teardownEnvironment,
        homeDirectory: home,
      }).path,
    ),
    { code: "ENOENT" },
  );
});

test("doctor reports a blocked stale plugin instead of not-needed", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-opencode-blocked-diagnostic-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const environment = connectorEnvironment(home, {
    HOME: home,
    USERPROFILE: home,
    NODE_ENV: "test",
  });
  const directory = environment.VIBERACING_STATE_DIR;
  const installationId = "24242424-1010-4010-8010-101010101010";
  const pluginPath = openCodePluginLocation({
    installationId,
    environment,
    homeDirectory: home,
  }).path;
  await mkdir(directory, { recursive: true });
  await mkdir(dirname(pluginPath), { recursive: true });
  await writeFile(join(directory, ".viberacing-state"), '{"format":1}\n');
  await writeFile(
    join(directory, "installation.json"),
    `${JSON.stringify({
      version: 1,
      id: installationId,
      secret: "blocked_diagnostic_installation_secret_that_is_long_enough",
      openCodePluginPath: pluginPath,
    })}\n`,
  );
  await writeFile(join(directory, "sources.json"), '{"version":2,"sources":[]}\n');
  await writeFile(
    join(directory, "config.json"),
    `${JSON.stringify({
      version: 2,
      origin: "http://127.0.0.1:9",
      installationId,
      deviceToken: "blocked_diagnostic_device_token_that_is_long_enough",
      sources: [],
    })}\n`,
  );
  await writeFile(join(directory, "state.json"), '{"version":2,"sequences":{}}\n');
  await writeFile(pluginPath, "export const ForeignPlugin = true;\n", { mode: 0o600 });
  await ensureOwnerOnlyWindowsFile(pluginPath);

  const result = await runWithInput(["doctor", "--repair"], environment, "");
  assert.equal(result.code, 1);
  assert.match(result.stdout, /OpenCode automatic sync plugin: conflict/);
  assert.doesNotMatch(result.stdout, /OpenCode automatic sync plugin: not-needed/);
  assert.match(result.stderr, /plugin repair is required/);
  assert.equal(await readFile(pluginPath, "utf8"), "export const ForeignPlugin = true;\n");
});

test("teardown removes the owned OpenCode plugin and stale idle hooks cannot resurrect state", async (context) => {
  for (const command of ["disconnect", "reset-installation", "uninstall"]) {
    const home = await mkdtemp(join(tmpdir(), `viberacing-opencode-${command}-`));
    context.after(() => rm(home, { recursive: true, force: true }));
    const environment = connectorEnvironment(home, {
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(home, "config-a"),
    });
    const teardownEnvironment = { ...environment, XDG_CONFIG_HOME: join(home, "config-b") };
    const directory = environment.VIBERACING_STATE_DIR;
    const installationId = randomUUID();
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, ".viberacing-state"), '{"format":1}\n');
    await writeFile(
      join(directory, "installation.json"),
      `${JSON.stringify({
        version: 1,
        id: installationId,
        secret: "teardown_installation_secret_that_is_long_enough",
      })}\n`,
    );
    const pluginOptions = {
      installationId,
      stateRoot: directory,
      environment,
      homeDirectory: home,
    };
    await reconcileOpenCodePlugin({ ...pluginOptions, desired: true });
    const pluginPath = openCodePluginLocation(pluginOptions).path;
    await access(pluginPath);
    await writeFile(
      join(directory, "installation.json"),
      `${JSON.stringify({
        version: 1,
        id: installationId,
        secret: "teardown_installation_secret_that_is_long_enough",
        openCodePluginPath: pluginPath,
      })}\n`,
    );

    const result = await runWithInput([command], teardownEnvironment, "");
    assert.equal(result.code, 0, result.stderr);
    assert.equal((await inspectOpenCodePlugin({ ...pluginOptions, pluginPath })).status, "missing");
    await assert.rejects(access(pluginPath), { code: "ENOENT" });
    await assert.rejects(
      access(
        openCodePluginLocation({
          ...pluginOptions,
          environment: teardownEnvironment,
        }).path,
      ),
      { code: "ENOENT" },
    );
    const before =
      command === "uninstall"
        ? null
        : await snapshotStateTree(directory).catch((error) =>
            error?.code === "ENOENT" ? null : Promise.reject(error),
          );
    await runWithInput(
      ["hook", "--agent", "opencode", "--all-sources", "--installation", installationId],
      teardownEnvironment,
      "",
    );
    if (before === null) await assert.rejects(access(directory), { code: "ENOENT" });
    else assert.deepEqual(await snapshotStateTree(directory), before);
  }
});

test("uninstall, reset-installation, and disconnect clean recorded and current OpenCode plugins", async (context) => {
  for (const command of ["uninstall", "reset-installation", "disconnect"]) {
    const home = await mkdtemp(join(tmpdir(), `viberacing-opencode-two-target-${command}-`));
    context.after(() => rm(home, { recursive: true, force: true }));
    const installationId = randomUUID();
    const recordedEnvironment = connectorEnvironment(home, {
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(home, "config-a"),
    });
    const currentEnvironment = {
      ...recordedEnvironment,
      XDG_CONFIG_HOME: join(home, "config-b"),
    };
    const { directory } = await writeMappedOpenCodeInstallation(
      home,
      "http://127.0.0.1:1",
      installationId,
    );
    const recorded = await reconcileOpenCodePlugin({
      installationId,
      stateRoot: directory,
      environment: recordedEnvironment,
      homeDirectory: home,
      desired: true,
    });
    const current = await reconcileOpenCodePlugin({
      installationId,
      stateRoot: directory,
      environment: currentEnvironment,
      homeDirectory: home,
      desired: true,
    });
    assert.notEqual(recorded.path, current.path);
    await writeFile(
      join(directory, "installation.json"),
      `${JSON.stringify({
        version: 1,
        id: installationId,
        secret: "two_target_installation_secret_that_is_long_enough",
        openCodePluginPath: recorded.path,
      })}\n`,
      { mode: 0o600 },
    );

    const result = await runWithInput([command], currentEnvironment, "");
    assert.equal(result.code, 0, `${command}: ${result.stderr}`);
    await assert.rejects(access(recorded.path), { code: "ENOENT" });
    await assert.rejects(access(current.path), { code: "ENOENT" });
    await assert.rejects(access(join(directory, "installation.json")), { code: "ENOENT" });
  }
});

test("disconnect retains the current OpenCode cleanup coordinate without an installation identity", async (context) => {
  for (const variant of ["missing", "corrupt"]) {
    const home = await mkdtemp(join(tmpdir(), `viberacing-disconnect-${variant}-identity-`));
    context.after(() => rm(home, { recursive: true, force: true }));
    const installationId = randomUUID();
    const environment = connectorEnvironment(home, {
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(home, "current-config"),
    });
    const { directory } = await writeMappedOpenCodeInstallation(
      home,
      "http://127.0.0.1:1",
      installationId,
    );
    const installed = await reconcileOpenCodePlugin({
      installationId,
      stateRoot: directory,
      environment,
      homeDirectory: home,
      desired: true,
    });
    if (variant === "corrupt")
      await writeFile(join(directory, "installation.json"), "{not-json\n", { mode: 0o600 });

    const result = await runWithInput(["disconnect"], environment, "");
    assert.equal(result.code, 0, `${variant}: ${result.stderr}`);
    await assert.rejects(access(join(directory, "config.json")), { code: "ENOENT" });
    if (variant === "corrupt") await access(join(directory, "installation.json"));
    else await assert.rejects(access(join(directory, "installation.json")), { code: "ENOENT" });
    const cleanupPath = join(directory, "opencode-plugin-cleanup.json");
    const pluginStillExists = await access(installed.path).then(
      () => true,
      () => false,
    );
    if (pluginStillExists) {
      const cleanup = openCodeCleanupTargets(JSON.parse(await readFile(cleanupPath, "utf8")));
      assert.ok(
        cleanup.some(
          (target) =>
            target.installationId === installationId &&
            target.openCodePluginPath === installed.path,
        ),
      );
    } else if (variant === "corrupt")
      assert.deepEqual(openCodeCleanupTargets(JSON.parse(await readFile(cleanupPath, "utf8"))), [
        { installationId },
      ]);
    else await assert.rejects(access(cleanupPath), { code: "ENOENT" });
    const remainingState = JSON.stringify(
      await snapshotStateTree(directory).catch((error) =>
        error?.code === "ENOENT" ? {} : Promise.reject(error),
      ),
    );
    assert.equal(remainingState.includes("synthetic-device-token-that-is-long-enough"), false);
  }
});

test("a blocked relocation rollback retains its exact new OpenCode path for uninstall", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-opencode-blocked-relocation-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const installationId = randomUUID();
  const recordedEnvironment = connectorEnvironment(home, {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, "config-a"),
    NODE_ENV: "test",
  });
  const currentEnvironment = {
    ...recordedEnvironment,
    XDG_CONFIG_HOME: join(home, "config-b"),
    VIBERACING_TEST_FAIL_OPENCODE_PLUGIN_PATH_COMMIT: "1",
    VIBERACING_TEST_BLOCK_OPENCODE_PLUGIN_ROLLBACK: "1",
  };
  const { directory, source } = await writeMappedOpenCodeInstallation(
    home,
    "http://127.0.0.1:1",
    installationId,
  );
  await mkdir(dirname(source.dataPath), { recursive: true });
  const database = new DatabaseSync(source.dataPath);
  database.exec("CREATE TABLE message (id TEXT, time_created INTEGER, data TEXT)");
  database.close();
  const recorded = await reconcileOpenCodePlugin({
    installationId,
    stateRoot: directory,
    environment: recordedEnvironment,
    homeDirectory: home,
    desired: true,
  });
  await writeFile(
    join(directory, "installation.json"),
    `${JSON.stringify({
      version: 1,
      id: installationId,
      secret: "blocked_rollback_installation_secret_that_is_long_enough",
      openCodePluginPath: recorded.path,
    })}\n`,
    { mode: 0o600 },
  );
  const currentPath = openCodePluginLocation({
    installationId,
    environment: currentEnvironment,
    homeDirectory: home,
  }).path;
  const foreignPath = join(dirname(currentPath), "keep-foreign.js");
  const foreignContents = "export const KeepForeign = true;\n";
  await mkdir(dirname(foreignPath), { recursive: true });
  await writeFile(foreignPath, foreignContents, { mode: 0o600 });

  const failed = await runWithInput(["doctor", "--repair"], currentEnvironment, "");
  assert.equal(failed.code, 1);
  assert.match(failed.stdout, /OpenCode automatic sync plugin: unreadable/, failed.stderr);
  assert.match(failed.stderr, new RegExp(currentPath.replaceAll("\\", "\\\\")));
  await access(currentPath);
  await access(recorded.path);
  assert.equal(await readFile(foreignPath, "utf8"), foreignContents);
  const retained = openCodeCleanupTargets(
    JSON.parse(await readFile(join(directory, "opencode-plugin-cleanup.json"), "utf8")),
  );
  assert.ok(
    retained.some(
      (target) =>
        target.installationId === installationId && target.openCodePluginPath === currentPath,
    ),
  );

  const uninstallEnvironment = { ...currentEnvironment };
  delete uninstallEnvironment.VIBERACING_TEST_FAIL_OPENCODE_PLUGIN_PATH_COMMIT;
  delete uninstallEnvironment.VIBERACING_TEST_BLOCK_OPENCODE_PLUGIN_ROLLBACK;
  const uninstalled = await runWithInput(["uninstall"], uninstallEnvironment, "");
  assert.equal(uninstalled.code, 0, uninstalled.stderr);
  await assert.rejects(access(currentPath), { code: "ENOENT" });
  await assert.rejects(access(recorded.path), { code: "ENOENT" });
  assert.equal(await readFile(foreignPath, "utf8"), foreignContents);
});

test("connect stays committed and inactive when plugin path recording and rollback fail", async (context) => {
  let pairingBody;
  const sourceId = randomUUID();
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
      response.setHeader("content-type", "application/json");
      if (request.url === "/api/pairing/start") {
        pairingBody = body;
        response.writeHead(201);
        response.end(
          JSON.stringify({
            installationId: body.installationId,
            code: "ABCDEFGH",
            pollToken: "blocked_rollback_poll_token_that_is_long_enough",
            verificationUrl: `http://${request.headers.host}/connect?code=ABCDEFGH`,
            expiresInSeconds: 30,
          }),
        );
        return;
      }
      const mapping = {
        clientSourceId: pairingBody.sources[0].clientSourceId,
        sourceId,
        agentAccountId: randomUUID(),
        agentId: "opencode",
        accountLabel: "OpenCode",
        collectionMethod: "opencode_sqlite",
        lastAcceptedSyncSequence: "0",
        historyBackfillYear: new Date().getUTCFullYear(),
        historyBackfillStatus: "complete",
      };
      if (request.url === "/api/pairing/poll") {
        response.end(
          JSON.stringify({
            status: "active",
            deviceToken: "blocked_rollback_device_token_that_is_long_enough",
            protocol: {
              version: connectorProtocolVersion,
              snapshotDays: 31,
              maximumSources: 32,
              maximumEntries: 1_024,
            },
            sources: [mapping],
          }),
        );
        return;
      }
      if (request.url === "/api/installations/current" && request.method === "DELETE") {
        response.writeHead(204);
        response.end();
        return;
      }
      if (request.url === "/api/installations/current") {
        response.end(JSON.stringify(reconciliationResponse([mapping])));
        return;
      }
      response.end(JSON.stringify(usageResponse(body)));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-connect-blocked-plugin-rollback-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const directory = join(home, ".viberacing");
  const dataRoot = join(home, ".local", "share", "opencode");
  const databasePath = join(dataRoot, "opencode.db");
  await mkdir(dataRoot, { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("CREATE TABLE message (id TEXT, time_created INTEGER, data TEXT)");
  database.close();
  await mkdir(directory, { recursive: true });
  await writeLocalSources(directory, [
    {
      clientSourceId: randomUUID(),
      agentId: "opencode",
      dataPath: databasePath,
      collectionMethod: "opencode_sqlite",
      supportedSurface: "cli",
      suggestedLabel: "OpenCode",
    },
  ]);
  const environment = connectorEnvironment(home, {
    HOME: home,
    USERPROFILE: home,
    NODE_ENV: "test",
    PATH: "",
    XDG_CONFIG_HOME: join(home, "current-config"),
    VIBERACING_TEST_PAIRING_POLL_INTERVAL_MS: "10",
    VIBERACING_TEST_FAIL_OPENCODE_PLUGIN_PATH_COMMIT: "1",
    VIBERACING_TEST_BLOCK_OPENCODE_PLUGIN_ROLLBACK: "1",
  });

  const connected = await runWithInput(
    ["connect", "--origin", `http://127.0.0.1:${address.port}`],
    environment,
    "",
  );
  assert.equal(connected.code, 0, connected.stderr);
  assert.match(connected.stdout, /Connected/);
  assert.doesNotMatch(connected.stdout, /Automatic exact aggregate sync is active/);
  const config = JSON.parse(await readFile(join(directory, "config.json"), "utf8"));
  assert.equal(config.installationId, pairingBody.installationId);
  const pluginPath = openCodePluginLocation({
    installationId: config.installationId,
    environment,
    homeDirectory: home,
  }).path;
  assert.match(connected.stderr, new RegExp(pluginPath.replaceAll("\\", "\\\\")));
  await access(pluginPath);
  const foreignPath = join(dirname(pluginPath), "keep-foreign.js");
  const foreignContents = "export const KeepForeign = true;\n";
  await writeFile(foreignPath, foreignContents, { mode: 0o600 });
  const cleanup = openCodeCleanupTargets(
    JSON.parse(await readFile(join(directory, "opencode-plugin-cleanup.json"), "utf8")),
  );
  assert.ok(
    cleanup.some(
      (target) =>
        target.installationId === config.installationId && target.openCodePluginPath === pluginPath,
    ),
  );

  const uninstallEnvironment = { ...environment };
  delete uninstallEnvironment.VIBERACING_TEST_FAIL_OPENCODE_PLUGIN_PATH_COMMIT;
  delete uninstallEnvironment.VIBERACING_TEST_BLOCK_OPENCODE_PLUGIN_ROLLBACK;
  const uninstalled = await runWithInput(["uninstall"], uninstallEnvironment, "");
  assert.equal(uninstalled.code, 0, uninstalled.stderr);
  await assert.rejects(access(pluginPath), { code: "ENOENT" });
  assert.equal(await readFile(foreignPath, "utf8"), foreignContents);
});

test("stable launcher forces its custom state root before importing the versioned runtime", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-custom-launcher-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const customState = join(home, "custom state 雪");
  const defaultState = join(home, ".viberacing");
  await mkdir(defaultState, { recursive: true });
  await writeFile(join(defaultState, "sentinel.bin"), Buffer.from([0, 1, 2, 255]));
  const defaultBefore = await snapshotStateTree(defaultState);
  const environment = connectorEnvironment(home, {
    HOME: home,
    USERPROFILE: home,
    VIBERACING_STATE_DIR: customState,
    NODE_ENV: "test",
  });
  const configUrl = pathToFileURL(
    fileURLToPath(new URL("../lib/config.mjs", import.meta.url)),
  ).href;
  await execFileAsync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `const config = await import(${JSON.stringify(configUrl)}); await config.prepareRuntime(new URL(${JSON.stringify(pathToFileURL(connectorPath).href)}));`,
    ],
    { env: environment },
  );
  const installationId = "20202020-2020-4020-8020-202020202020";
  const clientSourceId = "21212121-2020-4020-8020-202020202020";
  const sourceId = "22222222-2020-4020-8020-202020202020";
  const local = {
    clientSourceId,
    agentId: "opencode",
    collectionMethod: "opencode_sqlite",
    dataPath: join(home, "opencode.db"),
    suggestedLabel: "OpenCode",
    supportedSurface: "cli",
  };
  await writeFile(
    join(customState, "installation.json"),
    `${JSON.stringify({
      version: 1,
      id: installationId,
      secret: "custom_launcher_installation_secret_that_is_long_enough",
    })}\n`,
  );
  await writeFile(
    join(customState, "sources.json"),
    `${JSON.stringify({ version: 2, sources: [local] })}\n`,
  );
  await writeFile(
    join(customState, "config.json"),
    `${JSON.stringify({
      version: 2,
      origin: "http://127.0.0.1:9",
      installationId,
      deviceToken: "custom_launcher_device_token_that_is_long_enough",
      sources: [
        {
          clientSourceId,
          sourceId,
          agentId: "opencode",
          collectionMethod: "opencode_sqlite",
          accountLabel: "OpenCode",
          lastAcceptedSyncSequence: "0",
        },
      ],
    })}\n`,
  );
  await writeFile(
    join(customState, "state.json"),
    `${JSON.stringify({ version: 2, sequences: { [sourceId]: "0" } })}\n`,
  );
  await writeFile(join(customState, "scheduler-launch.lock"), `${process.pid}:${randomUUID()}\n`);
  const launcher = join(customState, "bin", "viberacing-hook.mjs");
  const launched = await runWithInput(
    ["hook", "--agent", "opencode", "--all-sources", "--installation", installationId],
    {
      ...environment,
      VIBERACING_STATE_DIR: defaultState,
    },
    "",
    launcher,
  );
  assert.equal(launched.code, 0);
  assert.equal(launched.stdout, "");
  assert.equal(launched.stderr, "");
  const dirty = JSON.parse(await readFile(join(customState, "dirty.json"), "utf8"));
  assert.equal(typeof dirty.sources[clientSourceId].generation, "string");
  assert.deepEqual(await snapshotStateTree(defaultState), defaultBefore);
});

test("a provider hook that receives EOF after uninstall does not recreate state", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-late-hook-uninstall-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const clientSourceId = "91919191-9191-4191-8191-919191919191";
  const sourceId = "92929292-9292-4292-8292-929292929292";
  const claudeRoot = join(home, ".claude");
  const directory = await writeMappedInstallation(home, "http://127.0.0.1:9", [
    {
      clientSourceId,
      sourceId,
      agentId: "claude_code",
      collectionMethod: "claude_jsonl",
      dataPath: claudeRoot,
      hookConfigRoot: claudeRoot,
      suggestedLabel: "Claude",
      supportedSurface: "cli",
    },
  ]);
  const ready = join(home, "hook.ready");
  const environment = connectorEnvironment(home, {
    NODE_ENV: "test",
    VIBERACING_TEST_HOOK_READY: ready,
  });
  const hook = spawn(
    process.execPath,
    [connectorPath, "hook", "--source", clientSourceId, "--agent", "claude_code"],
    { env: environment, stdio: ["pipe", "pipe", "pipe"] },
  );
  context.after(() => hook.kill());
  let stdout = "";
  let stderr = "";
  hook.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
  hook.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
  await waitFor(() =>
    access(ready)
      .then(() => true)
      .catch(() => false),
  );

  const uninstall = await execFileAsync(process.execPath, [connectorPath, "uninstall"], {
    env: environment,
  });
  assert.match(uninstall.stdout, /local state removed/);
  await assert.rejects(access(directory), { code: "ENOENT" });

  hook.stdin.end('{"private":"must never be logged"}\n');
  const [code] = await once(hook, "close");
  assert.equal(code, 0);
  assert.equal(stdout, "");
  assert.equal(stderr, "");
  await assert.rejects(access(directory), { code: "ENOENT" });
  for (const name of [
    ".viberacing-state",
    "scheduler.lock",
    "scheduler-launch.lock",
    "lifecycle.lock",
    "lifecycle-revoking.lock",
    "connection-state.lock",
  ])
    await assert.rejects(access(join(directory, name)), { code: "ENOENT" }, name);
  assert.deepEqual(
    (await readdir(home)).filter((name) => /(?:\.recovery|\.stale\.)/i.test(name)),
    [],
  );
});

test("claiming the scheduler launch gate does not initialize missing state", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-missing-launch-state-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const directory = join(home, ".viberacing");
  const runtimeUrl = pathToFileURL(
    fileURLToPath(new URL("../lib/runtime.mjs", import.meta.url)),
  ).href;
  const result = await execFileAsync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { claimSchedulerLaunch } from ${JSON.stringify(runtimeUrl)}; process.stdout.write(String(await claimSchedulerLaunch({ waitMs: 0 })));`,
    ],
    { env: connectorEnvironment(home, { NODE_ENV: "test" }) },
  );
  assert.equal(result.stdout, "null");
  assert.equal(result.stderr, "");
  await assert.rejects(access(directory), { code: "ENOENT" });
});

test("the detached scheduler child owns its lock and later launchers exit", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-scheduler-owner-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const installation = await writeCaptureInstallation(home, "http://127.0.0.1:9");
  const trace = join(home, "scheduler-processes.log");
  const environment = connectorEnvironment(home, {
    NODE_ENV: "test",
    VIBERACING_TEST_AUTOMATIC_SYNC_TIMINGS: "5000,5000,5000",
    VIBERACING_TEST_SCHEDULER_TRACE: trace,
  });
  const hookArguments = ["hook", "--source", installation.clientSourceId, "--agent", "antigravity"];

  const firstHook = await runWithInput(hookArguments, environment, "{}");
  assert.equal(firstHook.code, 0);
  await waitFor(async () => (await readFile(trace, "utf8").catch(() => "")).includes("acquired:"));
  const firstOwner = await readFile(join(installation.directory, "scheduler.lock"), "utf8");
  const ownerPid = Number(firstOwner.split(":", 1)[0]);
  assert.notEqual(ownerPid, firstHook.pid);
  process.kill(ownerPid, 0);

  const secondHook = await runWithInput(hookArguments, environment, "{}");
  assert.equal(secondHook.code, 0);
  await waitFor(async () => (await readFile(trace, "utf8")).includes("lost:"));
  assert.equal(await readFile(join(installation.directory, "scheduler.lock"), "utf8"), firstOwner);
  const lostPid = Number(
    (await readFile(trace, "utf8"))
      .trim()
      .split("\n")
      .find((line) => line.startsWith("lost:"))
      .split(":", 2)[1],
  );
  await waitFor(() => {
    try {
      process.kill(lostPid, 0);
      return false;
    } catch (error) {
      return error?.code === "ESRCH";
    }
  });

  await execFileAsync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { clearAutomaticState } from ${JSON.stringify(pathToFileURL(fileURLToPath(new URL("../lib/runtime.mjs", import.meta.url))).href)}; await clearAutomaticState();`,
    ],
    { env: environment },
  );
  await assert.rejects(access(join(installation.directory, "scheduler.lock")));
  assert.match(await readFile(trace, "utf8"), new RegExp(`released:${ownerPid}`));
});

test("a hook retries bounded detached scheduler startup failures", async (context) => {
  const bodies = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      bodies.push(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(usageResponse(body)));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-scheduler-launch-retry-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const installation = await writeCaptureInstallation(home, `http://127.0.0.1:${address.port}`);
  const marker = join(home, "scheduler-exited-once");
  const trace = join(home, "scheduler-retry-trace.log");
  const environment = connectorEnvironment(home, {
    NODE_ENV: "test",
    VIBERACING_TEST_AUTOMATIC_SYNC_TIMINGS: "10,10,10",
    VIBERACING_TEST_SCHEDULER_EXIT_BEFORE_HANDSHAKE: marker,
    VIBERACING_TEST_SCHEDULER_EXIT_BEFORE_HANDSHAKE_COUNT: "2",
    VIBERACING_TEST_SCHEDULER_TRACE: trace,
  });

  const result = await runWithInput(
    ["hook", "--source", installation.clientSourceId, "--agent", "antigravity"],
    environment,
    "{}",
  );
  assert.equal(result.code, 0);
  await waitFor(() => bodies.length === 1, 10_000);
  await waitFor(async () => (await readFile(trace, "utf8")).includes("released:"), 10_000);

  const lines = (await readFile(trace, "utf8")).trim().split("\n");
  assert.equal(lines.filter((line) => line.startsWith("started:")).length, 3);
  assert.equal(lines.filter((line) => line.startsWith("launch-failed:")).length, 2);
  assert.equal(lines.filter((line) => line.startsWith("acquired:")).length, 1);
  assert.equal(lines.filter((line) => line.startsWith("released:")).length, 1);
  await access(`${marker}.1`);
  await access(`${marker}.2`);
  await assert.rejects(access(join(installation.directory, "dirty.json")));
});

test("a slow detached scheduler survives its parent handshake timeout", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-slow-scheduler-handshake-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const installation = await writeCaptureInstallation(home, "http://127.0.0.1:9");
  const barrier = join(home, "slow-scheduler-claim");
  const trace = join(home, "slow-scheduler-trace.log");
  const environment = connectorEnvironment(home, {
    NODE_ENV: "test",
    VIBERACING_TEST_AUTOMATIC_SYNC_TIMINGS: "10,10,10",
    VIBERACING_TEST_SCHEDULER_CLAIM_BARRIER: barrier,
    VIBERACING_TEST_SCHEDULER_HANDSHAKE_TIMEOUT_MS: "50",
    VIBERACING_TEST_SCHEDULER_TRACE: trace,
  });

  const hook = runWithInput(
    ["hook", "--source", installation.clientSourceId, "--agent", "antigravity"],
    environment,
    "{}",
  );
  await waitFor(() =>
    access(`${barrier}.ready`)
      .then(() => true)
      .catch(() => false),
  );
  const hookResult = await hook;
  assert.equal(hookResult.code, 0);
  assert.doesNotMatch(await readFile(trace, "utf8"), /acquired:/);

  await writeFile(`${barrier}.continue`, "continue\n");
  await waitFor(async () => (await readFile(trace, "utf8")).includes("acquired:"));
  await waitFor(async () => (await readFile(trace, "utf8")).includes("released:"), 10_000);
});

test("a slow detached scheduler cannot recreate state after uninstall", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-slow-scheduler-uninstall-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const installation = await writeCaptureInstallation(home, "http://127.0.0.1:9");
  const barrier = join(home, "slow-scheduler-uninstall-claim");
  const trace = join(home, "slow-scheduler-uninstall-trace.log");
  const environment = connectorEnvironment(home, {
    NODE_ENV: "test",
    VIBERACING_TEST_AUTOMATIC_SYNC_TIMINGS: "10,10,10",
    VIBERACING_TEST_SCHEDULER_CLAIM_BARRIER: barrier,
    VIBERACING_TEST_SCHEDULER_HANDSHAKE_TIMEOUT_MS: "50",
    VIBERACING_TEST_SCHEDULER_TRACE: trace,
  });

  const hook = runWithInput(
    ["hook", "--source", installation.clientSourceId, "--agent", "antigravity"],
    environment,
    "{}",
  );
  await waitFor(() =>
    access(`${barrier}.ready`)
      .then(() => true)
      .catch(() => false),
  );
  const hookResult = await hook;
  assert.equal(hookResult.code, 0);
  const schedulerPid = Number(
    (await readFile(trace, "utf8"))
      .trim()
      .split("\n")
      .find((line) => line.startsWith("started:"))
      .split(":", 2)[1],
  );

  const uninstall = await runWithInput(["uninstall"], environment, "");
  assert.equal(uninstall.code, 0);
  assert.match(uninstall.stdout, /local state removed/i);
  await assert.rejects(access(installation.directory), { code: "ENOENT" });

  await writeFile(`${barrier}.continue`, "continue\n");
  await waitFor(async () => (await readFile(trace, "utf8")).includes(`lost:${schedulerPid}`));
  await waitFor(() => {
    try {
      process.kill(schedulerPid, 0);
      return false;
    } catch (error) {
      return error?.code === "ESRCH";
    }
  });
  await delay(100);
  await assert.rejects(access(installation.directory), { code: "ENOENT" });
});

test("uninstall waits for a scheduler child paused before lock acquisition", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-uninstall-scheduler-launch-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const installation = await writeCaptureInstallation(home, "http://127.0.0.1:9");
  const barrier = join(home, "scheduler-claim");
  const environment = connectorEnvironment(home, {
    NODE_ENV: "test",
    VIBERACING_TEST_SCHEDULER_CLAIM_BARRIER: barrier,
    VIBERACING_TEST_AUTOMATIC_SYNC_TIMINGS: "5000,5000,5000",
  });
  const hook = spawn(
    process.execPath,
    [connectorPath, "hook", "--source", installation.clientSourceId, "--agent", "antigravity"],
    { env: environment, stdio: ["pipe", "pipe", "pipe"] },
  );
  hook.stdin.end("{}\n");
  await waitFor(() =>
    access(`${barrier}.ready`)
      .then(() => true)
      .catch(() => false),
  );

  const uninstall = execFileAsync(process.execPath, [connectorPath, "uninstall"], {
    env: environment,
  });
  await waitFor(() =>
    access(join(installation.directory, "lifecycle.lock"))
      .then(() => true)
      .catch(() => false),
  );
  await writeFile(`${barrier}.continue`, "continue\n");
  const [hookCode] = await once(hook, "close");
  assert.equal(hookCode, 0);
  const uninstallResult = await uninstall;
  assert.match(uninstallResult.stdout, /local state removed/);
  await delay(100);
  await assert.rejects(access(installation.directory), { code: "ENOENT" });
  assert.deepEqual(
    (await readdir(home)).filter((name) => /(?:scheduler.*\.lock|recovery)/i.test(name)),
    [],
  );
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
        response.end(JSON.stringify(usageResponse(body)));
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
  const schedulerTrace = join(home, "scheduler-trace.log");
  await writeFile(
    join(installation.directory, "state.json"),
    `${JSON.stringify({ version: 1, sequences: { [installation.sourceId]: "0" } })}\n`,
  );
  const environment = connectorEnvironment(home, {
    NODE_ENV: "test",
    VIBERACING_TEST_AUTOMATIC_SYNC_TIMINGS: "50,400,200",
    VIBERACING_TEST_SCHEDULER_TRACE: schedulerTrace,
  });

  // Twenty simultaneous Node startups can starve the detached scheduler itself on the
  // smaller Windows-hosted runner. Eight hooks still exercise launch-gate contention and
  // coalescing while leaving enough capacity for the scheduler process under test to start.
  const concurrentHookCount = process.platform === "win32" ? 8 : 20;
  const hookResults = await Promise.all(
    Array.from({ length: concurrentHookCount }, (_, index) =>
      runWithInput(
        ["hook", "--source", installation.clientSourceId, "--agent", "antigravity"],
        environment,
        JSON.stringify({ prompt: `private-${index}`, cwd: `/private/${index}` }),
      ),
    ),
  );
  for (const [index, result] of hookResults.entries()) {
    assert.equal(
      result.code,
      0,
      `hook ${index} failed: stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)}`,
    );
    assert.equal(result.stdout, "", `hook ${index} unexpectedly wrote to stdout`);
  }
  await Promise.race([
    firstRequest,
    // Launching twenty real hook processes can briefly saturate a Windows CI
    // runner. Keep the production timing assertions below, but allow the
    // detached scheduler enough wall-clock time to start under that load.
    delay(30_000, undefined, { ref: false }).then(async () => {
      const diagnostics = {};
      for (const name of ["dirty.json", "scheduler-launch.lock", "scheduler.lock", "state.json"])
        diagnostics[name] = await readFile(join(installation.directory, name), "utf8").catch(
          (error) => error?.code ?? error?.message,
        );
      diagnostics.schedulerTrace = await readFile(schedulerTrace, "utf8").catch(
        (error) => error?.code ?? error?.message,
      );
      throw new Error(
        `Automatic scheduler did not issue its first request: ${JSON.stringify(diagnostics)}`,
      );
    }),
  ]);
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
    if (request.method === "POST" && request.url === "/api/installations/current") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(reconciliationResponse([{ sourceId: source.sourceId }])));
      return;
    }
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (request.url === "/api/installations/current/diagnostics") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ acceptedEvents: body.events.length }));
        return;
      }
      requests += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify(
          usageResponse({ snapshots: [], sourceErrors: [{ sourceId: source.sourceId }] }),
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

test("an unchanged healthy source never inherits another collector automatic failure", async (context) => {
  const usageBodies = [];
  const diagnosticBodies = [];
  const healthySourceId = "51515151-5151-4151-8151-515151515151";
  const failedSourceId = "52525252-5252-4252-8252-525252525252";
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
      response.setHeader("content-type", "application/json");
      if (request.url === "/api/installations/current") {
        response.end(
          JSON.stringify(
            reconciliationResponse([{ sourceId: healthySourceId }, { sourceId: failedSourceId }]),
          ),
        );
        return;
      }
      if (request.url === "/api/usage") {
        usageBodies.push(body);
        response.end(JSON.stringify(usageResponse(body)));
        return;
      }
      if (request.url === "/api/installations/current/diagnostics") {
        diagnosticBodies.push(body);
        response.end(JSON.stringify({ acceptedEvents: body.events.length }));
        return;
      }
      response.writeHead(404);
      response.end(JSON.stringify({ error: "not_found" }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-mixed-collector-failure-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const directory = join(home, ".viberacing");
  const captureDirectory = join(directory, "captures");
  await mkdir(captureDirectory, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const sources = [
    {
      clientSourceId: "53535353-5353-4353-8353-535353535353",
      sourceId: healthySourceId,
      agentId: "antigravity",
      dataPath: join(captureDirectory, "healthy.jsonl"),
      collectionMethod: "antigravity_cli_capture",
      supportedSurface: "cli",
      suggestedLabel: "Healthy",
    },
    {
      clientSourceId: "54545454-5454-4454-8454-545454545454",
      sourceId: failedSourceId,
      agentId: "antigravity",
      dataPath: join(captureDirectory, "failed.jsonl"),
      collectionMethod: "antigravity_cli_capture",
      supportedSurface: "cli",
      suggestedLabel: "Fails later",
    },
  ];
  for (const [index, source] of sources.entries())
    await writeFile(
      source.dataPath,
      `${JSON.stringify({
        id: `mixed-${index}`,
        date,
        usage: { date, totalTokens: `${index + 1}` },
      })}\n`,
    );
  await writeMappedInstallation(home, `http://127.0.0.1:${address.port}`, sources);
  const environment = connectorEnvironment(home, {
    NODE_ENV: "test",
    VIBERACING_TEST_AUTOMATIC_SYNC_TIMINGS: "1,1,1",
  });

  await execFileAsync(process.execPath, [connectorPath, "sync"], { env: environment });
  assert.equal(usageBodies.length, 1);
  assert.equal(usageBodies[0].snapshots.length, 2);

  const configPath = join(directory, "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.sources[1].collectionMethod = "synthetic_invalid_collector";
  await writeFile(configPath, `${JSON.stringify(config)}\n`);
  const sourcesPath = join(directory, "sources.json");
  const localSources = JSON.parse(await readFile(sourcesPath, "utf8"));
  localSources.sources[1].collectionMethod = "synthetic_invalid_collector";
  await writeFile(sourcesPath, `${JSON.stringify(localSources)}\n`);
  const lastHookErrorPath = join(directory, "logs", "last-error.log");
  await mkdir(join(directory, "logs"), { recursive: true });
  await writeFile(lastHookErrorPath, "2026-08-18T12:55:27.438Z automatic_sync_failed\n");
  const timestamp = new Date().toISOString();
  await writeFile(
    join(directory, "dirty.json"),
    `${JSON.stringify({
      version: 2,
      sources: Object.fromEntries(
        sources.map((source) => [
          source.clientSourceId,
          { dirtySince: timestamp, lastEventAt: timestamp, generation: randomUUID() },
        ]),
      ),
    })}\n`,
  );

  await execFileAsync(process.execPath, [connectorPath, "auto-sync"], { env: environment });

  assert.equal(usageBodies.length, 2);
  assert.deepEqual(usageBodies[1].snapshots, []);
  assert.deepEqual(usageBodies[1].sourceErrors, [
    { sourceId: failedSourceId, code: "collector_failed", observedAfterSequence: "1" },
  ]);
  assert.equal(diagnosticBodies.length, 1);
  assert.deepEqual(
    diagnosticBodies[0].events.map(({ sourceId, code, state, phase }) => ({
      sourceId,
      code,
      state,
      phase,
    })),
    [
      {
        sourceId: failedSourceId,
        code: "collector_failed",
        state: "opened",
        phase: "collect",
      },
    ],
  );
  assert.equal(
    diagnosticBodies[0].events.some(({ code }) => code === "automatic_sync_failed"),
    false,
  );
  assert.equal(
    await readFile(lastHookErrorPath, "utf8"),
    "2026-08-18T12:55:27.438Z automatic_sync_failed\n",
  );
  const state = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
  assert.deepEqual(state.diagnostics.activeBySource[failedSourceId], ["collect:collector_failed"]);
  assert.equal(state.diagnostics.activeBySource[healthySourceId], undefined);
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

test("a recovered initial pending drain clears the stale hook error on unchanged usage", async (context) => {
  let available = false;
  let usageRequests = 0;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
      if (request.url === "/api/installations/current/diagnostics") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ acceptedEvents: body.events.length }));
        return;
      }
      usageRequests += 1;
      response.writeHead(available ? 200 : 503, { "content-type": "application/json" });
      response.end(
        JSON.stringify(available ? usageResponse(body) : { error: "synthetic_unavailable" }),
      );
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-recovered-pending-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const installation = await writeCaptureInstallation(home, `http://127.0.0.1:${address.port}`);
  const trace = join(home, "collector-trace.txt");
  const environment = connectorEnvironment(home, {
    NODE_ENV: "test",
    VIBERACING_TEST_COLLECTOR_TRACE: trace,
    VIBERACING_TEST_AUTOMATIC_SYNC_TIMINGS: "20,80,40",
  });
  const hookArguments = ["hook", "--source", installation.clientSourceId, "--agent", "antigravity"];
  const schedulerPath = join(installation.directory, "scheduler.lock");
  const lastHookErrorPath = join(installation.directory, "logs", "last-error.log");

  await runWithInput(hookArguments, environment, "{}");
  await waitFor(() => usageRequests === 3, 7_000);
  await waitFor(async () => {
    try {
      await access(schedulerPath);
      return false;
    } catch {
      return true;
    }
  });
  await access(lastHookErrorPath);
  assert.equal((await readdir(join(installation.directory, "pending"))).length, 1);

  available = true;
  await runWithInput(hookArguments, environment, "{}");
  await waitFor(() => usageRequests === 4, 7_000);
  await waitFor(async () => {
    try {
      await access(schedulerPath);
      return false;
    } catch {
      return true;
    }
  });

  assert.equal((await readFile(trace, "utf8")).trim().split("\n").length, 2);
  assert.deepEqual(await readdir(join(installation.directory, "pending")), []);
  await assert.rejects(access(lastHookErrorPath));
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
      response.end(JSON.stringify(usageResponse(body)));
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

test("Codex account switches register once and route snapshots without sending provider identity", async (context) => {
  const primaryClientId = "12121212-1212-4212-8212-121212121212";
  const primarySourceId = "13131313-1313-4313-8313-131313131313";
  const secondarySourceId = "14141414-1414-4414-8414-141414141414";
  const secondaryAccountId = "15151515-1515-4515-8515-151515151515";
  const primaryAccountId = "16161616-1616-4616-8616-161616161616";
  const browserRequestId = "18181818-1818-4818-8818-181818181818";
  const registrationBodies = [];
  const usageBodies = [];
  const resultBodies = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.setHeader("content-type", "application/json");
      if (request.url === "/api/installations/current") {
        response.end(
          JSON.stringify(reconciliationResponse(body.sourceIds.map((sourceId) => ({ sourceId })))),
        );
        return;
      }
      if (request.url === "/api/installations/current/sources/register") {
        registrationBodies.push(body);
        if (registrationBodies.length === 1) {
          response.statusCode = 503;
          response.end(JSON.stringify({ error: "server_error" }));
          return;
        }
        response.end(
          JSON.stringify({
            source: {
              clientSourceId: body.clientSourceId,
              sourceId: secondarySourceId,
              agentAccountId: secondaryAccountId,
              agentId: "codex",
              accountLabel: "Codex account 2",
              collectionMethod: "codex_app_server",
              lastAcceptedSyncSequence: "0",
              historyBackfillYear: new Date().getUTCFullYear(),
              historyBackfillStatus: "pending",
              profileSourceId: primarySourceId,
            },
          }),
        );
        return;
      }
      if (request.url === "/api/installations/current/sync/claim") {
        response.end(
          JSON.stringify({
            requestId: browserRequestId,
            sourceIds:
              body.scope === "installation"
                ? [primarySourceId, secondarySourceId]
                : [secondarySourceId],
          }),
        );
        return;
      }
      if (request.url === "/api/installations/current/sync/result") {
        resultBodies.push(body);
        response.statusCode = 204;
        response.end();
        return;
      }
      if (request.url === "/api/usage") {
        usageBodies.push(body);
        response.end(JSON.stringify(usageResponse(body)));
        return;
      }
      response.writeHead(404).end(JSON.stringify({ error: "not_found" }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-codex-switch-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const codexHome = join(home, ".codex");
  const bin = join(home, "bin");
  const executablePath = join(bin, process.platform === "win32" ? "codex.cmd" : "codex");
  await mkdir(codexHome, { recursive: true });
  await mkdir(bin, { recursive: true });
  await writeExecutableNodeScript(
    executablePath,
    `#!/usr/bin/env node
import { createInterface } from "node:readline";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.id === 0) {
    writeFileSync(join(process.env.CODEX_HOME, "auth.json"), JSON.stringify({ auth_mode: "chatgpt", tokens: { account_id: process.env.VIBERACING_TEST_CODEX_ACCOUNT_ID } }), { mode: 0o600 });
    process.stdout.write(JSON.stringify({ id: 0, result: { userAgent: "synthetic" } }) + "\\n");
  } else if (message.method === "account/read") {
    process.stdout.write(JSON.stringify({ id: message.id, result: { account: { type: "chatgpt", email: "same@example.com", planType: "pro" }, requiresOpenaiAuth: false } }) + "\\n");
  } else if (message.method === "account/usage/read") {
    process.stdout.write(JSON.stringify({ id: message.id, result: { dailyUsageBuckets: [{ startDate: new Date().toISOString().slice(0, 10), tokens: "42" }] } }) + "\\n");
  }
}
`,
  );
  const source = {
    clientSourceId: primaryClientId,
    sourceId: primarySourceId,
    agentAccountId: primaryAccountId,
    agentId: "codex",
    dataPath: codexHome,
    executablePath,
    collectionMethod: "codex_app_server",
    supportedSurface: "desktop",
    suggestedLabel: "Codex",
    accountLabel: "Codex",
  };
  const directory = await writeMappedInstallation(home, `http://127.0.0.1:${address.port}`, [
    source,
  ]);
  await writeFile(
    join(directory, "installation.json"),
    `${JSON.stringify({
      version: 1,
      id: "17171717-1717-4717-8717-171717171717",
      secret: "codex-switch-installation-secret-that-is-long-enough",
    })}\n`,
  );
  const environment = connectorEnvironment(home, {
    NODE_ENV: "test",
    VIBERACING_CODEX_BIN: executablePath,
  });
  await writeFile(
    join(codexHome, "auth.json"),
    `${JSON.stringify({ auth_mode: "chatgpt", tokens: { account_id: "account-first" } })}\n`,
    { mode: 0o600 },
  );
  const terminalOutputs = [];
  terminalOutputs.push(
    await execFileAsync(process.execPath, [connectorPath, "sync"], {
      env: { ...environment, VIBERACING_TEST_CODEX_ACCOUNT_ID: "account-first" },
    }),
  );
  const pendingRegistration = await execFileAsync(process.execPath, [connectorPath, "sync"], {
    env: { ...environment, VIBERACING_TEST_CODEX_ACCOUNT_ID: "account-second" },
  });
  terminalOutputs.push(pendingRegistration);
  assert.match(pendingRegistration.stderr, /partial sync/i);
  const pendingState = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
  assert.equal(Object.keys(pendingState.pendingAccountRegistrations).length, 1);
  assert.deepEqual(Object.keys(Object.values(pendingState.pendingAccountRegistrations)[0]).sort(), [
    "completeness",
    "entries",
    "profileClientSourceId",
    "rangeEnd",
    "rangeStart",
  ]);
  assert.doesNotMatch(JSON.stringify(pendingState.pendingAccountRegistrations), /example|acct1_/i);
  terminalOutputs.push(
    await execFileAsync(process.execPath, [connectorPath, "sync"], {
      env: { ...environment, VIBERACING_TEST_CODEX_ACCOUNT_ID: "account-first" },
    }),
  );
  assert.deepEqual(
    JSON.parse(await readFile(join(directory, "state.json"), "utf8")).pendingAccountRegistrations,
    {},
  );
  terminalOutputs.push(
    await execFileAsync(process.execPath, [connectorPath, "sync"], {
      env: { ...environment, VIBERACING_TEST_CODEX_ACCOUNT_ID: "account-second" },
    }),
  );
  terminalOutputs.push(
    await execFileAsync(process.execPath, [connectorPath, "sync"], {
      env: { ...environment, VIBERACING_TEST_CODEX_ACCOUNT_ID: "account-first" },
    }),
  );
  terminalOutputs.push(
    await execFileAsync(process.execPath, [connectorPath, "sync"], {
      env: { ...environment, VIBERACING_TEST_CODEX_ACCOUNT_ID: "account-second" },
    }),
  );
  const browserEnvironment = {
    ...environment,
    VIBERACING_TEST_CODEX_ACCOUNT_ID: "account-first",
  };
  const beforeBrowser = JSON.parse(await readFile(join(directory, "config.json"), "utf8"));
  assert.equal(beforeBrowser.sources[1].agentAccountId, secondaryAccountId);
  const dirtyPath = join(directory, "dirty.json");
  await writeFile(
    dirtyPath,
    `${JSON.stringify({
      version: 2,
      sources: {
        [primaryClientId]: {
          dirtySince: "2026-08-26T12:00:00.000Z",
          lastEventAt: "2026-08-26T12:00:01.000Z",
          generation: "19191919-1919-4919-8919-191919191919",
        },
      },
    })}\n`,
  );
  terminalOutputs.push(
    await execFileAsync(
      process.execPath,
      [
        connectorPath,
        "handle-url",
        `viberacing://sync?requestId=${browserRequestId}&accountId=${secondaryAccountId}&grant=${"g".repeat(32)}`,
      ],
      { env: browserEnvironment },
    ),
  );
  assert.equal(
    JSON.parse(await readFile(dirtyPath, "utf8")).sources[primaryClientId].generation,
    "19191919-1919-4919-8919-191919191919",
  );
  terminalOutputs.push(
    await execFileAsync(
      process.execPath,
      [
        connectorPath,
        "handle-url",
        `viberacing://sync?requestId=${browserRequestId}&scope=installation&grant=${"g".repeat(32)}`,
      ],
      { env: browserEnvironment },
    ),
  );
  await assert.rejects(access(dirtyPath));

  assert.equal(registrationBodies.length, 2);
  for (const body of registrationBodies)
    assert.deepEqual(body, {
      agentId: "codex",
      clientSourceId: body.clientSourceId,
      collectionMethod: "codex_app_server",
      profileClientSourceId: primaryClientId,
      supportedSurface: "desktop",
    });
  assert.doesNotMatch(
    JSON.stringify({ registrationBodies, usageBodies, resultBodies }),
    /example|acct1_|account-(?:first|second)/i,
  );
  assert.deepEqual(
    usageBodies
      .map((body) =>
        body.snapshots.filter(({ kind }) => kind === "rolling").map(({ sourceId }) => sourceId),
      )
      .filter((sourceIds) => sourceIds.length > 0),
    [
      [primarySourceId],
      [primarySourceId, secondarySourceId],
      [secondarySourceId],
      [primarySourceId],
      [secondarySourceId],
      [primarySourceId],
    ],
  );
  assert.deepEqual(
    resultBodies.map(({ status, resultCode }) => ({ status, resultCode })),
    [
      { status: "failed", resultCode: "account_not_active" },
      { status: "partial", resultCode: "partial_accounts_inactive" },
    ],
  );
  const localSources = await readLocalSources(directory);
  assert.equal(localSources.length, 2);
  assert.equal(localSources[1].profileClientSourceId, primaryClientId);
  assert.match(localSources[0].providerAccountKey, /^acct1_[A-Za-z0-9_-]{43}$/);
  assert.match(localSources[1].providerAccountKey, /^acct1_[A-Za-z0-9_-]{43}$/);
  assert.doesNotMatch(JSON.stringify(localSources), /example|account-(?:first|second)/i);
  const storedConfig = JSON.parse(await readFile(join(directory, "config.json"), "utf8"));
  assert.equal(storedConfig.sources.length, 2);
  assert.equal(storedConfig.sources[1].profileSourceId, primarySourceId);
  assert.doesNotMatch(JSON.stringify(storedConfig), /acct1_|example|account-(?:first|second)/i);
  assert.doesNotMatch(
    terminalOutputs.map(({ stdout, stderr }) => `${stdout}\n${stderr}`).join("\n"),
    /same@example\.com|account-(?:first|second)|acct1_/i,
  );
});

test("a current Codex B snapshot durably supersedes a stale registration backfill", async (context) => {
  const profileClientSourceId = "20202020-2020-4020-8020-202020202020";
  const profileSourceId = "21212121-2121-4121-8121-212121212121";
  const profileAccountId = "22222222-2222-4222-8222-222222222222";
  const secondarySourceId = "23232323-2323-4323-8323-232323232323";
  const secondaryAccountId = "24242424-2424-4424-8424-242424242424";
  const requestId = "25252525-2525-4525-8525-252525252525";
  const registrationBodies = [];
  const usageBodies = [];
  const resultBodies = [];
  const serverTotals = new Map();
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
      response.setHeader("content-type", "application/json");
      if (request.url === "/api/installations/current/sync/claim") {
        response.end(
          JSON.stringify({
            requestId,
            sourceIds: [profileSourceId],
          }),
        );
        return;
      }
      if (request.url === "/api/installations/current/sources/register") {
        registrationBodies.push(body);
        if (registrationBodies.length === 1) {
          response.statusCode = 503;
          response.end(JSON.stringify({ error: "server_error" }));
          return;
        }
        response.end(
          JSON.stringify({
            source: {
              clientSourceId: body.clientSourceId,
              sourceId: secondarySourceId,
              agentAccountId: secondaryAccountId,
              agentId: "codex",
              accountLabel: "Codex account 2",
              collectionMethod: "codex_app_server",
              lastAcceptedSyncSequence: "0",
              historyBackfillYear: new Date().getUTCFullYear(),
              historyBackfillStatus: "pending",
              profileSourceId,
            },
          }),
        );
        return;
      }
      if (request.url === "/api/installations/current") {
        response.end(
          JSON.stringify(
            reconciliationResponse([
              {
                clientSourceId: profileClientSourceId,
                sourceId: profileSourceId,
                agentAccountId: profileAccountId,
                agentId: "codex",
                accountLabel: "Codex",
                collectionMethod: "codex_app_server",
                lastAcceptedSyncSequence: "0",
              },
              ...(registrationBodies.length < 2
                ? []
                : [
                    {
                      clientSourceId: registrationBodies.at(-1).clientSourceId,
                      sourceId: secondarySourceId,
                      agentAccountId: secondaryAccountId,
                      agentId: "codex",
                      accountLabel: "Codex account 2",
                      collectionMethod: "codex_app_server",
                      lastAcceptedSyncSequence: "0",
                      profileSourceId,
                    },
                  ]),
            ]),
          ),
        );
        return;
      }
      if (request.url === "/api/usage") {
        usageBodies.push(body);
        for (const snapshot of body.snapshots ?? [])
          serverTotals.set(snapshot.sourceId, snapshot.entries.at(-1)?.totalTokens ?? "0");
        response.end(JSON.stringify(usageResponse(body)));
        return;
      }
      if (request.url === "/api/installations/current/sync/result") {
        resultBodies.push(body);
        response.statusCode = 204;
        response.end();
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not_found" }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-codex-browser-first-backfill-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const codexHome = join(home, ".codex");
  const executablePath = join(home, "bin", process.platform === "win32" ? "codex.cmd" : "codex");
  await mkdir(codexHome, { recursive: true });
  await mkdir(dirname(executablePath), { recursive: true });
  await writeExecutableNodeScript(
    executablePath,
    `#!/usr/bin/env node
import { createInterface } from "node:readline";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.id === 0) {
    writeFileSync(join(process.env.CODEX_HOME, "auth.json"), JSON.stringify({ auth_mode: "chatgpt", tokens: { account_id: process.env.VIBERACING_TEST_CODEX_WORKSPACE } }), { mode: 0o600 });
    process.stdout.write(JSON.stringify({ id: 0, result: { userAgent: "synthetic" } }) + "\\n");
  }
  else if (message.method === "account/read") process.stdout.write(JSON.stringify({ id: message.id, result: { account: { type: "chatgpt", email: "same@example.com", planType: "pro" }, requiresOpenaiAuth: false } }) + "\\n");
  else if (message.method === "account/usage/read") process.stdout.write(JSON.stringify({ id: message.id, result: { dailyUsageBuckets: [{ startDate: new Date().toISOString().slice(0, 10), tokens: process.env.VIBERACING_TEST_CODEX_TOKENS }] } }) + "\\n");
}
`,
  );
  const directory = await writeMappedInstallation(home, `http://127.0.0.1:${address.port}`, [
    {
      clientSourceId: profileClientSourceId,
      sourceId: profileSourceId,
      agentAccountId: profileAccountId,
      agentId: "codex",
      dataPath: codexHome,
      executablePath,
      collectionMethod: "codex_app_server",
      supportedSurface: "desktop",
      suggestedLabel: "Codex",
      accountLabel: "Codex",
    },
  ]);
  const environment = connectorEnvironment(home, {
    NODE_ENV: "test",
    VIBERACING_CODEX_BIN: executablePath,
  });
  const writeAuth = (accountId) =>
    writeFile(
      join(codexHome, "auth.json"),
      `${JSON.stringify({ auth_mode: "chatgpt", tokens: { account_id: accountId } })}\n`,
      { mode: 0o600 },
    );
  await writeAuth("workspace-A");
  await execFileAsync(process.execPath, [connectorPath, "sync"], {
    env: {
      ...environment,
      VIBERACING_TEST_CODEX_WORKSPACE: "workspace-A",
      VIBERACING_TEST_CODEX_TOKENS: "10",
    },
  });
  usageBodies.length = 0;
  await writeAuth("workspace-B");
  const pendingOutput = await execFileAsync(process.execPath, [connectorPath, "sync"], {
    env: {
      ...environment,
      VIBERACING_TEST_CODEX_WORKSPACE: "workspace-B",
      VIBERACING_TEST_CODEX_TOKENS: "71",
    },
  });
  const pendingBeforeDelivery = JSON.parse(
    await readFile(join(directory, "state.json"), "utf8"),
  ).pendingAccountRegistrations;
  assert.equal(Object.keys(pendingBeforeDelivery).length, 1);
  const deliveryOutput = await execFileAsync(
    process.execPath,
    [
      connectorPath,
      "handle-url",
      `viberacing://sync?requestId=${requestId}&scope=installation&grant=${"g".repeat(32)}`,
    ],
    {
      env: {
        ...environment,
        VIBERACING_TEST_CODEX_WORKSPACE: "workspace-B",
        VIBERACING_TEST_CODEX_TOKENS: "73",
      },
    },
  );
  await writeAuth("workspace-A");
  const laterOutput = await execFileAsync(process.execPath, [connectorPath, "sync"], {
    env: {
      ...environment,
      VIBERACING_TEST_CODEX_WORKSPACE: "workspace-A",
      VIBERACING_TEST_CODEX_TOKENS: "10",
    },
  });

  assert.equal(registrationBodies.length, 2);
  assert.equal(usageBodies.length, 2);
  assert.deepEqual(
    usageBodies[0].snapshots.map(({ sourceId, entries }) => ({ sourceId, entries })),
    [
      {
        sourceId: secondarySourceId,
        entries: [{ date: new Date().toISOString().slice(0, 10), totalTokens: "73" }],
      },
    ],
  );
  assert.deepEqual(
    usageBodies
      .flatMap((body) => body.snapshots)
      .filter(({ sourceId }) => sourceId === secondarySourceId),
    [
      {
        sourceId: secondarySourceId,
        syncSequence: "1",
        kind: "rolling",
        rangeStart: new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10),
        rangeEnd: new Date().toISOString().slice(0, 10),
        completeness: "complete",
        entries: [{ date: new Date().toISOString().slice(0, 10), totalTokens: "73" }],
      },
    ],
  );
  assert.equal(serverTotals.get(secondarySourceId), "73");
  assert.deepEqual(
    JSON.parse(await readFile(join(directory, "state.json"), "utf8")).pendingAccountRegistrations,
    {},
  );
  assert.deepEqual(resultBodies, [
    { requestId, status: "partial", resultCode: "partial_accounts_inactive" },
  ]);
  const config = JSON.parse(await readFile(join(directory, "config.json"), "utf8"));
  assert.equal(config.sources.length, 2);
  assert.equal(config.sources[1].profileSourceId, profileSourceId);
  assert.doesNotMatch(
    JSON.stringify({
      registrationBodies,
      usageBodies,
      resultBodies,
      config,
      pendingOutput,
      deliveryOutput,
      laterOutput,
    }),
    /same@example\.com|workspace-B|acct1_/i,
  );
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
      response.end(JSON.stringify(usageResponse(body)));
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
  const schedulerTrace = join(home, "scheduler-trace.txt");
  const environment = connectorEnvironment(home, {
    NODE_ENV: "test",
    VIBERACING_TEST_COLLECTOR_TRACE: trace,
    VIBERACING_TEST_SCHEDULER_TRACE: schedulerTrace,
    VIBERACING_TEST_AUTOMATIC_SYNC_TIMINGS: "1500,3000,3000",
  });
  const hookResults = await Promise.all(
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
  assert.deepEqual(
    hookResults.map((result) => result.code),
    [0, 0],
  );
  const dirty = JSON.parse(await readFile(join(directory, "dirty.json"), "utf8"));
  assert.deepEqual(
    new Set(Object.keys(dirty.sources)),
    new Set(sources.slice(0, 2).map((source) => source.clientSourceId)),
  );
  // The detached scheduler is intentionally outside the hook processes. Give it
  // enough wall-clock budget when the full connector suite saturates a CI host;
  // the configured 3 s maximum delay still keeps this wait bounded.
  try {
    await waitFor(() => bodies.length === 1, 30_000);
  } catch {
    const diagnostics = {};
    for (const name of ["dirty.json", "scheduler-launch.lock", "scheduler.lock", "state.json"])
      diagnostics[name] = await readFile(join(directory, name), "utf8").catch(
        (error) => error?.code ?? "unavailable",
      );
    diagnostics.collectorTrace = await readFile(trace, "utf8").catch(
      (error) => error?.code ?? "unavailable",
    );
    diagnostics.schedulerTrace = await readFile(schedulerTrace, "utf8").catch(
      (error) => error?.code ?? "unavailable",
    );
    throw new Error(
      `Automatic scheduler did not coalesce the events: ${JSON.stringify(diagnostics)}`,
    );
  }
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

test("a hook persists its event while another hook holds the scheduler launch gate", async (context) => {
  const bodies = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      bodies.push(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(usageResponse(body)));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-hook-busy-launch-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const fixtureRoot = fileURLToPath(new URL("fixtures", import.meta.url));
  const sources = [
    {
      clientSourceId: "70707070-7070-4070-8070-707070707070",
      sourceId: "77777777-7070-4070-8070-707070707070",
      agentId: "claude_code",
      dataPath: fixtureRoot,
      collectionMethod: "claude_jsonl",
      supportedSurface: "cli",
      suggestedLabel: "Claude",
    },
    {
      clientSourceId: "80808080-8080-4080-8080-808080808080",
      sourceId: "88888888-8080-4080-8080-808080808080",
      agentId: "kimi_code",
      dataPath: fixtureRoot,
      collectionMethod: "kimi_wire_jsonl",
      supportedSurface: "cli",
      suggestedLabel: "Kimi",
    },
    {
      clientSourceId: "90909090-9090-4090-8090-909090909090",
      sourceId: "99999999-9090-4090-8090-909090909090",
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
  const barrier = join(home, "scheduler-claim");
  const trace = join(home, "collector-trace.txt");
  const environment = connectorEnvironment(home, {
    NODE_ENV: "test",
    VIBERACING_TEST_SCHEDULER_CLAIM_BARRIER: barrier,
    VIBERACING_TEST_COLLECTOR_TRACE: trace,
    VIBERACING_TEST_AUTOMATIC_SYNC_TIMINGS: "25,150,100",
  });
  const first = spawn(
    process.execPath,
    [connectorPath, "hook", "--source", sources[0].clientSourceId, "--agent", sources[0].agentId],
    { env: environment, stdio: ["pipe", "pipe", "pipe"] },
  );
  const firstClose = once(first, "close");
  context.after(() => first.kill("SIGKILL"));
  let firstStdout = "";
  let firstStderr = "";
  first.stdout.setEncoding("utf8").on("data", (chunk) => (firstStdout += chunk));
  first.stderr.setEncoding("utf8").on("data", (chunk) => (firstStderr += chunk));
  first.stdin.end("{}\n");
  let schedulerPid;
  await waitFor(async () => {
    const value = await readFile(`${barrier}.ready`, "utf8").catch(() => "");
    const candidate = Number(value.trim());
    if (!Number.isSafeInteger(candidate) || candidate < 1) return false;
    schedulerPid = candidate;
    return true;
  });
  assert.ok(Number.isSafeInteger(schedulerPid) && schedulerPid > 0);

  const second = await runWithInput(
    ["hook", "--source", sources[1].clientSourceId, "--agent", sources[1].agentId],
    environment,
    "{}",
  );
  assert.equal(second.code, 0);
  assert.equal(second.stdout, "");
  assert.equal(second.stderr, "");
  const dirty = JSON.parse(await readFile(join(directory, "dirty.json"), "utf8"));
  assert.deepEqual(
    new Set(Object.keys(dirty.sources)),
    new Set(sources.slice(0, 2).map((source) => source.clientSourceId)),
  );

  await writeFile(`${barrier}.continue`, "continue\n");
  const [firstCode] = await firstClose;
  assert.equal(firstCode, 0);
  assert.equal(firstStdout, "");
  assert.equal(firstStderr, "");
  await waitFor(() => bodies.length === 1);
  assert.deepEqual(
    new Set((await readFile(trace, "utf8")).trim().split("\n")),
    new Set(sources.slice(0, 2).map((source) => source.clientSourceId)),
  );
  assert.deepEqual(
    new Set(bodies[0].snapshots.map((snapshot) => snapshot.sourceId)),
    new Set(sources.slice(0, 2).map((source) => source.sourceId)),
  );
  await waitFor(() => {
    try {
      process.kill(schedulerPid, 0);
      return false;
    } catch (error) {
      return error?.code === "ESRCH";
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
      response.end(JSON.stringify(usageResponse(body)));
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
    dataPath: join(
      directory,
      "captures",
      `${index + 7}0707070-7070-4070-8070-70707070707${index}.jsonl`,
    ),
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
  const lastHookErrorPath = join(directory, "logs", "last-error.log");
  await mkdir(join(directory, "logs"), { recursive: true });
  await writeFile(lastHookErrorPath, "2026-08-18T12:55:27.438Z automatic_sync_failed\n");
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
  await assert.rejects(access(lastHookErrorPath));
  await assert.rejects(access(join(directory, "dirty.json")));
  await assert.rejects(access(join(directory, "scheduler.lock")));

  await execFileAsync(process.execPath, [connectorPath, "sync"], { env: environment });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].snapshots.length, 2);
  assert.deepEqual(
    bodies[1].snapshots.map((snapshot) => snapshot.syncSequence),
    ["2", "2"],
  );
  assert.equal((await readFile(trace, "utf8")).trim().split("\n").length, 4);
});

test("automatic sync advances one current-year chunk and manual sync resumes through January", async (context) => {
  const fixedNow = "2026-09-01T12:00:00.000Z";
  const historicalDates = ["2026-07-15", "2026-06-15", "2026-05-15"];
  const bodies = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      bodies.push(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(usageResponse(body)));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-history-resume-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const installation = await writeCaptureInstallation(home, `http://127.0.0.1:${address.port}`, {
    date: "2026-09-01",
    events: ["2026-09-01", ...historicalDates].map((date, index) => ({
      id: `history-range-${index}`,
      date,
      usage: { date, totalTokens: String(index + 1) },
    })),
    historyBackfillYear: 2026,
    historyBackfillStatus: "pending",
  });
  await writeFile(
    join(installation.directory, "dirty.json"),
    `${JSON.stringify({
      version: 2,
      sources: {
        [installation.clientSourceId]: {
          dirtySince: new Date().toISOString(),
          lastEventAt: new Date().toISOString(),
          generation: randomUUID(),
        },
      },
    })}\n`,
  );
  const environment = connectorEnvironment(home, {
    NODE_ENV: "test",
    VIBERACING_TEST_NOW: fixedNow,
  });

  await execFileAsync(process.execPath, [connectorPath, "auto-sync"], { env: environment });
  assert.deepEqual(
    bodies.map((body) => body.snapshots[0]?.kind),
    ["rolling", "year_backfill"],
  );
  const afterAutomatic = JSON.parse(
    await readFile(join(installation.directory, "state.json"), "utf8"),
  );
  const cursorAfterAutomatic = afterAutomatic.history[installation.sourceId];
  assert.equal(cursorAfterAutomatic.year, 2026);
  assert.equal(cursorAfterAutomatic.hadPartialChunk, true);
  assert.equal(afterAutomatic.historyAdapters?.[installation.sourceId], undefined);
  const rollingAdapterState = afterAutomatic.adapters[installation.sourceId];

  const bodyCountAfterAutomatic = bodies.length;
  await execFileAsync(process.execPath, [connectorPath, "sync"], { env: environment });
  const resumedBodies = bodies.slice(bodyCountAfterAutomatic);
  assert.equal(resumedBodies[0].snapshots[0].kind, "rolling");
  const historical = resumedBodies.slice(1).map((body) => body.snapshots[0]);
  assert.ok(historical.length > 0);
  for (const [index, snapshot] of historical.entries()) {
    assert.equal(snapshot.kind, "year_backfill");
    const days =
      (Date.parse(`${snapshot.rangeEnd}T00:00:00.000Z`) -
        Date.parse(`${snapshot.rangeStart}T00:00:00.000Z`)) /
        86_400_000 +
      1;
    assert.ok(days >= 1 && days <= 31);
    if (index > 0) assert.ok(snapshot.rangeEnd < historical[index - 1].rangeStart);
  }
  const terminal = historical.at(-1);
  assert.equal(terminal.rangeStart, "2026-01-01");
  assert.equal(terminal.historyYearComplete, "partial");
  const deliveredHistoryDates = bodies
    .flatMap((body) => body.snapshots)
    .filter((snapshot) => snapshot.kind === "year_backfill")
    .flatMap((snapshot) => snapshot.entries.map((entry) => entry.date));
  for (const date of historicalDates)
    assert.equal(
      deliveredHistoryDates.filter((delivered) => delivered === date).length,
      1,
      `${date} was not delivered exactly once from the shared capture file`,
    );

  const finalState = JSON.parse(await readFile(join(installation.directory, "state.json"), "utf8"));
  assert.equal(finalState.history?.[installation.sourceId], undefined);
  assert.deepEqual(finalState.adapters[installation.sourceId], rollingAdapterState);
  assert.equal(finalState.historyAdapters?.[installation.sourceId], undefined);
  const finalConfig = JSON.parse(
    await readFile(join(installation.directory, "config.json"), "utf8"),
  );
  assert.equal(finalConfig.sources[0].historyBackfillYear, 2026);
  assert.equal(finalConfig.sources[0].historyBackfillStatus, "partial");
  const compactedCapture = await readFile(installation.capture, "utf8");
  for (const date of historicalDates) assert.doesNotMatch(compactedCapture, new RegExp(date));
});

test("sync --full explicitly and idempotently retries terminal partial history", async (context) => {
  const bodies = [];
  const storedDays = new Map();
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      bodies.push(body);
      for (const snapshot of body.snapshots ?? [])
        for (const entry of snapshot.entries ?? [])
          storedDays.set(`${snapshot.sourceId}:${entry.date}`, entry.totalTokens);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(usageResponse(body)));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-full-history-retry-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const oldDate = "2026-01-15";
  const installation = await writeCaptureInstallation(home, `http://127.0.0.1:${address.port}`, {
    date: "2026-09-01",
    events: ["2026-09-01", oldDate].map((date, index) => ({
      id: `full-retry-${index}`,
      date,
      usage: { date, totalTokens: String(index + 7) },
    })),
    historyBackfillYear: 2026,
    historyBackfillStatus: "partial",
  });
  const environment = connectorEnvironment(home, {
    NODE_ENV: "test",
    VIBERACING_TEST_NOW: "2026-09-01T12:00:00.000Z",
  });

  await execFileAsync(process.execPath, [connectorPath, "sync"], { env: environment });
  assert.equal(
    bodies.flatMap((body) => body.snapshots).some((snapshot) => snapshot.kind === "year_backfill"),
    false,
  );

  const firstRetryStart = bodies.length;
  await execFileAsync(process.execPath, [connectorPath, "sync", "--full"], {
    env: environment,
  });
  const firstRetryHistory = bodies
    .slice(firstRetryStart)
    .flatMap((body) => body.snapshots)
    .filter((snapshot) => snapshot.kind === "year_backfill");
  assert.equal(
    firstRetryHistory
      .flatMap((snapshot) => snapshot.entries)
      .filter((entry) => entry.date === oldDate).length,
    1,
  );
  let state = JSON.parse(await readFile(join(installation.directory, "state.json"), "utf8"));
  assert.equal(state.history?.[installation.sourceId], undefined);
  assert.equal(state.historyRetries?.[installation.sourceId], undefined);

  const secondRetryStart = bodies.length;
  await execFileAsync(process.execPath, [connectorPath, "sync", "--full"], {
    env: environment,
  });
  const secondRetryHistory = bodies
    .slice(secondRetryStart)
    .flatMap((body) => body.snapshots)
    .filter((snapshot) => snapshot.kind === "year_backfill");
  assert.equal(
    secondRetryHistory
      .flatMap((snapshot) => snapshot.entries)
      .filter((entry) => entry.date === oldDate).length,
    0,
  );
  assert.equal(storedDays.get(`${installation.sourceId}:${oldDate}`), "8");
  assert.equal(
    [...storedDays.keys()].filter((key) => key === `${installation.sourceId}:${oldDate}`).length,
    1,
  );
  state = JSON.parse(await readFile(join(installation.directory, "state.json"), "utf8"));
  assert.equal(state.historyRetries?.[installation.sourceId], undefined);
  assert.doesNotMatch(await readFile(installation.capture, "utf8"), new RegExp(oldDate));
});

test("unsafe Antigravity history retains capture until a repaired full retry is acknowledged", async (context) => {
  const receivedDates = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      receivedDates.push(
        ...(body.snapshots ?? []).flatMap((snapshot) =>
          snapshot.entries.map((entry) => entry.date),
        ),
      );
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(usageResponse(body)));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-unsafe-history-retention-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const installation = await writeCaptureInstallation(home, `http://127.0.0.1:${address.port}`, {
    date: "2026-09-01",
    events: [
      {
        id: "safe-recent",
        date: "2026-09-01",
        usage: { date: "2026-09-01", totalTokens: "3" },
      },
      {
        id: "safe-old",
        date: "2026-01-15",
        usage: { date: "2026-01-15", totalTokens: "5" },
      },
    ],
    historyBackfillYear: 2026,
    historyBackfillStatus: "pending",
  });
  await writeFile(
    installation.capture,
    `${await readFile(installation.capture, "utf8")}{"id":"repaired-old","date":"2026-01-16","usage":`,
  );
  const environment = connectorEnvironment(home, {
    NODE_ENV: "test",
    VIBERACING_TEST_NOW: "2026-09-01T12:00:00.000Z",
  });

  await execFileAsync(process.execPath, [connectorPath, "sync"], { env: environment });
  assert.match(await readFile(installation.capture, "utf8"), /2026-01-15/);
  let state = JSON.parse(await readFile(join(installation.directory, "state.json"), "utf8"));
  assert.equal(state.captureCompactionPending?.[installation.sourceId], undefined);

  await writeFile(
    installation.capture,
    [
      { id: "safe-recent", date: "2026-09-01", usage: { date: "2026-09-01", totalTokens: "3" } },
      { id: "safe-old", date: "2026-01-15", usage: { date: "2026-01-15", totalTokens: "5" } },
      { id: "repaired-old", date: "2026-01-16", usage: { date: "2026-01-16", totalTokens: "7" } },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n") + "\n",
  );
  await execFileAsync(process.execPath, [connectorPath, "sync", "--full"], { env: environment });
  assert.ok(receivedDates.includes("2026-01-16"));
  const compacted = await readFile(installation.capture, "utf8");
  assert.doesNotMatch(compacted, /2026-01-15|2026-01-16/);
  assert.match(compacted, /2026-09-01/);
  state = JSON.parse(await readFile(join(installation.directory, "state.json"), "utf8"));
  assert.equal(state.captureCompactionPending?.[installation.sourceId], undefined);
});

test("terminal acknowledgement leaves crash-resumable Antigravity compaction", async (context) => {
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(usageResponse(body)));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-history-compaction-crash-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const installation = await writeCaptureInstallation(home, `http://127.0.0.1:${address.port}`, {
    date: "2026-09-01",
    events: [
      { id: "recent", date: "2026-09-01", usage: { date: "2026-09-01", totalTokens: "2" } },
      { id: "old", date: "2026-01-15", usage: { date: "2026-01-15", totalTokens: "9" } },
    ],
    historyBackfillYear: 2026,
    historyBackfillStatus: "pending",
  });
  const crashingEnvironment = connectorEnvironment(home, {
    NODE_ENV: "test",
    VIBERACING_TEST_NOW: "2026-09-01T12:00:00.000Z",
    VIBERACING_TEST_FAIL_AFTER_HISTORY_ACK: installation.sourceId,
  });
  await assert.rejects(
    execFileAsync(process.execPath, [connectorPath, "sync"], { env: crashingEnvironment }),
  );
  assert.match(await readFile(installation.capture, "utf8"), /2026-01-15/);
  let state = JSON.parse(await readFile(join(installation.directory, "state.json"), "utf8"));
  assert.equal(state.captureCompactionPending?.[installation.sourceId], 2026);

  await execFileAsync(process.execPath, [connectorPath, "sync"], {
    env: connectorEnvironment(home, {
      NODE_ENV: "test",
      VIBERACING_TEST_NOW: "2026-09-01T12:00:00.000Z",
    }),
  });
  assert.doesNotMatch(await readFile(installation.capture, "utf8"), /2026-01-15/);
  state = JSON.parse(await readFile(join(installation.directory, "state.json"), "utf8"));
  assert.equal(state.captureCompactionPending?.[installation.sourceId], undefined);
});

test("a rejected historical chunk is quarantined once per manual run without advancing its cursor", async (context) => {
  const bodies = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      bodies.push(body);
      const historical = body.snapshots.some((snapshot) => snapshot.kind === "year_backfill");
      response.writeHead(historical ? 400 : 200, { "content-type": "application/json" });
      response.end(JSON.stringify(historical ? { error: "invalid_history" } : usageResponse(body)));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-history-quarantine-once-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const installation = await writeCaptureInstallation(home, `http://127.0.0.1:${address.port}`, {
    date: "2026-09-01",
    events: ["2026-09-01", "2026-07-15"].map((date, index) => ({
      id: `rejected-history-${index}`,
      date,
      usage: { date, totalTokens: String(index + 1) },
    })),
    historyBackfillYear: 2026,
    historyBackfillStatus: "pending",
  });

  const result = await execFileAsync(process.execPath, [connectorPath, "sync"], {
    env: connectorEnvironment(home, {
      NODE_ENV: "test",
      VIBERACING_TEST_NOW: "2026-09-01T12:00:00.000Z",
    }),
  });
  const historical = bodies.filter((body) =>
    body.snapshots.some((snapshot) => snapshot.kind === "year_backfill"),
  );
  assert.equal(historical.length, 1);
  assert.match(result.stderr, /payload quarantined/);
  const state = JSON.parse(await readFile(join(installation.directory, "state.json"), "utf8"));
  assert.equal(state.history[installation.sourceId].nextRangeEnd, "2026-08-01");
});

test("one rejected historical source does not block older chunks for healthy sources", async (context) => {
  const invalidSourceId = "51515151-5151-4515-8515-515151515151";
  const healthySourceId = "52525252-5252-4525-8525-525252525252";
  const historicalBodies = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const historical = body.snapshots.some((snapshot) => snapshot.kind === "year_backfill");
      if (historical) historicalBodies.push(body);
      const rejected =
        historical && body.snapshots.some((snapshot) => snapshot.sourceId === invalidSourceId);
      response.writeHead(rejected ? 400 : 200, { "content-type": "application/json" });
      response.end(JSON.stringify(rejected ? { error: "invalid_history" } : usageResponse(body)));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-history-quarantine-group-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const captures = join(home, ".viberacing", "captures");
  await mkdir(captures, { recursive: true });
  const sources = [
    {
      clientSourceId: "53535353-5353-4535-8535-535353535353",
      sourceId: invalidSourceId,
      suggestedLabel: "Invalid",
      dataPath: join(captures, "invalid.jsonl"),
    },
    {
      clientSourceId: "54545454-5454-4545-8545-545454545454",
      sourceId: healthySourceId,
      suggestedLabel: "Healthy",
      dataPath: join(captures, "healthy.jsonl"),
    },
  ].map((source) => ({
    ...source,
    agentId: "antigravity",
    collectionMethod: "antigravity_cli_capture",
    supportedSurface: "cli",
    historyBackfillYear: 2026,
    historyBackfillStatus: "pending",
  }));
  for (const source of sources)
    await writeFile(
      source.dataPath,
      `${JSON.stringify({
        id: `${source.suggestedLabel.toLowerCase()}-history`,
        date: "2026-07-15",
        usage: { date: "2026-07-15", totalTokens: "7" },
      })}\n`,
    );
  const directory = await writeMappedInstallation(
    home,
    `http://127.0.0.1:${address.port}`,
    sources,
  );

  await execFileAsync(process.execPath, [connectorPath, "sync"], {
    env: connectorEnvironment(home, {
      NODE_ENV: "test",
      VIBERACING_TEST_NOW: "2026-09-01T12:00:00.000Z",
    }),
  });

  const invalidRanges = historicalBodies
    .flatMap((body) => body.snapshots)
    .filter((snapshot) => snapshot.sourceId === invalidSourceId)
    .map((snapshot) => snapshot.rangeEnd);
  const healthySnapshots = historicalBodies
    .flatMap((body) => body.snapshots)
    .filter((snapshot) => snapshot.sourceId === healthySourceId);
  assert.deepEqual([...new Set(invalidRanges)], ["2026-08-01"]);
  assert.ok(healthySnapshots.some((snapshot) => snapshot.rangeStart === "2026-01-01"));
  const state = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
  assert.equal(state.history[invalidSourceId].nextRangeEnd, "2026-08-01");
  assert.equal(state.history?.[healthySourceId], undefined);
});

test("a thrown historical collector retries the same range on the next sync", async (context) => {
  const bodies = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      bodies.push(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(usageResponse(body)));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-history-throw-once-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const installation = await writeCaptureInstallation(home, `http://127.0.0.1:${address.port}`, {
    date: "2026-09-01",
    events: ["2026-09-01", "2026-07-15"].map((date, index) => ({
      id: `throw-once-${index}`,
      date,
      usage: { date, totalTokens: String(index + 10) },
    })),
    historyBackfillYear: 2026,
    historyBackfillStatus: "pending",
  });
  const marker = join(installation.directory, ".test-fail-history-once");
  await writeFile(marker, "fail once\n");
  const environment = connectorEnvironment(home, {
    NODE_ENV: "test",
    VIBERACING_TEST_NOW: "2026-09-01T12:00:00.000Z",
    VIBERACING_TEST_FAIL_HISTORY_ONCE: "1",
  });

  await execFileAsync(process.execPath, [connectorPath, "sync"], { env: environment });
  const afterFailure = JSON.parse(
    await readFile(join(installation.directory, "state.json"), "utf8"),
  );
  assert.equal(afterFailure.sequences[installation.sourceId], "1");
  assert.equal(afterFailure.history[installation.sourceId].nextRangeEnd, "2026-08-01");
  assert.equal(
    bodies.some((body) => body.snapshots.some((item) => item.kind === "year_backfill")),
    false,
  );
  assert.match(await readFile(installation.capture, "utf8"), /2026-07-15/);

  const beforeRetry = bodies.length;
  await execFileAsync(process.execPath, [connectorPath, "sync"], { env: environment });
  const retriedHistory = bodies
    .slice(beforeRetry)
    .flatMap((body) => body.snapshots)
    .find((snapshot) => snapshot.kind === "year_backfill");
  assert.equal(retriedHistory.rangeEnd, "2026-08-01");
  assert.deepEqual(retriedHistory.entries, [{ date: "2026-07-15", totalTokens: "11" }]);
});

test("a January first sync keeps the cross-year rolling window without a redundant history chunk", async (context) => {
  const bodies = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      bodies.push(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(usageResponse(body)));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-january-rolling-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const installation = await writeCaptureInstallation(home, `http://127.0.0.1:${address.port}`, {
    date: "2027-01-01",
    events: ["2026-12-31", "2027-01-01"].map((date, index) => ({
      id: `new-year-${index}`,
      date,
      usage: { date, totalTokens: String(index + 20) },
    })),
    historyBackfillYear: 2027,
    historyBackfillStatus: "pending",
  });
  await execFileAsync(process.execPath, [connectorPath, "sync"], {
    env: connectorEnvironment(home, {
      NODE_ENV: "test",
      VIBERACING_TEST_NOW: "2027-01-01T12:00:00.000Z",
    }),
  });

  assert.equal(bodies.length, 1);
  assert.deepEqual(bodies[0].snapshots[0], {
    sourceId: installation.sourceId,
    syncSequence: "1",
    kind: "rolling",
    rangeStart: "2026-12-02",
    rangeEnd: "2027-01-01",
    completeness: "complete",
    entries: [
      { date: "2026-12-31", totalTokens: "20" },
      { date: "2027-01-01", totalTokens: "21" },
    ],
    historyYearComplete: "complete",
  });
  const config = JSON.parse(await readFile(join(installation.directory, "config.json"), "utf8"));
  assert.equal(config.sources[0].historyBackfillYear, 2027);
  assert.equal(config.sources[0].historyBackfillStatus, "complete");
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
        response.end(JSON.stringify(usageResponse(body)));
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
  await waitFor(async () => {
    try {
      await access(join(installation.directory, "scheduler.lock"));
      return false;
    } catch {
      return true;
    }
  });
});

test("automatic sync makes one bounded retry after its sync-lock wait expires", async (context) => {
  const bodies = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      bodies.push(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(usageResponse(body)));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-deferred-lock-retry-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const installation = await writeCaptureInstallation(home, `http://127.0.0.1:${address.port}`);
  const syncLock = join(installation.directory, "sync.lock");
  const trace = join(home, "automatic-sync-trace.txt");
  const environment = connectorEnvironment(home, {
    NODE_ENV: "test",
    VIBERACING_TEST_AUTOMATIC_SYNC_TIMINGS: "20,80,40",
    VIBERACING_TEST_AUTOMATIC_SYNC_LOCK_WAIT_MS: "80",
    VIBERACING_TEST_AUTOMATIC_SYNC_TRACE: trace,
  });
  const hookArguments = ["hook", "--source", installation.clientSourceId, "--agent", "antigravity"];

  await writeFile(syncLock, "synthetic-owner\n");
  await runWithInput(hookArguments, environment, "{}");
  await waitFor(
    async () => (await readFile(trace, "utf8").catch(() => "")) === "sync-lock-skipped\n",
  );
  await unlink(syncLock);
  await waitFor(() => bodies.length === 1);
  await waitFor(async () =>
    access(join(installation.directory, "scheduler.lock")).then(
      () => false,
      () => true,
    ),
  );
  await assert.rejects(access(join(installation.directory, "dirty.json")));

  await writeFile(syncLock, "synthetic-owner\n");
  await runWithInput(hookArguments, environment, "{}");
  await waitFor(async () => (await readFile(trace, "utf8")).trim().split("\n").length === 3);
  await waitFor(async () =>
    access(join(installation.directory, "scheduler.lock")).then(
      () => false,
      () => true,
    ),
  );
  await delay(250);
  assert.equal((await readFile(trace, "utf8")).trim().split("\n").length, 3);
  assert.equal(bodies.length, 1);
  await access(join(installation.directory, "dirty.json"));
  await unlink(syncLock);
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
  await assert.rejects(
    execFileAsync(
      process.execPath,
      [
        connectorPath,
        "source",
        "add",
        "--agent",
        "claude_code",
        "--name",
        "Work\u001b[2J",
        "--data-dir",
        sensitivePath,
      ],
      { env: environment },
    ),
    /safe label/,
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
  await execFileAsync(
    process.execPath,
    [
      connectorPath,
      "source",
      "add",
      "--agent",
      "kimi_code",
      "--name",
      "Archive",
      "--data-dir",
      join(home, "archived-kimi"),
      "--legacy",
    ],
    { env: environment },
  );
  const withLegacy = JSON.parse(await readFile(join(state, "sources.json"), "utf8"));
  assert.equal(withLegacy.sources[1].collectionMethod, "kimi_legacy_wire_jsonl");
  await assert.rejects(access(join(state, "config.json")));
});

test("connect pairs only exact sources and keeps every local path out of its payload", async (context) => {
  let pairingBody;
  const pairingBodies = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      if (request.url === "/api/pairing/cancel") {
        response.writeHead(204);
        response.end();
        return;
      }
      if (request.url === "/api/pairing/poll") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: "pending" }));
        return;
      }
      const candidate = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      pairingBodies.push(candidate);
      if (Object.hasOwn(candidate, "browserSyncProtocol")) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_request" }));
        return;
      }
      pairingBody = candidate;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          installationId: pairingBody.installationId,
          pollToken: "privacy_poll_token_that_is_long_enough_1234",
          verificationUrl: `http://${request.headers.host}/connect?code=ABCDEFGH`,
          code: "ABCDEFGH",
          expiresInSeconds: 1,
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
  const home = await mkdtemp(join(tmpdir(), "viberacing-pairing-privacy-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const directory = join(home, ".viberacing");
  await mkdir(directory, { recursive: true });
  await mkdir(join(home, ".codex"), { recursive: true });
  const codexProfileClientSourceId = "22222222-3333-4444-8555-666666666666";
  await writeLocalSources(directory, [
    {
      clientSourceId: "11111111-2222-4333-8444-555555555555",
      agentId: "antigravity",
      dataPath: join(home, "private", "antigravity.jsonl"),
      executablePath: join(home, "private", "agy"),
      hookConfigRoot: join(home, "private", "qwen-config"),
      collectionMethod: "antigravity_cli_capture",
      supportedSurface: "cli",
      suggestedLabel: "Antigravity",
    },
    {
      clientSourceId: codexProfileClientSourceId,
      agentId: "codex",
      dataPath: join(home, ".codex"),
      executablePath: process.execPath,
      collectionMethod: "codex_app_server",
      supportedSurface: "desktop",
      suggestedLabel: "Codex",
    },
    {
      clientSourceId: "33333333-4444-4555-8666-777777777777",
      agentId: "codex",
      dataPath: join(home, ".codex"),
      executablePath: process.execPath,
      collectionMethod: "codex_app_server",
      supportedSurface: "desktop",
      suggestedLabel: "Codex account 2",
      profileClientSourceId: codexProfileClientSourceId,
      providerAccountKey: `acct1_${"x".repeat(43)}`,
    },
  ]);

  await assert.rejects(
    execFileAsync(
      process.execPath,
      [connectorPath, "connect", "--origin", `http://127.0.0.1:${address.port}`],
      {
        env: connectorEnvironment(home, {
          NODE_ENV: "test",
          PATH: "",
          VIBERACING_TEST_PAIRING_POLL_INTERVAL_MS: "10",
        }),
      },
    ),
    /Pairing expired/,
  );
  assert.equal(pairingBodies.length, 2);
  assert.equal(pairingBodies[0].browserSyncCapable, false);
  assert.equal(pairingBodies[0].browserSyncProtocol, 0);
  assert.equal(pairingBodies[0].installedRuntimeVersion, connectorVersion);
  assert.equal(pairingBody.sources.length, 2);
  assert.deepEqual(Object.keys(pairingBody.sources[0]).sort(), [
    "agentId",
    "clientSourceId",
    "collectionMethod",
    "suggestedLabel",
    "supportedSurface",
  ]);
  assert.equal(pairingBody.sources[0].agentId, "antigravity");
  assert.equal(pairingBody.sources[1].agentId, "codex");
  assert.equal(pairingBody.sources[1].clientSourceId, codexProfileClientSourceId);
  assert.equal(
    pairingBodies.some((body) =>
      JSON.stringify(body).includes("33333333-4444-4555-8666-777777777777"),
    ),
    false,
  );
  assert.equal(pairingBody.browserSyncCapable, false);
  assert.equal(Object.hasOwn(pairingBody, "browserSyncProtocol"), false);
  assert.equal(Object.hasOwn(pairingBody, "installedRuntimeVersion"), false);
  assert.doesNotMatch(JSON.stringify(pairingBodies), new RegExp(home.replaceAll("\\", "\\\\")));
  for (const forbidden of [
    "dataPath",
    "canonicalPath",
    "executablePath",
    "hookConfigRoot",
    "prompt",
    "response",
    "model",
    "repository",
    "credentials",
  ])
    assert.equal(JSON.stringify(pairingBodies).includes(forbidden), false);
});

test("connect replaces a legacy OpenCode filename label before pairing and local commit", async (context) => {
  let pairingBody;
  const sourceId = "53535353-5353-4353-8353-535353535353";
  const accountId = "54545454-5454-4454-8454-545454545454";
  const mapping = () => {
    const paired = pairingBody.sources[0];
    return {
      clientSourceId: paired.clientSourceId,
      sourceId,
      agentAccountId: accountId,
      agentId: "opencode",
      accountLabel: paired.suggestedLabel,
      collectionMethod: "opencode_sqlite",
      lastAcceptedSyncSequence: "0",
      historyBackfillYear: new Date().getUTCFullYear(),
      historyBackfillStatus: "complete",
    };
  };
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
      response.setHeader("content-type", "application/json");
      if (request.url === "/api/pairing/start") {
        pairingBody = body;
        response.statusCode = 201;
        response.end(
          JSON.stringify({
            installationId: body.installationId,
            code: "ABCDEFGH",
            pollToken: "opencode_label_poll_token_that_is_long_enough",
            verificationUrl: `http://${request.headers.host}/connect?code=ABCDEFGH`,
            expiresInSeconds: 30,
          }),
        );
        return;
      }
      if (request.url === "/api/installations/current") {
        response.end(JSON.stringify(reconciliationResponse([mapping()])));
        return;
      }
      if (request.url === "/api/pairing/poll") {
        response.end(
          JSON.stringify({
            status: "active",
            deviceToken: "opencode_label_device_token_that_is_long_enough",
            protocol: {
              version: connectorProtocolVersion,
              snapshotDays: 31,
              maximumSources: 32,
              maximumEntries: 1_024,
            },
            sources: [mapping()],
          }),
        );
        return;
      }
      if (request.url === `/api/sources/${sourceId}` && request.method === "DELETE") {
        response.statusCode = 204;
        response.end();
        return;
      }
      response.end(JSON.stringify(usageResponse(body)));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-opencode-label-connect-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const directory = join(home, ".viberacing");
  const dataRoot = join(home, ".local", "share", "opencode");
  const databasePath = join(dataRoot, "opencode-custom-channel.db");
  await mkdir(dataRoot, { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("CREATE TABLE message (id TEXT, time_created INTEGER, data TEXT)");
  database.close();
  await mkdir(directory, { recursive: true });
  await writeLocalSources(directory, [
    {
      clientSourceId: "55555555-5555-4555-8555-555555555555",
      agentId: "opencode",
      dataPath: databasePath,
      collectionMethod: "opencode_sqlite",
      supportedSurface: "cli",
      suggestedLabel: "OpenCode custom-channel",
    },
  ]);
  const lastHookErrorPath = join(directory, "logs", "last-error.log");
  await mkdir(join(directory, "logs"), { recursive: true });
  await writeFile(lastHookErrorPath, "2026-08-18T12:55:27.438Z automatic_sync_failed\n");

  const connected = await execFileAsync(
    process.execPath,
    [connectorPath, "connect", "--origin", `http://127.0.0.1:${address.port}`],
    {
      env: connectorEnvironment(home, {
        NODE_ENV: "test",
        PATH: "",
        VIBERACING_TEST_PAIRING_POLL_INTERVAL_MS: "10",
      }),
    },
  );

  assert.equal(pairingBody.protocolVersion, connectorProtocolVersion);
  assert.match(connected.stdout, /Restart OpenCode once/);
  assert.doesNotMatch(connected.stdout, /Automatic exact aggregate sync is active/);
  assert.equal(pairingBody.sources[0].suggestedLabel, "OpenCode");
  assert.equal(JSON.stringify(pairingBody).includes("custom-channel"), false);
  assert.equal((await readLocalSources(directory))[0].suggestedLabel, "OpenCode");
  await assert.rejects(access(lastHookErrorPath));
  const config = JSON.parse(await readFile(join(directory, "config.json"), "utf8"));
  assert.equal(JSON.stringify(config).includes("custom-channel"), false);
  let pluginPath = join(
    home,
    ".config",
    "opencode",
    "plugins",
    `viberacing-${pairingBody.installationId}.js`,
  );
  const plugin = await readFile(pluginPath, "utf8");
  assert.match(plugin, /^\/\/ viberacing-opencode-plugin /);
  assert.match(plugin, /session\.status/);
  assert.match(plugin, /session\.idle/);
  assert.doesNotMatch(plugin, /sessionID|project|OPENCODE_/);
  const beforeDoctor = await snapshotStateTree(directory);
  const diagnosed = await execFileAsync(process.execPath, [connectorPath, "doctor"], {
    env: connectorEnvironment(home, {
      NODE_ENV: "test",
      VIBERACING_TEST_PAIRING_POLL_INTERVAL_MS: "10",
    }),
  });
  assert.match(diagnosed.stdout, /OpenCode automatic sync plugin: current/);
  assert.doesNotMatch(diagnosed.stdout, /Restart OpenCode/);
  assert.deepEqual(await snapshotStateTree(directory), beforeDoctor);
  assert.equal(await readFile(pluginPath, "utf8"), plugin);
  const originalPluginPath = pluginPath;
  const migratedEnvironment = connectorEnvironment(home, {
    NODE_ENV: "test",
    PATH: "",
    XDG_CONFIG_HOME: join(home, "migrated config"),
  });
  const migratedPluginPath = openCodePluginLocation({
    installationId: pairingBody.installationId,
    environment: migratedEnvironment,
    homeDirectory: home,
  }).path;
  const beforeRelocationDoctor = await snapshotStateTree(home);
  const relocationDoctor = await runWithInput(["doctor"], migratedEnvironment, "");
  assert.equal(relocationDoctor.code, 0, relocationDoctor.stderr);
  assert.match(relocationDoctor.stdout, /OpenCode automatic sync plugin: relocation-required/);
  assert.match(relocationDoctor.stdout, /OpenCode recorded plugin cleanup path: orphaned/);
  assert.doesNotMatch(relocationDoctor.stdout, /OpenCode automatic sync plugin: current/);
  assert.deepEqual(await snapshotStateTree(home), beforeRelocationDoctor);
  assert.equal(await readFile(originalPluginPath, "utf8"), plugin);
  await assert.rejects(access(migratedPluginPath), { code: "ENOENT" });
  const blockedMigrationPlugin = "export const ConcurrentPlugin = async () => ({});\n";
  await mkdir(dirname(migratedPluginPath), { recursive: true });
  await writeFile(migratedPluginPath, blockedMigrationPlugin, { mode: 0o600 });
  await ensureOwnerOnlyWindowsFile(migratedPluginPath);
  const beforeConflictDoctor = await snapshotStateTree(directory);
  const conflictDoctor = await runWithInput(["doctor"], migratedEnvironment, "");
  assert.equal(conflictDoctor.code, 0, conflictDoctor.stderr);
  assert.match(conflictDoctor.stdout, /OpenCode automatic sync plugin: conflict/);
  assert.deepEqual(await snapshotStateTree(directory), beforeConflictDoctor);
  assert.equal(await readFile(migratedPluginPath, "utf8"), blockedMigrationPlugin);
  const blockedDestination = await runWithInput(["doctor", "--repair"], migratedEnvironment, "");
  assert.equal(blockedDestination.code, 1);
  assert.match(blockedDestination.stdout, /OpenCode automatic sync plugin: conflict/);
  assert.equal(await readFile(originalPluginPath, "utf8"), plugin);
  assert.equal(await readFile(migratedPluginPath, "utf8"), blockedMigrationPlugin);
  assert.equal(
    JSON.parse(await readFile(join(directory, "installation.json"), "utf8")).openCodePluginPath,
    originalPluginPath,
  );
  await unlink(migratedPluginPath);
  if (process.platform !== "win32") {
    await chmod(dirname(migratedPluginPath), 0o000);
    const unreadableDoctor = await runWithInput(["doctor"], migratedEnvironment, "");
    await chmod(dirname(migratedPluginPath), 0o700);
    assert.equal(unreadableDoctor.code, 0, unreadableDoctor.stderr);
    assert.match(unreadableDoctor.stdout, /OpenCode automatic sync plugin: unreadable/);
    assert.equal(await readFile(originalPluginPath, "utf8"), plugin);
  }
  await mkdir(migratedPluginPath);
  const unsafeDoctor = await runWithInput(["doctor"], migratedEnvironment, "");
  assert.equal(unsafeDoctor.code, 0, unsafeDoctor.stderr);
  assert.match(unsafeDoctor.stdout, /OpenCode automatic sync plugin: unsafe/);
  await rm(migratedPluginPath, { recursive: true });
  assert.equal(await readFile(originalPluginPath, "utf8"), plugin);
  await unlink(originalPluginPath);
  await writeFile(originalPluginPath, blockedMigrationPlugin, { mode: 0o600 });
  await ensureOwnerOnlyWindowsFile(originalPluginPath);
  const blockedMigration = await runWithInput(["doctor", "--repair"], migratedEnvironment, "");
  assert.equal(blockedMigration.code, 1);
  assert.match(blockedMigration.stdout, /OpenCode automatic sync plugin: conflict/);
  assert.equal(await readFile(originalPluginPath, "utf8"), blockedMigrationPlugin);
  await assert.rejects(access(migratedPluginPath), { code: "ENOENT" });
  assert.equal(
    JSON.parse(await readFile(join(directory, "installation.json"), "utf8")).openCodePluginPath,
    originalPluginPath,
  );
  await unlink(originalPluginPath);
  const migrated = await execFileAsync(process.execPath, [connectorPath, "doctor", "--repair"], {
    env: migratedEnvironment,
  });
  pluginPath = migratedPluginPath;
  assert.match(migrated.stdout, /OpenCode automatic sync plugin: current/);
  assert.match(migrated.stdout, /Restart OpenCode once/);
  assert.equal(
    (
      await inspectOpenCodePlugin({
        installationId: pairingBody.installationId,
        stateRoot: directory,
        pluginPath: originalPluginPath,
      })
    ).status,
    "missing",
  );
  assert.equal(await readFile(pluginPath, "utf8"), plugin);
  assert.equal(
    JSON.parse(await readFile(join(directory, "installation.json"), "utf8")).openCodePluginPath,
    pluginPath,
  );
  const currentAfterMigration = await runWithInput(["doctor"], migratedEnvironment, "");
  assert.equal(currentAfterMigration.code, 0, currentAfterMigration.stderr);
  assert.match(currentAfterMigration.stdout, /OpenCode automatic sync plugin: current/);
  assert.doesNotMatch(currentAfterMigration.stdout, /Restart OpenCode/);
  if (process.platform !== "win32") {
    const aliasedConfigRoot = join(home, "aliased migrated config");
    await symlink(join(home, "migrated config"), aliasedConfigRoot, "dir");
    const aliasedEnvironment = {
      ...migratedEnvironment,
      XDG_CONFIG_HOME: aliasedConfigRoot,
    };
    const aliasedPluginPath = openCodePluginLocation({
      installationId: pairingBody.installationId,
      environment: aliasedEnvironment,
      homeDirectory: home,
    }).path;
    assert.notEqual(aliasedPluginPath, pluginPath);
    const aliasedRepair = await runWithInput(["doctor", "--repair"], aliasedEnvironment, "");
    assert.equal(aliasedRepair.code, 0, aliasedRepair.stderr);
    assert.match(aliasedRepair.stdout, /OpenCode automatic sync plugin: current/);
    assert.equal(await readFile(aliasedPluginPath, "utf8"), plugin);
    assert.equal(await readFile(pluginPath, "utf8"), plugin);
    assert.equal(
      JSON.parse(await readFile(join(directory, "installation.json"), "utf8")).openCodePluginPath,
      aliasedPluginPath,
    );
    const aliasedDoctor = await runWithInput(["doctor"], aliasedEnvironment, "");
    assert.equal(aliasedDoctor.code, 0, aliasedDoctor.stderr);
    assert.match(aliasedDoctor.stdout, /OpenCode automatic sync plugin: current/);

    const canonicalRepair = await runWithInput(["doctor", "--repair"], migratedEnvironment, "");
    assert.equal(canonicalRepair.code, 0, canonicalRepair.stderr);
    assert.match(canonicalRepair.stdout, /OpenCode automatic sync plugin: current/);
    assert.equal(await readFile(pluginPath, "utf8"), plugin);
    assert.equal(
      JSON.parse(await readFile(join(directory, "installation.json"), "utf8")).openCodePluginPath,
      pluginPath,
    );
  }
  const reconnected = await execFileAsync(
    process.execPath,
    [connectorPath, "connect", "--origin", `http://127.0.0.1:${address.port}`],
    {
      env: {
        ...migratedEnvironment,
        VIBERACING_TEST_PAIRING_POLL_INTERVAL_MS: "10",
      },
    },
  );
  assert.doesNotMatch(reconnected.stdout, /Automatic exact aggregate sync is active/);
  assert.match(reconnected.stdout, /OpenCode automatic sync plugin is installed and current/);
  assert.doesNotMatch(reconnected.stdout, /Restart OpenCode once/);
  const installationPath = join(directory, "installation.json");
  const matchingInstallation = await readFile(installationPath, "utf8");
  await writeFile(
    installationPath,
    `${JSON.stringify({
      version: 1,
      id: randomUUID(),
      secret: "mismatched_installation_secret_that_is_long_enough",
    })}\n`,
  );
  const beforeMismatchedIdentityDoctor = await snapshotStateTree(home);
  const mismatchedIdentityDoctor = await runWithInput(["doctor"], migratedEnvironment, "");
  assert.equal(mismatchedIdentityDoctor.code, 0, mismatchedIdentityDoctor.stderr);
  assert.match(
    mismatchedIdentityDoctor.stdout,
    /OpenCode automatic sync plugin: identity-mismatch/,
  );
  assert.doesNotMatch(mismatchedIdentityDoctor.stdout, /OpenCode automatic sync plugin: current/);
  assert.deepEqual(await snapshotStateTree(home), beforeMismatchedIdentityDoctor);
  await writeFile(installationPath, matchingInstallation);
  const configPath = join(directory, "config.json");
  const matchingConfig = JSON.parse(await readFile(configPath, "utf8"));
  const configWithoutIdentity = { ...matchingConfig };
  delete configWithoutIdentity.installationId;
  await writeFile(configPath, `${JSON.stringify(configWithoutIdentity)}\n`);
  const missingConfigIdentityDoctor = await runWithInput(["doctor"], migratedEnvironment, "");
  assert.equal(missingConfigIdentityDoctor.code, 0, missingConfigIdentityDoctor.stderr);
  assert.doesNotMatch(
    missingConfigIdentityDoctor.stdout,
    /OpenCode automatic sync plugin: current/,
  );
  await writeFile(
    configPath,
    `${JSON.stringify({ ...matchingConfig, installationId: randomUUID() })}\n`,
  );
  const mismatchedConfigIdentityDoctor = await runWithInput(["doctor"], migratedEnvironment, "");
  assert.equal(mismatchedConfigIdentityDoctor.code, 0, mismatchedConfigIdentityDoctor.stderr);
  assert.match(
    mismatchedConfigIdentityDoctor.stdout,
    /OpenCode automatic sync plugin: identity-mismatch/,
  );
  assert.doesNotMatch(
    mismatchedConfigIdentityDoctor.stdout,
    /OpenCode automatic sync plugin: current/,
  );
  await writeFile(configPath, `${JSON.stringify(matchingConfig)}\n`);
  const invalidCurrentEnvironment = {
    ...migratedEnvironment,
    XDG_CONFIG_HOME: "relative-config",
  };
  const beforeInvalidCurrentDoctor = await snapshotStateTree(directory);
  const invalidCurrentDoctor = await runWithInput(["doctor"], invalidCurrentEnvironment, "");
  assert.equal(invalidCurrentDoctor.code, 0, invalidCurrentDoctor.stderr);
  assert.match(invalidCurrentDoctor.stdout, /OpenCode automatic sync plugin: unreadable/);
  assert.match(invalidCurrentDoctor.stdout, /OpenCode recorded plugin cleanup path: orphaned/);
  assert.doesNotMatch(invalidCurrentDoctor.stdout, /OpenCode automatic sync plugin: current/);
  assert.deepEqual(await snapshotStateTree(directory), beforeInvalidCurrentDoctor);
  assert.equal(await readFile(pluginPath, "utf8"), plugin);
  const failedMigrationEnvironment = connectorEnvironment(home, {
    NODE_ENV: "test",
    XDG_CONFIG_HOME: join(home, "failed migrated config"),
    VIBERACING_TEST_FAIL_OPENCODE_PLUGIN_PATH_COMMIT: "1",
  });
  const failedMigrationPath = openCodePluginLocation({
    installationId: pairingBody.installationId,
    environment: failedMigrationEnvironment,
    homeDirectory: home,
  }).path;
  const failedMigration = await runWithInput(
    ["doctor", "--repair"],
    failedMigrationEnvironment,
    "",
  );
  assert.equal(failedMigration.code, 1);
  assert.match(failedMigration.stdout, /OpenCode automatic sync plugin: unreadable/);
  await assert.rejects(access(failedMigrationPath), { code: "ENOENT" });
  assert.equal(await readFile(pluginPath, "utf8"), plugin);
  assert.equal(
    JSON.parse(await readFile(join(directory, "installation.json"), "utf8")).openCodePluginPath,
    pluginPath,
  );
  const installationBackup = join(home, "installation-backup.json");
  await rename(join(directory, "installation.json"), installationBackup);
  const missingIdentityEnvironment = connectorEnvironment(home, {
    NODE_ENV: "test",
    XDG_CONFIG_HOME: join(home, "missing identity config"),
  });
  const missingIdentityPath = openCodePluginLocation({
    installationId: pairingBody.installationId,
    environment: missingIdentityEnvironment,
    homeDirectory: home,
  }).path;
  const beforeMissingIdentityDoctor = await snapshotStateTree(home);
  const missingIdentityDoctor = await runWithInput(["doctor"], missingIdentityEnvironment, "");
  assert.equal(missingIdentityDoctor.code, 0, missingIdentityDoctor.stderr);
  assert.match(missingIdentityDoctor.stdout, /OpenCode automatic sync plugin: identity-mismatch/);
  assert.doesNotMatch(missingIdentityDoctor.stdout, /OpenCode automatic sync plugin: current/);
  assert.deepEqual(await snapshotStateTree(home), beforeMissingIdentityDoctor);
  const missingIdentity = await runWithInput(
    ["doctor", "--repair"],
    missingIdentityEnvironment,
    "",
  );
  assert.equal(missingIdentity.code, 1);
  assert.match(missingIdentity.stdout, /OpenCode automatic sync plugin: unreadable/);
  await assert.rejects(access(missingIdentityPath), { code: "ENOENT" });
  assert.equal(await readFile(pluginPath, "utf8"), plugin);
  await rename(installationBackup, join(directory, "installation.json"));
  await unlink(pluginPath);
  const repaired = await execFileAsync(process.execPath, [connectorPath, "doctor", "--repair"], {
    env: migratedEnvironment,
  });
  assert.match(repaired.stdout, /Restart OpenCode once/);
  assert.match(repaired.stdout, /OpenCode automatic sync plugin: current/);
  assert.match(repaired.stdout, /Usage sync: not run/);
  const foreignPlugin = "export const ForeignPlugin = async () => ({});\n";
  await writeFile(pluginPath, foreignPlugin);
  const conflict = await runWithInput(["doctor", "--repair"], migratedEnvironment, "");
  assert.equal(conflict.code, 1);
  assert.match(conflict.stdout, /OpenCode automatic sync plugin: conflict/);
  assert.match(conflict.stderr, /plugin repair is required/);
  assert.equal(await readFile(pluginPath, "utf8"), foreignPlugin);
  await unlink(pluginPath);
  const removed = await execFileAsync(
    process.execPath,
    [connectorPath, "source", "remove", pairingBody.sources[0].clientSourceId],
    {
      env: migratedEnvironment,
    },
  );
  assert.match(removed.stdout, /Source disconnected and removed locally/);
  assert.equal(
    (
      await inspectOpenCodePlugin({
        installationId: pairingBody.installationId,
        stateRoot: directory,
        pluginPath,
      })
    ).status,
    "missing",
  );
});

test("connect restores every Codex logical mapping before its initial sync", async (context) => {
  const primaryClientSourceId = "56565656-5656-4656-8656-565656565656";
  const secondaryClientSourceId = "57575757-5757-4757-8757-575757575757";
  const primarySourceId = "58585858-5858-4858-8858-585858585858";
  const secondarySourceId = "59595959-5959-4959-8959-595959595959";
  const primaryAccountId = "60606060-6060-4060-8060-606060606060";
  const secondaryAccountId = "61616161-6161-4161-8161-616161616161";
  const providerIdentitySalt = "p".repeat(43);
  const events = [];
  let stateDirectory;
  let committedSourcesAtInitialReconcile;
  let pairingBody;
  const primaryMapping = () => ({
    clientSourceId: primaryClientSourceId,
    sourceId: primarySourceId,
    agentAccountId: primaryAccountId,
    agentId: "codex",
    accountLabel: "Codex A",
    collectionMethod: "codex_app_server",
    lastAcceptedSyncSequence: "0",
    historyBackfillYear: new Date().getUTCFullYear(),
    historyBackfillStatus: "pending",
  });
  const secondaryMapping = {
    clientSourceId: secondaryClientSourceId,
    sourceId: secondarySourceId,
    agentAccountId: secondaryAccountId,
    agentId: "codex",
    accountLabel: "Codex account 2",
    collectionMethod: "codex_app_server",
    lastAcceptedSyncSequence: "0",
    historyBackfillYear: new Date().getUTCFullYear(),
    historyBackfillStatus: "pending",
    profileSourceId: primarySourceId,
  };
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
      response.setHeader("content-type", "application/json");
      if (request.url === "/api/pairing/start") {
        pairingBody = body;
        events.push("pairing");
        response.statusCode = 201;
        response.end(
          JSON.stringify({
            installationId: body.installationId,
            code: "ABCDEFGH",
            pollToken: "codex_logical_poll_token_that_is_long_enough",
            verificationUrl: `http://${request.headers.host}/connect?code=ABCDEFGH`,
            expiresInSeconds: 30,
          }),
        );
        return;
      }
      if (request.url === "/api/pairing/poll") {
        events.push("active");
        response.end(
          JSON.stringify({
            status: "active",
            deviceToken: "codex_logical_device_token_that_is_long_enough",
            protocol: {
              version: connectorProtocolVersion,
              snapshotDays: 31,
              maximumSources: 32,
              maximumEntries: 1_024,
            },
            sources: [primaryMapping()],
          }),
        );
        return;
      }
      if (request.url === "/api/installations/current/sources/register") {
        events.push("register-secondary");
        assert.deepEqual(body, {
          agentId: "codex",
          clientSourceId: secondaryClientSourceId,
          collectionMethod: "codex_app_server",
          profileClientSourceId: primaryClientSourceId,
          supportedSurface: "desktop",
        });
        response.end(JSON.stringify({ source: secondaryMapping }));
        return;
      }
      if (request.url === "/api/installations/current") {
        events.push("initial-reconcile");
        committedSourcesAtInitialReconcile = JSON.parse(
          readFileSync(join(stateDirectory, "config.json"), "utf8"),
        ).sources;
        response.end(
          JSON.stringify(
            reconciliationResponse([
              { ...primaryMapping(), status: "disconnected" },
              { ...secondaryMapping, status: "disconnected" },
            ]),
          ),
        );
        return;
      }
      if (request.url === "/api/usage") {
        events.push("initial-usage");
        response.end(JSON.stringify(usageResponse(body)));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not_found" }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-codex-logical-connect-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const directory = join(home, ".viberacing");
  stateDirectory = directory;
  const codexHome = join(home, ".codex");
  const executablePath = join(home, "bin", process.platform === "win32" ? "codex.cmd" : "codex");
  await mkdir(directory, { recursive: true });
  await mkdir(codexHome, { recursive: true });
  await mkdir(dirname(executablePath), { recursive: true });
  await writeExecutableNodeScript(
    executablePath,
    `#!/usr/bin/env node
import { createInterface } from "node:readline";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.id === 0) {
    writeFileSync(join(process.env.CODEX_HOME, "auth.json"), JSON.stringify({ auth_mode: "chatgpt", tokens: { account_id: "pairing-account-A" } }), { mode: 0o600 });
    process.stdout.write(JSON.stringify({ id: 0, result: { userAgent: "synthetic" } }) + "\\n");
  } else if (message.method === "account/read") {
    process.stdout.write(JSON.stringify({ id: message.id, result: { account: { type: "chatgpt", email: "private@example.com", planType: "pro" }, requiresOpenaiAuth: false } }) + "\\n");
  } else if (message.method === "account/usage/read") {
    process.stdout.write(JSON.stringify({ id: message.id, result: { dailyUsageBuckets: [{ startDate: new Date().toISOString().slice(0, 10), tokens: "17" }] } }) + "\\n");
  } else if (message.method === "hooks/list") {
    process.stdout.write(JSON.stringify({ id: message.id, result: { data: [] } }) + "\\n");
  }
}
`,
  );
  const primaryProviderKey = deriveCodexProviderAccountKey(providerIdentitySalt, [
    ["account", "pairing-account-A"],
    ["email", "private@example.com"],
  ]);
  const secondaryProviderKey = deriveCodexProviderAccountKey(providerIdentitySalt, [
    ["account", "pairing-account-B"],
    ["email", "private@example.com"],
  ]);
  const common = {
    agentId: "codex",
    dataPath: codexHome,
    executablePath,
    collectionMethod: "codex_app_server",
    supportedSurface: "desktop",
  };
  await writeFile(join(directory, ".viberacing-state"), '{"format":1}\n');
  await writeFile(
    join(directory, "provider-identity.json"),
    `${JSON.stringify({ version: 1, salt: providerIdentitySalt })}\n`,
    { mode: 0o600 },
  );
  await writeFile(
    join(directory, "sources.json"),
    `${JSON.stringify({
      version: 2,
      sources: [
        {
          ...common,
          clientSourceId: primaryClientSourceId,
          suggestedLabel: "Codex",
          providerAccountKey: primaryProviderKey,
        },
        {
          ...common,
          clientSourceId: secondaryClientSourceId,
          suggestedLabel: "Codex account",
          profileClientSourceId: primaryClientSourceId,
          providerAccountKey: secondaryProviderKey,
        },
      ],
    })}\n`,
  );

  const connected = await execFileAsync(
    process.execPath,
    [connectorPath, "connect", "--origin", `http://127.0.0.1:${address.port}`],
    {
      env: connectorEnvironment(home, {
        NODE_ENV: "test",
        PATH: "",
        VIBERACING_CODEX_BIN: executablePath,
        VIBERACING_TEST_PAIRING_POLL_INTERVAL_MS: "10",
      }),
    },
  );

  assert.match(connected.stdout, /Automatic exact aggregate sync is active/);
  assert.doesNotMatch(connected.stdout, /OpenCode automatic sync plugin repair is required/);

  assert.equal(pairingBody.sources.length, 1);
  assert.equal(pairingBody.sources[0].clientSourceId, primaryClientSourceId);
  assert.ok(events.indexOf("register-secondary") < events.indexOf("initial-reconcile"));
  assert.equal(events.includes("initial-usage"), false);
  assert.deepEqual(
    committedSourcesAtInitialReconcile.map(({ clientSourceId, sourceId, profileSourceId }) => ({
      clientSourceId,
      sourceId,
      ...(profileSourceId === undefined ? {} : { profileSourceId }),
    })),
    [
      { clientSourceId: primaryClientSourceId, sourceId: primarySourceId },
      {
        clientSourceId: secondaryClientSourceId,
        sourceId: secondarySourceId,
        profileSourceId: primarySourceId,
      },
    ],
  );
});

test("later disconnect defeats pending, active-polled, and interrupted connect attempts", async (context) => {
  const installationId = "19191919-1919-4191-8191-191919191919";
  const clientSourceId = "20202020-2020-4202-8202-202020202020";
  const sourceId = "21212121-2121-4212-8212-212121212121";
  const mapping = {
    clientSourceId,
    sourceId,
    agentAccountId: "22222222-2222-4222-8222-222222222222",
    agentId: "antigravity",
    accountLabel: "Antigravity",
    collectionMethod: "antigravity_cli_capture",
    lastAcceptedSyncSequence: "0",
    historyBackfillYear: new Date().getUTCFullYear(),
    historyBackfillStatus: "complete",
  };
  let serverState = "pending";
  let nextPairingState = "pending";
  let pairingStarts = 0;
  let cancellations = 0;
  let deletes = 0;
  let deleteFailure = false;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
      if (request.url === "/api/installations/current" && request.method === "POST") {
        const status = serverState === "revoked" ? 401 : 200;
        response.writeHead(status, { "content-type": "application/json" });
        response.end(
          JSON.stringify(
            status === 401 ? { error: "unauthorized" } : reconciliationResponse([mapping]),
          ),
        );
        return;
      }
      if (request.url === "/api/installations/current" && request.method === "DELETE") {
        deletes += 1;
        const status = deleteFailure ? 503 : serverState === "revoked" ? 401 : 204;
        if (!deleteFailure) serverState = "revoked";
        response.writeHead(status, status === 204 ? {} : { "content-type": "application/json" });
        response.end(
          status === 204
            ? undefined
            : JSON.stringify({ error: status === 401 ? "unauthorized" : "server_error" }),
        );
        return;
      }
      if (request.url === "/api/pairing/start") {
        pairingStarts += 1;
        serverState = nextPairingState;
        response.writeHead(201, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            installationId: body.installationId,
            code: "RACETEST",
            pollToken: "race_poll_token_that_is_long_enough_123456",
            verificationUrl: `http://${request.headers.host}/connect?code=RACETEST`,
            expiresInSeconds: 30,
          }),
        );
        return;
      }
      if (request.url === "/api/pairing/cancel") {
        cancellations += 1;
        serverState = "revoked";
        response.writeHead(204);
        response.end();
        return;
      }
      if (request.url === "/api/pairing/poll") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify(
            serverState === "active"
              ? {
                  status: "active",
                  deviceToken: "race_replacement_device_token_that_is_long_enough",
                  sources: [mapping],
                  protocol: {
                    version: connectorProtocolVersion,
                    snapshotDays: 31,
                    maximumSources: 32,
                    maximumEntries: 1_024,
                  },
                }
              : { status: serverState },
          ),
        );
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(usageResponse(body)));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const home = await mkdtemp(join(tmpdir(), "viberacing-connect-disconnect-race-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const directory = join(home, ".viberacing");
  const capture = join(directory, "captures", `${clientSourceId}.jsonl`);
  await mkdir(join(directory, "captures"), { recursive: true });
  await writeFile(capture, "");
  const localSource = {
    clientSourceId,
    agentId: "antigravity",
    dataPath: capture,
    collectionMethod: "antigravity_cli_capture",
    supportedSurface: "cli",
    suggestedLabel: "Antigravity",
  };
  await writeLocalSources(directory, [localSource]);
  const writeInstallationIdentity = (openCodePluginPath) =>
    writeFile(
      join(directory, "installation.json"),
      `${JSON.stringify({
        version: 1,
        id: installationId,
        secret: "race_installation_secret_that_is_long_enough",
        ...(openCodePluginPath === undefined ? {} : { openCodePluginPath }),
      })}\n`,
    );
  const writePreviousConnection = async () => {
    await writeLocalSources(directory, [localSource]);
    await writeFile(
      join(directory, "config.json"),
      `${JSON.stringify({
        version: 2,
        origin,
        installationId,
        deviceToken: "race_previous_device_token_that_is_long_enough",
        sources: [mapping],
        protocol: { version: 2, snapshotDays: 31, maximumSources: 32, maximumEntries: 1_024 },
      })}\n`,
    );
  };
  const baseEnvironment = connectorEnvironment(home, {
    NODE_ENV: "test",
    PATH: "",
    VIBERACING_TEST_PAIRING_POLL_INTERVAL_MS: "10",
  });
  const spawnConnect = (extra = {}) => {
    const child = spawn(process.execPath, [connectorPath, "connect", "--origin", origin], {
      env: { ...baseEnvironment, ...extra },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    return {
      child,
      result: once(child, "close").then(([code, signal]) => ({ code, signal, stderr })),
    };
  };
  const runBarrierRace = async (stage, lifecycleArguments = ["disconnect"]) => {
    const barrier = join(home, `connect-${stage}-${randomUUID()}`);
    const connect = spawnConnect({
      VIBERACING_TEST_CONNECT_PAUSE: stage,
      VIBERACING_TEST_CONNECT_BARRIER: barrier,
    });
    await waitFor(() =>
      access(`${barrier}.ready`)
        .then(() => true)
        .catch(() => false),
    );
    await execFileAsync(process.execPath, [connectorPath, ...lifecycleArguments], {
      env: baseEnvironment,
    });
    await writeFile(`${barrier}.continue`, "continue\n");
    return connect.result;
  };

  const installedPlugin = await reconcileOpenCodePlugin({
    installationId,
    stateRoot: directory,
    environment: baseEnvironment,
    homeDirectory: home,
    desired: true,
  });
  await writeInstallationIdentity(installedPlugin.path);
  await writePreviousConnection();
  serverState = "active";
  const reconciliationBarrier = join(home, `connect-reconciliation-${randomUUID()}`);
  const staleConnect = spawnConnect({
    VIBERACING_TEST_CONNECT_PAUSE: "after_previous_connection_reconciliation",
    VIBERACING_TEST_CONNECT_BARRIER: reconciliationBarrier,
  });
  await waitFor(() =>
    access(`${reconciliationBarrier}.ready`)
      .then(() => true)
      .catch(() => false),
  );
  const startsBeforeDisconnect = pairingStarts;
  const disconnected = await execFileAsync(process.execPath, [connectorPath, "disconnect"], {
    env: {
      ...baseEnvironment,
      VIBERACING_TEST_FAIL_INSTALLATION_IDENTITY_REMOVAL: "1",
    },
  });
  assert.match(disconnected.stderr, /local authorization was removed.*manual inspection/i);
  await assert.rejects(access(join(directory, "config.json")), { code: "ENOENT" });
  await access(join(directory, "installation.json"));
  await assert.rejects(access(installedPlugin.path), { code: "ENOENT" });
  await writeFile(`${reconciliationBarrier}.continue`, "continue\n");
  const staleResult = await staleConnect.result;
  assert.equal(staleResult.code, 1);
  assert.match(staleResult.stderr, /Local connection changed while preparing the connection/);
  assert.equal(pairingStarts, startsBeforeDisconnect);
  await assert.rejects(access(join(directory, "config.json")), { code: "ENOENT" });
  await assert.rejects(access(join(directory, "connect-attempt.json")), { code: "ENOENT" });
  await access(join(directory, "installation.json"));

  await writeInstallationIdentity();
  await writePreviousConnection();
  serverState = "active";
  const preAttemptBarrier = join(home, `connect-pre-attempt-${randomUUID()}`);
  const pendingCleanupConnect = spawnConnect({
    VIBERACING_TEST_CONNECT_PAUSE: "before_begin_connect_attempt",
    VIBERACING_TEST_CONNECT_BARRIER: preAttemptBarrier,
  });
  await waitFor(() =>
    access(`${preAttemptBarrier}.ready`)
      .then(() => true)
      .catch(() => false),
  );
  const pendingInstallationId = "23232323-2323-4232-8232-232323232323";
  const pendingPath = openCodePluginLocation({
    installationId: pendingInstallationId,
    environment: baseEnvironment,
    homeDirectory: home,
  }).path;
  await mkdir(dirname(pendingPath), { recursive: true });
  await writeFile(pendingPath, "export const KeepForeignPlugin = true;\n", { mode: 0o600 });
  await ensureOwnerOnlyWindowsFile(pendingPath);
  await writeFile(
    join(directory, "opencode-plugin-cleanup.json"),
    `${JSON.stringify({
      version: 1,
      installationId: pendingInstallationId,
      openCodePluginPath: pendingPath,
    })}\n`,
    { mode: 0o600 },
  );
  const startsBeforePendingCleanup = pairingStarts;
  await writeFile(`${preAttemptBarrier}.continue`, "continue\n");
  const pendingCleanupResult = await pendingCleanupConnect.result;
  assert.equal(pendingCleanupResult.code, 1);
  assert.match(pendingCleanupResult.stderr, /Pending OpenCode plugin cleanup is incomplete/);
  assert.equal(pairingStarts, startsBeforePendingCleanup);
  await assert.rejects(access(join(directory, "connect-attempt.json")), { code: "ENOENT" });
  await access(join(directory, "config.json"));
  await unlink(pendingPath);
  await unlink(join(directory, "opencode-plugin-cleanup.json"));
  await unlink(join(directory, "config.json"));
  await writeInstallationIdentity();

  const pendingResult = await runBarrierRace("after_pairing_start");
  assert.equal(pendingResult.code, 1);
  assert.match(pendingResult.stderr, /Pairing was revoked/);
  await assert.rejects(access(join(directory, "config.json")));
  await assert.rejects(access(join(directory, "connect-attempt.json")));

  const resetResult = await runBarrierRace("after_pairing_start", ["reset-installation"]);
  assert.equal(resetResult.code, 1);
  await assert.rejects(access(join(directory, "installation.json")));
  await assert.rejects(access(join(directory, "config.json")));
  await writeInstallationIdentity();

  const addedPath = join(home, "added-claude");
  const addResult = await runBarrierRace("after_pairing_start", [
    "source",
    "add",
    "--agent",
    "claude_code",
    "--name",
    "Added during pairing",
    "--data-dir",
    addedPath,
  ]);
  assert.equal(addResult.code, 1);
  const addedSource = (await readLocalSources(directory)).find(
    (source) => source.dataPath === addedPath,
  );
  assert.ok(addedSource);
  await assert.rejects(access(join(directory, "config.json")));

  const removeResult = await runBarrierRace("after_pairing_start", [
    "source",
    "remove",
    addedSource.clientSourceId,
  ]);
  assert.equal(removeResult.code, 1);
  assert.equal(
    (await readLocalSources(directory)).some(
      (source) => source.clientSourceId === addedSource.clientSourceId,
    ),
    false,
  );
  await assert.rejects(access(join(directory, "config.json")));

  await writeInstallationIdentity();
  await writePreviousConnection();
  serverState = "active";
  nextPairingState = "active";
  const activeResult = await runBarrierRace("after_active_poll");
  assert.equal(activeResult.code, 1);
  assert.match(activeResult.stderr, /superseded by a local lifecycle change/);
  await assert.rejects(access(join(directory, "config.json")));
  await assert.rejects(access(join(directory, "connection-commit.json")));
  await assert.rejects(access(join(directory, "connect-attempt.json")));

  await writeInstallationIdentity();
  await writePreviousConnection();
  serverState = "active";
  nextPairingState = "active";
  const interruptionBarrier = join(home, `connect-interruption-${randomUUID()}`);
  const interrupted = spawnConnect({
    VIBERACING_TEST_CONNECT_PAUSE: "after_active_poll",
    VIBERACING_TEST_CONNECT_BARRIER: interruptionBarrier,
  });
  await waitFor(() =>
    access(`${interruptionBarrier}.ready`)
      .then(() => true)
      .catch(() => false),
  );
  assert.equal(interrupted.child.kill("SIGKILL"), true);
  const interruptedResult = await interrupted.result;
  assert.ok(interruptedResult.signal !== null || interruptedResult.code !== 0);
  await access(join(directory, "connect-attempt.json"));
  nextPairingState = "pending";
  const restartedResult = await runBarrierRace("after_pairing_start");
  assert.equal(restartedResult.code, 1);
  await assert.rejects(access(join(directory, "config.json")));
  await assert.rejects(access(join(directory, "connect-attempt.json")));
  await assert.rejects(access(join(directory, "dirty.json")));
  assert.ok(cancellations >= 6);
  assert.ok(deletes >= 1);

  await writePreviousConnection();
  await writeFile(
    join(directory, "connect-attempt.json"),
    `${JSON.stringify({
      version: 1,
      attemptId: randomUUID(),
      installationId,
      sourceRegistryRevision: randomUUID(),
      origin,
      startedAt: new Date().toISOString(),
      pollToken: "race_poll_token_that_is_long_enough_123456",
    })}\n`,
  );
  serverState = "active";
  deleteFailure = true;
  const uncertainDisconnect = await execFileAsync(process.execPath, [connectorPath, "disconnect"], {
    env: baseEnvironment,
  });
  assert.match(uncertainDisconnect.stderr, /remote revoke could not be confirmed/);
});

test("reconnect rejects omission and retains a temporarily unavailable source", async (context) => {
  let pairingBody;
  let omitRetained = true;
  const installationId = "67676767-6767-4767-8767-676767676767";
  const activeClientSourceId = "68686868-6868-4868-8868-686868686868";
  const retainedClientSourceId = "69696969-6969-4969-8969-696969696969";
  const activeSourceId = "70707070-7070-4070-8070-707070707070";
  const retainedSourceId = "71717171-7171-4171-8171-717171717171";
  const mappings = [
    {
      clientSourceId: activeClientSourceId,
      sourceId: activeSourceId,
      agentAccountId: "72727272-7272-4272-8272-727272727272",
      agentId: "antigravity",
      accountLabel: "Active",
      collectionMethod: "antigravity_cli_capture",
      lastAcceptedSyncSequence: "0",
      historyBackfillYear: new Date().getUTCFullYear(),
      historyBackfillStatus: "complete",
    },
    {
      clientSourceId: retainedClientSourceId,
      sourceId: retainedSourceId,
      agentAccountId: "73737373-7373-4373-8373-737373737373",
      agentId: "claude_code",
      accountLabel: "Retained",
      collectionMethod: "claude_jsonl",
      lastAcceptedSyncSequence: "0",
      historyBackfillYear: new Date().getUTCFullYear(),
      historyBackfillStatus: "complete",
    },
  ];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(request.url === "/api/pairing/start" ? 201 : 200, {
        "content-type": "application/json",
      });
      if (request.url === "/api/installations/current") {
        response.end(JSON.stringify(reconciliationResponse(mappings)));
        return;
      }
      if (request.url === "/api/pairing/start") {
        pairingBody = body;
        response.end(
          JSON.stringify({
            installationId,
            code: "ABCDEFGH",
            pollToken: "retained_poll_token_that_is_long_enough_1234",
            verificationUrl: `http://${request.headers.host}/connect?code=ABCDEFGH`,
            expiresInSeconds: 30,
          }),
        );
        return;
      }
      if (request.url === "/api/pairing/poll") {
        response.end(
          JSON.stringify({
            status: "active",
            deviceToken: "retained_device_token_that_is_long_enough_12",
            protocol: {
              version: connectorProtocolVersion,
              snapshotDays: 31,
              maximumSources: 32,
              maximumEntries: 1_024,
            },
            sources: omitRetained ? mappings.slice(0, 1) : mappings,
          }),
        );
        return;
      }
      response.end(JSON.stringify(usageResponse(body)));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const home = await mkdtemp(join(tmpdir(), "viberacing-retained-reconnect-"));
  context.after(() => rm(home, { recursive: true }));
  const directory = join(home, ".viberacing");
  const capture = join(directory, "captures", `${activeClientSourceId}.jsonl`);
  await mkdir(join(directory, "captures"), { recursive: true });
  await writeFile(capture, "");
  const sources = [
    {
      clientSourceId: activeClientSourceId,
      agentId: "antigravity",
      dataPath: capture,
      collectionMethod: "antigravity_cli_capture",
      supportedSurface: "cli",
      suggestedLabel: "Active",
    },
    {
      clientSourceId: retainedClientSourceId,
      agentId: "claude_code",
      dataPath: join(home, ".claude", "projects"),
      collectionMethod: "claude_jsonl",
      supportedSurface: "cli",
      suggestedLabel: "Retained",
    },
  ];
  await writeLocalSources(directory, sources);
  await writeFile(
    join(directory, "installation.json"),
    `${JSON.stringify({
      version: 1,
      id: installationId,
      secret: "retained_installation_secret_that_is_long_enough",
    })}\n`,
  );
  await writeFile(
    join(directory, "config.json"),
    `${JSON.stringify({
      version: 2,
      origin,
      installationId,
      deviceToken: "previous_device_token_that_is_long_enough_12",
      sources: mappings,
      protocol: { version: 2, snapshotDays: 31, maximumSources: 32, maximumEntries: 1_024 },
    })}\n`,
  );
  await writeFile(
    join(directory, "state.json"),
    `${JSON.stringify({
      version: 1,
      sequences: { [activeSourceId]: "0", [retainedSourceId]: "0" },
    })}\n`,
  );
  await mkdir(join(home, ".claude"), { recursive: true });
  const hookPath = join(home, ".claude", "settings.json");
  await writeFile(hookPath, '{"hooks":{"Stop":[{"hooks":[{"command":"keep-me"}]}]}}\n');
  const configBefore = await readFile(join(directory, "config.json"));
  const sourcesBefore = await readFile(join(directory, "sources.json"));
  const hookBefore = await readFile(hookPath);
  const environment = connectorEnvironment(home, {
    NODE_ENV: "test",
    PATH: "",
    VIBERACING_TEST_PAIRING_POLL_INTERVAL_MS: "10",
  });

  await assert.rejects(
    execFileAsync(process.execPath, [connectorPath, "connect", "--origin", origin], {
      env: environment,
    }),
    /invalid protocol response/,
  );
  assert.deepEqual(await readFile(join(directory, "config.json")), configBefore);
  assert.deepEqual(await readFile(join(directory, "sources.json")), sourcesBefore);
  assert.deepEqual(await readFile(hookPath), hookBefore);

  omitRetained = false;
  await assert.rejects(
    execFileAsync(process.execPath, [connectorPath, "connect", "--origin", origin], {
      env: { ...environment, VIBERACING_TEST_FAIL_CONNECTION_CONFIG_COMMIT: "1" },
    }),
    /Synthetic connection config commit failure/,
  );
  assert.deepEqual(await readFile(join(directory, "config.json")), configBefore);
  assert.deepEqual(await readFile(join(directory, "sources.json")), sourcesBefore);
  assert.deepEqual(await readFile(hookPath), hookBefore);

  let interruption;
  try {
    await execFileAsync(process.execPath, [connectorPath, "connect", "--origin", origin], {
      env: { ...environment, VIBERACING_TEST_INTERRUPT_AFTER_CONNECTION_COMMIT: "1" },
    });
  } catch (error) {
    interruption = error;
  }
  assert.ok(Number.isInteger(interruption?.code) && interruption.code !== 0);
  assert.equal(
    JSON.parse(await readFile(join(directory, "config.json"), "utf8")).deviceToken,
    "retained_device_token_that_is_long_enough_12",
  );
  await access(join(directory, "connection-commit.json"));
  assert.deepEqual(await readFile(hookPath), hookBefore);
  await execFileAsync(process.execPath, [connectorPath, "doctor", "--repair"], {
    env: environment,
  });
  await assert.rejects(access(join(directory, "connection-commit.json")));
  assert.match(await readFile(hookPath, "utf8"), /viberacing-hook-v3/);

  await writeFile(hookPath, "{invalid-json");
  const connectedResult = await execFileAsync(
    process.execPath,
    [connectorPath, "connect", "--origin", origin],
    { env: environment },
  );
  assert.match(connectedResult.stderr, /hook: Cannot read hook settings/);
  assert.equal(await readFile(hookPath, "utf8"), "{invalid-json");
  assert.deepEqual(
    pairingBody.sources.map((source) => source.clientSourceId),
    [activeClientSourceId],
  );
  const connected = JSON.parse(await readFile(join(directory, "config.json"), "utf8"));
  assert.equal(connected.deviceToken, "retained_device_token_that_is_long_enough_12");
  assert.deepEqual(
    connected.sources.map((source) => source.sourceId).sort(),
    [activeSourceId, retainedSourceId].sort(),
  );

  await writeFile(hookPath, '{"hooks":{"Stop":[{"hooks":[{"command":"keep-me"}]}]}}\n');
  await execFileAsync(process.execPath, [connectorPath, "doctor", "--repair"], {
    env: environment,
  });
  assert.match(await readFile(hookPath, "utf8"), /viberacing-hook-v3/);
});

test("reconnect preserves transient failures, retires disconnected sources, and recovers revoked authorization", async (context) => {
  let mode = "malformed";
  let pairingStarts = 0;
  let pairingBody;
  const installationId = "74747474-7474-4474-8474-747474747474";
  const retiredClientSourceId = "75757575-7575-4575-8575-757575757575";
  const activeClientSourceId = "76767676-7676-4676-8676-767676767676";
  const retiredSourceId = "77777777-7777-4777-8777-777777777777";
  const activeSourceId = "78787878-7878-4878-8878-787878787878";
  const activeMapping = {
    clientSourceId: activeClientSourceId,
    sourceId: activeSourceId,
    agentAccountId: "79797979-7979-4979-8979-797979797979",
    agentId: "antigravity",
    accountLabel: "Available",
    collectionMethod: "antigravity_cli_capture",
    lastAcceptedSyncSequence: "3",
    historyBackfillYear: new Date().getUTCFullYear(),
    historyBackfillStatus: "complete",
  };
  const retiredMapping = {
    clientSourceId: retiredClientSourceId,
    sourceId: retiredSourceId,
    agentAccountId: "80808080-8080-4080-8080-808080808080",
    agentId: "claude_code",
    accountLabel: "Unavailable",
    collectionMethod: "claude_jsonl",
    lastAcceptedSyncSequence: "2",
    historyBackfillYear: new Date().getUTCFullYear(),
    historyBackfillStatus: "complete",
  };
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
      response.setHeader("content-type", "application/json");
      if (request.url === "/api/installations/current") {
        if (mode === "malformed") {
          response.end(JSON.stringify(reconciliationResponse([activeMapping])));
          return;
        }
        if (mode === "transient") {
          response.statusCode = 503;
          response.end(JSON.stringify({ error: "server_error" }));
          return;
        }
        if (mode === "unauthorized") {
          response.statusCode = 401;
          response.end(JSON.stringify({ error: "unauthorized" }));
          return;
        }
        response.end(
          JSON.stringify(
            reconciliationResponse([
              { ...retiredMapping, status: "disconnected" },
              { ...activeMapping, status: "active" },
            ]),
          ),
        );
        return;
      }
      if (request.url === "/api/pairing/start") {
        pairingStarts += 1;
        pairingBody = body;
        response.statusCode = 201;
        response.end(
          JSON.stringify({
            installationId: body.installationId,
            code: "ABCDEFGH",
            pollToken: "dashboard_disconnect_poll_token_long_enough",
            verificationUrl: `http://${request.headers.host}/connect?code=ABCDEFGH`,
            expiresInSeconds: 30,
          }),
        );
        return;
      }
      if (request.url === "/api/pairing/poll") {
        mode = "disconnected";
        response.end(
          JSON.stringify({
            status: "active",
            deviceToken: "dashboard_disconnect_device_token_long_enough",
            protocol: {
              version: connectorProtocolVersion,
              snapshotDays: 31,
              maximumSources: 32,
              maximumEntries: 1_024,
            },
            sources: [activeMapping],
          }),
        );
        return;
      }
      response.end(JSON.stringify(usageResponse(body)));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const home = await mkdtemp(join(tmpdir(), "viberacing-dashboard-disconnect-reconnect-"));
  context.after(() => rm(home, { recursive: true }));
  const directory = join(home, ".viberacing");
  const capture = join(directory, "captures", `${activeClientSourceId}.jsonl`);
  const hookRoot = join(home, ".claude");
  await mkdir(join(directory, "captures"), { recursive: true });
  await mkdir(hookRoot, { recursive: true });
  await writeFile(capture, "");
  await writeLocalSources(directory, [
    {
      clientSourceId: retiredClientSourceId,
      agentId: "claude_code",
      dataPath: join(hookRoot, "projects"),
      hookConfigRoot: hookRoot,
      collectionMethod: "claude_jsonl",
      supportedSurface: "cli",
      suggestedLabel: "Unavailable",
    },
    {
      clientSourceId: activeClientSourceId,
      agentId: "antigravity",
      dataPath: capture,
      collectionMethod: "antigravity_cli_capture",
      supportedSurface: "cli",
      suggestedLabel: "Available",
    },
  ]);
  await writeFile(
    join(directory, "installation.json"),
    `${JSON.stringify({
      version: 1,
      id: installationId,
      secret: "dashboard_disconnect_installation_secret_long_enough",
    })}\n`,
  );
  await writeFile(
    join(directory, "config.json"),
    `${JSON.stringify({
      version: 2,
      origin,
      installationId,
      deviceToken: "dashboard_disconnect_previous_token_long_enough",
      sources: [retiredMapping, activeMapping],
      protocol: { version: 2, snapshotDays: 31, maximumSources: 32, maximumEntries: 1_024 },
    })}\n`,
  );
  await writeFile(
    join(directory, "state.json"),
    `${JSON.stringify({
      version: 1,
      sequences: { [retiredSourceId]: "2", [activeSourceId]: "3" },
    })}\n`,
  );
  await writeFile(
    join(hookRoot, "settings.json"),
    `${JSON.stringify({
      hooks: {
        Stop: [
          { hooks: [{ command: "keep-foreign" }] },
          {
            hooks: [
              {
                command: `node hook --viberacing-hook-id=viberacing-hook-v3:${retiredClientSourceId}`,
              },
            ],
          },
        ],
      },
    })}\n`,
  );
  const configBefore = await readFile(join(directory, "config.json"));
  const hookBefore = await readFile(join(hookRoot, "settings.json"));
  const environment = connectorEnvironment(home, {
    NODE_ENV: "test",
    PATH: "",
    VIBERACING_TEST_PAIRING_POLL_INTERVAL_MS: "10",
  });

  for (const failure of [
    ["malformed", /invalid protocol response/],
    ["transient", /server_error/],
  ]) {
    mode = failure[0];
    await assert.rejects(
      execFileAsync(process.execPath, [connectorPath, "connect", "--origin", origin], {
        env: environment,
      }),
      failure[1],
    );
    assert.deepEqual(await readFile(join(directory, "config.json")), configBefore);
    assert.deepEqual(await readFile(join(hookRoot, "settings.json")), hookBefore);
    assert.equal(pairingStarts, 0);
  }

  mode = "disconnected";
  await execFileAsync(process.execPath, [connectorPath, "connect", "--origin", origin], {
    env: environment,
  });
  assert.equal(pairingStarts, 1);
  assert.deepEqual(
    pairingBody.sources.map((source) => source.clientSourceId),
    [activeClientSourceId],
  );
  const connected = JSON.parse(await readFile(join(directory, "config.json"), "utf8"));
  assert.equal(connected.deviceToken, "dashboard_disconnect_device_token_long_enough");
  assert.deepEqual(
    connected.sources.map((source) => source.sourceId),
    [activeSourceId],
  );
  const hook = await readFile(join(hookRoot, "settings.json"), "utf8");
  assert.match(hook, /keep-foreign/);
  assert.doesNotMatch(hook, new RegExp(retiredClientSourceId));

  const pending = join(directory, "pending");
  await mkdir(pending, { recursive: true });
  await writeFile(join(pending, `${activeSourceId}.json`), '{"stale":true}\n');
  mode = "unauthorized";
  const reconnected = await execFileAsync(
    process.execPath,
    [connectorPath, "connect", "--origin", origin],
    { env: environment },
  );
  assert.match(
    reconnected.stdout,
    /Previous installation authorization is no longer valid; reconnecting/,
  );
  assert.equal(pairingStarts, 2);
  await assert.rejects(access(join(pending, `${activeSourceId}.json`)));
  const reconnectedConfig = JSON.parse(await readFile(join(directory, "config.json"), "utf8"));
  assert.notEqual(reconnectedConfig.installationId, installationId);
  assert.equal(reconnectedConfig.installationId, pairingBody.installationId);
  assert.equal(reconnectedConfig.deviceToken, "dashboard_disconnect_device_token_long_enough");
});

test("hostile pairing response cannot change config, hooks, or local paths", async (context) => {
  let localSource;
  const maliciousRoot = join(tmpdir(), `viberacing-malicious-${process.pid}`);
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(200, { "content-type": "application/json" });
      if (request.url === "/api/pairing/start") {
        response.end(
          JSON.stringify({
            installationId: body.installationId,
            code: "ABCDEFGH",
            pollToken: "hostile_poll_token_that_is_long_enough_1234",
            verificationUrl: `http://${request.headers.host}/connect?code=ABCDEFGH`,
            expiresInSeconds: 30,
          }),
        );
        return;
      }
      response.end(
        JSON.stringify({
          status: "active",
          deviceToken: "hostile_device_token_that_is_long_enough_12",
          protocol: {
            version: connectorProtocolVersion,
            snapshotDays: 31,
            maximumSources: 32,
            maximumEntries: 1_024,
          },
          sources: [
            {
              clientSourceId: localSource.clientSourceId,
              sourceId: localSource.sourceId,
              agentAccountId: "56565656-5656-4656-8656-565656565656",
              agentId: "antigravity",
              accountLabel: "Hostile",
              collectionMethod: "antigravity_cli_capture",
              lastAcceptedSyncSequence: "0",
              hookConfigRoot: maliciousRoot,
            },
          ],
        }),
      );
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  context.after(() => rm(maliciousRoot, { force: true, recursive: true }));
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-hostile-pairing-"));
  context.after(() => rm(home, { recursive: true }));
  const installation = await writeCaptureInstallation(home, `http://127.0.0.1:${address.port}`);
  localSource = installation;
  await writeFile(
    join(installation.directory, "installation.json"),
    `${JSON.stringify({
      version: 1,
      id: "57575757-5757-4757-8757-575757575757",
      secret: "local_installation_secret_that_is_long_enough",
    })}\n`,
  );
  const hookPath = join(home, ".claude", "settings.json");
  await mkdir(join(home, ".claude"), { recursive: true });
  await writeFile(hookPath, '{"hooks":{"Stop":[{"hooks":[{"command":"keep-me"}]}]}}\n');
  const configBefore = await readFile(join(installation.directory, "config.json"));
  const sourcesBefore = await readFile(join(installation.directory, "sources.json"));
  const hookBefore = await readFile(hookPath);

  await assert.rejects(
    execFileAsync(
      process.execPath,
      [connectorPath, "connect", "--origin", `http://127.0.0.1:${address.port}`],
      {
        env: connectorEnvironment(home, {
          NODE_ENV: "test",
          PATH: "",
          VIBERACING_TEST_PAIRING_POLL_INTERVAL_MS: "10",
        }),
      },
    ),
    /invalid protocol response/,
  );
  assert.deepEqual(await readFile(join(installation.directory, "config.json")), configBefore);
  assert.deepEqual(await readFile(join(installation.directory, "sources.json")), sourcesBefore);
  assert.deepEqual(await readFile(hookPath), hookBefore);
  await assert.rejects(access(maliciousRoot));
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
      adapters: { [sourceId]: { qwen: 1 } },
      history: {
        [sourceId]: { year: 2026, nextRangeEnd: "2026-08-01", hadPartialChunk: false },
      },
      fingerprints: { [sourceId]: "fingerprint" },
      quarantine: { [sourceId]: "invalid_payload" },
      collectionWarnings: { [sourceId]: ["codex_session_components_incomplete"] },
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
  assert.equal(localState.history[sourceId], undefined);
  assert.equal(localState.fingerprints[sourceId], undefined);
  assert.equal(localState.quarantine[sourceId], undefined);
  assert.equal(localState.collectionWarnings[sourceId], undefined);
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
    hookConfigRoot: root,
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
    if (request.method === "POST" && request.url === "/api/installations/current") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(reconciliationResponse([{ sourceId }])));
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

test("doctor fails closed until Codex trusts the stable owned hook", async (context) => {
  const clientSourceId = "71717171-7171-4171-8171-717171717171";
  const sourceId = "72727272-7272-4272-8272-727272727272";
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      if (request.url !== "/api/installations/reconcile") {
        response.writeHead(404).end();
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify(
          reconciliationResponse([
            {
              sourceId: body.sourceIds[0],
              agentId: "codex",
              collectionMethod: "codex_app_server",
              status: "active",
              lastAcceptedSyncSequence: "0",
            },
          ]),
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

  const home = await mkdtemp(join(tmpdir(), "viberacing-doctor-codex-trust-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const codexHome = join(home, ".codex");
  const bin = join(home, "bin");
  const executablePath = join(bin, process.platform === "win32" ? "codex.cmd" : "codex");
  await mkdir(codexHome, { recursive: true });
  await mkdir(bin, { recursive: true });
  await writeFakeCodexHookServer(executablePath);
  const source = {
    clientSourceId,
    sourceId,
    agentId: "codex",
    dataPath: codexHome,
    executablePath,
    collectionMethod: "codex_app_server",
    supportedSurface: "desktop",
    suggestedLabel: "Codex",
  };
  const directory = await writeMappedInstallation(home, `http://127.0.0.1:${address.port}`, [
    source,
  ]);
  const environment = connectorEnvironment(home, {
    VIBERACING_CODEX_BIN: executablePath,
    VIBERACING_TEST_CODEX_HOOK_TRUST: "untrusted",
  });

  const untrusted = await runWithInput(["doctor", "--repair"], environment, "");
  assert.equal(untrusted.code, 1);
  assert.match(untrusted.stdout, /codex hook: untrusted/);
  assert.match(untrusted.stdout, /Codex automatic sync needs approval/);
  assert.match(untrusted.stdout, /run `\/hooks`/);
  assert.match(untrusted.stdout, /Usage sync: not run/);
  assert.match(untrusted.stderr, /connector repair is incomplete/);
  const hookPath = join(codexHome, "hooks.json");
  const firstSettings = await readFile(hookPath, "utf8");
  const firstCommand = JSON.parse(firstSettings).hooks.Stop[0].hooks[0].command;
  assert.match(firstCommand, /bin[/\\]viberacing-hook\.mjs/);
  assert.doesNotMatch(firstCommand, new RegExp(`runtime[/\\\\]${connectorVersion}`));

  const trusted = await runWithInput(
    ["doctor", "--repair"],
    { ...environment, VIBERACING_TEST_CODEX_HOOK_TRUST: "trusted" },
    "",
  );
  assert.equal(trusted.code, 0);
  assert.match(trusted.stdout, /codex hook: current/);
  assert.doesNotMatch(trusted.stdout, /Codex automatic sync needs approval/);
  assert.equal(trusted.stderr, "");
  assert.equal(await readFile(hookPath, "utf8"), firstSettings);
  await access(join(directory, "bin", "viberacing-hook.mjs"));
});

test("doctor reports Claude availability without collecting usage", async (context) => {
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
  const beforeDoctor = await snapshotStateTree(directory);
  const result = await execFileAsync(process.execPath, [connectorPath, "doctor"], {
    env: connectorEnvironment(home, { PATH: "" }),
  });
  assert.match(result.stdout, /claude_code diagnostics: ok/);
  assert.doesNotMatch(result.stdout, /claude_code \(Work\): ok/);
  assert.deepEqual(await snapshotStateTree(directory), beforeDoctor);
  await assert.rejects(access(join(home, ".config", "opencode", "plugins")), {
    code: "ENOENT",
  });
});

test("doctor explains Qwen relative settings and Antigravity wrapper-only", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-doctor-discovery-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  await mkdir(join(home, ".qwen"), { recursive: true });
  await writeFile(
    join(home, ".qwen", "settings.json"),
    JSON.stringify({ advanced: { runtimeOutputDir: "project-runtime" } }),
  );
  const result = await execFileAsync(process.execPath, [connectorPath, "doctor"], {
    env: connectorEnvironment(home, { PATH: "" }),
  });
  assert.match(result.stdout, /Qwen Code:[\s\S]*runtimeOutputDir is relative/);
  assert.match(result.stdout, /viberacing source add --agent qwen_code/);
  assert.match(result.stdout, /Antigravity CLI:[\s\S]*Status: wrapper-only/);
  assert.match(
    result.stdout,
    /only Antigravity CLI sessions launched through the Vibe Racing wrapper are counted/,
  );
});

test("doctor inspection stays read-only behind an active sync", async (context) => {
  let releaseUpload;
  let uploadStarted;
  const firstUpload = new Promise((resolve) => (uploadStarted = resolve));
  const uploadCanFinish = new Promise((resolve) => (releaseUpload = resolve));
  context.after(() => releaseUpload());
  let currentRequests = 0;
  const reconciliationBodies = [];
  let installation;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      if (request.method === "POST" && request.url === "/api/installations/current") {
        currentRequests += 1;
        reconciliationBodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify(
            reconciliationResponse([
              {
                sourceId: installation.sourceId,
                agentId: "antigravity",
                collectionMethod: "antigravity_cli_capture",
                status: "active",
                lastAcceptedSyncSequence: "1",
              },
            ]),
          ),
        );
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      uploadStarted();
      uploadCanFinish.then(() => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(usageResponse(body)));
      });
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-doctor-sync-lock-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  installation = await writeCaptureInstallation(home, `http://127.0.0.1:${address.port}`);
  const environment = connectorEnvironment(home, { NODE_ENV: "test" });
  const activeSync = execFileAsync(process.execPath, [connectorPath, "sync"], { env: environment });
  await firstUpload;

  const doctor = spawn(process.execPath, [connectorPath, "doctor"], {
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const doctorClosed = once(doctor, "close");
  let doctorOutput = "";
  doctor.stdout.setEncoding("utf8").on("data", (chunk) => (doctorOutput += chunk));
  await waitFor(() => doctorOutput.includes("Connector:"));
  const [doctorCode] = await doctorClosed;
  assert.equal(doctorCode, 0);
  assert.equal(currentRequests, 0);
  assert.match(doctorOutput, /Pairing status: stored connection; server not contacted/);

  releaseUpload();
  await activeSync;
  assert.deepEqual(reconciliationBodies, []);
});

test("a newer one-off CLI does not attest an older installed runtime", async (context) => {
  const reconciliationBodies = [];
  let installation;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      if (request.method === "POST" && request.url === "/api/installations/current") {
        reconciliationBodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(reconciliationResponse([{ sourceId: installation.sourceId }])));
        return;
      }
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "unexpected_request" }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-one-off-cli-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  installation = await writeCaptureInstallation(home, `http://127.0.0.1:${address.port}`);
  const attestationId = randomUUID();
  await writeFile(
    join(installation.directory, "state.json"),
    `${JSON.stringify({
      version: 1,
      sequences: { [installation.sourceId]: "0" },
      handlerAttestation: {
        attestationId,
        installedRuntimeVersion: "0.4.2",
        browserSyncProtocol: 1,
        pending: false,
      },
    })}\n`,
  );

  await execFileAsync(process.execPath, [connectorPath, "doctor"], {
    env: connectorEnvironment(home, { NODE_ENV: "test", PATH: "" }),
  });

  assert.deepEqual(reconciliationBodies, []);
  assert.deepEqual(
    JSON.parse(await readFile(join(installation.directory, "state.json"), "utf8"))
      .handlerAttestation,
    {
      attestationId,
      installedRuntimeVersion: "0.4.2",
      browserSyncProtocol: 1,
      pending: false,
    },
  );
});

test("normal sync re-attests the exact observed Browser Sync handler state", async (context) => {
  const scenarios = [
    {
      name: "removed handler after a confirmed protocol 2 registration",
      observation: "missing",
      removeState: false,
      expectedVersion: null,
      expectedProtocol: 0,
    },
    {
      name: "legacy owned marker after a confirmed protocol 2 registration",
      observation: "legacy",
      removeState: false,
      expectedVersion: null,
      expectedProtocol: 1,
    },
    {
      name: "removed state file and handler",
      observation: "missing",
      removeState: true,
      expectedVersion: null,
      expectedProtocol: 0,
    },
    {
      name: "removed state file with a current marker",
      observation: "current",
      removeState: true,
      expectedVersion: connectorVersion,
      expectedProtocol: 2,
    },
  ];

  for (const scenario of scenarios) {
    await context.test(scenario.name, async (subtest) => {
      const reconciliationBodies = [];
      const usageBodies = [];
      let installation;
      const server = createServer((request, response) => {
        const chunks = [];
        request.on("data", (chunk) => chunks.push(chunk));
        request.on("end", () => {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          response.setHeader("content-type", "application/json");
          if (request.url === "/api/installations/current") {
            reconciliationBodies.push(body);
            response.end(
              JSON.stringify({
                ...reconciliationResponse([{ sourceId: installation.sourceId }]),
                acceptedHandlerAttestationId: body.handlerAttestation.attestationId,
              }),
            );
            return;
          }
          if (request.url === "/api/usage") {
            usageBodies.push(body);
            response.end(JSON.stringify(usageResponse(body)));
            return;
          }
          response.writeHead(500);
          response.end(JSON.stringify({ error: "unexpected_request" }));
        });
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      subtest.after(() => server.close());
      const address = server.address();
      assert.notEqual(address, null);
      assert.equal(typeof address, "object");

      const home = await mkdtemp(join(tmpdir(), "viberacing-handler-observation-"));
      subtest.after(() => rm(home, { recursive: true, force: true }));
      installation = await writeCaptureInstallation(home, `http://127.0.0.1:${address.port}`);
      const previousAttestationId = randomUUID();
      if (scenario.removeState) {
        await unlink(join(installation.directory, "state.json"));
      } else {
        await writeFile(
          join(installation.directory, "state.json"),
          `${JSON.stringify({
            version: 1,
            sequences: { [installation.sourceId]: "0" },
            handlerAttestation: {
              attestationId: previousAttestationId,
              installedRuntimeVersion: connectorVersion,
              browserSyncProtocol: 2,
              pending: false,
            },
          })}\n`,
        );
      }

      await execFileAsync(process.execPath, [connectorPath, "sync"], {
        env: defaultStateConnectorEnvironment(home, {
          NODE_ENV: "test",
          VIBERACING_TEST_BROWSER_HANDLER_INSPECTION: scenario.observation,
        }),
      });

      assert.equal(reconciliationBodies.length, 1);
      assert.deepEqual(
        {
          ...reconciliationBodies[0].handlerAttestation,
          attestationId: "<uuid>",
        },
        {
          attestationId: "<uuid>",
          installedRuntimeVersion: scenario.expectedVersion,
          browserSyncProtocol: scenario.expectedProtocol,
        },
      );
      assert.notEqual(
        reconciliationBodies[0].handlerAttestation.attestationId,
        previousAttestationId,
      );
      assert.equal(usageBodies.length, 1);
      assert.equal(usageBodies[0].snapshots[0].entries[0].totalTokens, "3");
      const state = JSON.parse(await readFile(join(installation.directory, "state.json"), "utf8"));
      assert.deepEqual(state.handlerAttestation, {
        ...reconciliationBodies[0].handlerAttestation,
        pending: false,
      });
    });
  }
});

test("handler inspection failure does not block token sync or overwrite attestation", async (context) => {
  const reconciliationBodies = [];
  const usageBodies = [];
  let installation;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.setHeader("content-type", "application/json");
      if (request.url === "/api/installations/current") {
        reconciliationBodies.push(body);
        response.end(JSON.stringify(reconciliationResponse([{ sourceId: installation.sourceId }])));
        return;
      }
      if (request.url === "/api/usage") {
        usageBodies.push(body);
        response.end(JSON.stringify(usageResponse(body)));
        return;
      }
      response.writeHead(500);
      response.end(JSON.stringify({ error: "unexpected_request" }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-handler-inspection-failure-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  installation = await writeCaptureInstallation(home, `http://127.0.0.1:${address.port}`);
  const confirmed = {
    attestationId: randomUUID(),
    installedRuntimeVersion: connectorVersion,
    browserSyncProtocol: 2,
    pending: false,
  };
  await writeFile(
    join(installation.directory, "state.json"),
    `${JSON.stringify({
      version: 1,
      sequences: { [installation.sourceId]: "0" },
      handlerAttestation: confirmed,
    })}\n`,
  );
  const environment = defaultStateConnectorEnvironment(home, {
    NODE_ENV: "test",
    VIBERACING_TEST_BROWSER_HANDLER_INSPECTION: "error_eacces",
  });

  await execFileAsync(process.execPath, [connectorPath, "sync"], { env: environment });

  assert.equal(usageBodies.length, 1);
  assert.equal(usageBodies[0].snapshots[0].entries[0].totalTokens, "3");
  assert.equal(reconciliationBodies.length, 0);
  let state = JSON.parse(await readFile(join(installation.directory, "state.json"), "utf8"));
  assert.deepEqual(state.handlerAttestation, confirmed);
  assert.equal(state.handlerInspectionDiagnostic, "browser_handler_inspection_failed");

  const diagnostic = await execFileAsync(process.execPath, [connectorPath, "doctor"], {
    env: environment,
  });

  assert.match(`${diagnostic.stdout}\n${diagnostic.stderr}`, /handler inspection failed/i);
  assert.doesNotMatch(`${diagnostic.stdout}\n${diagnostic.stderr}`, /EACCES|Synthetic/);
  assert.equal(reconciliationBodies.length, 0);
  state = JSON.parse(await readFile(join(installation.directory, "state.json"), "utf8"));
  assert.deepEqual(state.handlerAttestation, confirmed);
  assert.equal(state.handlerInspectionDiagnostic, "browser_handler_inspection_failed");
});

test("doctor repair fails closed when connection config cannot be loaded", async () => {
  for (const scenario of ["missing", "malformed"]) {
    const home = await mkdtemp(join(tmpdir(), `viberacing-doctor-repair-${scenario}-`));
    const directory = join(home, ".viberacing");
    try {
      if (scenario === "malformed") {
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, ".viberacing-state"), '{"format":1}\n');
        await writeFile(join(directory, "config.json"), "{\n");
      }

      const failure = await execFileAsync(process.execPath, [connectorPath, "doctor", "--repair"], {
        env: connectorEnvironment(home, { NODE_ENV: "test", PATH: "" }),
      }).then(
        () => assert.fail(`doctor --repair unexpectedly succeeded with ${scenario} config`),
        (error) => error,
      );
      const output = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`;

      assert.equal(failure.code, 1);
      assert.match(output, /Connector repair not run/);
      assert.match(output, /connector repair is incomplete/);
      assert.doesNotMatch(output, /Local repair complete/);
      await assert.rejects(access(join(directory, "runtime")), { code: "ENOENT" });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }
});

test("doctor repair drains an exact pending OpenCode cleanup before reinstalling", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-doctor-repair-opencode-cleanup-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const environment = connectorEnvironment(home, { HOME: home, USERPROFILE: home });
  const installationId = "98989898-9898-4989-8989-989898989898";
  const { directory } = await writeMappedOpenCodeInstallation(
    home,
    "http://127.0.0.1:1",
    installationId,
  );
  const installed = await reconcileOpenCodePlugin({
    installationId,
    stateRoot: directory,
    environment,
    homeDirectory: home,
    desired: true,
  });
  await writeFile(
    join(directory, "installation.json"),
    `${JSON.stringify({
      version: 1,
      id: installationId,
      secret: "doctor_repair_installation_secret_that_is_long_enough",
      openCodePluginPath: installed.path,
    })}\n`,
    { mode: 0o600 },
  );
  const recoveryPath = `${installed.path}.quarantine-${randomUUID()}`;
  await rename(installed.path, recoveryPath);
  await writeFile(
    join(directory, "opencode-plugin-cleanup.json"),
    `${JSON.stringify({
      version: 1,
      installationId,
      openCodePluginPath: recoveryPath,
    })}\n`,
    { mode: 0o600 },
  );

  const repaired = await runWithInput(["doctor", "--repair"], environment, "");
  if (repaired.code === 0) assert.match(repaired.stdout, /Local repair complete/);
  else {
    assert.equal(repaired.code, 1);
    assert.match(repaired.stderr, /connector repair is incomplete/);
  }
  assert.doesNotMatch(repaired.stderr, /Pending OpenCode plugin cleanup is incomplete/);
  await assert.rejects(access(recoveryPath), { code: "ENOENT" });
  await assert.rejects(access(join(directory, "opencode-plugin-cleanup.json")), {
    code: "ENOENT",
  });
  assert.match(await readFile(installed.path, "utf8"), /viberacing-opencode-plugin/);
});

test("doctor repair recovers journaled OpenCode artifacts after abrupt process exit", async (context) => {
  for (const interruption of [
    "after-stage-create",
    "after-hardlink-probe",
    "after-quarantine-rename",
    "after-publish",
    "after-stage-journal-release",
  ]) {
    const home = await mkdtemp(join(tmpdir(), `viberacing-opencode-${interruption}-`));
    context.after(() => rm(home, { recursive: true, force: true }));
    const environment = connectorEnvironment(home, { HOME: home, USERPROFILE: home });
    const installationId = randomUUID();
    const { directory } = await writeMappedOpenCodeInstallation(
      home,
      "http://127.0.0.1:1",
      installationId,
    );
    const installed = await reconcileOpenCodePlugin({
      installationId,
      stateRoot: directory,
      environment,
      homeDirectory: home,
      nodeExecutable: process.platform === "win32" ? "C:\\different\\node.exe" : "/different/node",
      desired: true,
    });
    await writeFile(
      join(directory, "installation.json"),
      `${JSON.stringify({
        version: 1,
        id: installationId,
        secret: "abrupt_exit_installation_secret_that_is_long_enough",
        openCodePluginPath: installed.path,
      })}\n`,
      { mode: 0o600 },
    );

    const interrupted = await runWithInput(
      ["doctor", "--repair"],
      {
        ...environment,
        NODE_ENV: "test",
        VIBERACING_TEST_INTERRUPT_OPENCODE_PLUGIN: interruption,
      },
      "",
    );
    assert.equal(interrupted.code, 86, interruption);
    const journal = openCodeCleanupTargets(
      JSON.parse(await readFile(join(directory, "opencode-plugin-cleanup.json"), "utf8")),
    );
    if (interruption === "after-stage-journal-release")
      assert.equal(
        journal.some((target) => target.openCodePluginPath === installed.path),
        true,
      );
    else
      assert.equal(
        journal.some((target) => target.openCodePluginPath?.endsWith(".stage")),
        true,
      );
    if (["after-quarantine-rename", "after-publish"].includes(interruption))
      assert.equal(
        journal.some((target) => target.openCodePluginPath?.includes(".quarantine-")),
        true,
      );
    if (interruption === "after-hardlink-probe")
      assert.equal(
        journal.some((target) => target.openCodePluginPath?.includes(".probe-")),
        true,
      );

    const resumed = await runWithInput(["doctor", "--repair"], environment, "");
    assert.notEqual(resumed.code, 86, interruption);
    assert.doesNotMatch(resumed.stderr, /Pending OpenCode plugin cleanup is incomplete/);
    let residualJournal = null;
    try {
      residualJournal = await readFile(join(directory, "opencode-plugin-cleanup.json"), "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    assert.equal(residualJournal, null, `${interruption}: ${residualJournal}`);
    assert.equal(
      (await readdir(dirname(installed.path))).some(
        (name) =>
          name.endsWith(".stage") || name.includes(".probe-") || name.includes(".quarantine-"),
      ),
      false,
    );
    assert.match(await readFile(installed.path, "utf8"), /viberacing-opencode-plugin/);
  }
});

test("published-stage recovery removes the uncommitted canonical across XDG changes", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-opencode-path-commit-exit-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const installationId = randomUUID();
  const environmentA = connectorEnvironment(home, {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, "config-a"),
  });
  const { directory } = await writeMappedOpenCodeInstallation(
    home,
    "http://127.0.0.1:1",
    installationId,
  );
  const installedA = await reconcileOpenCodePlugin({
    installationId,
    stateRoot: directory,
    environment: environmentA,
    homeDirectory: home,
    nodeExecutable: process.platform === "win32" ? "C:\\different\\node.exe" : "/different/node",
    desired: true,
  });
  await writeFile(
    join(directory, "installation.json"),
    `${JSON.stringify({
      version: 1,
      id: installationId,
      secret: "path_commit_exit_installation_secret_that_is_long_enough",
      openCodePluginPath: installedA.path,
    })}\n`,
    { mode: 0o600 },
  );
  const environmentB = {
    ...environmentA,
    XDG_CONFIG_HOME: join(home, "config-b"),
    NODE_ENV: "test",
    VIBERACING_TEST_INTERRUPT_OPENCODE_PLUGIN: "after-publish",
  };
  const interrupted = await runWithInput(["doctor", "--repair"], environmentB, "");
  assert.equal(interrupted.code, 86);
  const pathB = openCodePluginLocation({
    installationId,
    environment: environmentB,
    homeDirectory: home,
  }).path;
  await access(pathB);
  assert.equal(
    openCodeCleanupTargets(
      JSON.parse(await readFile(join(directory, "opencode-plugin-cleanup.json"), "utf8")),
    ).some(
      (target) =>
        target.installationId === installationId &&
        target.openCodePluginPath?.startsWith(`${pathB}.`) &&
        target.openCodePluginPath.endsWith(".stage"),
    ),
    true,
  );
  assert.equal(
    JSON.parse(await readFile(join(directory, "installation.json"), "utf8")).openCodePluginPath,
    installedA.path,
  );

  const environmentC = {
    ...environmentA,
    XDG_CONFIG_HOME: join(home, "config-c"),
  };
  const resumed = await runWithInput(["doctor", "--repair"], environmentC, "");
  assert.notEqual(resumed.code, 86);
  const pathC = openCodePluginLocation({
    installationId,
    environment: environmentC,
    homeDirectory: home,
  }).path;
  await assert.rejects(access(installedA.path), { code: "ENOENT" });
  await assert.rejects(access(pathB), { code: "ENOENT" });
  assert.match(await readFile(pathC, "utf8"), /viberacing-opencode-plugin/);
  await assert.rejects(access(join(directory, "opencode-plugin-cleanup.json")), {
    code: "ENOENT",
  });
  assert.equal(
    JSON.parse(await readFile(join(directory, "installation.json"), "utf8")).openCodePluginPath,
    pathC,
  );
});

test("journal-clear failure keeps the committed canonical path and retries safely", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-opencode-journal-clear-failure-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const installationId = randomUUID();
  const environmentA = connectorEnvironment(home, {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, "config-a"),
  });
  const { directory } = await writeMappedOpenCodeInstallation(
    home,
    "http://127.0.0.1:1",
    installationId,
  );
  const installedA = await reconcileOpenCodePlugin({
    installationId,
    stateRoot: directory,
    environment: environmentA,
    homeDirectory: home,
    desired: true,
  });
  await writeFile(
    join(directory, "installation.json"),
    `${JSON.stringify({
      version: 1,
      id: installationId,
      secret: "journal_clear_installation_secret_that_is_long_enough",
      openCodePluginPath: installedA.path,
    })}\n`,
    { mode: 0o600 },
  );
  const environmentB = connectorEnvironment(home, {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, "config-b"),
    NODE_ENV: "test",
    VIBERACING_TEST_FAIL_OPENCODE_CANONICAL_JOURNAL_CLEAR: "1",
  });
  const pathB = openCodePluginLocation({
    installationId,
    environment: environmentB,
    homeDirectory: home,
  }).path;

  const failed = await runWithInput(["doctor", "--repair"], environmentB, "");
  assert.equal(failed.code, 1);
  assert.match(failed.stderr, /plugin repair is required/i);
  await assert.rejects(access(installedA.path), { code: "ENOENT" });
  assert.match(await readFile(pathB, "utf8"), /viberacing-opencode-plugin/);
  assert.equal(
    JSON.parse(await readFile(join(directory, "installation.json"), "utf8")).openCodePluginPath,
    pathB,
  );
  assert.deepEqual(
    openCodeCleanupTargets(
      JSON.parse(await readFile(join(directory, "opencode-plugin-cleanup.json"), "utf8")),
    ),
    [{ installationId, openCodePluginPath: pathB }],
  );

  const committedContents = await readFile(pathB);
  const committedStat = await stat(pathB);
  const committedInstallation = JSON.parse(
    await readFile(join(directory, "installation.json"), "utf8"),
  );
  delete environmentB.VIBERACING_TEST_FAIL_OPENCODE_CANONICAL_JOURNAL_CLEAR;
  environmentB.VIBERACING_TEST_INTERRUPT_OPENCODE_PLUGIN = "after-stage-create";
  await writeFile(join(directory, "installation.json"), "{\n", { mode: 0o600 });
  const unreadableRetry = await runWithInput(["doctor", "--repair"], environmentB, "");
  assert.equal(unreadableRetry.code, 1);
  assert.match(`${unreadableRetry.stdout}\n${unreadableRetry.stderr}`, /repair is incomplete/i);
  assert.deepEqual(await readFile(pathB), committedContents);
  if (process.platform !== "win32") {
    const unreadableRetryStat = await stat(pathB);
    assert.equal(unreadableRetryStat.dev, committedStat.dev);
    assert.equal(unreadableRetryStat.ino, committedStat.ino);
  }
  assert.deepEqual(
    openCodeCleanupTargets(
      JSON.parse(await readFile(join(directory, "opencode-plugin-cleanup.json"), "utf8")),
    ),
    [{ installationId, openCodePluginPath: pathB }],
  );

  await writeFile(
    join(directory, "installation.json"),
    `${JSON.stringify({
      ...committedInstallation,
      id: committedInstallation.id.toUpperCase(),
      openCodePluginPath: `${dirname(pathB)}${sep}journal-alias${sep}..${sep}${basename(pathB)}`,
    })}\n`,
    { mode: 0o600 },
  );
  const retried = await runWithInput(["doctor", "--repair"], environmentB, "");
  assert.notEqual(retried.code, 86);
  assert.deepEqual(await readFile(pathB), committedContents);
  if (process.platform !== "win32") {
    const retriedStat = await stat(pathB);
    assert.equal(retriedStat.dev, committedStat.dev);
    assert.equal(retriedStat.ino, committedStat.ino);
  }
  await assert.rejects(access(join(directory, "opencode-plugin-cleanup.json")), {
    code: "ENOENT",
  });
});

test("doctor repair keeps successful local work when server confirmation is unavailable", async (context) => {
  const unavailable = createServer();
  unavailable.listen(0, "127.0.0.1");
  await once(unavailable, "listening");
  const address = unavailable.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  await new Promise((resolve, reject) =>
    unavailable.close((error) => (error === undefined ? resolve() : reject(error))),
  );

  const home = await mkdtemp(join(tmpdir(), "viberacing-doctor-repair-offline-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const installation = await writeCaptureInstallation(home, `http://127.0.0.1:${address.port}`);

  const repaired = await execFileAsync(process.execPath, [connectorPath, "doctor", "--repair"], {
    env: connectorEnvironment(home, { NODE_ENV: "test", PATH: "" }),
  });

  assert.match(repaired.stdout, new RegExp(`Runtime: reinstalled ${connectorVersion}`));
  assert.match(repaired.stdout, /Pairing status: error/);
  assert.match(repaired.stdout, /Local repair complete; server confirmation is pending/);
  assert.match(repaired.stdout, /Usage sync: not run/);
  assert.doesNotMatch(`${repaired.stdout}\n${repaired.stderr}`, /repair is incomplete/);
  await access(join(installation.directory, "runtime", connectorVersion, "bin", "viberacing.mjs"));
  const pendingState = JSON.parse(
    await readFile(join(installation.directory, "state.json"), "utf8"),
  );
  assert.equal(pendingState.handlerAttestation.pending, true);
  assert.equal(pendingState.handlerAttestation.installedRuntimeVersion, null);
  assert.equal(pendingState.handlerAttestation.browserSyncProtocol, 0);

  const reconciliationBodies = [];
  const recovered = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.setHeader("content-type", "application/json");
      if (request.url === "/api/installations/current") {
        reconciliationBodies.push(body);
        response.end(
          JSON.stringify({
            ...reconciliationResponse([{ sourceId: installation.sourceId }]),
            acceptedHandlerAttestationId: body.handlerAttestation.attestationId,
          }),
        );
        return;
      }
      response.end(JSON.stringify(usageResponse(body)));
    });
  });
  recovered.listen(address.port, "127.0.0.1");
  await once(recovered, "listening");
  context.after(() => recovered.close());

  await execFileAsync(process.execPath, [connectorPath, "sync"], {
    env: connectorEnvironment(home, { NODE_ENV: "test", PATH: "" }),
  });

  assert.equal(reconciliationBodies.length, 1);
  assert.equal(
    reconciliationBodies[0].handlerAttestation.attestationId,
    pendingState.handlerAttestation.attestationId,
  );
  assert.equal(
    JSON.parse(await readFile(join(installation.directory, "state.json"), "utf8"))
      .handlerAttestation.pending,
    false,
  );
});

test("doctor repair re-enables automatic sync after a connector upgrade", async (context) => {
  let usageRequests = 0;
  const reconciliationBodies = [];
  let installation;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      if (request.method === "POST" && request.url === "/api/installations/current") {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        reconciliationBodies.push(body);
        if (Object.hasOwn(body, "cliVersion")) {
          response.writeHead(400, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "invalid_request" }));
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            sources: [
              {
                sourceId: installation.sourceId,
                status: "active",
                lastAcceptedSyncSequence: "0",
              },
            ],
          }),
        );
        return;
      }
      usageRequests += 1;
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(usageResponse(body)));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-doctor-upgrade-repair-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  installation = await writeCaptureInstallation(home, `http://127.0.0.1:${address.port}`);
  await writeFile(
    join(installation.directory, "state.json"),
    `${JSON.stringify({
      version: 1,
      sequences: { [installation.sourceId]: "0" },
      automaticDisabledReason: "unsupported_connector",
    })}\n`,
  );
  const environment = connectorEnvironment(home, {
    NODE_ENV: "test",
    VIBERACING_TEST_AUTOMATIC_SYNC_TIMINGS: "20,80,40",
  });

  const repaired = await execFileAsync(process.execPath, [connectorPath, "doctor", "--repair"], {
    env: environment,
  });
  assert.match(repaired.stdout, new RegExp(`Runtime: reinstalled ${connectorVersion}`));
  assert.match(repaired.stdout, /Hooks: repaired/);
  assert.match(repaired.stdout, /Usage sync: not run/);
  assert.equal(reconciliationBodies.length, 2);
  assert.deepEqual(
    {
      ...reconciliationBodies[0],
      handlerAttestation: {
        ...reconciliationBodies[0].handlerAttestation,
        attestationId: "<uuid>",
      },
    },
    {
      sourceIds: [installation.sourceId],
      cliVersion: connectorVersion,
      protocolVersion: connectorProtocolVersion,
      handlerAttestation: {
        attestationId: "<uuid>",
        installedRuntimeVersion: null,
        browserSyncProtocol: 0,
      },
    },
  );
  assert.match(reconciliationBodies[0].handlerAttestation.attestationId, /^[0-9a-f-]{36}$/i);
  assert.deepEqual(reconciliationBodies[1], {
    sourceIds: [installation.sourceId],
    connectorVersion,
  });
  assert.equal(usageRequests, 0);
  assert.equal(
    JSON.parse(await readFile(join(installation.directory, "state.json"), "utf8"))
      .automaticDisabledReason,
    undefined,
  );
  await runWithInput(
    ["hook", "--source", installation.clientSourceId, "--agent", "antigravity"],
    environment,
    "{}",
  );
  await waitFor(() => usageRequests === 1);
  await waitFor(async () =>
    access(join(installation.directory, "scheduler.lock")).then(
      () => false,
      () => true,
    ),
  );
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

  const result = await execFileAsync(process.execPath, [connectorPath, "doctor", "--repair"], {
    env: connectorEnvironment(home),
  });

  assert.match(result.stdout, /authorization was revoked/i);
  assert.match(result.stdout, /viberacing connect/i);
  await assert.rejects(access(join(installation.directory, "config.json")));
  await assert.rejects(access(join(installation.directory, "dirty.json")));
});

test("doctor does not report a local disconnect when revocation recovery cannot be prepared", async (context) => {
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

  const home = await mkdtemp(join(tmpdir(), "viberacing-doctor-revocation-prepare-failure-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const installationId = randomUUID();
  const environment = connectorEnvironment(home, {
    HOME: home,
    USERPROFILE: home,
    NODE_ENV: "test",
    VIBERACING_TEST_FAIL_OPENCODE_REVOCATION_PREPARE: "1",
  });
  const { directory, source } = await writeMappedOpenCodeInstallation(
    home,
    `http://127.0.0.1:${address.port}`,
    installationId,
  );
  await mkdir(dirname(source.dataPath), { recursive: true });
  const database = new DatabaseSync(source.dataPath);
  database.exec("CREATE TABLE message (id TEXT, time_created INTEGER, data TEXT)");
  database.close();
  const installed = await reconcileOpenCodePlugin({
    installationId,
    stateRoot: directory,
    environment,
    homeDirectory: home,
    desired: true,
  });

  const result = await runWithInput(["doctor", "--repair"], environment, "");
  assert.equal(result.code, 1);
  assert.match(result.stdout + result.stderr, /local token file could not be removed/i);
  assert.doesNotMatch(result.stdout, /Pairing status: disconnected/i);
  await access(join(directory, "config.json"));
  await access(installed.path);
});

test("reconnect drains a crash-journaled revoked OpenCode target before creating a new identity", async (context) => {
  let pairingStarts = 0;
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/installations/current") {
      response.writeHead(401);
      response.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    if (request.url === "/api/pairing/start") pairingStarts += 1;
    response.writeHead(500);
    response.end(JSON.stringify({ error: "server_error" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  const origin = `http://127.0.0.1:${address.port}`;

  const home = await mkdtemp(join(tmpdir(), "viberacing-reconnect-revocation-crash-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const retiredInstallationId = randomUUID();
  const environment = connectorEnvironment(home, {
    HOME: home,
    USERPROFILE: home,
    NODE_ENV: "test",
    PATH: "",
    VIBERACING_TEST_INTERRUPT_AFTER_CONFIG_REMOVAL: "1",
  });
  const { directory, source } = await writeMappedOpenCodeInstallation(
    home,
    origin,
    retiredInstallationId,
  );
  await mkdir(dirname(source.dataPath), { recursive: true });
  const database = new DatabaseSync(source.dataPath);
  database.exec("CREATE TABLE message (id TEXT, time_created INTEGER, data TEXT)");
  database.close();
  const installed = await reconcileOpenCodePlugin({
    installationId: retiredInstallationId,
    stateRoot: directory,
    environment,
    homeDirectory: home,
    desired: true,
  });

  const interrupted = await runWithInput(["connect", "--origin", origin], environment, "");
  assert.equal(interrupted.code, 86, interrupted.stderr);
  await assert.rejects(access(join(directory, "config.json")), { code: "ENOENT" });
  await assert.rejects(access(join(directory, "installation.json")), { code: "ENOENT" });
  await access(installed.path);
  await access(join(directory, "opencode-plugin-cleanup.json"));
  assert.equal(pairingStarts, 0);

  const recovered = await runWithInput(
    ["connect", "--origin", origin],
    { ...environment, VIBERACING_TEST_INTERRUPT_AFTER_CONFIG_REMOVAL: "0" },
    "",
  );
  assert.equal(recovered.code, 1);
  assert.equal(pairingStarts, 1);
  await assert.rejects(access(installed.path), { code: "ENOENT" });
  await assert.rejects(access(join(directory, "opencode-plugin-cleanup.json")), {
    code: "ENOENT",
  });
  const replacement = JSON.parse(await readFile(join(directory, "installation.json"), "utf8"));
  assert.notEqual(replacement.id, retiredInstallationId);
});

test("doctor and reconnect retain OpenCode cleanup when authorization is revoked without identity", async (context) => {
  for (const variant of [
    { command: ["doctor", "--repair"], identity: "missing", status: 401 },
    { command: ["connect"], identity: "corrupt", status: 403 },
  ]) {
    const server = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.url === "/api/installations/current") {
        response.writeHead(variant.status);
        response.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      response.writeHead(500);
      response.end(JSON.stringify({ error: "server_error" }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    context.after(() => server.close());
    const address = server.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, "object");

    const home = await mkdtemp(
      join(tmpdir(), `viberacing-${variant.command[0]}-${variant.identity}-identity-revoked-`),
    );
    context.after(() => rm(home, { recursive: true, force: true }));
    const installationId = randomUUID();
    const environment = connectorEnvironment(home, {
      HOME: home,
      USERPROFILE: home,
      NODE_ENV: "test",
      PATH: "",
      XDG_CONFIG_HOME: join(home, "current-config"),
      VIBERACING_TEST_PAIRING_POLL_INTERVAL_MS: "10",
    });
    const { directory, source } = await writeMappedOpenCodeInstallation(
      home,
      `http://127.0.0.1:${address.port}`,
      installationId,
    );
    await mkdir(dirname(source.dataPath), { recursive: true });
    const database = new DatabaseSync(source.dataPath);
    database.exec("CREATE TABLE message (id TEXT, time_created INTEGER, data TEXT)");
    database.close();
    const installed = await reconcileOpenCodePlugin({
      installationId,
      stateRoot: directory,
      environment,
      homeDirectory: home,
      desired: true,
    });
    if (variant.identity === "corrupt")
      await writeFile(join(directory, "installation.json"), "{not-json\n", { mode: 0o600 });

    const result = await runWithInput(
      [...variant.command, "--origin", `http://127.0.0.1:${address.port}`],
      environment,
      "",
    );
    if (variant.command[0] === "doctor") {
      assert.match(result.stdout, /authorization was revoked/i);
      assert.match(result.stdout, /viberacing connect/i);
    } else assert.match(result.stdout, /authorization is no longer valid/i);
    await assert.rejects(access(join(directory, "config.json")), { code: "ENOENT" });
    const cleanupPath = join(directory, "opencode-plugin-cleanup.json");
    const pluginStillExists = await access(installed.path).then(
      () => true,
      () => false,
    );
    if (pluginStillExists) {
      const cleanup = openCodeCleanupTargets(JSON.parse(await readFile(cleanupPath, "utf8")));
      assert.ok(
        cleanup.some(
          (target) =>
            target.installationId === installationId &&
            target.openCodePluginPath === installed.path,
        ),
      );
    }
  }
});

test("doctor removes a hook after dashboard-side source disconnect", async (context) => {
  const sourceId = "86868686-8686-4686-8686-868686868686";
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify(
        reconciliationResponse([
          {
            sourceId,
            agentId: "qwen_code",
            collectionMethod: "qwen_stats_jsonl",
            accountLabel: "Dashboard",
            status: "disconnected",
          },
        ]),
      ),
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
    hookConfigRoot: root,
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
  await execFileAsync(process.execPath, [connectorPath, "doctor", "--repair"], {
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
      if (request.method === "POST" && request.url === "/api/installations/current") {
        currentRequests += 1;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify(
            reconciliationResponse([
              {
                sourceId,
                agentId: "claude_code",
                collectionMethod: "claude_jsonl",
                accountLabel: "Dashboard",
                status: "disconnected",
              },
            ]),
          ),
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
      JSON.stringify(
        reconciliationResponse([
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
        ]),
      ),
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
    hookConfigRoot: qwenRoot,
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
      historyAdapters: { [retiredSourceId]: { files: { orphan: true } } },
      fingerprints: { [retiredSourceId]: "retired-fingerprint" },
      quarantine: { [retiredSourceId]: "invalid_payload" },
    })}\n`,
  );

  await execFileAsync(process.execPath, [connectorPath, "doctor", "--repair"], {
    env: connectorEnvironment(home),
  });
  const state = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
  assert.equal(state.sequences[activeSourceId], "7");
  assert.equal(state.sequences[retiredSourceId], undefined);
  assert.equal(state.adapters?.[retiredSourceId], undefined);
  assert.equal(state.historyAdapters?.[retiredSourceId], undefined);
  assert.equal(state.fingerprints?.[retiredSourceId], undefined);
  assert.equal(state.quarantine?.[retiredSourceId], undefined);
  assert.doesNotMatch(await readFile(join(qwenRoot, "settings.json"), "utf8"), /viberacing/);
});

test("recovers a missing sequence and confirms unchanged manual sync with the next sequence", async (context) => {
  let uploaded;
  let uploadCount = 0;
  const sourceId = "66666666-6666-4666-8666-666666666666";
  const server = createServer((request, response) => {
    if (request.method === "POST" && request.url === "/api/installations/current") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify(reconciliationResponse([{ sourceId, lastAcceptedSyncSequence: "500" }])),
      );
      return;
    }
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      uploadCount += 1;
      uploaded = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(usageResponse(uploaded)));
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
  const clientSourceId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const capture = join(directory, "captures", `${clientSourceId}.jsonl`);
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
      origin: `http://127.0.0.1:${address.port}`,
      deviceToken: "synthetic-device-token",
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
  assert.equal(uploadCount, 2);
  assert.equal(uploaded.snapshots[0].syncSequence, "502");
  assert.equal(
    JSON.parse(await readFile(join(directory, "state.json"), "utf8")).sequences[sourceId],
    "502",
  );
  assert.match(unchanged.stdout, /synced 1 daily totals from 1 source/i);
  assert.doesNotMatch(unchanged.stdout, /no request was sent/i);
});

for (const legacyProtocolVersion of [2, 3])
  test(`replaces an unsequenced legacy v${legacyProtocolVersion} pending error when only another source is dirty`, async (context) => {
    const usageBodies = [];
    const server = createServer((request, response) => {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (request.url === "/api/installations/current/diagnostics") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ acceptedEvents: body.events.length }));
          return;
        }
        usageBodies.push(body);
        const invalidSourceError = body.sourceErrors?.some(
          (sourceError) => sourceError.observedAfterSequence === undefined,
        );
        response.writeHead(invalidSourceError ? 400 : 200, {
          "content-type": "application/json",
        });
        response.end(
          JSON.stringify(
            invalidSourceError ? { error: "invalid_source_error" } : usageResponse(body),
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

    const home = await mkdtemp(
      join(tmpdir(), `viberacing-legacy-v${legacyProtocolVersion}-pending-error-`),
    );
    context.after(() => rm(home, { recursive: true, force: true }));
    const directory = join(home, ".viberacing");
    const captureDirectory = join(directory, "captures");
    await mkdir(captureDirectory, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const healthySource = {
      clientSourceId: "61616161-6161-4161-8161-616161616161",
      sourceId: "62626262-6262-4262-8262-626262626262",
      agentId: "antigravity",
      dataPath: join(captureDirectory, "healthy.jsonl"),
      collectionMethod: "antigravity_cli_capture",
      supportedSurface: "cli",
      suggestedLabel: "Healthy",
    };
    const failedSource = {
      clientSourceId: "63636363-6363-4363-8363-636363636363",
      sourceId: "64646464-6464-4464-8464-646464646464",
      agentId: "antigravity",
      dataPath: join(captureDirectory, "failed.jsonl"),
      collectionMethod: "synthetic_invalid_collector",
      supportedSurface: "cli",
      suggestedLabel: "Failed",
    };
    await writeFile(
      healthySource.dataPath,
      `${JSON.stringify({
        id: `legacy-${legacyProtocolVersion}-healthy`,
        date,
        usage: { date, totalTokens: "3" },
      })}\n`,
    );
    await writeMappedInstallation(home, `http://127.0.0.1:${address.port}`, [
      healthySource,
      failedSource,
    ]);
    const statePath = join(directory, "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.fingerprints = {
      [failedSource.sourceId]: createHash("sha256")
        .update(JSON.stringify({ error: "collector_failed" }))
        .digest("hex"),
    };
    await writeFile(statePath, `${JSON.stringify(state)}\n`);
    const pendingDirectory = join(directory, "pending");
    await mkdir(pendingDirectory, { recursive: true });
    await writeFile(
      join(pendingDirectory, `${failedSource.sourceId}.error.json`),
      `${JSON.stringify({
        protocolVersion: legacyProtocolVersion,
        snapshots: [],
        sourceErrors: [{ sourceId: failedSource.sourceId, code: "collector_failed" }],
      })}\n`,
    );
    const timestamp = new Date().toISOString();
    await writeFile(
      join(directory, "dirty.json"),
      `${JSON.stringify({
        version: 2,
        sources: {
          [healthySource.clientSourceId]: {
            dirtySince: timestamp,
            lastEventAt: timestamp,
            generation: randomUUID(),
          },
        },
      })}\n`,
    );
    const trace = join(home, "collector-trace.txt");

    await execFileAsync(process.execPath, [connectorPath, "auto-sync"], {
      env: connectorEnvironment(home, {
        NODE_ENV: "test",
        VIBERACING_TEST_COLLECTOR_TRACE: trace,
        VIBERACING_TEST_AUTOMATIC_SYNC_TIMINGS: "1,1,1",
      }),
    });

    assert.deepEqual(
      new Set((await readFile(trace, "utf8")).trim().split("\n")),
      new Set([healthySource.clientSourceId, failedSource.clientSourceId]),
    );
    assert.equal(usageBodies.length, 2);
    assert.equal(usageBodies[0].protocolVersion, connectorProtocolVersion);
    assert.equal(usageBodies[0].snapshots[0].sourceId, healthySource.sourceId);
    assert.deepEqual(usageBodies[0].sourceErrors, []);
    assert.equal(usageBodies[1].protocolVersion, connectorProtocolVersion);
    assert.deepEqual(usageBodies[1].snapshots, []);
    assert.deepEqual(usageBodies[1].sourceErrors, [
      {
        sourceId: failedSource.sourceId,
        code: "collector_failed",
        observedAfterSequence: "0",
      },
    ]);
    assert.deepEqual(await readdir(pendingDirectory), []);
    await assert.rejects(access(join(directory, "quarantine", `${failedSource.sourceId}.json`)));
  });

test("0.4.3 OpenCode state blocks 0.5.0 sync byte-for-byte until real 0.4.4 runs", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-opencode-preflight-sync-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  let installation;
  const remote = openCodeUpgradeServer(() => installation);
  remote.server.listen(0, "127.0.0.1");
  await once(remote.server, "listening");
  context.after(() => remote.server.close());
  const address = remote.server.address();
  assert.equal(typeof address, "object");
  installation = await writeOpenCode043Installation(home, "http://127.0.0.1:1");
  await pointInstallationAtServer(installation, address.port);
  await mkdir(join(installation.directory, "pending"));
  await writeFile(
    join(installation.directory, "pending", `${installation.sourceId}.error.json`),
    `${JSON.stringify({
      protocolVersion: connectorProtocolVersion,
      snapshots: [],
      sourceErrors: [
        {
          sourceId: installation.sourceId,
          code: "collector_failed",
          observedAfterSequence: "1",
        },
      ],
    })}\n`,
  );
  const environment = connectorEnvironment(home, { NODE_ENV: "test" });
  const before = await snapshotStateTree(installation.directory);

  const status = await execFileAsync(process.execPath, [connectorPath, "upgrade-preflight"], {
    env: environment,
  }).then(
    () => assert.fail("upgrade preflight unexpectedly accepted uncut 0.4.3 state"),
    (error) => error,
  );
  assert.equal(status.code, 1);
  assert.match(status.stderr, /opencode_cutover_required/);
  assert.deepEqual(await snapshotStateTree(installation.directory), before);
  assert.equal(remote.requests.length, 0);

  const blocked = await execFileAsync(process.execPath, [connectorPath, "sync"], {
    env: environment,
  }).then(
    () => assert.fail("0.5.0 sync unexpectedly accepted uncut 0.4.3 OpenCode state"),
    (error) => error,
  );

  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr, /opencode_cutover_required/);
  assert.match(blocked.stderr, /npx --yes @viberacing\/connector@0\.4\.4 sync/);
  assert.deepEqual(await snapshotStateTree(installation.directory), before);
  assert.equal(remote.requests.length, 0);

  const cutover = await execFileAsync(process.execPath, [connector044Path, "sync"], {
    env: environment,
  });
  assert.match(cutover.stdout, /Synced/);
  const cutoverState = JSON.parse(
    await readFile(join(installation.directory, "state.json"), "utf8"),
  );
  assert.equal(cutoverState.adapters[installation.sourceId].cutover.version, 1);

  const upgraded = await execFileAsync(process.execPath, [connectorPath, "sync"], {
    env: environment,
  });
  assert.match(upgraded.stdout, /Synced/);
  assert.equal(
    JSON.parse(await readFile(join(installation.directory, "sources.json"), "utf8")).version,
    2,
  );
  assert.ok(remote.usageBodies.length >= 3);
  assert.equal(remote.usageBodies.at(-1).snapshots[0].entries[0].totalTokens, "100");
});

test("0.4.3 OpenCode state blocks 0.5.0 connect before pairing and remains 0.4.4-readable", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-opencode-preflight-connect-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  let installation;
  const remote = openCodeUpgradeServer(() => installation);
  remote.server.listen(0, "127.0.0.1");
  await once(remote.server, "listening");
  context.after(() => remote.server.close());
  const address = remote.server.address();
  assert.equal(typeof address, "object");
  installation = await writeOpenCode043Installation(home, "http://127.0.0.1:1");
  await pointInstallationAtServer(installation, address.port);
  const environment = connectorEnvironment(home, { NODE_ENV: "test" });
  const before = await snapshotStateTree(installation.directory);

  const blocked = await execFileAsync(
    process.execPath,
    [connectorPath, "connect", "--origin", `http://127.0.0.1:${address.port}`],
    {
      env: environment,
    },
  ).then(
    () => assert.fail("0.5.0 connect unexpectedly started pairing from uncut 0.4.3 state"),
    (error) => error,
  );

  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr, /opencode_cutover_required/);
  assert.match(blocked.stderr, /npx --yes @viberacing\/connector@0\.4\.4 sync/);
  assert.deepEqual(await snapshotStateTree(installation.directory), before);
  assert.equal(remote.requests.length, 0);

  const compatible = await execFileAsync(process.execPath, [connector044Path, "sync"], {
    env: environment,
  });
  assert.match(compatible.stdout, /Synced/);
  assert.equal(remote.usageBodies.length, 1);
});

test("confirmed real 0.4.4 cutover migrates once and preserves the accepted baseline", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-opencode-preflight-confirmed-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  let installation;
  const remote = openCodeUpgradeServer(() => installation);
  remote.server.listen(0, "127.0.0.1");
  await once(remote.server, "listening");
  context.after(() => remote.server.close());
  const address = remote.server.address();
  assert.equal(typeof address, "object");
  installation = await writeOpenCode043Installation(home, "http://127.0.0.1:1");
  await pointInstallationAtServer(installation, address.port);
  const environment = connectorEnvironment(home, { NODE_ENV: "test" });

  await execFileAsync(process.execPath, [connector044Path, "sync"], { env: environment });
  const confirmedTree = await snapshotStateTree(installation.directory);
  const preflight = await execFileAsync(process.execPath, [connectorPath, "upgrade-preflight"], {
    env: environment,
  });
  assert.match(preflight.stdout, /OpenCode upgrade preflight passed/);
  assert.deepEqual(await snapshotStateTree(installation.directory), confirmedTree);
  const database = new DatabaseSync(installation.databasePath);
  database
    .prepare("INSERT INTO message (id, time_created, data) VALUES (?, ?, ?)")
    .run(
      "post-cutover-once",
      Date.parse(`${installation.date}T09:00:00.000Z`),
      JSON.stringify({ role: "assistant", tokens: { input: 4, output: 3, total: 7 } }),
    );
  database.close();

  await execFileAsync(process.execPath, [connectorPath, "sync"], { env: environment });
  await execFileAsync(process.execPath, [connectorPath, "sync"], { env: environment });

  assert.equal(
    JSON.parse(await readFile(join(installation.directory, "sources.json"), "utf8")).version,
    2,
  );
  const state = JSON.parse(await readFile(join(installation.directory, "state.json"), "utf8"));
  const adapterState = state.adapters[installation.sourceId];
  assert.equal(adapterState.bootstrapComplete, true);
  assert.deepEqual(adapterState.legacyBaseline, [{ date: installation.date, totalTokens: "100" }]);
  assert.equal(Object.keys(adapterState.legacyAliases).length, 1);
  assert.equal(Object.keys(adapterState.ledger).length, 1);
  assert.equal(remote.usageBodies.length, 3);
  for (const body of remote.usageBodies.slice(1)) {
    assert.equal(body.snapshots[0].entries.length, 1);
    assert.equal(body.snapshots[0].entries[0].totalTokens, "107");
  }
});

test("a real 0.4.3 Browser Sync advancing past the cutover is blocked until 0.4.4 reconfirms", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-opencode-stale-browser-runtime-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  let installation;
  const remote = openCodeUpgradeServer(() => installation);
  remote.server.listen(0, "127.0.0.1");
  await once(remote.server, "listening");
  context.after(() => remote.server.close());
  const address = remote.server.address();
  assert.equal(typeof address, "object");
  installation = await writeOpenCode043Installation(home, "http://127.0.0.1:1");
  await pointInstallationAtServer(installation, address.port);
  const statePath = join(installation.directory, "state.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.adapters[installation.sourceId] = {
    cutover: {
      version: 1,
      confirmedSequence: "1",
      confirmedRangeEnd: installation.date,
      aliases: {
        [createHash("sha256").update("accepted-before-upgrade").digest("hex")]: installation.date,
      },
    },
  };
  await writeFile(statePath, `${JSON.stringify(state)}\n`);
  const environment = connectorEnvironment(home, { NODE_ENV: "test" });
  const requestId = "78787878-7878-4878-8878-787878787878";

  const oldBrowser = await execFileAsync(
    process.execPath,
    [
      connector043Path,
      "handle-url",
      `viberacing://sync?requestId=${requestId}&scope=installation&grant=${"g".repeat(32)}`,
    ],
    { env: environment },
  );
  assert.match(oldBrowser.stdout, /Synced/);
  assert.equal(JSON.parse(await readFile(statePath, "utf8")).sequences[installation.sourceId], "2");
  const afterOldBrowser = await snapshotStateTree(installation.directory);
  const requestCount = remote.requests.length;

  const blocked = await execFileAsync(process.execPath, [connectorPath, "upgrade-preflight"], {
    env: environment,
  }).then(
    () => assert.fail("0.5.0 accepted a sequence newer than the confirmed cutover"),
    (error) => error,
  );
  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr, /opencode_cutover_required/);
  assert.match(blocked.stderr, /@viberacing\/connector@0\.4\.4 sync/);
  assert.equal(remote.requests.length, requestCount);
  assert.deepEqual(await snapshotStateTree(installation.directory), afterOldBrowser);

  await execFileAsync(process.execPath, [connector044Path, "sync"], { env: environment });
  const repaired = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(
    repaired.adapters[installation.sourceId].cutover.confirmedSequence,
    repaired.sequences[installation.sourceId],
  );
  const passed = await execFileAsync(process.execPath, [connectorPath, "upgrade-preflight"], {
    env: environment,
  });
  assert.match(passed.stdout, /preflight passed/);
});

test("state and pending OpenCode sequences block delivery even when config still reports zero", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-opencode-pending-sequence-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  let requests = 0;
  const server = createServer((request, response) => {
    requests += 1;
    request.resume();
    response.statusCode = 500;
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.equal(typeof address, "object");
  const installation = await writeOpenCode043Installation(home, `http://127.0.0.1:${address.port}`);
  const configPath = join(installation.directory, "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.sources[0].lastAcceptedSyncSequence = "0";
  await writeFile(configPath, `${JSON.stringify(config)}\n`);
  await mkdir(join(installation.directory, "pending"));
  await writeFile(
    join(installation.directory, "pending", `${installation.sourceId}.json`),
    `${JSON.stringify({
      protocolVersion: connectorProtocolVersion,
      snapshots: [{ sourceId: installation.sourceId, syncSequence: "1", entries: [] }],
      sourceErrors: [],
    })}\n`,
  );
  const before = await snapshotStateTree(installation.directory);

  const blocked = await execFileAsync(process.execPath, [connectorPath, "sync"], {
    env: connectorEnvironment(home, { NODE_ENV: "test" }),
  }).then(
    () => assert.fail("0.5.0 delivered an unconfirmed pending OpenCode snapshot"),
    (error) => error,
  );
  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr, /opencode_cutover_required/);
  assert.equal(requests, 0);
  assert.deepEqual(await snapshotStateTree(installation.directory), before);
});

test("a higher read-only server sequence blocks before reconciliation persistence", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-opencode-server-sequence-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  let installation;
  const remote = openCodeUpgradeServer(() => installation);
  remote.server.listen(0, "127.0.0.1");
  await once(remote.server, "listening");
  context.after(() => remote.server.close());
  const address = remote.server.address();
  assert.equal(typeof address, "object");
  installation = await writeOpenCode043Installation(home, `http://127.0.0.1:${address.port}`);
  const configPath = join(installation.directory, "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.sources[0].lastAcceptedSyncSequence = "0";
  await writeFile(configPath, `${JSON.stringify(config)}\n`);
  await writeFile(
    join(installation.directory, "state.json"),
    `${JSON.stringify({ version: 1, sequences: {}, adapters: {} })}\n`,
  );
  for (const name of [".viberacing-state", "config.json", "sources.json", "state.json"])
    await chmod(join(installation.directory, name), 0o600);
  const before = await snapshotStateTree(installation.directory);

  const blocked = await execFileAsync(process.execPath, [connectorPath, "sync"], {
    env: connectorEnvironment(home, { NODE_ENV: "test" }),
  }).then(
    () => assert.fail("0.5.0 persisted an unconfirmed server sequence"),
    (error) => error,
  );
  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr, /opencode_cutover_required/);
  assert.deepEqual(remote.requests, [{ method: "POST", url: "/api/installations/current" }]);
  assert.deepEqual(await snapshotStateTree(installation.directory), before);
});

test("inner lifecycle preflight catches a sequence advanced after the outer preflight", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-opencode-preflight-race-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const installation = await writeOpenCode043Installation(home, "http://127.0.0.1:1");
  const statePath = join(installation.directory, "state.json");
  const configPath = join(installation.directory, "config.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.adapters[installation.sourceId] = {
    cutover: {
      version: 1,
      confirmedSequence: "1",
      confirmedRangeEnd: installation.date,
      aliases: {},
    },
  };
  await writeFile(statePath, `${JSON.stringify(state)}\n`);
  for (const name of [".viberacing-state", "config.json", "sources.json", "state.json"])
    await chmod(join(installation.directory, name), 0o600);
  const barrier = join(home, "preflight-race");
  const environment = connectorEnvironment(home, {
    NODE_ENV: "test",
    VIBERACING_TEST_OPENCODE_PREFLIGHT_PAUSE: "after_outer",
    VIBERACING_TEST_OPENCODE_PREFLIGHT_BARRIER: barrier,
  });
  const commandPromise = execFileAsync(
    process.execPath,
    [
      connectorPath,
      "source",
      "add",
      "--agent",
      "qwen_code",
      "--name",
      "Concurrent",
      "--data-dir",
      join(home, "qwen-usage"),
    ],
    { env: environment },
  ).catch((error) => error);
  await waitFor(() =>
    access(`${barrier}.ready`).then(
      () => true,
      () => false,
    ),
  );

  const advancedConfig = JSON.parse(await readFile(configPath, "utf8"));
  advancedConfig.sources[0].lastAcceptedSyncSequence = "2";
  await writeFile(configPath, `${JSON.stringify(advancedConfig)}\n`);
  const advancedState = JSON.parse(await readFile(statePath, "utf8"));
  advancedState.sequences[installation.sourceId] = "2";
  await writeFile(statePath, `${JSON.stringify(advancedState)}\n`);
  const afterOldSync = await snapshotStateTree(installation.directory);
  await writeFile(`${barrier}.continue`, "continue\n");

  const blocked = await commandPromise;
  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr, /opencode_cutover_required/);
  assert.deepEqual(await snapshotStateTree(installation.directory), afterOldSync);
  assert.equal(
    JSON.parse(await readFile(join(installation.directory, "sources.json"), "utf8")).version,
    1,
  );
});

test("all local source registry mutations block before schema v2 and remain 0.4.4-readable", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-opencode-global-guard-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const installation = await writeOpenCode043Installation(home, "http://127.0.0.1:1");
  const environment = connectorEnvironment(home, {
    NODE_ENV: "test",
    VIBERACING_ANTIGRAVITY_BIN: process.execPath,
  });
  const commands = [
    [
      "source",
      "add",
      "--agent",
      "qwen_code",
      "--name",
      "Blocked add",
      "--data-dir",
      join(home, "qwen-usage"),
    ],
    ["source", "remove", installation.clientSourceId],
    ["run", "antigravity", "--", "--version"],
  ];
  for (const arguments_ of commands) {
    const before = await snapshotStateTree(installation.directory);
    const blocked = await execFileAsync(process.execPath, [connectorPath, ...arguments_], {
      env: environment,
    }).then(
      () => assert.fail(`${arguments_.join(" ")} unexpectedly changed uncut state`),
      (error) => error,
    );
    assert.equal(blocked.code, 1);
    assert.match(blocked.stderr, /opencode_cutover_required/);
    assert.deepEqual(await snapshotStateTree(installation.directory), before);
    const legacy = await execFileAsync(process.execPath, [connector044Path, "source", "list"], {
      env: environment,
    });
    assert.match(legacy.stdout, /opencode/);
    assert.equal(
      JSON.parse(await readFile(join(installation.directory, "sources.json"), "utf8")).version,
      1,
    );
  }

  for (const arguments_ of [
    ["auto-sync"],
    ["doctor"],
    [
      "handle-url",
      `viberacing://sync?requestId=79797979-7979-4979-8979-797979797979&scope=installation&grant=${"g".repeat(32)}`,
    ],
  ]) {
    const before = await snapshotStateTree(installation.directory);
    const blocked = await execFileAsync(process.execPath, [connectorPath, ...arguments_], {
      env: environment,
    }).then(
      () => assert.fail(`${arguments_[0]} unexpectedly entered uncut recovery state`),
      (error) => error,
    );
    assert.equal(blocked.code, 1);
    assert.match(blocked.stderr, /opencode_cutover_required/);
    assert.deepEqual(await snapshotStateTree(installation.directory), before);
  }

  const beforeHook = await snapshotStateTree(installation.directory);
  const hook = await runWithInput(
    ["hook", "--source", installation.clientSourceId, "--agent", "opencode"],
    environment,
    '{"private":"discarded"}\n',
  );
  assert.equal(hook.code, 0);
  assert.equal(hook.stdout, "");
  assert.equal(hook.stderr, "");
  assert.deepEqual(await snapshotStateTree(installation.directory), beforeHook);
});

test("read-only commands remain available while OpenCode recovery is blocked", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-opencode-read-only-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const installation = await writeOpenCode043Installation(home, "http://127.0.0.1:1");
  const environment = connectorEnvironment(home, { NODE_ENV: "test" });
  const listed = await execFileAsync(process.execPath, [connectorPath, "source", "list"], {
    env: environment,
  });
  assert.match(listed.stdout, /opencode/);
  const accounts = await execFileAsync(process.execPath, [connectorPath, "accounts"], {
    env: environment,
  });
  assert.match(accounts.stdout, /opencode: OpenCode/);
  const version = await execFileAsync(process.execPath, [connectorPath, "--version"], {
    env: environment,
  });
  assert.equal(version.stdout.trim(), connectorVersion);
  assert.equal(
    JSON.parse(await readFile(join(installation.directory, "sources.json"), "utf8")).version,
    1,
  );
});

test("reset-installation blocks byte-for-byte until OpenCode cutover is current", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-opencode-reset-guard-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const installation = await writeOpenCode043Installation(home, "http://127.0.0.1:1");
  const before = await snapshotStateTree(installation.directory);
  const blocked = await execFileAsync(process.execPath, [connectorPath, "reset-installation"], {
    env: connectorEnvironment(home, { NODE_ENV: "test" }),
  }).then(
    () => assert.fail("reset-installation bypassed the OpenCode cutover"),
    (error) => error,
  );
  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr, /opencode_cutover_required/);
  assert.deepEqual(await snapshotStateTree(installation.directory), before);
});

test("upgrade preflight streams selected OpenCode fields from valid state larger than 20 MiB", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-opencode-large-state-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const installation = await writeOpenCode043Installation(home, "http://127.0.0.1:1");
  const filler = "x".repeat(11 * 1_024 * 1_024);
  const statePath = join(installation.directory, "state.json");
  await writeFile(
    statePath,
    `${JSON.stringify({
      version: 1,
      sequences: { [installation.sourceId]: "1" },
      adapters: {
        "11111111-1111-4111-8111-111111111111": { boundedLedger: filler },
        "22222222-2222-4222-8222-222222222222": { boundedLedger: filler },
        [installation.sourceId]: {
          cutover: {
            version: 1,
            confirmedSequence: "1",
            confirmedRangeEnd: installation.date,
            aliases: {},
          },
        },
      },
    })}\n`,
  );
  assert.ok((await stat(statePath)).size > 20 * 1_024 * 1_024);

  const preflight = await execFileAsync(process.execPath, [connectorPath, "upgrade-preflight"], {
    env: connectorEnvironment(home, { NODE_ENV: "test" }),
    maxBuffer: 1_000_000,
  });
  assert.match(preflight.stdout, /preflight passed/);
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
        JSON.stringify(
          usageResponse(body, {
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
  assert.deepEqual(
    bodies.map((body) => body.protocolVersion),
    [connectorProtocolVersion, connectorProtocolVersion, connectorProtocolVersion],
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
    if (request.method === "POST" && request.url === "/api/installations/current") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(reconciliationResponse([{ sourceId: installation.sourceId }])));
      return;
    }
    requests += 1;
    response.writeHead(requests < 3 ? 503 : 200, { "content-type": "application/json" });
    response.end(
      JSON.stringify(
        requests < 3
          ? { error: "server_error" }
          : usageResponse({
              snapshots: [{ sourceId: installation.sourceId, syncSequence: "1", entries: [] }],
              sourceErrors: [],
            }),
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

test("retries transient malformed proxy responses without accepting them", async (context) => {
  let requests = 0;
  const server = createServer((request, response) => {
    if (request.method === "POST" && request.url === "/api/installations/current") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(reconciliationResponse([{ sourceId: installation.sourceId }])));
      return;
    }
    requests += 1;
    if (requests < 3) {
      response.writeHead(503, { "content-type": "text/html" });
      response.end("<html>temporary proxy failure</html>");
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify(
        usageResponse({
          snapshots: [{ sourceId: installation.sourceId, syncSequence: "1", entries: [] }],
          sourceErrors: [],
        }),
      ),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  const home = await mkdtemp(join(tmpdir(), "viberacing-malformed-transient-retry-"));
  context.after(() => rm(home, { recursive: true }));
  const installation = await writeCaptureInstallation(home, `http://127.0.0.1:${address.port}`);

  await execFileAsync(process.execPath, [connectorPath, "sync"], {
    env: connectorEnvironment(home),
  });
  assert.equal(requests, 3);
});

test("honors Retry-After before retrying a rate-limited upload", async (context) => {
  const requestTimes = [];
  const server = createServer((request, response) => {
    if (request.method === "POST" && request.url === "/api/installations/current") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(reconciliationResponse([{ sourceId: installation.sourceId }])));
      return;
    }
    requestTimes.push(Date.now());
    response.writeHead(requestTimes.length === 1 ? 429 : 200, {
      "content-type": "application/json",
      ...(requestTimes.length === 1 ? { "retry-after": "1" } : {}),
    });
    response.end(
      JSON.stringify(
        requestTimes.length === 1
          ? { error: "rate_limited" }
          : usageResponse({
              snapshots: [{ sourceId: installation.sourceId, syncSequence: "1", entries: [] }],
              sourceErrors: [],
            }),
      ),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  const home = await mkdtemp(join(tmpdir(), "viberacing-retry-after-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const installation = await writeCaptureInstallation(home, `http://127.0.0.1:${address.port}`);

  await execFileAsync(process.execPath, [connectorPath, "sync"], {
    env: connectorEnvironment(home, {
      NODE_ENV: "test",
      VIBERACING_TEST_MAX_RETRY_AFTER_MS: "1000",
    }),
  });
  assert.equal(requestTimes.length, 2);
  assert.ok(
    requestTimes[1] - requestTimes[0] >= 900,
    `retry happened after only ${requestTimes[1] - requestTimes[0]}ms`,
  );
});

test("quarantines a permanent 400 once without blocking the next corrected snapshot", async (context) => {
  let requests = 0;
  const bodies = [];
  const server = createServer((request, response) => {
    if (request.method === "POST" && request.url === "/api/installations/current") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(reconciliationResponse([{ sourceId: installation.sourceId }])));
      return;
    }
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (request.url === "/api/installations/current/diagnostics") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ acceptedEvents: body.events.length }));
        return;
      }
      requests += 1;
      bodies.push(body);
      response.writeHead(requests === 1 ? 400 : 200, { "content-type": "application/json" });
      response.end(
        JSON.stringify(
          requests === 1 ? { error: "token_components_mismatch" } : usageResponse(bodies.at(-1)),
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

test("diagnostic 404 and 500 responses do not break sync and retain one outbox event", async (context) => {
  const diagnosticBodies = [];
  let diagnosticAttempts = 0;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      if (request.method === "POST" && request.url === "/api/installations/current") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(reconciliationResponse([{ sourceId: installation.sourceId }])));
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (request.method === "POST" && request.url === "/api/usage") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(usageResponse(body)));
        return;
      }
      if (request.method === "POST" && request.url === "/api/installations/current/diagnostics") {
        diagnosticAttempts += 1;
        diagnosticBodies.push(body);
        const status = diagnosticAttempts === 1 ? 404 : diagnosticAttempts === 2 ? 500 : 200;
        response.writeHead(status, { "content-type": "application/json" });
        response.end(
          JSON.stringify(
            status === 200
              ? { acceptedEvents: body.events.length }
              : { error: status === 404 ? "not_found" : "server_error" },
          ),
        );
        return;
      }
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  const home = await mkdtemp(join(tmpdir(), "viberacing-diagnostic-retry-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const installation = await writeCaptureInstallation(home, `http://127.0.0.1:${address.port}`);
  const statePath = join(installation.directory, "state.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.diagnostics = {
    version: 1,
    activeBySource: { [installation.sourceId]: ["sync:automatic_sync_failed"] },
    outboxBySource: {
      [installation.sourceId]: { "sync:automatic_sync_failed": ["opened"] },
    },
  };
  await writeFile(statePath, `${JSON.stringify(state)}\n`);
  const environment = connectorEnvironment(home);

  const results = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await execFileAsync(process.execPath, [connectorPath, "sync"], {
      env: environment,
    });
    results.push(result);
    assert.doesNotMatch(result.stderr, /diagnostic|404|500/i);
  }

  for (const result of results) {
    assert.match(result.stdout, /synced 1 daily totals from 1 source/i);
    assert.doesNotMatch(result.stdout, /no request was sent/i);
  }

  assert.equal(diagnosticAttempts, 3);
  assert.deepEqual(diagnosticBodies[0], diagnosticBodies[1]);
  assert.deepEqual(diagnosticBodies[1], diagnosticBodies[2]);
  assert.deepEqual(
    diagnosticBodies[2].events.map(({ code, state }) => ({ code, state })),
    [
      { code: "automatic_sync_failed", state: "opened" },
      { code: "automatic_sync_failed", state: "resolved" },
    ],
  );
  const finalState = JSON.parse(await readFile(statePath, "utf8"));
  assert.deepEqual(finalState.diagnostics, {
    version: 1,
    activeBySource: {},
    outboxBySource: {},
  });
});

test("browser Sync confirms unchanged usage and scopes diagnostics to claimed sources", async (context) => {
  const requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const selectedAccountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const selectedSourceId = "33333333-3333-4333-8333-333333333333";
  const otherSourceId = "44444444-4444-4444-8444-444444444444";
  const diagnosticBodies = [];
  const usageBodies = [];
  const resultBodies = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
      response.setHeader("content-type", "application/json");
      if (request.url === "/api/installations/current/sync/claim") {
        response.end(
          JSON.stringify({
            requestId,
            sourceIds:
              body.scope === "installation"
                ? [selectedSourceId, otherSourceId]
                : [selectedSourceId],
          }),
        );
        return;
      }
      if (request.url === "/api/usage") {
        usageBodies.push(body);
        response.end(JSON.stringify(usageResponse(body)));
        return;
      }
      if (request.url === "/api/installations/current/diagnostics") {
        diagnosticBodies.push(body);
        response.end(JSON.stringify({ acceptedEvents: body.events.length }));
        return;
      }
      if (request.url === "/api/installations/current/sync/result") {
        resultBodies.push(body);
        response.statusCode = 204;
        response.end();
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not_found" }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-browser-diagnostic-scope-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const captures = join(home, ".viberacing", "captures");
  await mkdir(captures, { recursive: true });
  const sources = [
    {
      clientSourceId: "11111111-1111-4111-8111-111111111111",
      sourceId: selectedSourceId,
      agentAccountId: selectedAccountId,
      agentId: "antigravity",
      accountLabel: "Selected",
      collectionMethod: "antigravity_cli_capture",
      supportedSurface: "cli",
      suggestedLabel: "Selected",
      dataPath: join(captures, "selected.jsonl"),
    },
    {
      clientSourceId: "22222222-2222-4222-8222-222222222222",
      sourceId: otherSourceId,
      agentAccountId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      agentId: "antigravity",
      accountLabel: "Other",
      collectionMethod: "antigravity_cli_capture",
      supportedSurface: "cli",
      suggestedLabel: "Other",
      dataPath: join(captures, "other.jsonl"),
    },
  ];
  for (const source of sources) await writeFile(source.dataPath, "");
  const directory = await writeMappedInstallation(
    home,
    `http://127.0.0.1:${address.port}`,
    sources,
  );
  const statePath = join(directory, "state.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  for (const sourceId of [selectedSourceId, otherSourceId]) {
    reconcileDiagnosticPhase(state, sourceId, "collect", [
      { code: "collector_failed", phase: "collect" },
    ]);
  }
  await writeFile(statePath, `${JSON.stringify(state)}\n`);

  await execFileAsync(
    process.execPath,
    [
      connectorPath,
      "handle-url",
      `viberacing://sync?requestId=${requestId}&accountId=${selectedAccountId}&grant=${"g".repeat(32)}`,
    ],
    { env: connectorEnvironment(home) },
  );
  await execFileAsync(
    process.execPath,
    [
      connectorPath,
      "handle-url",
      `viberacing://sync?requestId=${requestId}&accountId=${selectedAccountId}&grant=${"g".repeat(32)}`,
    ],
    { env: connectorEnvironment(home) },
  );
  await execFileAsync(
    process.execPath,
    [
      connectorPath,
      "handle-url",
      `viberacing://sync?requestId=${requestId}&scope=installation&grant=${"g".repeat(32)}`,
    ],
    { env: connectorEnvironment(home) },
  );

  assert.equal(diagnosticBodies.length, 2);
  assert.deepEqual(
    [...new Set(diagnosticBodies[0].events.map((event) => event.sourceId))],
    [selectedSourceId],
  );
  assert.deepEqual(
    [...new Set(diagnosticBodies[1].events.map((event) => event.sourceId))],
    [otherSourceId],
  );
  assert.deepEqual(
    usageBodies.map((body) => body.snapshots[0]?.syncSequence),
    ["1", "2", "3"],
  );
  assert.deepEqual(
    usageBodies.map((body) => new Set(body.snapshots.map((snapshot) => snapshot.sourceId))),
    [
      new Set([selectedSourceId]),
      new Set([selectedSourceId]),
      new Set([selectedSourceId, otherSourceId]),
    ],
  );
  assert.deepEqual(
    resultBodies.map(({ status, resultCode }) => ({ status, resultCode })),
    [
      { status: "succeeded", resultCode: "complete" },
      { status: "succeeded", resultCode: "complete" },
      { status: "succeeded", resultCode: "complete" },
    ],
  );
  const finalState = JSON.parse(await readFile(statePath, "utf8"));
  assert.deepEqual(finalState.diagnostics.outboxBySource, {});
});

test("browser Sync does not report unchanged after accepting a pending rolling snapshot", async (context) => {
  const requestId = "62626262-6262-4626-8626-626262626262";
  const usageBodies = [];
  const resultBodies = [];
  let installation;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
      response.setHeader("content-type", "application/json");
      if (request.url === "/api/installations/current/sync/claim") {
        response.end(JSON.stringify({ requestId, sourceIds: [installation.sourceId] }));
        return;
      }
      if (request.url === "/api/usage") {
        usageBodies.push(body);
        response.end(JSON.stringify(usageResponse(body)));
        return;
      }
      if (request.url === "/api/installations/current/sync/result") {
        resultBodies.push(body);
        response.statusCode = 204;
        response.end();
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not_found" }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-browser-pending-rolling-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  installation = await writeCaptureInstallation(home, `http://127.0.0.1:${address.port}`, {
    date: "2026-09-01",
    events: [],
    historyBackfillYear: 2026,
    historyBackfillStatus: "complete",
  });
  const statePath = join(installation.directory, "state.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.sequences[installation.sourceId] = "1";
  await writeFile(statePath, `${JSON.stringify(state)}\n`);
  const pendingDirectory = join(installation.directory, "pending");
  await mkdir(pendingDirectory, { recursive: true });
  await writeFile(
    join(pendingDirectory, `${installation.sourceId}.json`),
    `${JSON.stringify({
      protocolVersion: 5,
      snapshots: [
        {
          sourceId: installation.sourceId,
          syncSequence: "1",
          kind: "rolling",
          rangeStart: "2026-08-02",
          rangeEnd: "2026-09-01",
          completeness: "complete",
          entries: [],
        },
      ],
      sourceErrors: [],
    })}\n`,
  );

  const url = `viberacing://sync?requestId=${requestId}&scope=installation&grant=${"g".repeat(32)}`;
  await execFileAsync(process.execPath, [connectorPath, "handle-url", url], {
    env: connectorEnvironment(home, {
      NODE_ENV: "test",
      VIBERACING_TEST_NOW: "2026-09-01T12:00:00.000Z",
    }),
  });

  assert.deepEqual(
    usageBodies.map((body) => body.snapshots[0]?.syncSequence),
    ["1", "2"],
  );
  assert.deepEqual(resultBodies, [{ requestId, status: "succeeded", resultCode: "complete" }]);
});

test("browser Sync reports useful work when an unchanged rolling snapshot imports history", async (context) => {
  const requestId = "61616161-6161-4616-8616-616161616161";
  const resultBodies = [];
  const usageBodies = [];
  let installation;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
      response.setHeader("content-type", "application/json");
      if (request.url === "/api/installations/current/sync/claim") {
        response.end(JSON.stringify({ requestId, sourceIds: [installation.sourceId] }));
        return;
      }
      if (request.url === "/api/usage") {
        usageBodies.push(body);
        response.end(JSON.stringify(usageResponse(body)));
        return;
      }
      if (request.url === "/api/installations/current/sync/result") {
        resultBodies.push(body);
        response.statusCode = 204;
        response.end();
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not_found" }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-browser-history-progress-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  installation = await writeCaptureInstallation(home, `http://127.0.0.1:${address.port}`, {
    date: "2026-09-01",
    events: ["2026-09-01", "2026-07-15", "2026-06-15"].map((date, index) => ({
      id: `browser-history-${index}`,
      date,
      usage: { date, totalTokens: String(index + 1) },
    })),
    historyBackfillYear: 2026,
    historyBackfillStatus: "pending",
  });
  const environment = connectorEnvironment(home, {
    NODE_ENV: "test",
    VIBERACING_TEST_NOW: "2026-09-01T12:00:00.000Z",
  });
  const url = `viberacing://sync?requestId=${requestId}&scope=installation&grant=${"g".repeat(32)}`;
  await execFileAsync(process.execPath, [connectorPath, "handle-url", url], { env: environment });
  await execFileAsync(process.execPath, [connectorPath, "handle-url", url], { env: environment });

  const secondCallSnapshots = usageBodies.slice(2).flatMap((body) => body.snapshots);
  assert.equal(
    secondCallSnapshots.some((snapshot) => snapshot.kind === "rolling"),
    true,
  );
  assert.equal(
    secondCallSnapshots.some((snapshot) => snapshot.kind === "year_backfill"),
    true,
  );
  assert.deepEqual(
    resultBodies.map(({ status, resultCode }) => ({ status, resultCode })),
    [
      { status: "succeeded", resultCode: "complete" },
      { status: "succeeded", resultCode: "complete" },
    ],
  );
});

test("one successful contact sends at most one bounded diagnostic batch", async (context) => {
  const diagnosticBodies = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
      response.setHeader("content-type", "application/json");
      if (request.url === "/api/usage") {
        response.end(JSON.stringify(usageResponse(body)));
        return;
      }
      if (request.url === "/api/installations/current/diagnostics") {
        diagnosticBodies.push(body);
        response.end(JSON.stringify({ acceptedEvents: body.events.length }));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not_found" }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-diagnostic-batch-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const captures = join(home, ".viberacing", "captures");
  await mkdir(captures, { recursive: true });
  const sources = [1, 2].map((index) => ({
    clientSourceId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    sourceId: `00000000-0000-4000-9000-${String(index).padStart(12, "0")}`,
    agentId: "antigravity",
    collectionMethod: "antigravity_cli_capture",
    supportedSurface: "cli",
    suggestedLabel: `Source ${index}`,
    dataPath: join(captures, `${index}.jsonl`),
  }));
  for (const source of sources) await writeFile(source.dataPath, "");
  const directory = await writeMappedInstallation(
    home,
    `http://127.0.0.1:${address.port}`,
    sources,
  );
  const statePath = join(directory, "state.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.diagnostics = { version: 1, activeBySource: {}, outboxBySource: {} };
  for (const source of sources) {
    state.diagnostics.outboxBySource[source.sourceId] = {};
    for (const [phase, codes] of Object.entries(diagnosticCodesByPhase)) {
      for (const code of codes) {
        state.diagnostics.outboxBySource[source.sourceId][`${phase}:${code}`] = [
          "opened",
          "resolved",
        ];
      }
    }
  }
  await writeFile(statePath, `${JSON.stringify(state)}\n`);

  await execFileAsync(process.execPath, [connectorPath, "sync"], {
    env: connectorEnvironment(home),
  });

  assert.equal(diagnosticBodies.length, 1);
  assert.equal(diagnosticBodies[0].events.length, 32);
  const finalState = JSON.parse(await readFile(statePath, "utf8"));
  const seededEvents =
    sources.length *
    Object.values(diagnosticCodesByPhase).reduce((total, codes) => total + codes.length * 2, 0);
  assert.equal(
    pendingDiagnosticEvents(
      finalState,
      sources.map((source) => source.sourceId),
      1_000,
    ).length,
    seededEvents - 32,
  );
});

test("diagnostic outbox survives offline sync and drains after connectivity recovers", async (context) => {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const reservedAddress = reservation.address();
  assert.notEqual(reservedAddress, null);
  assert.equal(typeof reservedAddress, "object");
  const port = reservedAddress.port;
  await new Promise((resolve, reject) =>
    reservation.close((error) => (error === undefined ? resolve() : reject(error))),
  );

  const home = await mkdtemp(join(tmpdir(), "viberacing-diagnostic-offline-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const installation = await writeCaptureInstallation(home, `http://127.0.0.1:${port}`);
  const statePath = join(installation.directory, "state.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  reconcileDiagnosticPhase(state, installation.sourceId, "collect", [
    { code: "collector_failed", phase: "collect" },
  ]);
  await writeFile(statePath, `${JSON.stringify(state)}\n`);
  const environment = connectorEnvironment(home);

  await assert.rejects(
    execFileAsync(process.execPath, [connectorPath, "sync"], { env: environment }),
  );
  assert.equal(
    JSON.parse(await readFile(statePath, "utf8")).diagnostics.outboxBySource[installation.sourceId][
      "collect:collector_failed"
    ][0],
    "opened",
  );

  const diagnosticBodies = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      if (request.method === "POST" && request.url === "/api/installations/current") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(reconciliationResponse([{ sourceId: installation.sourceId }])));
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (request.method === "POST" && request.url === "/api/usage") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(usageResponse(body)));
        return;
      }
      if (request.method === "POST" && request.url === "/api/installations/current/diagnostics") {
        diagnosticBodies.push(body);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ acceptedEvents: body.events.length }));
        return;
      }
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
    });
  });
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());

  await execFileAsync(process.execPath, [connectorPath, "sync"], { env: environment });
  assert.deepEqual(
    diagnosticBodies.flatMap((body) => body.events.map(({ code, state }) => ({ code, state }))),
    [
      { code: "collector_failed", state: "opened" },
      { code: "collector_failed", state: "resolved" },
    ],
  );
  assert.deepEqual(JSON.parse(await readFile(statePath, "utf8")).diagnostics.outboxBySource, {});
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
      if (request.url === "/api/installations/current/diagnostics") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ acceptedEvents: body.events.length }));
        return;
      }
      bodies.push(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(usageResponse(body)));
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
      accountLabel: `Unsupported ${index}`,
      historyBackfillYear: new Date().getUTCFullYear(),
      historyBackfillStatus: "complete",
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

test("reconnect replaces authorization after an in-flight sync without token resurrection", async (context) => {
  let releaseOldUpload;
  let oldUploadStarted;
  const oldUpload = new Promise((resolve) => (oldUploadStarted = resolve));
  const oldUploadCanFinish = new Promise((resolve) => (releaseOldUpload = resolve));
  context.after(() => releaseOldUpload());
  const authorizations = [];
  let installation;
  let replacementInstallationId;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      if (request.url === "/api/pairing/start") {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        replacementInstallationId = body.installationId;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            installationId: body.installationId,
            pollToken: "replacement_poll_token_that_is_long_enough",
            verificationUrl: `http://${request.headers.host}/connect?code=RECONNEC`,
            code: "RECONNEC",
            expiresInSeconds: 30,
          }),
        );
        return;
      }
      if (request.url === "/api/pairing/poll") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            status: "active",
            deviceToken: "replacement-device-token-that-is-long-enough",
            protocol: {
              version: connectorProtocolVersion,
              snapshotDays: 31,
              maximumSources: 32,
              maximumEntries: 1_024,
            },
            sources: [
              {
                clientSourceId: installation.clientSourceId,
                sourceId: installation.sourceId,
                agentAccountId: "71717171-7171-4171-8171-717171717171",
                agentId: "antigravity",
                accountLabel: "Antigravity",
                collectionMethod: "antigravity_cli_capture",
                lastAcceptedSyncSequence: "0",
                historyBackfillYear: new Date().getUTCFullYear(),
                historyBackfillStatus: "complete",
              },
            ],
          }),
        );
        return;
      }
      if (request.url !== "/api/usage") {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "not_found" }));
        return;
      }
      const authorization = request.headers.authorization;
      authorizations.push(authorization);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const finish = () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(usageResponse(body)));
      };
      if (authorization?.includes("synthetic-device-token")) {
        oldUploadStarted();
        oldUploadCanFinish.then(finish);
      } else finish();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-reconnect-sync-race-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  installation = await writeCaptureInstallation(home, `http://127.0.0.1:${address.port}`);
  await writeFile(
    join(installation.directory, "state.json"),
    `${JSON.stringify({
      version: 1,
      sequences: { [installation.sourceId]: "0" },
      automaticDisabledReason: "unsupported_connector",
    })}\n`,
  );
  const environment = connectorEnvironment(home, {
    NODE_ENV: "test",
    PATH: "",
    VIBERACING_TEST_PAIRING_POLL_INTERVAL_MS: "10",
  });
  const oldSync = execFileAsync(process.execPath, [connectorPath, "sync"], { env: environment });
  await oldUpload;
  const reconnect = execFileAsync(
    process.execPath,
    [connectorPath, "connect", "--origin", `http://127.0.0.1:${address.port}`],
    { env: environment },
  );
  await waitFor(() =>
    access(join(installation.directory, "lifecycle-revoking.lock")).then(
      () => true,
      () => false,
    ),
  );
  assert.equal(
    JSON.parse(await readFile(join(installation.directory, "config.json"), "utf8")).deviceToken,
    "synthetic-device-token-that-is-long-enough",
  );

  releaseOldUpload();
  const oldResult = await oldSync.catch((error) => error);
  assert.equal(oldResult.code, 1);
  assert.match(oldResult.stderr, /stopped by a local lifecycle operation/i);
  await reconnect;

  const config = JSON.parse(await readFile(join(installation.directory, "config.json"), "utf8"));
  assert.equal(config.deviceToken, "replacement-device-token-that-is-long-enough");
  assert.equal(config.installationId, replacementInstallationId);
  const state = JSON.parse(await readFile(join(installation.directory, "state.json"), "utf8"));
  assert.equal(state.automaticDisabledReason, undefined);
  assert.deepEqual(authorizations, [
    "Bearer synthetic-device-token-that-is-long-enough",
    "Bearer replacement-device-token-that-is-long-enough",
    "Bearer replacement-device-token-that-is-long-enough",
  ]);
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
          JSON.stringify(
            usageResponse({
              snapshots: [{ sourceId: installation.sourceId, syncSequence: "1", entries: [{}] }],
              sourceErrors: [],
            }),
          ),
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
  await waitFor(() =>
    access(join(installation.directory, "lifecycle-revoking.lock")).then(
      () => true,
      () => false,
    ),
  );
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

test("disconnect fails closed and retains installation identity when the local token cannot be removed", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-disconnect-token-removal-failure-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const directory = await writeMappedInstallation(home, "http://127.0.0.1:1", []);
  const installationId = "97979797-9797-4979-8979-979797979797";
  await writeFile(
    join(directory, "installation.json"),
    `${JSON.stringify({
      version: 1,
      id: installationId,
      secret: "retained_installation_secret_that_is_long_enough",
    })}\n`,
    { mode: 0o600 },
  );

  const result = await runWithInput(
    ["disconnect"],
    connectorEnvironment(home, {
      NODE_ENV: "test",
      VIBERACING_TEST_FAIL_CONFIG_REMOVAL: "1",
    }),
    "",
  );
  assert.equal(result.code, 1);
  assert.match(result.stderr, /local token file could not be removed/i);
  assert.doesNotMatch(result.stdout, /Installation disconnected locally/i);
  assert.doesNotMatch(result.stderr, /local token and hooks were removed/i);
  await access(join(directory, "config.json"));
  await access(join(directory, "installation.json"));
});

test("disconnect retains the token when durable OpenCode revocation preparation fails", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-disconnect-revocation-prepare-failure-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const installationId = randomUUID();
  const environment = connectorEnvironment(home, {
    HOME: home,
    USERPROFILE: home,
    NODE_ENV: "test",
    VIBERACING_TEST_FAIL_OPENCODE_REVOCATION_PREPARE: "1",
  });
  const { directory } = await writeMappedOpenCodeInstallation(
    home,
    "http://127.0.0.1:1",
    installationId,
  );
  const installed = await reconcileOpenCodePlugin({
    installationId,
    stateRoot: directory,
    environment,
    homeDirectory: home,
    desired: true,
  });

  const result = await runWithInput(["disconnect"], environment, "");
  assert.equal(result.code, 1);
  assert.match(result.stderr, /local token file could not be removed/i);
  assert.match(result.stderr, /revocation journal failure/i);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /Installation disconnected locally;|local token and hooks were removed/i,
  );
  await access(join(directory, "config.json"));
  await access(installed.path);
  await assert.rejects(access(join(directory, "opencode-plugin-cleanup.json")), {
    code: "ENOENT",
  });
  await assert.rejects(access(join(directory, "opencode-plugin-revocation.json")), {
    code: "ENOENT",
  });
});

test("reset-installation and uninstall preserve recovery state when teardown prepare fails", async (context) => {
  for (const command of ["reset-installation", "uninstall"]) {
    const home = await mkdtemp(join(tmpdir(), `viberacing-${command}-prepare-failure-`));
    context.after(() => rm(home, { recursive: true, force: true }));
    const installationId = randomUUID();
    const environment = connectorEnvironment(home, {
      HOME: home,
      USERPROFILE: home,
      NODE_ENV: "test",
      VIBERACING_TEST_FAIL_OPENCODE_REVOCATION_PREPARE: "1",
    });
    const { directory } = await writeMappedOpenCodeInstallation(
      home,
      "http://127.0.0.1:1",
      installationId,
    );
    const installed = await reconcileOpenCodePlugin({
      installationId,
      stateRoot: directory,
      environment,
      homeDirectory: home,
      desired: true,
    });
    await writeFile(
      join(directory, "installation.json"),
      `${JSON.stringify({
        version: 1,
        id: installationId,
        secret: "prepare_failure_installation_secret_that_is_long_enough",
        openCodePluginPath: installed.path,
      })}\n`,
      { mode: 0o600 },
    );
    const configBefore = await readFile(join(directory, "config.json"));
    const identityBefore = await readFile(join(directory, "installation.json"));
    const pluginBefore = await readFile(installed.path);

    const result = await runWithInput([command], environment, "");
    assert.equal(result.code, 1, `${command}: ${result.stderr}`);
    assert.match(result.stderr, /revocation journal failure/i);
    assert.deepEqual(await readFile(join(directory, "config.json")), configBefore);
    assert.deepEqual(await readFile(join(directory, "installation.json")), identityBefore);
    assert.deepEqual(await readFile(installed.path), pluginBefore);
    await assert.rejects(access(join(directory, "opencode-plugin-cleanup.json")), {
      code: "ENOENT",
    });
    await assert.rejects(access(join(directory, "opencode-plugin-revocation.json")), {
      code: "ENOENT",
    });
  }
});

test("reset-installation and uninstall preserve recovery state when the cleanup journal is full", async (context) => {
  for (const command of ["reset-installation", "uninstall"]) {
    const home = await mkdtemp(join(tmpdir(), `viberacing-${command}-full-journal-`));
    context.after(() => rm(home, { recursive: true, force: true }));
    const installationId = randomUUID();
    const environment = connectorEnvironment(home, { HOME: home, USERPROFILE: home });
    const { directory } = await writeMappedOpenCodeInstallation(
      home,
      "http://127.0.0.1:1",
      installationId,
    );
    const installed = await reconcileOpenCodePlugin({
      installationId,
      stateRoot: directory,
      environment,
      homeDirectory: home,
      desired: true,
    });
    await writeFile(
      join(directory, "installation.json"),
      `${JSON.stringify({
        version: 1,
        id: installationId,
        secret: "full_journal_installation_secret_that_is_long_enough",
        openCodePluginPath: installed.path,
      })}\n`,
      { mode: 0o600 },
    );
    const cleanupPath = join(directory, "opencode-plugin-cleanup.json");
    const fullJournal = Buffer.from(
      `${JSON.stringify({
        version: 2,
        targets: Array.from({ length: 32 }, () => ({ installationId: randomUUID() })),
      })}\n`,
    );
    await writeFile(cleanupPath, fullJournal, { mode: 0o600 });
    const configBefore = await readFile(join(directory, "config.json"));
    const identityBefore = await readFile(join(directory, "installation.json"));
    const pluginBefore = await readFile(installed.path);

    const result = await runWithInput([command], environment, "");
    assert.equal(result.code, 1, `${command}: ${result.stderr}`);
    assert.match(result.stderr, /cleanup target limit was reached/i);
    assert.deepEqual(await readFile(join(directory, "config.json")), configBefore);
    assert.deepEqual(await readFile(join(directory, "installation.json")), identityBefore);
    assert.deepEqual(await readFile(installed.path), pluginBefore);
    assert.deepEqual(await readFile(cleanupPath), fullJournal);
    await assert.rejects(access(join(directory, "opencode-plugin-revocation.json")), {
      code: "ENOENT",
    });
  }
});

test("disconnected commands are clear and disconnect remains idempotent", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-already-disconnected-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
  const environment = connectorEnvironment(home);

  for (const command of ["sync", "accounts"]) {
    const result = await execFileAsync(process.execPath, [connectorPath, command], {
      env: environment,
    }).catch((error) => error);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /This computer is not connected/);
    assert.doesNotMatch(result.stderr, /ENOENT|config\.json/);
  }

  const result = await execFileAsync(process.execPath, [connectorPath, "disconnect"], {
    env: environment,
  });
  assert.match(result.stdout, /Installation disconnected locally/);
  assert.equal(result.stderr, "");
});

test("disconnect warns when a pending pairing cancellation cannot be confirmed without config", async (context) => {
  let cancellationRequests = 0;
  const server = createServer((request) => {
    if (request.url === "/api/pairing/cancel" && request.method === "POST") {
      cancellationRequests += 1;
      request.socket.destroy();
      return;
    }
    request.socket.destroy();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");

  const home = await mkdtemp(join(tmpdir(), "viberacing-unconfirmed-pairing-cancel-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const directory = join(home, ".viberacing");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, ".viberacing-state"), '{"format":1}\n');
  await writeFile(
    join(directory, "connect-attempt.json"),
    `${JSON.stringify({
      version: 1,
      attemptId: randomUUID(),
      installationId: randomUUID(),
      sourceRegistryRevision: randomUUID(),
      origin: `http://127.0.0.1:${address.port}`,
      startedAt: new Date().toISOString(),
      pollToken: "unconfirmed_pairing_poll_token_long_enough",
    })}\n`,
  );

  const environment = connectorEnvironment(home);
  const result = await execFileAsync(process.execPath, [connectorPath, "disconnect"], {
    env: environment,
  });
  assert.match(result.stdout, /Installation disconnected locally/);
  assert.match(result.stderr, /remote pairing cancellation could not be confirmed/i);
  assert.equal(cancellationRequests, 1);
  await assert.rejects(access(join(directory, "connect-attempt.json")));
  await assert.rejects(access(join(directory, "config.json")));

  const repeated = await execFileAsync(process.execPath, [connectorPath, "disconnect"], {
    env: environment,
  });
  assert.equal(repeated.stderr, "");
  assert.equal(cancellationRequests, 1);
});

test("successful installation revoke confirms only the matching failed pairing cancellation", async (context) => {
  let cancellationRequests = 0;
  let revocationRequests = 0;
  const server = createServer((request, response) => {
    if (request.url === "/api/pairing/cancel" && request.method === "POST") {
      cancellationRequests += 1;
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "server_error" }));
      return;
    }
    if (request.url === "/api/installations/current" && request.method === "DELETE") {
      revocationRequests += 1;
      response.writeHead(204);
      response.end();
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");

  const alternateServer = createServer((request, response) => {
    if (request.url === "/api/pairing/cancel" && request.method === "POST") {
      cancellationRequests += 1;
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "server_error" }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  });
  alternateServer.listen(0, "127.0.0.1");
  await once(alternateServer, "listening");
  context.after(() => alternateServer.close());
  const alternateAddress = alternateServer.address();
  assert.notEqual(alternateAddress, null);
  assert.equal(typeof alternateAddress, "object");

  const origin = `http://127.0.0.1:${address.port}`;
  const alternateOrigin = `http://127.0.0.1:${alternateAddress.port}`;
  const runScenario = async ({
    name,
    configInstallationId,
    attemptInstallationId,
    attemptOrigin = origin,
    warns,
  }) => {
    const home = await mkdtemp(join(tmpdir(), `viberacing-pairing-cancel-${name}-`));
    context.after(() => rm(home, { recursive: true, force: true }));
    const { directory } = await writeCaptureInstallation(
      home,
      origin,
      configInstallationId === undefined ? {} : { installationId: configInstallationId },
    );
    await writeFile(
      join(directory, "connect-attempt.json"),
      `${JSON.stringify({
        version: 1,
        attemptId: randomUUID(),
        installationId: attemptInstallationId,
        sourceRegistryRevision: randomUUID(),
        origin: attemptOrigin,
        startedAt: new Date().toISOString(),
        pollToken: `${name}_fallback_pairing_poll_token_long_enough`,
      })}\n`,
    );

    const result = await execFileAsync(process.execPath, [connectorPath, "disconnect"], {
      env: connectorEnvironment(home),
    });
    assert.match(result.stdout, /Installation disconnected locally/);
    if (warns) assert.match(result.stderr, /remote pairing cancellation could not be confirmed/i);
    else assert.doesNotMatch(result.stderr, /remote pairing cancellation could not be confirmed/i);
    assert.doesNotMatch(result.stderr, /remote revoke could not be confirmed/i);
    await assert.rejects(access(join(directory, "connect-attempt.json")));
    await assert.rejects(access(join(directory, "config.json")));
  };

  const matchingInstallationId = randomUUID();
  await runScenario({
    name: "matching",
    configInstallationId: matchingInstallationId,
    attemptInstallationId: matchingInstallationId,
    warns: false,
  });
  await runScenario({
    name: "mismatched",
    configInstallationId: randomUUID(),
    attemptInstallationId: randomUUID(),
    warns: true,
  });
  const originMismatchInstallationId = randomUUID();
  await runScenario({
    name: "origin-mismatched",
    configInstallationId: originMismatchInstallationId,
    attemptInstallationId: originMismatchInstallationId,
    attemptOrigin: alternateOrigin,
    warns: true,
  });
  await runScenario({
    name: "legacy",
    configInstallationId: undefined,
    attemptInstallationId: randomUUID(),
    warns: true,
  });
  assert.equal(cancellationRequests, 4);
  assert.equal(revocationRequests, 4);
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

test("uninstall rejects the wrong default state root and cleans the selected custom installation", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-uninstall-selected-state-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const customHome = join(home, "custom-installation");
  const customDirectory = join(customHome, ".viberacing");
  const qwenRoot = join(home, "qwen-custom");
  const source = {
    clientSourceId: "97979797-9797-4797-8797-979797979797",
    sourceId: "98989898-9898-4989-8989-989898989898",
    agentId: "qwen_code",
    dataPath: join(qwenRoot, "usage"),
    hookConfigRoot: qwenRoot,
    collectionMethod: "qwen_stats_jsonl",
    supportedSurface: "cli",
    suggestedLabel: "Custom state",
  };
  await writeMappedInstallation(customHome, "http://127.0.0.1:1", [source]);
  const runtime = join(customDirectory, "runtime", connectorVersion, "bin", "viberacing.mjs");
  await mkdir(join(customDirectory, "runtime", connectorVersion, "bin"), { recursive: true });
  await writeFile(runtime, "// installed connector runtime\n");
  await mkdir(qwenRoot, { recursive: true });
  await writeFile(
    join(qwenRoot, "settings.json"),
    JSON.stringify({
      hooks: {
        SessionEnd: [
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
    }),
  );
  const defaultEnvironment = connectorEnvironment(home, { HOME: home, USERPROFILE: home });
  delete defaultEnvironment.VIBERACING_STATE_DIR;
  const defaultDirectory = join(home, ".viberacing");
  const initializedDefault = await runWithInput(["source", "list"], defaultEnvironment, "");
  assert.equal(initializedDefault.code, 0);
  assert.deepEqual(await readdir(defaultDirectory), [".viberacing-state"]);
  const defaultMarker = await readFile(join(defaultDirectory, ".viberacing-state"), "utf8");

  const wrongRoot = await runWithInput(["uninstall"], defaultEnvironment, "");
  assert.equal(wrongRoot.code, 1);
  assert.equal(wrongRoot.stdout, "");
  assert.match(wrongRoot.stderr, /No Vibe Racing installation was found/i);
  assert.match(wrongRoot.stderr, /VIBERACING_STATE_DIR/);
  assert.deepEqual(await readdir(defaultDirectory), [".viberacing-state"]);
  assert.equal(await readFile(join(defaultDirectory, ".viberacing-state"), "utf8"), defaultMarker);
  await access(join(customDirectory, "config.json"));
  await access(runtime);
  assert.match(await readFile(join(qwenRoot, "settings.json"), "utf8"), /viberacing-hook-v3/);

  const selectedRoot = await runWithInput(
    ["uninstall"],
    { ...defaultEnvironment, VIBERACING_STATE_DIR: customDirectory },
    "",
  );
  assert.equal(selectedRoot.code, 0);
  assert.match(selectedRoot.stdout, /hooks, installed copy, secrets, and local state removed/i);
  await assert.rejects(access(customDirectory), { code: "ENOENT" });
  const settings = await readFile(join(qwenRoot, "settings.json"), "utf8");
  assert.match(settings, /keep-foreign/);
  assert.doesNotMatch(settings, /viberacing-hook-v3/);
});

test("uninstall cleans an incomplete installation that contains only an installed runtime", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-uninstall-runtime-only-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const directory = join(home, ".viberacing");
  const runtime = join(directory, "runtime", connectorVersion, "bin", "viberacing.mjs");
  await mkdir(join(directory, "runtime", connectorVersion, "bin"), { recursive: true });
  await writeFile(join(directory, ".viberacing-state"), '{"format":1}\n');
  await writeFile(runtime, "// installed connector runtime\n");

  const result = await runWithInput(["uninstall"], connectorEnvironment(home), "");
  assert.equal(result.code, 0);
  assert.match(result.stdout, /hooks, installed copy, secrets, and local state removed/i);
  await assert.rejects(access(directory), { code: "ENOENT" });
});

test("uninstall retains secret-free OpenCode cleanup metadata until a foreign plugin is gone", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-uninstall-opencode-conflict-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const directory = await writeMappedInstallation(home, "http://127.0.0.1:1", []);
  const installationId = "71717171-7171-4171-8171-717171717171";
  const secret = "opencode_cleanup_secret_that_must_not_be_retained";
  const pluginPath = openCodePluginLocation({
    installationId,
    environment: connectorEnvironment(home),
    homeDirectory: home,
  }).path;
  await mkdir(dirname(pluginPath), { recursive: true });
  await writeFile(pluginPath, "export const ForeignPlugin = async () => ({});\n", { mode: 0o600 });
  await mkdir(join(directory, "bin"), { recursive: true });
  await writeFile(join(directory, "bin", "viberacing.mjs"), "// cleanup runtime\n");
  await writeFile(
    join(directory, "installation.json"),
    `${JSON.stringify({ version: 1, id: installationId, secret, openCodePluginPath: pluginPath })}\n`,
    { mode: 0o600 },
  );

  const first = await runWithInput(["uninstall"], connectorEnvironment(home), "");
  assert.equal(first.code, 1);
  assert.match(first.stdout, /cleanup metadata and runtime were retained/i);
  assert.match(first.stderr, /1 OpenCode plugin/i);
  await assert.rejects(access(join(directory, "installation.json")), { code: "ENOENT" });
  await assert.rejects(access(join(directory, "config.json")), { code: "ENOENT" });
  await access(join(directory, "bin", "viberacing.mjs"));
  const cleanup = await readFile(join(directory, "opencode-plugin-cleanup.json"), "utf8");
  assert.equal(cleanup.includes(secret), false);
  assert.deepEqual(JSON.parse(cleanup), {
    version: 1,
    installationId,
    openCodePluginPath: pluginPath,
  });
  assert.match(await readFile(pluginPath, "utf8"), /ForeignPlugin/);

  await unlink(pluginPath);
  const second = await runWithInput(["uninstall"], connectorEnvironment(home), "");
  assert.equal(second.code, 0);
  await assert.rejects(access(directory), { code: "ENOENT" });
});

test("uninstall preserves owned plugin recovery evidence when cleanup metadata is unreadable", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-uninstall-unreadable-cleanup-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const environment = connectorEnvironment(home, { HOME: home, USERPROFILE: home });
  const directory = await writeMappedInstallation(home, "http://127.0.0.1:1", []);
  const installationId = "69696969-6969-4969-8969-696969696969";
  const installed = await reconcileOpenCodePlugin({
    installationId,
    stateRoot: directory,
    environment,
    homeDirectory: home,
    desired: true,
  });
  await writeFile(
    join(directory, "installation.json"),
    `${JSON.stringify({
      version: 1,
      id: installationId,
      secret: "unreadable_cleanup_installation_secret_that_is_long_enough",
      openCodePluginPath: installed.path,
    })}\n`,
    { mode: 0o600 },
  );
  const cleanupPath = join(directory, "opencode-plugin-cleanup.json");
  const unreadableCleanup = "{not-json\n";
  await writeFile(cleanupPath, unreadableCleanup, { mode: 0o600 });
  const pluginContents = await readFile(installed.path);
  const pluginStat = await stat(installed.path);

  const result = await runWithInput(["uninstall"], environment, "");
  assert.equal(result.code, 1);
  assert.match(result.stdout, /cleanup metadata was unreadable/i);
  assert.match(result.stdout, /installation identity.*retained for recovery/i);
  assert.match(result.stderr, /OpenCode cleanup detail:/i);
  assert.doesNotMatch(result.stdout, /hooks, installed copy, secrets, and local state removed/i);
  assert.deepEqual(await readFile(installed.path), pluginContents);
  if (process.platform !== "win32") {
    const retainedStat = await stat(installed.path);
    assert.equal(retainedStat.dev, pluginStat.dev);
    assert.equal(retainedStat.ino, pluginStat.ino);
  }
  await access(join(directory, "installation.json"));
  assert.equal(await readFile(cleanupPath, "utf8"), unreadableCleanup);
  await assert.rejects(access(join(directory, "config.json")), { code: "ENOENT" });
});

test("disconnect durably recovers OpenCode teardown after config-removal crashes", async (context) => {
  for (const identity of ["missing", "corrupt"])
    for (const cleanupJournal of ["missing", "corrupt"]) {
      const home = await mkdtemp(
        join(tmpdir(), `viberacing-disconnect-crash-${identity}-${cleanupJournal}-`),
      );
      context.after(() => rm(home, { recursive: true, force: true }));
      const installationId = randomUUID();
      const environment = connectorEnvironment(home, {
        HOME: home,
        USERPROFILE: home,
        NODE_ENV: "test",
        VIBERACING_TEST_INTERRUPT_AFTER_CONFIG_REMOVAL: "1",
      });
      const { directory } = await writeMappedOpenCodeInstallation(
        home,
        "http://127.0.0.1:1",
        installationId,
      );
      const installed = await reconcileOpenCodePlugin({
        installationId,
        stateRoot: directory,
        environment,
        homeDirectory: home,
        desired: true,
      });
      if (identity === "corrupt")
        await writeFile(join(directory, "installation.json"), "{not-json\n", { mode: 0o600 });
      const cleanupPath = join(directory, "opencode-plugin-cleanup.json");
      const revocationPath = join(directory, "opencode-plugin-revocation.json");
      const corruptBytes = Buffer.from("{corrupt-cleanup-journal\n");
      if (cleanupJournal === "corrupt") await writeFile(cleanupPath, corruptBytes, { mode: 0o600 });

      const interrupted = await runWithInput(["disconnect"], environment, "");
      assert.equal(interrupted.code, 86, `${identity}/${cleanupJournal}: ${interrupted.stderr}`);
      assert.doesNotMatch(interrupted.stdout + interrupted.stderr, /disconnected locally/i);
      await assert.rejects(access(join(directory, "config.json")), { code: "ENOENT" });
      await access(installed.path);
      const recoveryPath = cleanupJournal === "corrupt" ? revocationPath : cleanupPath;
      const recoveryBytes = await readFile(recoveryPath);
      const recovery = openCodeCleanupTargets(JSON.parse(recoveryBytes));
      assert.deepEqual(recovery, [{ installationId, openCodePluginPath: installed.path }]);
      assert.doesNotMatch(
        recoveryBytes.toString("utf8"),
        /deviceToken|installationSecret|origin|provider|sourceId|usage|prompt|session|project/i,
      );
      if (process.platform !== "win32")
        assert.equal((await stat(recoveryPath)).mode & 0o777, 0o600);
      if (cleanupJournal === "corrupt") {
        assert.deepEqual(await readFile(cleanupPath), corruptBytes);
        const partialRecovery = await runWithInput(
          ["uninstall"],
          { ...environment, VIBERACING_TEST_INTERRUPT_AFTER_CONFIG_REMOVAL: "0" },
          "",
        );
        assert.equal(partialRecovery.code, 1);
        assert.deepEqual(await readFile(cleanupPath), corruptBytes);
        await assert.rejects(access(installed.path), { code: "ENOENT" });
        await assert.rejects(access(revocationPath), { code: "ENOENT" });
        await unlink(cleanupPath);
      } else await assert.rejects(access(revocationPath), { code: "ENOENT" });

      const recovered = await runWithInput(
        ["uninstall"],
        { ...environment, VIBERACING_TEST_INTERRUPT_AFTER_CONFIG_REMOVAL: "0" },
        "",
      );
      assert.equal(recovered.code, identity === "missing" ? 0 : 1, recovered.stderr);
      await assert.rejects(access(installed.path), { code: "ENOENT" });
      await assert.rejects(access(recoveryPath), { code: "ENOENT" });
    }
});

test("crash recovery records distinct current-XDG and installation OpenCode paths", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-disconnect-crash-distinct-paths-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const installationId = randomUUID();
  const recordedEnvironment = connectorEnvironment(home, {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, "recorded-config"),
  });
  const environment = connectorEnvironment(home, {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, "current-config"),
    NODE_ENV: "test",
    VIBERACING_TEST_INTERRUPT_AFTER_CONFIG_REMOVAL: "1",
  });
  const { directory } = await writeMappedOpenCodeInstallation(
    home,
    "http://127.0.0.1:1",
    installationId,
  );
  const recorded = await reconcileOpenCodePlugin({
    installationId,
    stateRoot: directory,
    environment: recordedEnvironment,
    homeDirectory: home,
    desired: true,
  });
  const current = await reconcileOpenCodePlugin({
    installationId,
    stateRoot: directory,
    environment,
    homeDirectory: home,
    desired: true,
  });
  await writeFile(
    join(directory, "installation.json"),
    `${JSON.stringify({
      version: 1,
      id: installationId,
      secret: "distinct_crash_recovery_secret_that_is_long_enough",
      openCodePluginPath: recorded.path,
    })}\n`,
    { mode: 0o600 },
  );

  const interrupted = await runWithInput(["disconnect"], environment, "");
  assert.equal(interrupted.code, 86, interrupted.stderr);
  const cleanupPath = join(directory, "opencode-plugin-cleanup.json");
  assert.deepEqual(
    openCodeCleanupTargets(JSON.parse(await readFile(cleanupPath, "utf8")))
      .map((target) => target.openCodePluginPath)
      .sort(),
    [recorded.path, current.path].sort(),
  );
  await access(recorded.path);
  await access(current.path);

  const recovered = await runWithInput(
    ["uninstall"],
    {
      ...environment,
      XDG_CONFIG_HOME: join(home, "later-config"),
      VIBERACING_TEST_INTERRUPT_AFTER_CONFIG_REMOVAL: "0",
    },
    "",
  );
  assert.equal(recovered.code, 0, recovered.stderr);
  await assert.rejects(access(recorded.path), { code: "ENOENT" });
  await assert.rejects(access(current.path), { code: "ENOENT" });
  await assert.rejects(access(cleanupPath), { code: "ENOENT" });
});

test("mapped OpenCode teardown records an unresolved target when current XDG is unsafe", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-disconnect-unsafe-xdg-recovery-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const installationId = randomUUID();
  const { directory } = await writeMappedOpenCodeInstallation(
    home,
    "http://127.0.0.1:1",
    installationId,
  );
  const result = await runWithInput(
    ["disconnect"],
    connectorEnvironment(home, {
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: "relative-config",
      NODE_ENV: "test",
      VIBERACING_TEST_INTERRUPT_AFTER_CONFIG_REMOVAL: "1",
    }),
    "",
    connectorPath,
    { cwd: home },
  );
  assert.equal(result.code, 86, result.stderr);
  assert.deepEqual(
    openCodeCleanupTargets(
      JSON.parse(await readFile(join(directory, "opencode-plugin-cleanup.json"), "utf8")),
    ),
    [{ installationId }],
  );
});

test("a foreign file at a crash-journaled OpenCode path remains pending and blocks connect", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-crash-journal-foreign-plugin-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const installationId = randomUUID();
  const environment = connectorEnvironment(home, {
    HOME: home,
    USERPROFILE: home,
    NODE_ENV: "test",
    VIBERACING_TEST_INTERRUPT_AFTER_CONFIG_REMOVAL: "1",
  });
  const { directory } = await writeMappedOpenCodeInstallation(
    home,
    "http://127.0.0.1:1",
    installationId,
  );
  const installed = await reconcileOpenCodePlugin({
    installationId,
    stateRoot: directory,
    environment,
    homeDirectory: home,
    desired: true,
  });
  const interrupted = await runWithInput(["disconnect"], environment, "");
  assert.equal(interrupted.code, 86, interrupted.stderr);
  const cleanupPath = join(directory, "opencode-plugin-cleanup.json");
  await access(cleanupPath);

  const foreign = "export const KeepForeignPlugin = async () => ({});\n";
  await writeFile(installed.path, foreign, { mode: 0o600 });
  await ensureOwnerOnlyWindowsFile(installed.path);
  const uninstall = await runWithInput(
    ["uninstall"],
    { ...environment, VIBERACING_TEST_INTERRUPT_AFTER_CONFIG_REMOVAL: "0" },
    "",
  );
  assert.equal(uninstall.code, 1);
  assert.equal(await readFile(installed.path, "utf8"), foreign);
  assert.deepEqual(openCodeCleanupTargets(JSON.parse(await readFile(cleanupPath, "utf8"))), [
    { installationId, openCodePluginPath: installed.path },
  ]);

  const connect = await runWithInput(
    ["connect", "--origin", "http://127.0.0.1:1"],
    { ...environment, VIBERACING_TEST_INTERRUPT_AFTER_CONFIG_REMOVAL: "0" },
    "",
  );
  assert.equal(connect.code, 1);
  assert.match(connect.stderr, /Pending OpenCode plugin cleanup is incomplete/);
  assert.equal(await readFile(installed.path, "utf8"), foreign);
  await assert.rejects(access(join(directory, "installation.json")), { code: "ENOENT" });
});

test("uninstall retries an exact OpenCode quarantine recovery path", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-uninstall-opencode-quarantine-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const environment = connectorEnvironment(home);
  const directory = await writeMappedInstallation(home, "http://127.0.0.1:1", []);
  const installationId = "70707070-7070-4070-8070-707070707070";
  const installed = await reconcileOpenCodePlugin({
    installationId,
    stateRoot: directory,
    environment,
    homeDirectory: home,
    desired: true,
  });
  const recoveryPath = `${installed.path}.quarantine-${randomUUID()}`;
  await rename(installed.path, recoveryPath);
  await writeFile(
    join(directory, "opencode-plugin-cleanup.json"),
    `${JSON.stringify({
      version: 1,
      installationId,
      openCodePluginPath: recoveryPath,
    })}\n`,
    { mode: 0o600 },
  );

  const result = await runWithInput(["uninstall"], environment, "");
  assert.equal(result.code, 0, result.stderr);
  await assert.rejects(access(recoveryPath), { code: "ENOENT" });
  await assert.rejects(access(directory), { code: "ENOENT" });
});

test(
  "uninstall retries an owned OpenCode plugin after directory permissions are repaired",
  { skip: process.platform === "win32" },
  async (context) => {
    const home = await mkdtemp(join(tmpdir(), "viberacing-uninstall-opencode-permissions-"));
    const directory = await writeMappedInstallation(home, "http://127.0.0.1:1", []);
    const installationId = "72727272-7272-4272-8272-727272727272";
    const environment = connectorEnvironment(home);
    const pluginOptions = {
      installationId,
      stateRoot: directory,
      environment,
      homeDirectory: home,
      desired: true,
    };
    const installed = await reconcileOpenCodePlugin(pluginOptions);
    const pluginDirectory = dirname(installed.path);
    context.after(async () => {
      await chmod(pluginDirectory, 0o700).catch(() => {});
      await rm(home, { recursive: true, force: true });
    });
    await mkdir(join(directory, "bin"), { recursive: true });
    await writeFile(join(directory, "bin", "viberacing.mjs"), "// cleanup runtime\n");
    await writeFile(
      join(directory, "installation.json"),
      `${JSON.stringify({
        version: 1,
        id: installationId,
        secret: "owned_plugin_cleanup_secret_that_is_long_enough",
        openCodePluginPath: installed.path,
      })}\n`,
      { mode: 0o600 },
    );
    await chmod(pluginDirectory, 0o500);

    const first = await runWithInput(["uninstall"], environment, "");
    assert.equal(first.code, 1);
    await access(installed.path);
    await access(join(directory, "opencode-plugin-cleanup.json"));
    await assert.rejects(access(join(directory, "installation.json")), { code: "ENOENT" });

    await chmod(pluginDirectory, 0o700);
    const second = await runWithInput(["uninstall"], environment, "");
    assert.equal(second.code, 0);
    await assert.rejects(access(installed.path), { code: "ENOENT" });
    await assert.rejects(access(directory), { code: "ENOENT" });
  },
);

test(
  "reset-installation retains a blocked owned OpenCode target until uninstall can finish it",
  { skip: process.platform === "win32" },
  async (context) => {
    const home = await mkdtemp(join(tmpdir(), "viberacing-reset-opencode-permissions-"));
    const environment = connectorEnvironment(home, { HOME: home, USERPROFILE: home });
    const directory = await writeMappedInstallation(home, "http://127.0.0.1:1", []);
    const installationId = "73737373-7373-4373-8373-737373737373";
    const pluginOptions = {
      installationId,
      stateRoot: directory,
      environment,
      homeDirectory: home,
      desired: true,
    };
    const installed = await reconcileOpenCodePlugin(pluginOptions);
    const pluginDirectory = dirname(installed.path);
    context.after(async () => {
      await chmod(pluginDirectory, 0o700).catch(() => {});
      await rm(home, { recursive: true, force: true });
    });
    await writeFile(
      join(directory, "installation.json"),
      `${JSON.stringify({
        version: 1,
        id: installationId,
        secret: "reset_cleanup_installation_secret_that_is_long_enough",
        openCodePluginPath: installed.path,
      })}\n`,
      { mode: 0o600 },
    );
    await chmod(pluginDirectory, 0o500);

    const reset = await runWithInput(["reset-installation"], environment, "");
    assert.equal(reset.code, 1);
    assert.match(reset.stdout, /Installation identity reset/);
    assert.match(reset.stderr, new RegExp(installed.path.replaceAll("\\", "\\\\")));
    await access(installed.path);
    await assert.rejects(access(join(directory, "installation.json")), { code: "ENOENT" });
    await assert.rejects(access(join(directory, "config.json")), { code: "ENOENT" });
    const retainedTargets = openCodeCleanupTargets(
      JSON.parse(await readFile(join(directory, "opencode-plugin-cleanup.json"))),
    );
    assert.equal(
      retainedTargets.some((target) => target.openCodePluginPath === installed.path),
      true,
    );
    assert.equal(
      retainedTargets.some((target) =>
        target.openCodePluginPath?.startsWith(`${installed.path}.quarantine-`),
      ),
      true,
    );

    await chmod(pluginDirectory, 0o700);
    const uninstall = await runWithInput(["uninstall"], environment, "");
    assert.equal(uninstall.code, 0, uninstall.stderr);
    await assert.rejects(access(installed.path), { code: "ENOENT" });
    await assert.rejects(access(directory), { code: "ENOENT" });
  },
);

test("reset-installation preserves an unreadable identity that may contain the only plugin path", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-reset-unreadable-identity-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const directory = await writeMappedInstallation(home, "http://127.0.0.1:1", []);
  await writeFile(join(directory, "installation.json"), "{not-json\n", { mode: 0o600 });

  const reset = await runWithInput(["reset-installation"], connectorEnvironment(home), "");
  assert.equal(reset.code, 1);
  assert.match(reset.stderr, /unreadable installation identity was retained/i);
  assert.doesNotMatch(reset.stdout, /Installation identity reset/i);
  await access(join(directory, "installation.json"));
  await assert.rejects(access(join(directory, "config.json")), { code: "ENOENT" });
});

test("connect cannot replace a missing identity while its active OpenCode target is pending", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-connect-missing-identity-pending-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const installationId = randomUUID();
  const environment = connectorEnvironment(home, {
    HOME: home,
    USERPROFILE: home,
  });
  const { directory } = await writeMappedOpenCodeInstallation(
    home,
    "http://127.0.0.1:1",
    installationId,
  );
  const installed = await reconcileOpenCodePlugin({
    installationId,
    stateRoot: directory,
    environment,
    homeDirectory: home,
    desired: true,
  });
  const cleanupPath = join(directory, "opencode-plugin-cleanup.json");
  await writeFile(
    cleanupPath,
    `${JSON.stringify({
      version: 1,
      installationId,
      openCodePluginPath: installed.path,
    })}\n`,
    { mode: 0o600 },
  );

  const connect = await runWithInput(
    ["connect", "--origin", "http://127.0.0.1:1"],
    environment,
    "",
  );
  assert.equal(connect.code, 1);
  assert.match(connect.stderr, /Pending OpenCode plugin cleanup is incomplete/);
  await assert.rejects(access(join(directory, "installation.json")), { code: "ENOENT" });
  await access(installed.path);
  assert.deepEqual(openCodeCleanupTargets(JSON.parse(await readFile(cleanupPath, "utf8"))), [
    { installationId, openCodePluginPath: installed.path },
  ]);
});

test("connect refuses an active config without its strictly matching installation identity", async (context) => {
  let reconciliationRequests = 0;
  let pairingStarts = 0;
  let reconciliationSourceId = null;
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/installations/current") {
      reconciliationRequests += 1;
      response.end(JSON.stringify(reconciliationResponse([{ sourceId: reconciliationSourceId }])));
      return;
    }
    if (request.url === "/api/pairing/start") pairingStarts += 1;
    response.statusCode = 500;
    response.end(JSON.stringify({ error: "unexpected_request" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  const origin = `http://127.0.0.1:${address.port}`;

  for (const identity of ["missing", "mismatched"]) {
    const home = await mkdtemp(join(tmpdir(), `viberacing-connect-${identity}-identity-active-`));
    context.after(() => rm(home, { recursive: true, force: true }));
    const installationId = randomUUID();
    const environment = connectorEnvironment(home, { HOME: home, USERPROFILE: home });
    const { directory, source } = await writeMappedOpenCodeInstallation(
      home,
      origin,
      installationId,
    );
    reconciliationSourceId = source.sourceId;
    const installed = await reconcileOpenCodePlugin({
      installationId,
      stateRoot: directory,
      environment,
      homeDirectory: home,
      desired: true,
    });
    const configBefore = await readFile(join(directory, "config.json"));
    const pluginBefore = await readFile(installed.path);
    if (identity === "mismatched")
      await writeFile(
        join(directory, "installation.json"),
        `${JSON.stringify({
          version: 1,
          id: randomUUID(),
          secret: "mismatched_installation_secret_that_is_long_enough",
        })}\n`,
        { mode: 0o600 },
      );

    const result = await runWithInput(["connect", "--origin", origin], environment, "");
    assert.equal(result.code, 1, `${identity}: ${result.stderr}`);
    assert.match(result.stderr, /no strictly matching local installation identity/i);
    assert.match(result.stderr, /disconnect.*uninstall/i);
    assert.deepEqual(await readFile(join(directory, "config.json")), configBefore);
    assert.deepEqual(await readFile(installed.path), pluginBefore);
    await assert.rejects(access(join(directory, "opencode-plugin-cleanup.json")), {
      code: "ENOENT",
    });
    await assert.rejects(access(join(directory, "opencode-plugin-revocation.json")), {
      code: "ENOENT",
    });
    if (identity === "missing")
      await assert.rejects(access(join(directory, "installation.json")), { code: "ENOENT" });
    else {
      const retainedIdentity = JSON.parse(
        await readFile(join(directory, "installation.json"), "utf8"),
      );
      assert.notEqual(retainedIdentity.id, installationId);
    }
  }
  assert.equal(reconciliationRequests, 2);
  assert.equal(pairingStarts, 0);
});

test("pending OpenCode cleanup blocks connect until it succeeds", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-connect-opencode-cleanup-gate-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const environment = connectorEnvironment(home, { HOME: home, USERPROFILE: home });
  const dataRoot = join(home, ".local", "share", "opencode");
  const databasePath = join(dataRoot, "opencode.db");
  await mkdir(dataRoot, { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("CREATE TABLE message (id TEXT, time_created INTEGER, data TEXT)");
  database.close();
  const installationId = "74747474-7474-4474-8474-747474747474";
  const source = {
    clientSourceId: "75757575-7575-4575-8575-757575757575",
    sourceId: "76767676-7676-4676-8676-767676767676",
    agentId: "opencode",
    dataPath: databasePath,
    collectionMethod: "opencode_sqlite",
    supportedSurface: "cli",
    suggestedLabel: "OpenCode",
    accountLabel: "OpenCode",
  };
  const directory = await writeMappedInstallation(home, "http://127.0.0.1:1", [source]);
  const pluginPath = openCodePluginLocation({
    installationId,
    environment,
    homeDirectory: home,
  }).path;
  const foreignPlugin = "export const KeepForeignPlugin = async () => ({});\n";
  await mkdir(dirname(pluginPath), { recursive: true });
  await writeFile(pluginPath, foreignPlugin, { mode: 0o600 });
  await ensureOwnerOnlyWindowsFile(pluginPath);
  await writeFile(
    join(directory, "installation.json"),
    `${JSON.stringify({
      version: 1,
      id: installationId,
      secret: "connect_gate_installation_secret_that_is_long_enough",
      openCodePluginPath: pluginPath,
    })}\n`,
    { mode: 0o600 },
  );

  const failedUninstall = await runWithInput(["uninstall"], environment, "");
  assert.equal(failedUninstall.code, 1);
  await assert.rejects(access(join(directory, "installation.json")), { code: "ENOENT" });
  await access(join(directory, "opencode-plugin-cleanup.json"));

  const blockedConnect = await runWithInput(
    ["connect", "--origin", "http://127.0.0.1:1"],
    environment,
    "",
  );
  assert.equal(blockedConnect.code, 1);
  assert.match(blockedConnect.stderr, /Pending OpenCode plugin cleanup is incomplete/);
  assert.match(blockedConnect.stderr, new RegExp(pluginPath.replaceAll("\\", "\\\\")));
  assert.match(blockedConnect.stderr, /permissions.*foreign plugin conflict.*uninstall.*connect/i);
  await assert.rejects(access(join(directory, "installation.json")), { code: "ENOENT" });
  assert.equal(await readFile(pluginPath, "utf8"), foreignPlugin);

  await unlink(pluginPath);
  const resumedConnect = await runWithInput(
    ["connect", "--origin", "http://127.0.0.1:1"],
    environment,
    "",
  );
  assert.equal(resumedConnect.code, 1);
  assert.doesNotMatch(resumedConnect.stderr, /Pending OpenCode plugin cleanup is incomplete/);
  const replacement = JSON.parse(await readFile(join(directory, "installation.json"), "utf8"));
  assert.notEqual(replacement.id, installationId);
  assert.match(replacement.secret, /^[A-Za-z0-9_-]{43}$/);
  await assert.rejects(access(join(directory, "opencode-plugin-cleanup.json")), {
    code: "ENOENT",
  });
});

test("uninstall cleans distinct current and pending owned OpenCode targets", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-uninstall-opencode-distinct-owned-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const environment = connectorEnvironment(home, {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, "current-config"),
  });
  const pendingEnvironment = {
    ...environment,
    XDG_CONFIG_HOME: join(home, "pending-config"),
  };
  const directory = await writeMappedInstallation(home, "http://127.0.0.1:1", []);
  const currentId = "77777777-7777-4777-8777-777777777777";
  const pendingId = "78787878-7878-4878-8878-787878787878";
  const current = await reconcileOpenCodePlugin({
    installationId: currentId,
    stateRoot: directory,
    environment,
    homeDirectory: home,
    desired: true,
  });
  const pending = await reconcileOpenCodePlugin({
    installationId: pendingId,
    stateRoot: directory,
    environment: pendingEnvironment,
    homeDirectory: home,
    desired: true,
  });
  await writeFile(
    join(directory, "installation.json"),
    `${JSON.stringify({
      version: 1,
      id: currentId,
      secret: "distinct_current_installation_secret_that_is_long_enough",
      openCodePluginPath: current.path,
    })}\n`,
    { mode: 0o600 },
  );
  await writeFile(
    join(directory, "opencode-plugin-cleanup.json"),
    `${JSON.stringify({
      version: 1,
      installationId: pendingId,
      openCodePluginPath: pending.path,
    })}\n`,
    { mode: 0o600 },
  );

  const result = await runWithInput(["uninstall"], environment, "");
  assert.equal(result.code, 0, result.stderr);
  await assert.rejects(access(current.path), { code: "ENOENT" });
  await assert.rejects(access(pending.path), { code: "ENOENT" });
  await assert.rejects(access(directory), { code: "ENOENT" });
});

test("uninstall recovers a missing identity but blocks on an unreadable identity", async (context) => {
  for (const variant of ["missing", "corrupt"]) {
    const home = await mkdtemp(
      join(tmpdir(), `viberacing-uninstall-opencode-${variant}-identity-`),
    );
    context.after(() => rm(home, { recursive: true, force: true }));
    const environment = connectorEnvironment(home, {
      HOME: home,
      USERPROFILE: home,
    });
    const installationId =
      variant === "missing"
        ? "82828282-8282-4282-8282-828282828282"
        : "83838383-8383-4383-8383-838383838383";
    const { directory } = await writeMappedOpenCodeInstallation(
      home,
      "http://127.0.0.1:1",
      installationId,
    );
    const installed = await reconcileOpenCodePlugin({
      installationId,
      stateRoot: directory,
      environment,
      homeDirectory: home,
      desired: true,
    });
    if (variant === "corrupt")
      await writeFile(join(directory, "installation.json"), "{not-json\n", { mode: 0o600 });

    const result = await runWithInput(["uninstall"], environment, "");
    await assert.rejects(access(installed.path), { code: "ENOENT" });
    if (variant === "missing") {
      assert.equal(result.code, 0, `${variant}: ${result.stderr}`);
      assert.match(result.stdout, /hooks, installed copy, secrets, and local state removed/i);
      await assert.rejects(access(directory), { code: "ENOENT" });
    } else {
      assert.equal(result.code, 1, `${variant}: ${result.stderr}`);
      assert.match(result.stderr, /OpenCode cleanup detail.*JSON/i);
      assert.match(result.stdout, /installation identity was unreadable.*retained for recovery/i);
      await access(join(directory, "installation.json"));
      assert.deepEqual(
        openCodeCleanupTargets(
          JSON.parse(await readFile(join(directory, "opencode-plugin-cleanup.json"), "utf8")),
        ),
        [{ installationId }],
      );
    }
  }
});

test("uninstall cleans the current plugin but retains an unresolved retry when config is unreadable", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-uninstall-corrupt-config-opencode-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const environment = connectorEnvironment(home, { HOME: home, USERPROFILE: home });
  const installationId = "89898989-8989-4989-8989-898989898989";
  const { directory } = await writeMappedOpenCodeInstallation(
    home,
    "http://127.0.0.1:1",
    installationId,
  );
  const installed = await reconcileOpenCodePlugin({
    installationId,
    stateRoot: directory,
    environment,
    homeDirectory: home,
    desired: true,
  });
  await writeFile(
    join(directory, "installation.json"),
    `${JSON.stringify({
      version: 1,
      id: installationId,
      secret: "corrupt_config_installation_secret_that_is_long_enough",
    })}\n`,
    { mode: 0o600 },
  );
  await writeFile(join(directory, "config.json"), "{not-json\n", { mode: 0o600 });

  const result = await runWithInput(["uninstall"], environment, "");
  assert.equal(result.code, 1);
  assert.match(result.stderr, /OpenCode cleanup detail.*JSON/i);
  await assert.rejects(access(installed.path), { code: "ENOENT" });
  assert.deepEqual(
    openCodeCleanupTargets(
      JSON.parse(await readFile(join(directory, "opencode-plugin-cleanup.json"), "utf8")),
    ),
    [{ installationId }],
  );
});

test("uninstall preserves unreadable installation evidence when no plugin identity is recoverable", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-uninstall-unrecoverable-identity-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const directory = join(home, ".viberacing");
  await mkdir(join(directory, "runtime", connectorVersion, "bin"), { recursive: true });
  await writeFile(join(directory, ".viberacing-state"), '{"format":1}\n');
  await writeFile(join(directory, "installation.json"), "{not-json\n", { mode: 0o600 });
  await writeFile(
    join(directory, "runtime", connectorVersion, "bin", "viberacing.mjs"),
    "// retained runtime\n",
  );

  const result = await runWithInput(["uninstall"], connectorEnvironment(home), "");
  assert.equal(result.code, 1);
  assert.match(result.stdout, /installation identity was unreadable.*retained for recovery/i);
  assert.match(result.stderr, /installation secrets could not be safely separated/i);
  await access(join(directory, "installation.json"));
  await access(join(directory, "runtime", connectorVersion, "bin", "viberacing.mjs"));
});

test("uninstall preserves distinct foreign OpenCode targets and all cleanup metadata", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-uninstall-opencode-distinct-foreign-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const environment = connectorEnvironment(home, {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, "current-config"),
  });
  const pendingEnvironment = {
    ...environment,
    XDG_CONFIG_HOME: join(home, "pending-config"),
  };
  const directory = await writeMappedInstallation(home, "http://127.0.0.1:1", []);
  const currentId = "79797979-7979-4979-8979-797979797979";
  const pendingId = "80808080-8080-4080-8080-808080808080";
  const currentPath = openCodePluginLocation({
    installationId: currentId,
    environment,
    homeDirectory: home,
  }).path;
  const pendingPath = openCodePluginLocation({
    installationId: pendingId,
    environment: pendingEnvironment,
    homeDirectory: home,
  }).path;
  const currentForeign = "export const CurrentForeign = true;\n";
  const pendingForeign = "export const PendingForeign = true;\n";
  for (const [path, contents] of [
    [currentPath, currentForeign],
    [pendingPath, pendingForeign],
  ]) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, { mode: 0o600 });
    await ensureOwnerOnlyWindowsFile(path);
  }
  await writeFile(
    join(directory, "installation.json"),
    `${JSON.stringify({
      version: 1,
      id: currentId,
      secret: "distinct_foreign_installation_secret_that_is_long_enough",
      openCodePluginPath: currentPath,
    })}\n`,
    { mode: 0o600 },
  );
  await writeFile(
    join(directory, "opencode-plugin-cleanup.json"),
    `${JSON.stringify({
      version: 1,
      installationId: pendingId,
      openCodePluginPath: pendingPath,
    })}\n`,
    { mode: 0o600 },
  );

  const first = await runWithInput(["uninstall"], environment, "");
  assert.equal(first.code, 1);
  assert.equal(await readFile(currentPath, "utf8"), currentForeign);
  assert.equal(await readFile(pendingPath, "utf8"), pendingForeign);
  await assert.rejects(access(join(directory, "installation.json")), { code: "ENOENT" });
  await assert.rejects(access(join(directory, "config.json")), { code: "ENOENT" });
  const cleanup = JSON.parse(
    await readFile(join(directory, "opencode-plugin-cleanup.json"), "utf8"),
  );
  assert.equal(cleanup.version, 2);
  assert.deepEqual(
    openCodeCleanupTargets(cleanup)
      .map((target) => [target.installationId, target.openCodePluginPath])
      .sort(),
    [
      [currentId, currentPath],
      [pendingId, pendingPath],
    ].sort(),
  );

  await unlink(currentPath);
  await unlink(pendingPath);
  const second = await runWithInput(["uninstall"], environment, "");
  assert.equal(second.code, 0, second.stderr);
  await assert.rejects(access(directory), { code: "ENOENT" });
});

test("non-OpenCode installations do not create unresolved cleanup at a relative XDG root", async (context) => {
  for (const command of ["uninstall", "reset-installation"]) {
    const home = await mkdtemp(join(tmpdir(), `viberacing-${command}-relative-xdg-no-opencode-`));
    context.after(() => rm(home, { recursive: true, force: true }));
    const installationId = randomUUID();
    const capturePath = join(home, ".viberacing", "captures", `${randomUUID()}.jsonl`);
    const source = {
      clientSourceId: randomUUID(),
      sourceId: randomUUID(),
      agentId: "antigravity",
      dataPath: capturePath,
      collectionMethod: "antigravity_cli_capture",
      supportedSurface: "cli",
      suggestedLabel: "Antigravity",
      accountLabel: "Antigravity",
    };
    const directory = await writeMappedInstallation(home, "http://127.0.0.1:1", [source]);
    const configPath = join(directory, "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    await writeFile(configPath, `${JSON.stringify({ ...config, installationId })}\n`, {
      mode: 0o600,
    });
    await writeFile(
      join(directory, "installation.json"),
      `${JSON.stringify({
        version: 1,
        id: installationId,
        secret: "relative_xdg_non_opencode_secret_that_is_long_enough",
      })}\n`,
      { mode: 0o600 },
    );
    const environment = connectorEnvironment(home, {
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: "relative-config",
    });

    const doctor = await runWithInput(["doctor"], environment, "", connectorPath, { cwd: home });
    assert.equal(doctor.code, 0, `${command}: ${doctor.stderr}`);
    assert.match(doctor.stdout, /OpenCode automatic sync plugin: not-needed/);
    assert.doesNotMatch(doctor.stdout + doctor.stderr, /XDG_CONFIG_HOME|OpenCode.*unreadable/);

    const result = await runWithInput([command], environment, "", connectorPath, { cwd: home });
    assert.equal(result.code, 0, `${command}: ${result.stderr}`);
    await assert.rejects(access(join(directory, "opencode-plugin-cleanup.json")), {
      code: "ENOENT",
    });
    await assert.rejects(access(join(directory, "opencode-plugin-revocation.json")), {
      code: "ENOENT",
    });

    const reconnect = await runWithInput(
      ["connect", "--origin", "http://127.0.0.1:1"],
      environment,
      "",
      connectorPath,
      { cwd: home },
    );
    assert.doesNotMatch(reconnect.stderr, /Pending OpenCode plugin cleanup is incomplete/);
    await assert.rejects(access(join(directory, "opencode-plugin-cleanup.json")), {
      code: "ENOENT",
    });
    await assert.rejects(access(join(directory, "opencode-plugin-revocation.json")), {
      code: "ENOENT",
    });
  }
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
      hookConfigRoot: brokenRoot,
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
    `${JSON.stringify({
      version: 1,
      id: "90909090-9090-4090-8090-909090909090",
      secret: "synthetic_installation_secret_that_is_long_enough",
    })}\n`,
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
  "wrapper passes exact argv and preserves native output and safe metadata",
  { skip: process.platform === "win32" },
  async (context) => {
    const home = await mkdtemp(join(tmpdir(), "viberacing-wrapper-executable-"));
    context.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true })));
    const bin = join(home, "bin");
    await mkdir(bin, { recursive: true });
    const antigravityArgv = join(home, "antigravity-argv.json");
    const antigravityExecutable = join(bin, "agy");
    await writeFile(
      antigravityExecutable,
      `#!/usr/bin/env node\nimport { writeFileSync } from "node:fs";\nwriteFileSync(process.env.SYNTHETIC_ARGV_PATH, JSON.stringify(process.argv.slice(2)));\nprocess.stdout.write(JSON.stringify({type:"result",session_id:"safe-session",timestamp:new Date().toISOString(),prompt:"synthetic private prompt",response:"synthetic private response",usage:{input_tokens:1,output_tokens:2,cache_read_tokens:0,cache_write_tokens:0}})+"\\n");\n`,
    );
    await chmod(antigravityExecutable, 0o700);
    const environment = connectorEnvironment(home, {
      PATH: `${bin}${delimiter}${process.env.PATH}`,
    });

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
  "Antigravity wrapper waits for a busy launch gate before persisting capture and dirty state",
  { skip: process.platform === "win32" },
  async (context) => {
    const home = await mkdtemp(join(tmpdir(), "viberacing-wrapper-busy-launch-"));
    context.after(() => rm(home, { recursive: true, force: true }));
    const installation = await writeCaptureInstallation(home, "http://127.0.0.1:9", {
      eventId: "initial-capture",
    });
    const bin = join(home, "bin");
    await mkdir(bin, { recursive: true });
    const executable = join(bin, "agy");
    await writeFile(
      executable,
      `#!/usr/bin/env node
process.stdout.write(JSON.stringify({type:"result",session_id:"gate-wait-record",timestamp:new Date().toISOString(),usage:{input_tokens:4,output_tokens:5}})+"\\n");
`,
    );
    await chmod(executable, 0o700);

    const holderBarrier = join(home, "launch-holder");
    const wrapperReady = join(home, "wrapper-capture-ready");
    const schedulerTrace = join(home, "scheduler-trace.log");
    const environment = connectorEnvironment(home, {
      NODE_ENV: "test",
      PATH: `${bin}${delimiter}${process.env.PATH}`,
      VIBERACING_TEST_WRAPPER_CAPTURE_READY: wrapperReady,
      VIBERACING_TEST_SCHEDULER_TRACE: schedulerTrace,
      VIBERACING_TEST_AUTOMATIC_SYNC_TIMINGS: "5000,5000,5000",
    });
    const runtimeUrl = pathToFileURL(
      fileURLToPath(new URL("../lib/runtime.mjs", import.meta.url)),
    ).href;
    const holderScript = `
      import { readFile, writeFile } from "node:fs/promises";
      import { setTimeout as delay } from "node:timers/promises";
      import { claimSchedulerLaunch, releaseSchedulerLaunch } from ${JSON.stringify(runtimeUrl)};
      const gate = await claimSchedulerLaunch({ waitMs: 0 });
      if (!gate) throw new Error("launch gate unavailable");
      await writeFile(${JSON.stringify(`${holderBarrier}.ready`)}, "ready\\n");
      for (;;) {
        try {
          await readFile(${JSON.stringify(`${holderBarrier}.continue`)});
          break;
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
        await delay(10);
      }
      await releaseSchedulerLaunch(gate);
    `;
    const holder = spawn(process.execPath, ["--input-type=module", "--eval", holderScript], {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    context.after(() => holder.kill("SIGKILL"));
    await waitFor(() =>
      access(`${holderBarrier}.ready`)
        .then(() => true)
        .catch(() => false),
    );

    const wrapper = spawn(process.execPath, [connectorPath, "run", "antigravity", "--", "review"], {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    context.after(() => wrapper.kill("SIGKILL"));
    let wrapperStdout = "";
    let wrapperStderr = "";
    wrapper.stdout.setEncoding("utf8").on("data", (chunk) => (wrapperStdout += chunk));
    wrapper.stderr.setEncoding("utf8").on("data", (chunk) => (wrapperStderr += chunk));
    await waitFor(() =>
      access(wrapperReady)
        .then(() => true)
        .catch(() => false),
    );
    assert.doesNotMatch(await readFile(installation.capture, "utf8"), /gate-wait-record/);

    await writeFile(`${holderBarrier}.continue`, "continue\n");
    const [holderCode] = await once(holder, "close");
    assert.equal(holderCode, 0);
    const [wrapperCode] = await once(wrapper, "close");
    assert.equal(wrapperCode, 0);
    assert.equal(wrapperStderr, "");
    assert.match(wrapperStdout, /gate-wait-record/);
    assert.match(await readFile(installation.capture, "utf8"), /gate-wait-record/);
    const dirty = JSON.parse(await readFile(join(installation.directory, "dirty.json"), "utf8"));
    assert.equal(typeof dirty.sources[installation.clientSourceId]?.generation, "string");
    await waitFor(async () =>
      (await readFile(schedulerTrace, "utf8").catch(() => "")).includes("acquired:"),
    );

    await execFileAsync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import { clearAutomaticState } from ${JSON.stringify(runtimeUrl)}; await clearAutomaticState();`,
      ],
      { env: environment },
    );
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
    const executable = join(bin, "agy");
    await writeFile(
      executable,
      '#!/usr/bin/env node\nprocess.stdout.write("ready\\n");\nsetInterval(() => {}, 1000);\n',
    );
    await chmod(executable, 0o700);
    const child = spawn(process.execPath, [connectorPath, "run", "antigravity", "--", "hello"], {
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
  "a wrapper finishing after uninstall cannot recreate local state",
  { skip: process.platform === "win32" },
  async (context) => {
    const home = await mkdtemp(join(tmpdir(), "viberacing-stale-wrapper-"));
    context.after(() => rm(home, { recursive: true, force: true }));
    const bin = join(home, "bin");
    const barrier = join(home, "wrapper-finish");
    await mkdir(bin, { recursive: true });
    const executable = join(bin, "agy");
    await writeFile(
      executable,
      `#!/usr/bin/env node
import { existsSync, writeFileSync } from "node:fs";
writeFileSync(process.env.SYNTHETIC_WRAPPER_BARRIER + ".ready", "ready\\n");
while (!existsSync(process.env.SYNTHETIC_WRAPPER_BARRIER + ".continue")) await new Promise((resolve) => setTimeout(resolve, 10));
process.stdout.write(JSON.stringify({type:"result",session_id:"stale-wrapper",timestamp:new Date().toISOString(),usage:{input_tokens:1,output_tokens:2}})+"\\n");
`,
    );
    await chmod(executable, 0o700);
    const environment = connectorEnvironment(home, {
      PATH: `${bin}${delimiter}${process.env.PATH}`,
      SYNTHETIC_WRAPPER_BARRIER: barrier,
    });
    await execFileAsync(
      process.execPath,
      [connectorPath, "source", "add", "--agent", "antigravity", "--name", "Local"],
      { env: environment },
    );
    const wrapper = spawn(process.execPath, [connectorPath, "run", "antigravity", "--", "review"], {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitFor(() =>
      access(`${barrier}.ready`)
        .then(() => true)
        .catch(() => false),
    );
    await execFileAsync(process.execPath, [connectorPath, "uninstall"], { env: environment });
    await assert.rejects(access(join(home, ".viberacing")), { code: "ENOENT" });
    await writeFile(`${barrier}.continue`, "continue\n");
    const [code] = await once(wrapper, "close");
    assert.equal(code, 0);
    await delay(100);
    await assert.rejects(access(join(home, ".viberacing")), { code: "ENOENT" });
  },
);

test(
  "Antigravity wrapper selects source-specific profiles",
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
    await chmod(join(bin, "agy"), 0o700);
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
  },
);

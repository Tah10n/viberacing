import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { detectOpenCodeSources, openCodeDataRoot } from "../lib/adapters/opencode.mjs";
import { detectQwenSources, qwenRuntimeRoot, resolveQwenPath } from "../lib/adapters/qwen.mjs";
import { canonicalPathKey } from "../lib/adapters/shared.mjs";
import { claudeSourcePath, detectClaudeSources } from "../lib/adapters/claude.mjs";
import { detectGeminiSources, geminiSourcePath } from "../lib/adapters/gemini.mjs";
import { detectKimiSources, kimiSourcePaths } from "../lib/adapters/kimi.mjs";

function createOpenCodeDatabase(path, columns = "id TEXT, time_created INTEGER, data TEXT") {
  const database = new DatabaseSync(path);
  try {
    database.exec(`CREATE TABLE message (${columns})`);
  } finally {
    database.close();
  }
}

test("enumerates every compatible official OpenCode channel database", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-opencode-discovery-"));
  context.after(() => rm(home, { force: true, recursive: true }));
  const dataRoot = openCodeDataRoot({}, home);
  await mkdir(dataRoot, { recursive: true });
  for (const name of [
    "opencode.db",
    "opencode-prod.db",
    "opencode-dev.db",
    "opencode-custom-channel.db",
  ])
    createOpenCodeDatabase(join(dataRoot, name));
  createOpenCodeDatabase(join(dataRoot, "unrelated.db"));
  createOpenCodeDatabase(join(dataRoot, "opencode-invalid.db"), "id TEXT, data TEXT");
  await writeFile(join(dataRoot, "opencode-broken.db"), "not sqlite");
  await writeFile(join(dataRoot, "opencode.db-wal"), "ignored");
  await writeFile(join(dataRoot, "opencode.db-shm"), "ignored");
  await writeFile(join(dataRoot, "opencode-dev.db.backup"), "ignored");
  const diagnostics = [];
  const sources = await detectOpenCodeSources({ environment: {}, home, diagnostics });

  assert.deepEqual(
    sources.map((source) => basename(source.dataPath)),
    ["opencode.db", "opencode-prod.db", "opencode-custom-channel.db", "opencode-dev.db"],
  );
  assert.deepEqual(
    sources.map((source) => source.suggestedLabel),
    ["OpenCode", "OpenCode prod", "OpenCode custom-channel", "OpenCode dev"],
  );
  assert.equal(diagnostics.length, 2);
  assert.ok(
    diagnostics.every((diagnostic) => /incompatible OpenCode SQLite schema/.test(diagnostic.error)),
  );
  assert.ok(diagnostics.every((diagnostic) => !diagnostic.error.includes(home)));
});

test("prioritizes OPENCODE_DB and deduplicates relative, direct, and symlink paths", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-opencode-configured-"));
  context.after(() => rm(home, { force: true, recursive: true }));
  const dataRoot = openCodeDataRoot({}, home);
  await mkdir(dataRoot, { recursive: true });
  const database = join(dataRoot, "opencode.db");
  createOpenCodeDatabase(database);

  const relative = await detectOpenCodeSources({
    environment: { OPENCODE_DB: "opencode.db" },
    home,
  });
  assert.equal(relative.length, 1);
  assert.equal(relative[0].dataPath, database);

  const aliasRoot = join(home, "opencode-data-alias");
  await symlink(dataRoot, aliasRoot, process.platform === "win32" ? "junction" : "dir");
  const alias = await detectOpenCodeSources({
    environment: { OPENCODE_DB: join(aliasRoot, "opencode.db") },
    home,
  });
  assert.equal(alias.length, 1);
  assert.equal(alias[0].dataPath, join(aliasRoot, "opencode.db"));

  const configured = join(home, "portable", "custom.sqlite");
  await mkdir(join(home, "portable"));
  createOpenCodeDatabase(configured);
  const absolute = await detectOpenCodeSources({
    environment: { OPENCODE_DB: configured },
    home,
  });
  assert.equal(absolute[0].dataPath, configured);
  assert.equal(absolute[0].suggestedLabel, "OpenCode configured");
  assert.equal(absolute.length, 2);
});

test("resolves Qwen runtime roots by environment, user settings, and fallback priority", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-qwen-discovery-"));
  context.after(() => rm(home, { force: true, recursive: true }));
  const qwenHome = join(home, ".qwen");
  const configured = join(home, "configured-runtime");
  const environmentRuntime = join(home, "environment-runtime");
  await mkdir(qwenHome, { recursive: true });
  await writeFile(
    join(qwenHome, "settings.json"),
    JSON.stringify({ advanced: { runtimeOutputDir: configured } }),
  );

  assert.equal(await qwenRuntimeRoot({ environment: {}, home }), configured);
  assert.equal(
    await qwenRuntimeRoot({ environment: { QWEN_RUNTIME_DIR: environmentRuntime }, home }),
    environmentRuntime,
  );
  assert.equal(
    await qwenRuntimeRoot({ environment: { QWEN_HOME: join(home, "work-qwen") }, home }),
    join(home, "work-qwen"),
  );
  await writeFile(
    join(qwenHome, "settings.json"),
    JSON.stringify({ advanced: { runtimeOutputDir: "~/runtime-output" } }),
  );
  assert.equal(await qwenRuntimeRoot({ environment: {}, home }), join(home, "runtime-output"));
});

test("never resolves relative Qwen runtimeOutputDir against connector CWD", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-qwen-relative-"));
  context.after(() => rm(home, { force: true, recursive: true }));
  await mkdir(join(home, ".qwen"), { recursive: true });
  await writeFile(
    join(home, ".qwen", "settings.json"),
    JSON.stringify({ advanced: { runtimeOutputDir: "project-runtime" } }),
  );
  const diagnostics = [];
  assert.equal(await qwenRuntimeRoot({ environment: {}, home, diagnostics }), null);
  assert.match(diagnostics[0].error, /viberacing source add --agent qwen_code/);
  assert.doesNotMatch(diagnostics[0].error, new RegExp(process.cwd().replaceAll("\\", "\\\\")));
  assert.deepEqual(await detectQwenSources({ environment: {}, home, diagnostics: [] }), []);
});

test("detects Qwen usage only at the selected runtime root", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-qwen-selected-"));
  context.after(() => rm(home, { force: true, recursive: true }));
  const selected = join(home, "selected");
  await mkdir(join(selected, "usage"), { recursive: true });
  await mkdir(join(home, ".qwen", "usage"), { recursive: true });
  const sources = await detectQwenSources({
    environment: { QWEN_RUNTIME_DIR: selected },
    home,
  });
  assert.deepEqual(
    sources.map((source) => source.dataPath),
    [join(selected, "usage")],
  );
});

test("canonical path keys use real paths and common case-insensitive platform semantics", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-canonical-path-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const target = join(root, "TokenStore");
  const alias = join(root, "alias");
  await mkdir(target);
  await symlink(target, alias, process.platform === "win32" ? "junction" : "dir");
  assert.equal(await canonicalPathKey(target), await canonicalPathKey(alias));
  assert.equal(
    await canonicalPathKey("C:\\Users\\Racer\\Usage", {
      platform: "win32",
      resolvePath: (value) => value,
      realpathPath: async () => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      },
    }),
    "c:\\users\\racer\\usage",
  );
  assert.equal(
    await canonicalPathKey("/Users/Racer/Usage", {
      platform: "darwin",
      resolvePath: (value) => value,
      realpathPath: async (value) => value,
    }),
    "/users/racer/usage",
  );
  assert.equal(
    resolveQwenPath("~\\runtime", { home: "C:\\Users\\Racer", platform: "win32" }),
    "C:\\Users\\Racer\\runtime",
  );
});

test("Claude, Kimi, and Gemini auto-discovery requires actual session records", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-record-discovery-"));
  context.after(() => rm(home, { force: true, recursive: true }));
  const claude = claudeSourcePath({}, home);
  const kimi = kimiSourcePaths({}, home);
  const gemini = geminiSourcePath({}, home);
  await mkdir(join(claude, "project"), { recursive: true });
  await mkdir(join(kimi.current, "project", "session", "agents", "main"), {
    recursive: true,
  });
  await mkdir(join(gemini, "project", "chats"), { recursive: true });
  assert.deepEqual(await detectClaudeSources({ environment: {}, home }), []);
  assert.deepEqual(await detectKimiSources({ environment: {}, home }), []);
  assert.deepEqual(await detectGeminiSources({ environment: {}, home }), []);

  await writeFile(join(claude, "project", "session.jsonl"), "\n");
  await writeFile(join(kimi.current, "project", "session", "agents", "main", "wire.jsonl"), "\n");
  await writeFile(join(gemini, "project", "chats", "session-1.jsonl"), "\n");
  assert.equal((await detectClaudeSources({ environment: {}, home })).length, 1);
  assert.equal((await detectKimiSources({ environment: {}, home })).length, 1);
  assert.equal((await detectGeminiSources({ environment: {}, home })).length, 1);
});

test("Kimi current records suppress only the default legacy root", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-kimi-priority-"));
  context.after(() => rm(home, { force: true, recursive: true }));
  const paths = kimiSourcePaths({}, home);
  const current = join(paths.current, "project", "session", "agents", "main");
  const legacy = join(paths.legacy, "project", "session", "agents", "main");
  await mkdir(current, { recursive: true });
  await mkdir(legacy, { recursive: true });
  await writeFile(join(current, "wire.jsonl"), "\n");
  await writeFile(join(legacy, "wire.jsonl"), "\n");
  const detected = await detectKimiSources({ environment: {}, home });
  assert.equal(detected.length, 1);
  assert.equal(detected[0].dataPath, paths.current);
  assert.deepEqual(detected[0].supersedesDataPaths, [paths.legacy]);

  const explicitLegacy = await detectKimiSources({
    environment: { KIMI_SHARE_DIR: join(home, "explicit-legacy") },
    home,
  });
  assert.deepEqual(explicitLegacy[0].supersedesDataPaths, []);
});

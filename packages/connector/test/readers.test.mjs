import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zstdCompressSync } from "node:zlib";
import {
  collectClaude,
  collectCodexSessionUsage,
  parseClaudeLines,
  parseAntigravityLines,
  parseCodexUsage,
  codexProfileEnvironment,
  mergeCodexUsageComponents,
  parseCodexSessionLines,
  parseGeminiRecords,
  parseKimiLines,
  parseKimiLegacyLines,
  kimiSourcePaths,
  parseOpenCodeMessages,
  parseQwenLines,
  adapters,
  adapterFor,
  recentEntries,
  safeCaptureRecord,
  wrapperInvocation,
} from "../lib/readers.mjs";

async function fixture(name) {
  return readFile(fileURLToPath(new URL(`fixtures/${name}`, import.meta.url)), "utf8");
}

function codexTokenCount(timestamp, usage, lastUsage = usage, ordinal = 1) {
  return JSON.stringify({
    ordinal,
    timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: { total_token_usage: usage, last_token_usage: lastUsage },
    },
  });
}

test("projects authoritative Codex UTC buckets", async () => {
  assert.deepEqual(parseCodexUsage(JSON.parse(await fixture("codex.json"))), [
    { date: "2026-08-10", totalTokens: "9007199254740993" },
  ]);
});

test("treats Codex JSON-RPC and unsupported account usage responses as failures", () => {
  assert.throws(
    () => parseCodexUsage({ error: { message: "account usage unavailable" } }),
    /usage request failed/,
  );
  assert.throws(() => parseCodexUsage({ result: {} }), /daily usage buckets/);
});

test("isolates each Codex App Server with its source-specific CODEX_HOME", () => {
  const work = join(tmpdir(), "synthetic-codex-work");
  const personal = join(tmpdir(), "synthetic-codex-personal");
  const first = codexProfileEnvironment({ dataPath: work }, { PATH: "bin" });
  const second = codexProfileEnvironment({ dataPath: personal }, { PATH: "bin" });
  assert.equal(first.CODEX_HOME, work);
  assert.equal(second.CODEX_HOME, personal);
  assert.notEqual(first.CODEX_HOME, second.CODEX_HOME);
});

test("extracts exact non-overlapping Codex components from cumulative token events", () => {
  const first = codexTokenCount(
    "2026-08-10T12:00:00Z",
    {
      input_tokens: 60,
      cached_input_tokens: 30,
      cache_write_input_tokens: 2,
      output_tokens: 40,
      reasoning_output_tokens: 10,
      total_tokens: 100,
    },
    {
      input_tokens: 10,
      cached_input_tokens: 3,
      cache_write_input_tokens: 2,
      output_tokens: 8,
      reasoning_output_tokens: 3,
      total_tokens: 18,
    },
  );
  const second = codexTokenCount(
    "2026-08-10T12:01:00Z",
    {
      input_tokens: 65,
      cached_input_tokens: 31,
      cache_write_input_tokens: 2,
      output_tokens: 44,
      reasoning_output_tokens: 11,
      total_tokens: 109,
    },
    {
      input_tokens: 5,
      cached_input_tokens: 1,
      cache_write_input_tokens: 0,
      output_tokens: 4,
      reasoning_output_tokens: 1,
      total_tokens: 9,
    },
    2,
  );
  const reset = codexTokenCount("2026-08-11T00:01:00Z", {
    input_tokens: 4,
    cached_input_tokens: 1,
    cache_write_input_tokens: 0,
    output_tokens: 3,
    reasoning_output_tokens: 1,
    total_tokens: 7,
  });
  const parsed = parseCodexSessionLines([first, first, second, reset]);
  assert.equal(parsed.invalid, false);
  assert.deepEqual(parsed.entries, [
    {
      date: "2026-08-10",
      totalTokens: "27",
      inputTokens: "9",
      outputTokens: "8",
      cacheReadTokens: "4",
      cacheWriteTokens: "2",
      reasoningTokens: "4",
    },
    {
      date: "2026-08-11",
      totalTokens: "7",
      inputTokens: "3",
      outputTokens: "2",
      cacheReadTokens: "1",
      cacheWriteTokens: "0",
      reasoningTokens: "1",
    },
  ]);
  assert.equal(parsed.lastUsage.totalTokens, "7");
});

test("ignores Codex context-window occupancy events without poisoning later usage", () => {
  const first = codexTokenCount("2026-08-10T12:00:00Z", {
    input_tokens: 10,
    cached_input_tokens: 3,
    cache_write_input_tokens: 2,
    output_tokens: 8,
    reasoning_output_tokens: 3,
    total_tokens: 18,
  });
  const occupancy = codexTokenCount("2026-08-10T12:01:00Z", {
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 100,
  });
  const afterOccupancy = codexTokenCount(
    "2026-08-10T12:02:00Z",
    {
      input_tokens: 5,
      cached_input_tokens: 1,
      cache_write_input_tokens: 0,
      output_tokens: 4,
      reasoning_output_tokens: 1,
      total_tokens: 109,
    },
    {
      input_tokens: 5,
      cached_input_tokens: 1,
      cache_write_input_tokens: 0,
      output_tokens: 4,
      reasoning_output_tokens: 1,
      total_tokens: 9,
    },
    3,
  );
  const parsed = parseCodexSessionLines([first, occupancy, afterOccupancy]);
  assert.equal(parsed.invalid, false);
  assert.deepEqual(parsed.entries, [
    {
      date: "2026-08-10",
      totalTokens: "27",
      inputTokens: "9",
      outputTokens: "8",
      cacheReadTokens: "4",
      cacheWriteTokens: "2",
      reasoningTokens: "4",
    },
  ]);
});

test("keeps the Codex account total while attaching exact local components", () => {
  const components = [
    {
      date: "2026-08-10",
      totalTokens: "27",
      inputTokens: "9",
      outputTokens: "8",
      cacheReadTokens: "4",
      cacheWriteTokens: "2",
      reasoningTokens: "4",
    },
    {
      date: "2026-08-11",
      totalTokens: "7",
      inputTokens: "3",
      outputTokens: "2",
      cacheReadTokens: "1",
      cacheWriteTokens: "0",
      reasoningTokens: "1",
    },
  ];
  assert.deepEqual(
    mergeCodexUsageComponents(
      [
        { date: "2026-08-10", totalTokens: "27" },
        { date: "2026-08-11", totalTokens: "8" },
      ],
      components,
    ),
    [components[0], { ...components[1], totalTokens: "8" }],
  );
});

test("resumes Codex transcripts and deduplicates copied token events", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-components-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  const path = join(directory, "rollout.jsonl");
  await mkdir(directory, { recursive: true });
  const firstLine = `${codexTokenCount("2026-08-10T12:00:00Z", {
    input_tokens: 10,
    cached_input_tokens: 3,
    cache_write_input_tokens: 2,
    output_tokens: 8,
    reasoning_output_tokens: 3,
    total_tokens: 18,
  })}\n`;
  await writeFile(path, firstLine);
  await writeFile(join(directory, "copied-rollout.jsonl"), firstLine);
  const range = { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" };
  const first = await collectCodexSessionUsage({ dataPath: root }, range);
  await appendFile(
    path,
    `${codexTokenCount(
      "2026-08-10T12:01:00Z",
      {
        input_tokens: 15,
        cached_input_tokens: 4,
        cache_write_input_tokens: 2,
        output_tokens: 12,
        reasoning_output_tokens: 4,
        total_tokens: 27,
      },
      {
        input_tokens: 5,
        cached_input_tokens: 1,
        cache_write_input_tokens: 0,
        output_tokens: 4,
        reasoning_output_tokens: 1,
        total_tokens: 9,
      },
      2,
    )}\n`,
  );
  const second = await collectCodexSessionUsage({ dataPath: root }, range, first.nextState);
  assert.deepEqual(second.warnings, []);
  assert.deepEqual(second.entries, [
    {
      date: "2026-08-10",
      totalTokens: "27",
      inputTokens: "9",
      outputTokens: "8",
      cacheReadTokens: "4",
      cacheWriteTokens: "2",
      reasoningTokens: "4",
    },
  ]);
});

test("preserves Codex component ownership when a rollout is archived", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-archive-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const activeDirectory = join(root, "sessions", "2026", "08", "10");
  const activePath = join(activeDirectory, "rollout.jsonl");
  const archivedDirectory = join(root, "archived_sessions");
  const archivedPath = join(archivedDirectory, "rollout-2026-08-10T12-00-00.jsonl");
  await mkdir(activeDirectory, { recursive: true });
  await mkdir(archivedDirectory, { recursive: true });
  const contents = `${codexTokenCount("2026-08-10T12:00:00Z", {
    input_tokens: 10,
    cached_input_tokens: 3,
    cache_write_input_tokens: 2,
    output_tokens: 8,
    reasoning_output_tokens: 3,
    total_tokens: 18,
  })}\n`;
  await writeFile(activePath, contents);
  const range = { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" };
  const active = await collectCodexSessionUsage({ dataPath: root }, range);
  await rename(activePath, archivedPath);
  const archived = await collectCodexSessionUsage({ dataPath: root }, range, active.nextState);
  assert.deepEqual(archived.entries, active.entries);
  assert.deepEqual(archived.warnings, []);
  assert.deepEqual(Object.keys(archived.nextState.files), [archivedPath]);
});

test("deduplicates Codex plain and compressed rollout representation transitions", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-compressed-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  const plainPath = join(directory, "rollout.jsonl");
  const compressedPath = `${plainPath}.zst`;
  await mkdir(directory, { recursive: true });
  const contents = `${codexTokenCount("2026-08-10T12:00:00Z", {
    input_tokens: 10,
    cached_input_tokens: 3,
    cache_write_input_tokens: 2,
    output_tokens: 8,
    reasoning_output_tokens: 3,
    total_tokens: 18,
  })}\n`;
  await writeFile(plainPath, contents);
  const range = { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" };
  const plain = await collectCodexSessionUsage({ dataPath: root }, range);

  await writeFile(compressedPath, zstdCompressSync(Buffer.from(contents)));
  const both = await collectCodexSessionUsage({ dataPath: root }, range, plain.nextState);
  assert.deepEqual(both.entries, plain.entries);
  assert.deepEqual(both.warnings, []);

  await rm(plainPath);
  const compressed = await collectCodexSessionUsage({ dataPath: root }, range, both.nextState);
  assert.deepEqual(compressed.entries, plain.entries);
  assert.deepEqual(compressed.warnings, []);

  await writeFile(plainPath, contents);
  const materializing = await collectCodexSessionUsage(
    { dataPath: root },
    range,
    compressed.nextState,
  );
  assert.deepEqual(materializing.entries, plain.entries);
  assert.deepEqual(materializing.warnings, []);

  await rm(compressedPath);
  const materialized = await collectCodexSessionUsage(
    { dataPath: root },
    range,
    materializing.nextState,
  );
  assert.deepEqual(materialized.entries, plain.entries);
  assert.deepEqual(materialized.warnings, []);
});

test("omits all Codex components when the bounded scan skips a session file", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-component-budget-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  await mkdir(directory, { recursive: true });
  const first = `${codexTokenCount("2026-08-10T12:00:00Z", {
    input_tokens: 10,
    cached_input_tokens: 3,
    cache_write_input_tokens: 2,
    output_tokens: 8,
    reasoning_output_tokens: 3,
    total_tokens: 18,
  })}\n`;
  const second = `${codexTokenCount("2026-08-10T12:01:00Z", {
    input_tokens: 12,
    cached_input_tokens: 3,
    cache_write_input_tokens: 2,
    output_tokens: 9,
    reasoning_output_tokens: 3,
    total_tokens: 21,
  })}\n`;
  await writeFile(join(directory, "first.jsonl"), first);
  await writeFile(join(directory, "second.jsonl"), second);
  const result = await collectCodexSessionUsage(
    { dataPath: root },
    { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" },
    {},
    { maximumBytes: Math.max(Buffer.byteLength(first), Buffer.byteLength(second)) },
  );
  assert.deepEqual(result.entries, []);
  assert.deepEqual(result.warnings, ["codex_session_components_incomplete"]);
  assert.equal(Object.keys(result.nextState.events).length, 1);
});

test("retains current Codex state when discovery hits a limit in an old directory", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-discovery-limit-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  const path = join(directory, "rollout.jsonl");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path,
    `${codexTokenCount("2026-08-10T12:00:00Z", {
      input_tokens: 10,
      cached_input_tokens: 3,
      cache_write_input_tokens: 2,
      output_tokens: 8,
      reasoning_output_tokens: 3,
      total_tokens: 18,
    })}\n`,
  );
  const range = { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" };
  const first = await collectCodexSessionUsage({ dataPath: root }, range);
  const limited = await collectCodexSessionUsage({ dataPath: root }, range, first.nextState, {
    discover: async (scanRoot) => ({
      files: [],
      incomplete: true,
      issues: [{ path: join(scanRoot, "2025", "01", "01"), reason: "limit" }],
    }),
  });

  assert.deepEqual(limited.entries, []);
  assert.deepEqual(limited.warnings, ["codex_session_components_incomplete"]);
  assert.deepEqual(limited.nextState.files, first.nextState.files);
  assert.deepEqual(limited.nextState.events, first.nextState.events);

  const recovered = await collectCodexSessionUsage({ dataPath: root }, range, limited.nextState);
  assert.deepEqual(recovered.entries, first.entries);
  assert.deepEqual(recovered.warnings, []);
});

test("keeps malformed Codex component state fail-closed until the file is reread", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-component-invalid-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  const path = join(directory, "rollout.jsonl");
  await mkdir(directory, { recursive: true });
  const valid = `${codexTokenCount("2026-08-10T12:00:00Z", {
    input_tokens: 10,
    cached_input_tokens: 3,
    cache_write_input_tokens: 2,
    output_tokens: 8,
    reasoning_output_tokens: 3,
    total_tokens: 18,
  })}\n`;
  const malformed = `${codexTokenCount("2026-08-10T12:01:00Z", {
    input_tokens: 2,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 99,
  })}\n`;
  await writeFile(path, `${valid}${malformed}`);
  const range = { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" };
  const first = await collectCodexSessionUsage({ dataPath: root }, range);
  assert.deepEqual(first.entries, []);
  assert.deepEqual(first.warnings, ["codex_session_components_incomplete"]);
  assert.deepEqual(Object.values(first.nextState.files)[0].incompleteDates, ["2026-08-10"]);

  const unchanged = await collectCodexSessionUsage({ dataPath: root }, range, first.nextState);
  assert.deepEqual(unchanged.entries, []);
  assert.deepEqual(unchanged.warnings, ["codex_session_components_incomplete"]);

  await writeFile(path, valid);
  const recovered = await collectCodexSessionUsage({ dataPath: root }, range, unchanged.nextState);
  assert.equal(recovered.entries.length, 1);
  assert.deepEqual(recovered.warnings, []);
  assert.equal(Object.values(recovered.nextState.files)[0].incompleteDates, undefined);
});

test("does not let an old malformed Codex rollout suppress current components", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-old-invalid-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const oldDirectory = join(root, "sessions", "2025", "01", "01");
  const currentDirectory = join(root, "sessions", "2026", "08", "10");
  await mkdir(oldDirectory, { recursive: true });
  await mkdir(currentDirectory, { recursive: true });
  await writeFile(
    join(oldDirectory, "old.jsonl"),
    `${codexTokenCount("2025-01-01T12:00:00Z", {
      input_tokens: 2,
      cached_input_tokens: 0,
      cache_write_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
      total_tokens: 99,
    })}\n`,
  );
  await writeFile(
    join(currentDirectory, "current.jsonl"),
    `${codexTokenCount("2026-08-10T12:00:00Z", {
      input_tokens: 10,
      cached_input_tokens: 3,
      cache_write_input_tokens: 2,
      output_tokens: 8,
      reasoning_output_tokens: 3,
      total_tokens: 18,
    })}\n`,
  );
  const result = await collectCodexSessionUsage(
    { dataPath: root },
    { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" },
  );
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.entries, [
    {
      date: "2026-08-10",
      totalTokens: "18",
      inputTokens: "5",
      outputTokens: "5",
      cacheReadTokens: "3",
      cacheWriteTokens: "2",
      reasoningTokens: "3",
    },
  ]);
});

test("deduplicates Claude messages without reading content", async () => {
  const lines = (await fixture("claude.jsonl")).trim().split("\n");
  assert.deepEqual(parseClaudeLines([...lines, lines[0]]), [
    {
      date: "2026-08-10",
      totalTokens: "20",
      inputTokens: "10",
      outputTokens: "5",
      cacheReadTokens: "3",
      cacheWriteTokens: "2",
      reasoningTokens: "0",
    },
  ]);
});

test("bounds cumulative Claude history reads and reports a partial snapshot", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "viberacing-claude-budget-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const line = (id, timestamp) =>
    `${JSON.stringify({
      type: "assistant",
      timestamp,
      message: {
        id,
        role: "assistant",
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          reasoning_tokens: 0,
        },
      },
    })}\n`;
  const firstContents = line("message-1", "2026-08-10T00:00:00Z");
  const secondContents = line("message-2", "2026-08-11T00:00:00Z");
  await writeFile(join(directory, "first.jsonl"), firstContents);
  await writeFile(join(directory, "second.jsonl"), secondContents);
  const result = await collectClaude(
    { dataPath: directory },
    { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" },
    {},
    { maximumBytes: Math.max(Buffer.byteLength(firstContents), Buffer.byteLength(secondContents)) },
  );
  assert.equal(result.completeness, "partial");
  assert.equal(result.entries.length, 1);
  assert.deepEqual(result.warnings, ["unreadable_or_unbounded_session_data"]);
  assert.equal(Object.keys(result.nextState.files).length, 1);
});

test("keeps prior Claude contributions when a replaced file cannot be read", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "viberacing-claude-read-failure-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const path = join(directory, "session.jsonl");
  const record = (id, tokens) =>
    `${JSON.stringify({
      type: "assistant",
      timestamp: "2026-08-10T00:00:00Z",
      message: {
        id,
        role: "assistant",
        usage: {
          input_tokens: tokens,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          reasoning_tokens: 0,
        },
      },
    })}\n`;
  await writeFile(path, record("message-before-replacement", 20));
  const range = { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" };
  const first = await collectClaude({ dataPath: directory }, range, {});
  await writeFile(path, record("message-after-replacement", 30));
  const partial = await collectClaude({ dataPath: directory }, range, first.nextState, {
    readChunk: async () => {
      throw new Error("synthetic read failure");
    },
  });
  assert.equal(partial.completeness, "partial");
  assert.deepEqual(partial.entries, first.entries);
  assert.deepEqual(partial.nextState, first.nextState);
});

test("reads OpenCode assistant usage and avoids cache double-counting", async () => {
  const rows = JSON.parse(await fixture("opencode.json"));
  assert.deepEqual(parseOpenCodeMessages(rows), [
    {
      date: "2026-08-10",
      totalTokens: "23",
      inputTokens: "10",
      outputTokens: "5",
      cacheReadTokens: "3",
      cacheWriteTokens: "2",
      reasoningTokens: "3",
    },
  ]);
});

test("reads current Kimi usage records with millisecond UTC timestamps", async () => {
  const lines = (await fixture("kimi.jsonl")).trim().split("\n");
  assert.deepEqual(parseKimiLines([...lines, lines[1]]), [
    {
      date: "2026-08-10",
      totalTokens: "20",
      inputTokens: "10",
      outputTokens: "5",
      cacheReadTokens: "3",
      cacheWriteTokens: "2",
      reasoningTokens: "0",
    },
    {
      date: "2026-08-11",
      totalTokens: "10",
      inputTokens: "4",
      outputTokens: "3",
      cacheReadTokens: "2",
      cacheWriteTokens: "1",
      reasoningTokens: "0",
    },
  ]);

  assert.deepEqual(parseKimiLines([lines[1]]), [
    {
      date: "2026-08-10",
      totalTokens: "20",
      inputTokens: "10",
      outputTokens: "5",
      cacheReadTokens: "3",
      cacheWriteTokens: "2",
      reasoningTokens: "0",
    },
  ]);
});

test("keeps the legacy Kimi StatusUpdate parser separate", async () => {
  const lines = (await fixture("kimi-legacy.jsonl")).trim().split("\n");
  assert.deepEqual(parseKimiLegacyLines([...lines, lines[1]]), [
    {
      date: "2026-08-10",
      totalTokens: "20",
      inputTokens: "10",
      outputTokens: "5",
      cacheReadTokens: "3",
      cacheWriteTokens: "2",
      reasoningTokens: "0",
    },
    {
      date: "2026-08-11",
      totalTokens: "10",
      inputTokens: "4",
      outputTokens: "3",
      cacheReadTokens: "2",
      cacheWriteTokens: "1",
      reasoningTokens: "0",
    },
  ]);
});

test("honors KIMI_CODE_HOME and keeps current and legacy roots distinct", () => {
  assert.deepEqual(
    kimiSourcePaths(
      { KIMI_CODE_HOME: "/portable/current", KIMI_SHARE_DIR: "/portable/legacy" },
      "/home/racer",
    ),
    {
      current: join(resolve("/portable/current"), "sessions"),
      legacy: join(resolve("/portable/legacy"), "sessions"),
    },
  );
});

test("collects current Kimi main-agent and subagent wire files", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-kimi-current-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const main = join(root, "wd_project_hash", "session-1", "agents", "main");
  const subagent = join(root, "wd_project_hash", "session-1", "agents", "agent-0");
  await mkdir(main, { recursive: true });
  await mkdir(subagent, { recursive: true });
  const lines = (await fixture("kimi.jsonl")).trim().split("\n");
  await writeFile(join(main, "wire.jsonl"), `${lines[1]}\n`);
  await writeFile(join(subagent, "wire.jsonl"), `${lines[2]}\n`);
  const result = await adapterFor("kimi_code").collect(
    { dataPath: root, collectionMethod: "kimi_wire_jsonl" },
    { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" },
    {},
  );
  assert.equal(result.completeness, "complete");
  assert.deepEqual(
    result.entries.map((entry) => [entry.date, entry.totalTokens]),
    [
      ["2026-08-10", "20"],
      ["2026-08-11", "10"],
    ],
  );
});

test("reads Qwen content-free stats using UTC timestamp instead of localDate", async () => {
  const lines = (await fixture("qwen.jsonl")).trim().split("\n");
  assert.deepEqual(parseQwenLines(lines), [
    {
      date: "2026-08-10",
      totalTokens: "35",
      inputTokens: "7",
      outputTokens: "20",
      cacheReadTokens: "3",
      cacheWriteTokens: "0",
      reasoningTokens: "5",
    },
  ]);
});

test("invalidates Qwen incremental state created with overlapping component semantics", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-qwen-parser-version-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const path = join(root, "token-usage-2026-08.jsonl");
  await writeFile(path, await fixture("qwen.jsonl"));
  const source = { dataPath: root };
  const range = { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" };
  const current = await adapterFor("qwen_code").collect(source, range, {});
  const { parserVersion: _parserVersion, ...stale } = current.nextState;
  for (const file of Object.values(stale.files))
    file.entries = file.entries.map((entry) => ({
      date: entry.date,
      totalTokens: entry.totalTokens,
    }));
  const refreshed = await adapterFor("qwen_code").collect(source, range, stale);
  assert.equal(refreshed.nextState.parserVersion, 3);
  assert.equal(refreshed.entries[0].inputTokens, "7");
  assert.equal(refreshed.entries[0].outputTokens, "20");
});

test("supports legacy Qwen records whose thoughts are included in output", () => {
  const record = JSON.stringify({
    schemaVersion: 1,
    id: "legacy-overlapping-output",
    timestamp: "2026-08-10T23:30:00Z",
    inputTokens: 10,
    outputTokens: 7,
    cachedTokens: 3,
    thoughtsTokens: 5,
    totalTokens: 17,
  });
  assert.deepEqual(parseQwenLines([record]), [
    {
      date: "2026-08-10",
      totalTokens: "17",
      inputTokens: "7",
      outputTokens: "2",
      cacheReadTokens: "3",
      cacheWriteTokens: "0",
      reasoningTokens: "5",
    },
  ]);
});

test("keeps contradictory Qwen component tuples total-only", () => {
  const record = JSON.stringify({
    schemaVersion: 1,
    id: "contradictory-components",
    timestamp: "2026-08-10T23:30:00Z",
    inputTokens: 10,
    outputTokens: 20,
    cachedTokens: 3,
    thoughtsTokens: 5,
    totalTokens: 34,
  });
  assert.deepEqual(parseQwenLines([record]), [{ date: "2026-08-10", totalTokens: "34" }]);
});

test("reads Antigravity CLI snake-case usage", async () => {
  const lines = (await fixture("antigravity.jsonl")).trim().split("\n");
  assert.deepEqual(parseAntigravityLines(lines), [
    {
      date: "2026-08-10",
      totalTokens: "20",
      inputTokens: "10",
      outputTokens: "5",
      cacheReadTokens: "3",
      cacheWriteTokens: "2",
      reasoningTokens: "0",
    },
  ]);
});

test("reads Gemini session usage metadata", async () => {
  assert.deepEqual(parseGeminiRecords(JSON.parse(await fixture("gemini.json"))), [
    {
      date: "2026-08-10",
      totalTokens: "17",
      inputTokens: "7",
      outputTokens: "5",
      cacheReadTokens: "3",
      cacheWriteTokens: "0",
      reasoningTokens: "2",
    },
  ]);
});

test("omits components when an authoritative total uses different semantics", () => {
  assert.deepEqual(
    parseOpenCodeMessages([
      {
        id: "m",
        time_created: Date.parse("2026-08-10T00:00:00Z"),
        data: JSON.stringify({ role: "assistant", tokens: { input: 4, output: 2, total: 99 } }),
      },
    ]),
    [{ date: "2026-08-10", totalTokens: "99" }],
  );
});

test("keeps exactly the 31 UTC dates accepted by ingestion", () => {
  const entries = [
    { date: "2026-07-13", totalTokens: "1" },
    { date: "2026-07-14", totalTokens: "2" },
    { date: "2026-08-13", totalTokens: "3" },
    { date: "2026-08-14", totalTokens: "4" },
  ];
  assert.deepEqual(recentEntries(entries, new Date("2026-08-13T23:00:00Z")), entries.slice(1, 3));
});

test("all seven adapters expose the complete collection contract", () => {
  assert.deepEqual(
    adapters.map((adapter) => adapter.id),
    ["codex", "claude_code", "opencode", "kimi_code", "qwen_code", "antigravity", "gemini_cli"],
  );
  for (const adapter of adapters) {
    assert.equal(typeof adapter.detect, "function");
    assert.equal(typeof adapter.collect, "function");
    assert.equal(typeof adapter.diagnose, "function");
    assert.ok(adapter.supportedSurfaces.length > 0);
    assert.ok(adapter.collectionMethods.length > 0);
  }
});

test("malformed records never become usage", () => {
  assert.throws(() => parseCodexUsage({ result: { dailyUsageBuckets: [{}] } }), /unsupported/);
  assert.deepEqual(parseClaudeLines(["bad", "{}"]), []);
  assert.deepEqual(parseOpenCodeMessages([{ id: "x", data: "bad" }]), []);
  assert.deepEqual(parseKimiLines(["bad", "{}"]), []);
  assert.deepEqual(parseQwenLines(["bad", "{}"]), []);
  assert.deepEqual(parseAntigravityLines(["bad", "{}"]), []);
  assert.deepEqual(parseGeminiRecords([{}]), []);
});

test("every event-based adapter deduplicates IDs and keeps distinct UTC days", async () => {
  const claude = JSON.parse((await fixture("claude.jsonl")).trim());
  const openCode = JSON.parse(await fixture("opencode.json"))[0];
  const qwen = JSON.parse((await fixture("qwen.jsonl")).trim());
  const antigravity = JSON.parse((await fixture("antigravity.jsonl")).trim());
  const gemini = JSON.parse(await fixture("gemini.json"))[0];
  const cases = [
    [
      parseClaudeLines,
      [
        JSON.stringify(claude),
        JSON.stringify(claude),
        JSON.stringify({
          ...claude,
          timestamp: "2026-08-11T00:00:00Z",
          message: { ...claude.message, id: "m2" },
        }),
      ],
    ],
    [
      parseOpenCodeMessages,
      [
        openCode,
        openCode,
        {
          ...openCode,
          id: "m2",
          time_created: Date.parse("2026-08-11T00:00:00Z"),
          data: JSON.stringify({
            ...JSON.parse(openCode.data),
            time: { created: Date.parse("2026-08-11T00:00:00Z") },
          }),
        },
      ],
    ],
    [
      parseQwenLines,
      [
        JSON.stringify(qwen),
        JSON.stringify(qwen),
        JSON.stringify({ ...qwen, id: "event-2", timestamp: "2026-08-11T00:00:00Z" }),
      ],
    ],
    [
      parseAntigravityLines,
      [
        JSON.stringify(antigravity),
        JSON.stringify(antigravity),
        JSON.stringify({
          ...antigravity,
          session_id: "session-2",
          timestamp: "2026-08-11T00:00:00Z",
        }),
      ],
    ],
    [
      parseGeminiRecords,
      [gemini, gemini, { ...gemini, id: "event-2", timestamp: "2026-08-11T00:00:00Z" }],
    ],
  ];
  for (const [parser, input] of cases) {
    const entries = parser(input);
    assert.deepEqual(
      entries.map((entry) => entry.date),
      ["2026-08-10", "2026-08-11"],
    );
    assert.equal(entries[0].totalTokens, entries[1].totalTokens);
  }

  const kimi = (await fixture("kimi.jsonl")).trim().split("\n")[1];
  const parsedKimi = JSON.parse(kimi);
  const nextKimi = JSON.stringify({
    ...parsedKimi,
    time: parsedKimi.time + 86_400_000,
    usage: { ...parsedKimi.usage, output: parsedKimi.usage.output + 1 },
  });
  assert.deepEqual(
    parseKimiLines([kimi, kimi, nextKimi]).map((entry) => entry.date),
    ["2026-08-10", "2026-08-11"],
  );
});

test("adapter output never carries prompt, response, model, path, or credential fields", async () => {
  const sensitive = "synthetic-sensitive-value";
  const antigravity = JSON.parse((await fixture("antigravity.jsonl")).trim());
  const output = parseAntigravityLines([
    JSON.stringify({
      ...antigravity,
      prompt: sensitive,
      response: sensitive,
      model: sensitive,
      path: sensitive,
      apiKey: sensitive,
    }),
  ]);
  const serialized = JSON.stringify(output);
  assert.doesNotMatch(serialized, /prompt|response|model|path|apiKey|synthetic-sensitive-value/);
  assert.deepEqual(Object.keys(output[0]).sort(), [
    "cacheReadTokens",
    "cacheWriteTokens",
    "date",
    "inputTokens",
    "outputTokens",
    "reasoningTokens",
    "totalTokens",
  ]);
});

test("Codex rejects duplicate authoritative day buckets", async () => {
  const bucket = JSON.parse(await fixture("codex.json")).result.dailyUsageBuckets[0];
  assert.throws(
    () => parseCodexUsage({ result: { dailyUsageBuckets: [bucket, bucket] } }),
    /unsupported/,
  );
});

test("capture adapter deduplicates events and aggregates multiple UTC days", async () => {
  const antigravity = (await fixture("antigravity.jsonl")).trim();
  const other = JSON.stringify({
    ...JSON.parse(antigravity),
    session_id: "session-2",
    timestamp: "2026-08-11T00:00:00Z",
  });
  assert.deepEqual(
    parseAntigravityLines([antigravity, antigravity, other]).map((entry) => entry.date),
    ["2026-08-10", "2026-08-11"],
  );
});

test("capture collectors accept their configured JSONL file directly", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "viberacing-capture-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  for (const agentId of ["antigravity"]) {
    const native = (await fixture(`${agentId}.jsonl`)).trim().split("\n").at(-1);
    const persisted = safeCaptureRecord(agentId, native);
    assert.equal(persisted.id, "session-1");
    const path = join(directory, `${agentId}.jsonl`);
    await writeFile(path, `${JSON.stringify(persisted)}\n`);
    const result = await adapterFor(agentId).collect({ dataPath: path }, undefined, {});
    assert.equal(result.completeness, "complete");
    assert.deepEqual(
      result.entries.map((item) => item.totalTokens),
      ["20"],
    );
  }
});

test("JSONL collectors reuse unchanged state and resume at the last complete byte offset", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "viberacing-incremental-jsonl-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const path = join(directory, "antigravity.jsonl");
  const native = JSON.parse((await fixture("antigravity.jsonl")).trim());
  const firstRecord = safeCaptureRecord("antigravity", JSON.stringify(native));
  await writeFile(path, `${JSON.stringify(firstRecord)}\n`);
  const adapter = adapterFor("antigravity");
  const range = { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" };
  const first = await adapter.collect({ dataPath: path }, range, {});
  const unchanged = await adapter.collect({ dataPath: path }, range, first.nextState);
  assert.deepEqual(unchanged.nextState, first.nextState);

  const secondNative = {
    ...native,
    session_id: "session-2",
    timestamp: "2026-08-11T12:00:00Z",
  };
  const secondRecord = safeCaptureRecord("antigravity", JSON.stringify(secondNative));
  await appendFile(path, JSON.stringify(secondRecord));
  const partialLine = await adapter.collect({ dataPath: path }, range, unchanged.nextState);
  const priorOffset = first.nextState.files[path].safeOffset;
  assert.equal(partialLine.nextState.files[path].safeOffset, priorOffset);
  assert.deepEqual(
    partialLine.entries.map((entry) => entry.date),
    ["2026-08-10"],
  );

  await appendFile(path, "\n");
  const appended = await adapter.collect({ dataPath: path }, range, partialLine.nextState);
  assert.ok(appended.nextState.files[path].safeOffset > priorOffset);
  assert.deepEqual(
    appended.entries.map((entry) => entry.date),
    ["2026-08-10", "2026-08-11"],
  );

  await appendFile(path, `${JSON.stringify(secondRecord)}\n`);
  const duplicate = await adapter.collect({ dataPath: path }, range, appended.nextState);
  assert.equal(duplicate.entries.find((entry) => entry.date === "2026-08-11")?.totalTokens, "20");

  await writeFile(path, `${JSON.stringify(secondRecord)}\n`);
  const truncated = await adapter.collect({ dataPath: path }, range, duplicate.nextState);
  assert.deepEqual(
    truncated.entries.map((entry) => entry.date),
    ["2026-08-11"],
  );
});

test("collector limits are explicit partial results with diagnostics", async () => {
  const adapter = adapterFor("antigravity");
  const source = {
    dataPath: join(tmpdir(), `missing-viberacing-${Date.now().toString()}.jsonl`),
    collectionMethod: "antigravity_cli_capture",
    supportedSurface: "cli",
  };
  const result = await adapter.collect(source, undefined, {});
  const diagnostic = await adapter.diagnose(source);
  assert.equal(result.completeness, "partial");
  assert.deepEqual(result.warnings, ["collector_limits_or_unreadable_files"]);
  assert.equal(diagnostic.dataLocationAvailable, false);
  assert.deepEqual(diagnostic.excluded, ["Antigravity Desktop usage"]);
});

test("parses valid usage from an oversized JSONL record and marks the pass partial", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "viberacing-oversized-jsonl-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const path = join(directory, "antigravity.jsonl");
  const record = {
    id: "oversized-event",
    date: "2026-08-10",
    usage: {
      date: "2026-08-10",
      totalTokens: "20",
      inputTokens: "10",
      outputTokens: "5",
      cacheReadTokens: "3",
      cacheWriteTokens: "2",
      reasoningTokens: "0",
    },
    ignoredPadding: "x".repeat(1_000_001),
  };
  await writeFile(path, `${JSON.stringify(record)}\n`);
  const result = await adapterFor("antigravity").collect(
    { dataPath: path },
    { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" },
    {},
  );
  assert.equal(result.completeness, "partial");
  assert.equal(result.entries[0]?.totalTokens, "20");
  assert.deepEqual(result.warnings, [
    "collector_limits_or_unreadable_files",
    "oversized_jsonl_records",
  ]);
  assert.ok(result.nextState.files[path].safeOffset > 1_000_000);
});

test("capture wrapper uses the current executable and required headless structured flags", () => {
  assert.deepEqual(
    wrapperInvocation("antigravity", ["-p", "hello", "--output-format=stream-json"]),
    {
      executable: "agy",
      args: ["-p", "hello", "--output-format=stream-json"],
    },
  );
  assert.throws(() => wrapperInvocation("unknown", ["hello"]), /Unsupported wrapper agent/);
});

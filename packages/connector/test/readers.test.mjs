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

function codexSessionMeta(id, options = {}) {
  const timestamp =
    options.timestamp ?? (options.forkedFromId ? "2026-08-10T12:00:02Z" : "2026-08-10T11:59:00Z");
  return JSON.stringify({
    ...(options.historyMode === "paginated"
      ? { ordinal: options.historyBase?.end_ordinal_exclusive ?? 0 }
      : {}),
    timestamp,
    type: "session_meta",
    payload: {
      id,
      timestamp,
      ...(options.forkedFromId ? { forked_from_id: options.forkedFromId } : {}),
      ...(options.historyBase ? { history_base: options.historyBase } : {}),
      ...(options.historyMode ? { history_mode: options.historyMode } : {}),
      ...(options.subagentHistoryStartOrdinal === undefined
        ? {}
        : { subagent_history_start_ordinal: options.subagentHistoryStartOrdinal }),
    },
  });
}

function codexRolloutName(threadId, rolloutId = threadId, timestamp = "2026-08-10T12-00-00") {
  const ids = rolloutId === threadId ? threadId : `${threadId}_${rolloutId}`;
  return `rollout-${timestamp}-${ids}.jsonl`;
}

function codexThreadSettings(timestamp = "2026-08-10T12:00:30Z") {
  return JSON.stringify({
    timestamp,
    type: "event_msg",
    payload: { type: "thread_settings_applied" },
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
  const parsed = parseCodexSessionLines([
    codexSessionMeta("01010101-0101-4101-8101-010101010101"),
    first,
    first,
    second,
    reset,
  ]);
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
  const parsed = parseCodexSessionLines([
    codexSessionMeta("02020202-0202-4202-8202-020202020202"),
    first,
    occupancy,
    afterOccupancy,
  ]);
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
  const firstLine = `${codexSessionMeta("24242424-2424-4424-8424-242424242424")}\n${codexTokenCount(
    "2026-08-10T12:00:00Z",
    {
      input_tokens: 10,
      cached_input_tokens: 3,
      cache_write_input_tokens: 2,
      output_tokens: 8,
      reasoning_output_tokens: 3,
      total_tokens: 18,
    },
  )}\n`;
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

test("does not count a legacy fork's rewritten inherited token prefix", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-legacy-fork-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  await mkdir(directory, { recursive: true });
  const parentId = "11111111-1111-4111-8111-111111111111";
  const childId = "22222222-2222-4222-8222-222222222222";
  const inheritedUsage = {
    input_tokens: 10,
    cached_input_tokens: 3,
    cache_write_input_tokens: 2,
    output_tokens: 8,
    reasoning_output_tokens: 3,
    total_tokens: 18,
  };
  const childUsage = {
    input_tokens: 15,
    cached_input_tokens: 4,
    cache_write_input_tokens: 2,
    output_tokens: 12,
    reasoning_output_tokens: 4,
    total_tokens: 27,
  };
  const childLastUsage = {
    input_tokens: 5,
    cached_input_tokens: 1,
    cache_write_input_tokens: 0,
    output_tokens: 4,
    reasoning_output_tokens: 1,
    total_tokens: 9,
  };
  await writeFile(
    join(directory, "parent.jsonl"),
    `${[codexSessionMeta(parentId), codexTokenCount("2026-08-10T12:00:00Z", inheritedUsage)].join(
      "\n",
    )}\n`,
  );
  await writeFile(
    join(directory, "child.jsonl"),
    `${[
      codexSessionMeta(childId, { forkedFromId: parentId }),
      codexTokenCount("2026-08-10T12:00:05Z", inheritedUsage, inheritedUsage, 41),
      codexThreadSettings(),
      codexTokenCount("2026-08-10T12:01:00Z", childUsage, childLastUsage, 42),
    ].join("\n")}\n`,
  );

  const result = await collectCodexSessionUsage(
    { dataPath: root },
    { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" },
  );
  assert.deepEqual(result.warnings, []);
  assert.equal(result.entries[0].totalTokens, "27");
});

test("deduplicates a LastNTurns legacy fork copied from the parent suffix", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-last-turns-fork-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  await mkdir(directory, { recursive: true });
  const parentId = "12121212-1212-4212-8212-121212121212";
  const childId = "13131313-1313-4313-8313-131313131313";
  const last = {
    input_tokens: 5,
    cached_input_tokens: 1,
    cache_write_input_tokens: 0,
    output_tokens: 4,
    reasoning_output_tokens: 1,
    total_tokens: 9,
  };
  const usages = [
    last,
    {
      input_tokens: 10,
      cached_input_tokens: 2,
      cache_write_input_tokens: 0,
      output_tokens: 8,
      reasoning_output_tokens: 2,
      total_tokens: 18,
    },
    {
      input_tokens: 15,
      cached_input_tokens: 3,
      cache_write_input_tokens: 0,
      output_tokens: 12,
      reasoning_output_tokens: 3,
      total_tokens: 27,
    },
    {
      input_tokens: 20,
      cached_input_tokens: 4,
      cache_write_input_tokens: 0,
      output_tokens: 16,
      reasoning_output_tokens: 4,
      total_tokens: 36,
    },
  ];
  await writeFile(
    join(directory, "parent.jsonl"),
    `${codexSessionMeta(parentId)}\n${codexTokenCount(
      "2026-08-10T12:00:00Z",
      usages[0],
      usages[0],
      1,
    )}\n${codexTokenCount("2026-08-10T12:01:00Z", usages[1], last, 2)}\n${codexTokenCount(
      "2026-08-10T12:02:00Z",
      usages[2],
      last,
      3,
    )}\n`,
  );
  await writeFile(
    join(directory, "child.jsonl"),
    `${codexSessionMeta(childId, {
      forkedFromId: parentId,
      timestamp: "2026-08-10T12:02:30Z",
    })}\n${codexTokenCount(
      "2026-08-10T12:02:31Z",
      usages[2],
      last,
      41,
    )}\n${codexThreadSettings("2026-08-10T12:02:32Z")}\n${codexTokenCount(
      "2026-08-10T12:03:00Z",
      usages[3],
      last,
      42,
    )}\n`,
  );

  const result = await collectCodexSessionUsage(
    { dataPath: root },
    { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" },
  );
  assert.deepEqual(result.warnings, []);
  assert.equal(result.entries[0].totalTokens, "36");
});

test("deduplicates truncated suffixes through a LastNTurns fork-of-fork", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-last-turns-chain-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  await mkdir(directory, { recursive: true });
  const rootId = "14141414-1414-4414-8414-141414141414";
  const childId = "15151515-1515-4515-8515-151515151515";
  const grandchildId = "16161616-1616-4616-8616-161616161616";
  const last = {
    input_tokens: 5,
    cached_input_tokens: 1,
    cache_write_input_tokens: 0,
    output_tokens: 4,
    reasoning_output_tokens: 1,
    total_tokens: 9,
  };
  const usages = Array.from({ length: 5 }, (_, index) => ({
    input_tokens: 5 * (index + 1),
    cached_input_tokens: index + 1,
    cache_write_input_tokens: 0,
    output_tokens: 4 * (index + 1),
    reasoning_output_tokens: index + 1,
    total_tokens: 9 * (index + 1),
  }));
  await writeFile(
    join(directory, "root.jsonl"),
    `${codexSessionMeta(rootId)}\n${codexTokenCount(
      "2026-08-10T12:00:00Z",
      usages[0],
      usages[0],
      1,
    )}\n${codexTokenCount("2026-08-10T12:01:00Z", usages[1], last, 2)}\n${codexTokenCount(
      "2026-08-10T12:02:00Z",
      usages[2],
      last,
      3,
    )}\n`,
  );
  await writeFile(
    join(directory, "child.jsonl"),
    `${codexSessionMeta(childId, {
      forkedFromId: rootId,
      timestamp: "2026-08-10T12:02:30Z",
    })}\n${codexTokenCount(
      "2026-08-10T12:02:31Z",
      usages[2],
      last,
      41,
    )}\n${codexThreadSettings("2026-08-10T12:02:32Z")}\n${codexTokenCount(
      "2026-08-10T12:03:00Z",
      usages[3],
      last,
      42,
    )}\n`,
  );
  await writeFile(
    join(directory, "grandchild.jsonl"),
    `${codexSessionMeta(grandchildId, {
      forkedFromId: childId,
      timestamp: "2026-08-10T12:03:30Z",
    })}\n${codexTokenCount(
      "2026-08-10T12:03:31Z",
      usages[3],
      last,
      81,
    )}\n${codexThreadSettings("2026-08-10T12:03:32Z")}\n${codexTokenCount(
      "2026-08-10T12:04:00Z",
      usages[4],
      last,
      82,
    )}\n`,
  );

  const result = await collectCodexSessionUsage(
    { dataPath: root },
    { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" },
  );
  assert.deepEqual(result.warnings, []);
  assert.equal(result.entries[0].totalTokens, "45");
});

test("keeps a copied fork prefix deduplicated across a partial write", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-partial-fork-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  const parentPath = join(directory, "parent.jsonl");
  const childPath = join(directory, "child.jsonl");
  await mkdir(directory, { recursive: true });
  const parentId = "19191919-1919-4919-8919-191919191919";
  const childId = "29292929-2929-4929-8929-292929292929";
  const inheritedUsage = {
    input_tokens: 10,
    cached_input_tokens: 3,
    cache_write_input_tokens: 2,
    output_tokens: 8,
    reasoning_output_tokens: 3,
    total_tokens: 18,
  };
  await writeFile(
    parentPath,
    `${codexSessionMeta(parentId)}\n${codexThreadSettings()}\n${codexTokenCount(
      "2026-08-10T12:00:00Z",
      inheritedUsage,
    )}\n`,
  );
  await writeFile(
    childPath,
    `${codexSessionMeta(childId, { forkedFromId: parentId })}\n${codexTokenCount(
      "2026-08-10T12:00:05Z",
      inheritedUsage,
      inheritedUsage,
      41,
    )}\n${codexThreadSettings()}\n`,
  );
  const range = { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" };
  const partial = await collectCodexSessionUsage({ dataPath: root }, range);
  assert.deepEqual(partial.warnings, []);
  assert.equal(partial.entries[0].totalTokens, "18");

  await appendFile(
    childPath,
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
      42,
    )}\n`,
  );
  const complete = await collectCodexSessionUsage({ dataPath: root }, range, partial.nextState);
  assert.deepEqual(complete.warnings, []);
  assert.equal(complete.entries[0].totalTokens, "27");
});

test("keeps a legacy fork pending until its child boundary is durable", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-pending-fork-boundary-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  const parentPath = join(directory, "parent.jsonl");
  const childPath = join(directory, "child.jsonl");
  await mkdir(directory, { recursive: true });
  const parentId = "20202020-2020-4020-8020-202020202020";
  const childId = "21212121-2121-4121-8121-212121212121";
  const inherited = {
    input_tokens: 10,
    cached_input_tokens: 3,
    cache_write_input_tokens: 2,
    output_tokens: 8,
    reasoning_output_tokens: 3,
    total_tokens: 18,
  };
  const childTotal = {
    input_tokens: 15,
    cached_input_tokens: 4,
    cache_write_input_tokens: 2,
    output_tokens: 12,
    reasoning_output_tokens: 4,
    total_tokens: 27,
  };
  const childLast = {
    input_tokens: 5,
    cached_input_tokens: 1,
    cache_write_input_tokens: 0,
    output_tokens: 4,
    reasoning_output_tokens: 1,
    total_tokens: 9,
  };
  const copiedSettings = codexThreadSettings("2026-08-10T11:59:30Z");
  const copiedToken = codexTokenCount("2026-08-10T12:00:00Z", inherited, inherited, 1);
  await writeFile(parentPath, `${codexSessionMeta(parentId)}\n${copiedSettings}\n${copiedToken}\n`);
  await writeFile(
    childPath,
    `${codexSessionMeta(childId, {
      forkedFromId: parentId,
      timestamp: "2026-08-10T12:01:00Z",
    })}\n${codexThreadSettings("2026-08-10T12:01:00.001Z")}\n${copiedToken}\n`,
  );
  const range = { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" };

  const pending = await collectCodexSessionUsage({ dataPath: root }, range);
  assert.deepEqual(pending.entries, []);
  assert.deepEqual(pending.warnings, ["codex_session_components_incomplete"]);

  await appendFile(
    childPath,
    `${codexThreadSettings("2026-08-10T12:01:01Z")}\n${codexTokenCount(
      "2026-08-10T12:02:00Z",
      childTotal,
      childLast,
      2,
    )}\n`,
  );
  const recovered = await collectCodexSessionUsage({ dataPath: root }, range, pending.nextState);
  assert.deepEqual(recovered.warnings, []);
  assert.equal(recovered.entries[0].totalTokens, "27");
});

test("uses the first non-inherited legacy boundary when token signatures repeat", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-repeated-fork-signatures-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  await mkdir(directory, { recursive: true });
  const parentId = "22222222-2222-4222-8222-222222222222";
  const childId = "23232323-2323-4323-8323-232323232323";
  const first = {
    input_tokens: 5,
    cached_input_tokens: 1,
    cache_write_input_tokens: 0,
    output_tokens: 4,
    reasoning_output_tokens: 1,
    total_tokens: 9,
  };
  const second = {
    input_tokens: 10,
    cached_input_tokens: 2,
    cache_write_input_tokens: 0,
    output_tokens: 8,
    reasoning_output_tokens: 2,
    total_tokens: 18,
  };
  const occupancy = {
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 100,
  };
  await writeFile(
    join(directory, "parent.jsonl"),
    `${codexSessionMeta(parentId)}\n${codexTokenCount(
      "2026-08-10T12:00:00Z",
      first,
      first,
      1,
    )}\n${codexTokenCount("2026-08-10T12:01:00Z", second, first, 2)}\n${codexTokenCount(
      "2026-08-10T12:02:00Z",
      occupancy,
      occupancy,
      3,
    )}\n${codexTokenCount("2026-08-10T12:03:00Z", first, first, 4)}\n${codexTokenCount(
      "2026-08-10T12:04:00Z",
      second,
      first,
      5,
    )}\n`,
  );
  await writeFile(
    join(directory, "child.jsonl"),
    `${codexSessionMeta(childId, {
      forkedFromId: parentId,
      timestamp: "2026-08-10T12:04:30Z",
    })}\n${codexTokenCount("2026-08-10T12:04:31Z", second, first, 41)}\n${codexThreadSettings(
      "2026-08-10T12:04:32Z",
    )}\n${codexTokenCount("2026-08-10T12:05:00Z", occupancy, occupancy, 42)}\n${codexTokenCount(
      "2026-08-10T12:06:00Z",
      first,
      first,
      43,
    )}\n${codexTokenCount("2026-08-10T12:07:00Z", second, first, 44)}\n${codexThreadSettings(
      "2026-08-10T12:08:00Z",
    )}\n`,
  );

  const result = await collectCodexSessionUsage(
    { dataPath: root },
    { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" },
  );
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.entries, [
    {
      date: "2026-08-10",
      totalTokens: "54",
      inputTokens: "24",
      outputTokens: "18",
      cacheReadTokens: "6",
      cacheWriteTokens: "0",
      reasoningTokens: "6",
    },
  ]);
});

test("fails closed when repeated legacy signatures and boundaries remain ambiguous", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-ambiguous-fork-boundaries-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  await mkdir(directory, { recursive: true });
  const parentId = "24242424-2424-4424-8424-242424242424";
  const childId = "25252525-2525-4525-8525-252525252525";
  const first = {
    input_tokens: 5,
    cached_input_tokens: 1,
    cache_write_input_tokens: 0,
    output_tokens: 4,
    reasoning_output_tokens: 1,
    total_tokens: 9,
  };
  const second = {
    input_tokens: 10,
    cached_input_tokens: 2,
    cache_write_input_tokens: 0,
    output_tokens: 8,
    reasoning_output_tokens: 2,
    total_tokens: 18,
  };
  const occupancy = {
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 100,
  };
  await writeFile(
    join(directory, "parent.jsonl"),
    `${codexSessionMeta(parentId)}\n${codexTokenCount(
      "2026-08-10T12:00:00Z",
      first,
      first,
      1,
    )}\n${codexTokenCount("2026-08-10T12:01:00Z", second, first, 2)}\n${codexTokenCount(
      "2026-08-10T12:02:00Z",
      occupancy,
      occupancy,
      3,
    )}\n${codexThreadSettings("2026-08-10T12:02:30Z")}\n${codexTokenCount(
      "2026-08-10T12:03:00Z",
      first,
      first,
      4,
    )}\n${codexTokenCount("2026-08-10T12:04:00Z", second, first, 5)}\n`,
  );
  await writeFile(
    join(directory, "child.jsonl"),
    `${codexSessionMeta(childId, {
      forkedFromId: parentId,
      timestamp: "2026-08-10T12:04:30Z",
    })}\n${codexTokenCount("2026-08-10T12:04:31Z", second, first, 41)}\n${codexThreadSettings(
      "2026-08-10T12:04:32Z",
    )}\n${codexTokenCount("2026-08-10T12:05:00Z", occupancy, occupancy, 42)}\n${codexTokenCount(
      "2026-08-10T12:06:00Z",
      first,
      first,
      43,
    )}\n${codexTokenCount("2026-08-10T12:07:00Z", second, first, 44)}\n${codexThreadSettings(
      "2026-08-10T12:08:00Z",
    )}\n`,
  );

  const result = await collectCodexSessionUsage(
    { dataPath: root },
    { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" },
  );
  assert.deepEqual(result.entries, []);
  assert.deepEqual(result.warnings, ["codex_session_components_incomplete"]);
});

test("recovers Codex lineage after first seeing an empty rollout", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-empty-rollout-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  const parentPath = join(directory, "parent.jsonl");
  const childPath = join(directory, "child.jsonl");
  await mkdir(directory, { recursive: true });
  const parentId = "17171717-1717-4717-8717-171717171717";
  const childId = "18181818-1818-4818-8818-181818181818";
  const inherited = {
    input_tokens: 10,
    cached_input_tokens: 3,
    cache_write_input_tokens: 2,
    output_tokens: 8,
    reasoning_output_tokens: 3,
    total_tokens: 18,
  };
  const childLast = {
    input_tokens: 5,
    cached_input_tokens: 1,
    cache_write_input_tokens: 0,
    output_tokens: 4,
    reasoning_output_tokens: 1,
    total_tokens: 9,
  };
  await writeFile(
    parentPath,
    `${codexSessionMeta(parentId)}\n${codexTokenCount("2026-08-10T12:00:00Z", inherited)}\n`,
  );
  await writeFile(childPath, "");
  const range = { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" };

  const pending = await collectCodexSessionUsage({ dataPath: root }, range);
  assert.deepEqual(pending.entries, []);
  assert.deepEqual(pending.warnings, ["codex_session_components_incomplete"]);
  assert.equal(pending.nextState.files[childPath].sessionContext.complete, false);

  await writeFile(
    childPath,
    `${codexSessionMeta(childId, {
      forkedFromId: parentId,
      timestamp: "2026-08-10T12:00:30Z",
    })}\n${codexTokenCount(
      "2026-08-10T12:00:31Z",
      inherited,
      inherited,
      41,
    )}\n${codexThreadSettings("2026-08-10T12:00:32Z")}\n${codexTokenCount(
      "2026-08-10T12:01:00Z",
      {
        input_tokens: 15,
        cached_input_tokens: 4,
        cache_write_input_tokens: 2,
        output_tokens: 12,
        reasoning_output_tokens: 4,
        total_tokens: 27,
      },
      childLast,
      42,
    )}\n`,
  );
  const recovered = await collectCodexSessionUsage({ dataPath: root }, range, pending.nextState);
  assert.deepEqual(recovered.warnings, []);
  assert.equal(recovered.entries[0].totalTokens, "27");
  assert.equal(recovered.nextState.files[childPath].sessionContext.complete, true);
  assert.notEqual(recovered.nextState.files[childPath].sessionContext.rolloutKey, null);
});

test("recovers Codex lineage after first seeing an incomplete SessionMeta line", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-partial-session-meta-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  const parentPath = join(directory, "parent.jsonl");
  const childPath = join(directory, "child.jsonl");
  await mkdir(directory, { recursive: true });
  const parentId = "21212121-2121-4121-8121-212121212121";
  const childId = "23232323-2323-4323-8323-232323232323";
  const inherited = {
    input_tokens: 10,
    cached_input_tokens: 3,
    cache_write_input_tokens: 2,
    output_tokens: 8,
    reasoning_output_tokens: 3,
    total_tokens: 18,
  };
  const childMeta = codexSessionMeta(childId, {
    forkedFromId: parentId,
    timestamp: "2026-08-10T12:00:30Z",
  });
  const splitAt = childMeta.length - 7;
  await writeFile(
    parentPath,
    `${codexSessionMeta(parentId)}\n${codexTokenCount("2026-08-10T12:00:00Z", inherited)}\n`,
  );
  await writeFile(childPath, childMeta.slice(0, splitAt));
  const range = { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" };

  const pending = await collectCodexSessionUsage({ dataPath: root }, range);
  assert.deepEqual(pending.entries, []);
  assert.deepEqual(pending.warnings, ["codex_session_components_incomplete"]);
  assert.equal(pending.nextState.files[childPath].safeOffset, 0);
  assert.equal(pending.nextState.files[childPath].sessionContext.complete, false);

  await appendFile(
    childPath,
    `${childMeta.slice(splitAt)}\n${codexTokenCount(
      "2026-08-10T12:00:31Z",
      inherited,
      inherited,
      41,
    )}\n${codexThreadSettings("2026-08-10T12:00:32Z")}\n${codexTokenCount(
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
      42,
    )}\n`,
  );
  const recovered = await collectCodexSessionUsage({ dataPath: root }, range, pending.nextState);
  assert.deepEqual(recovered.warnings, []);
  assert.equal(recovered.entries[0].totalTokens, "27");
  assert.equal(recovered.nextState.files[childPath].sessionContext.complete, true);
  assert.notEqual(recovered.nextState.files[childPath].sessionContext.forkParentThreadKey, null);
});

test("deduplicates inherited token sequences through a fork-of-fork lineage", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-fork-chain-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  await mkdir(directory, { recursive: true });
  const rootId = "31313131-3131-4131-8131-313131313131";
  const childId = "32323232-3232-4232-8232-323232323232";
  const grandchildId = "34343434-3434-4434-8434-343434343434";
  const usages = [
    {
      input_tokens: 10,
      cached_input_tokens: 3,
      cache_write_input_tokens: 2,
      output_tokens: 8,
      reasoning_output_tokens: 3,
      total_tokens: 18,
    },
    {
      input_tokens: 15,
      cached_input_tokens: 4,
      cache_write_input_tokens: 2,
      output_tokens: 12,
      reasoning_output_tokens: 4,
      total_tokens: 27,
    },
    {
      input_tokens: 20,
      cached_input_tokens: 5,
      cache_write_input_tokens: 2,
      output_tokens: 16,
      reasoning_output_tokens: 5,
      total_tokens: 36,
    },
  ];
  const last = {
    input_tokens: 5,
    cached_input_tokens: 1,
    cache_write_input_tokens: 0,
    output_tokens: 4,
    reasoning_output_tokens: 1,
    total_tokens: 9,
  };
  await writeFile(
    join(directory, "root.jsonl"),
    `${codexSessionMeta(rootId)}\n${codexTokenCount("2026-08-10T12:00:00Z", usages[0])}\n`,
  );
  await writeFile(
    join(directory, codexRolloutName(childId, childId, "2026-08-10T12-00-02")),
    `${codexSessionMeta(childId, { forkedFromId: rootId })}\n${codexTokenCount(
      "2026-08-10T12:00:05Z",
      usages[0],
      usages[0],
      41,
    )}\n${codexThreadSettings()}\n${codexTokenCount(
      "2026-08-10T12:01:00Z",
      usages[1],
      last,
      42,
    )}\n`,
  );
  await writeFile(
    join(directory, "grandchild.jsonl"),
    `${codexSessionMeta(grandchildId, {
      forkedFromId: childId,
      timestamp: "2026-08-10T12:01:10Z",
    })}\n${codexTokenCount(
      "2026-08-10T12:00:10Z",
      usages[0],
      usages[0],
      81,
    )}\n${codexThreadSettings()}\n${codexTokenCount(
      "2026-08-10T12:01:05Z",
      usages[1],
      last,
      82,
    )}\n${codexThreadSettings("2026-08-10T12:01:30Z")}\n${codexTokenCount(
      "2026-08-10T12:02:00Z",
      usages[2],
      last,
      83,
    )}\n`,
  );

  const result = await collectCodexSessionUsage(
    { dataPath: root },
    { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" },
  );
  assert.deepEqual(result.warnings, []);
  assert.equal(result.entries[0].totalTokens, "36");
});

test("fails closed when a copied Codex fork's parent rollout is unavailable", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-missing-parent-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "child.jsonl"),
    `${codexSessionMeta("35353535-3535-4535-8535-353535353535", {
      forkedFromId: "36363636-3636-4636-8636-363636363636",
    })}\n${codexTokenCount("2026-08-10T12:00:00Z", {
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
  assert.deepEqual(result.entries, []);
  assert.deepEqual(result.warnings, ["codex_session_components_incomplete"]);
});

test("counts identical token counters from independent Codex sessions", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-independent-sessions-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  await mkdir(directory, { recursive: true });
  const usage = {
    input_tokens: 10,
    cached_input_tokens: 3,
    cache_write_input_tokens: 2,
    output_tokens: 8,
    reasoning_output_tokens: 3,
    total_tokens: 18,
  };
  for (const [name, id] of [
    ["first", "33333333-3333-4333-8333-333333333333"],
    ["second", "44444444-4444-4444-8444-444444444444"],
  ])
    await writeFile(
      join(directory, `${name}.jsonl`),
      `${codexSessionMeta(id)}\n${codexTokenCount("2026-08-10T12:00:00Z", usage)}\n`,
    );

  const result = await collectCodexSessionUsage(
    { dataPath: root },
    { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" },
  );
  assert.deepEqual(result.warnings, []);
  assert.equal(result.entries[0].totalTokens, "36");
});

test("counts identical post-fork counters on both divergent branches", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-divergent-fork-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  await mkdir(directory, { recursive: true });
  const parentId = "45454545-4545-4545-8545-454545454545";
  const childId = "46464646-4646-4646-8646-464646464646";
  const inherited = {
    input_tokens: 10,
    cached_input_tokens: 3,
    cache_write_input_tokens: 2,
    output_tokens: 8,
    reasoning_output_tokens: 3,
    total_tokens: 18,
  };
  const afterFork = {
    input_tokens: 15,
    cached_input_tokens: 4,
    cache_write_input_tokens: 2,
    output_tokens: 12,
    reasoning_output_tokens: 4,
    total_tokens: 27,
  };
  const last = {
    input_tokens: 5,
    cached_input_tokens: 1,
    cache_write_input_tokens: 0,
    output_tokens: 4,
    reasoning_output_tokens: 1,
    total_tokens: 9,
  };
  await writeFile(
    join(directory, "parent.jsonl"),
    `${codexSessionMeta(parentId)}\n${codexTokenCount(
      "2026-08-10T12:00:00Z",
      inherited,
    )}\n${codexTokenCount("2026-08-10T12:02:00Z", afterFork, last, 2)}\n`,
  );
  await writeFile(
    join(directory, "child.jsonl"),
    `${codexSessionMeta(childId, {
      forkedFromId: parentId,
      timestamp: "2026-08-10T12:01:00Z",
    })}\n${codexTokenCount(
      "2026-08-10T12:01:05Z",
      inherited,
      inherited,
      41,
    )}\n${codexThreadSettings()}\n${codexTokenCount(
      "2026-08-10T12:02:05Z",
      afterFork,
      last,
      42,
    )}\n`,
  );

  const result = await collectCodexSessionUsage(
    { dataPath: root },
    { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" },
  );
  assert.deepEqual(result.warnings, []);
  assert.equal(result.entries[0].totalTokens, "36");
});

test("counts a paginated child's first own TokenCount even when it matches its parent", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-paginated-fork-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  await mkdir(directory, { recursive: true });
  const parentId = "66666666-6666-4666-8666-666666666666";
  const childId = "55555555-5555-4555-8555-555555555555";
  const inheritedUsage = {
    input_tokens: 10,
    cached_input_tokens: 3,
    cache_write_input_tokens: 2,
    output_tokens: 8,
    reasoning_output_tokens: 3,
    total_tokens: 18,
  };
  await writeFile(
    join(directory, "parent.jsonl"),
    `${codexSessionMeta(parentId)}\n${codexTokenCount("2026-08-10T12:00:00Z", inheritedUsage)}\n`,
  );
  await writeFile(
    join(directory, codexRolloutName(childId, childId, "2026-08-10T12-00-02")),
    `${[
      codexSessionMeta(childId, {
        forkedFromId: parentId,
        historyMode: "paginated",
        subagentHistoryStartOrdinal: 2,
      }),
      codexThreadSettings(),
      codexTokenCount("2026-08-10T12:01:00Z", inheritedUsage, inheritedUsage, 2),
    ].join("\n")}\n`,
  );

  const result = await collectCodexSessionUsage(
    { dataPath: root },
    { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" },
  );
  assert.deepEqual(result.warnings, []);
  assert.equal(result.entries[0].totalTokens, "36");
});

test("keeps identical provider calls distinct across immutable thread revert rollouts", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-revert-lineage-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  const archivedDirectory = join(root, "archived_sessions");
  await mkdir(directory, { recursive: true });
  await mkdir(archivedDirectory, { recursive: true });
  const threadId = "41414141-4141-4141-8141-414141414141";
  const firstRevertId = "42424242-4242-4242-8242-424242424242";
  const secondRevertId = "43434343-4343-4343-8343-434343434343";
  const usage = {
    input_tokens: 10,
    cached_input_tokens: 3,
    cache_write_input_tokens: 2,
    output_tokens: 8,
    reasoning_output_tokens: 3,
    total_tokens: 18,
  };
  const historyBase = (rolloutId, endOrdinalExclusive) => ({
    thread_id: rolloutId,
    end_ordinal_exclusive: endOrdinalExclusive,
    end_byte_offset: 512,
  });
  const originalPath = join(directory, codexRolloutName(threadId, threadId, "2026-08-10T12-00-00"));
  const firstRevertPath = join(
    directory,
    codexRolloutName(threadId, firstRevertId, "2026-08-10T12-01-00"),
  );
  const secondRevertName = codexRolloutName(threadId, secondRevertId, "2026-08-10T12-02-00");
  const secondRevertPath = join(directory, secondRevertName);
  const original = `${codexSessionMeta(threadId, {
    historyMode: "paginated",
    timestamp: "2026-08-10T12:00:00Z",
  })}\n${codexTokenCount("2026-08-10T12:00:01Z", usage, usage, 1)}\n`;
  const firstRevert = `${codexSessionMeta(threadId, {
    historyBase: historyBase(threadId, 2),
    historyMode: "paginated",
    timestamp: "2026-08-10T12:01:00Z",
  })}\n${codexTokenCount("2026-08-10T12:01:01Z", usage, usage, 3)}\n`;
  const secondRevert = `${codexSessionMeta(threadId, {
    historyBase: historyBase(firstRevertId, 4),
    historyMode: "paginated",
    timestamp: "2026-08-10T12:02:00Z",
  })}\n${codexTokenCount("2026-08-10T12:02:01Z", usage, usage, 5)}\n`;
  await writeFile(originalPath, original);
  await writeFile(firstRevertPath, firstRevert);
  await writeFile(secondRevertPath, secondRevert);
  const range = { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" };

  const initial = await collectCodexSessionUsage({ dataPath: root }, range);
  assert.deepEqual(initial.warnings, []);
  assert.equal(initial.entries[0].totalTokens, "54");
  const contexts = Object.values(initial.nextState.files).map((file) => file.sessionContext);
  assert.equal(new Set(contexts.map((item) => item.threadKey)).size, 1);
  assert.equal(new Set(contexts.map((item) => item.rolloutKey)).size, 3);

  const compressedFirstRevertPath = `${firstRevertPath}.zst`;
  await writeFile(compressedFirstRevertPath, zstdCompressSync(Buffer.from(firstRevert)));
  const representedTwice = await collectCodexSessionUsage(
    { dataPath: root },
    range,
    initial.nextState,
  );
  assert.deepEqual(representedTwice.warnings, []);
  assert.equal(representedTwice.entries[0].totalTokens, "54");

  const archivedSecondRevertPath = join(archivedDirectory, secondRevertName);
  await rename(secondRevertPath, archivedSecondRevertPath);
  const archived = await collectCodexSessionUsage(
    { dataPath: root },
    range,
    representedTwice.nextState,
  );
  assert.deepEqual(archived.warnings, []);
  assert.equal(archived.entries[0].totalTokens, "54");
  assert.equal(
    archived.nextState.files[archivedSecondRevertPath].sessionContext.rolloutKey,
    initial.nextState.files[secondRevertPath].sessionContext.rolloutKey,
  );
});

test("fails closed when a paginated rollout filename is noncanonical", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-revert-ambiguous-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  await mkdir(directory, { recursive: true });
  const threadId = "44444444-4444-4444-8444-444444444444";
  const usage = {
    input_tokens: 10,
    cached_input_tokens: 3,
    cache_write_input_tokens: 2,
    output_tokens: 8,
    reasoning_output_tokens: 3,
    total_tokens: 18,
  };
  await writeFile(
    join(directory, codexRolloutName(threadId, threadId)),
    `${codexSessionMeta(threadId, {
      historyMode: "paginated",
    })}\n${codexTokenCount("2026-08-10T12:00:01Z", usage, usage, 1)}\n`,
  );
  await writeFile(
    join(directory, "noncanonical-revert.jsonl"),
    `${codexSessionMeta(threadId, {
      historyMode: "paginated",
      timestamp: "2026-08-10T12:01:00Z",
    })}\n${codexTokenCount("2026-08-10T12:01:01Z", usage, usage, 1)}\n`,
  );
  const result = await collectCodexSessionUsage(
    { dataPath: root },
    { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" },
  );
  assert.deepEqual(result.entries, []);
  assert.deepEqual(result.warnings, ["codex_session_components_incomplete"]);
});

test("fails closed when a revert rollout suffix contradicts legacy metadata", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-revert-legacy-metadata-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  await mkdir(directory, { recursive: true });
  const threadId = "48484848-4848-4848-8848-484848484848";
  const rolloutId = "49494949-4949-4949-8949-494949494949";
  const usage = {
    input_tokens: 10,
    cached_input_tokens: 3,
    cache_write_input_tokens: 2,
    output_tokens: 8,
    reasoning_output_tokens: 3,
    total_tokens: 18,
  };
  const contents = `${codexSessionMeta(threadId, {
    historyMode: "legacy",
  })}\n${codexTokenCount("2026-08-10T12:00:01Z", usage)}\n`;
  await writeFile(join(directory, codexRolloutName(threadId, threadId)), contents);
  await writeFile(
    join(directory, codexRolloutName(threadId, rolloutId, "2026-08-10T12-01-00")),
    contents,
  );

  const result = await collectCodexSessionUsage(
    { dataPath: root },
    { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" },
  );
  assert.deepEqual(result.entries, []);
  assert.deepEqual(result.warnings, ["codex_session_components_incomplete"]);
});

test("fails closed when history_base targets a missing rollout of an existing thread", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-revert-missing-base-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  await mkdir(directory, { recursive: true });
  const threadId = "45454545-4545-4545-8545-454545454545";
  const missingRolloutId = "46464646-4646-4646-8646-464646464646";
  const revertRolloutId = "47474747-4747-4747-8747-474747474747";
  const usage = {
    input_tokens: 10,
    cached_input_tokens: 3,
    cache_write_input_tokens: 2,
    output_tokens: 8,
    reasoning_output_tokens: 3,
    total_tokens: 18,
  };
  await writeFile(
    join(directory, codexRolloutName(threadId, threadId)),
    `${codexSessionMeta(threadId, {
      historyMode: "paginated",
    })}\n${codexTokenCount("2026-08-10T12:00:01Z", usage, usage, 1)}\n`,
  );
  await writeFile(
    join(directory, codexRolloutName(threadId, revertRolloutId, "2026-08-10T12-01-00")),
    `${codexSessionMeta(threadId, {
      historyBase: {
        thread_id: missingRolloutId,
        end_ordinal_exclusive: 2,
        end_byte_offset: 512,
      },
      historyMode: "paginated",
      timestamp: "2026-08-10T12:01:00Z",
    })}\n${codexTokenCount("2026-08-10T12:01:01Z", usage, usage, 3)}\n`,
  );

  const result = await collectCodexSessionUsage(
    { dataPath: root },
    { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" },
  );
  assert.deepEqual(result.entries, []);
  assert.deepEqual(result.warnings, ["codex_session_components_incomplete"]);
});

test("parses oversized Codex SessionMeta and fails closed when it is malformed", () => {
  const usage = {
    input_tokens: 10,
    cached_input_tokens: 3,
    cache_write_input_tokens: 2,
    output_tokens: 8,
    reasoning_output_tokens: 3,
    total_tokens: 18,
  };
  const oversized = JSON.stringify({
    timestamp: "2026-08-10T11:59:00Z",
    type: "session_meta",
    payload: {
      id: "77777777-7777-4777-8777-777777777777",
      forked_from_id: "88888888-8888-4888-8888-888888888888",
      timestamp: "2026-08-10T11:59:00Z",
      base_instructions: { text: "x".repeat(1_000_001) },
    },
  });
  const oversizedParsed = parseCodexSessionLines([
    oversized,
    codexTokenCount("2026-08-10T12:00:00Z", usage),
  ]);
  assert.equal(oversizedParsed.invalid, false);
  assert.equal(oversizedParsed.sessionContext.rolloutKey !== null, true);
  assert.equal(oversizedParsed.events.length, 1);

  const malformedParsed = parseCodexSessionLines([
    '{"type":"session_meta","payload":',
    codexTokenCount("2026-08-10T12:00:00Z", usage),
  ]);
  assert.equal(malformedParsed.invalid, true);
  assert.equal(malformedParsed.unknownIncomplete, true);
  assert.deepEqual(malformedParsed.events, []);
  assert.equal(malformedParsed.sessionContext.complete, false);

  const invalidLineageParsed = parseCodexSessionLines([
    JSON.stringify({
      timestamp: "2026-08-10T11:59:00Z",
      type: "session_meta",
      payload: {
        id: "99999999-9999-4999-8999-999999999999",
        forked_from_id: 7,
        timestamp: "2026-08-10T11:59:00Z",
      },
    }),
    codexTokenCount("2026-08-10T12:00:00Z", usage),
  ]);
  assert.equal(invalidLineageParsed.invalid, true);
  assert.deepEqual(invalidLineageParsed.events, []);
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
  const contents = `${codexSessionMeta("25252525-2525-4525-8525-252525252525")}\n${codexTokenCount(
    "2026-08-10T12:00:00Z",
    {
      input_tokens: 10,
      cached_input_tokens: 3,
      cache_write_input_tokens: 2,
      output_tokens: 8,
      reasoning_output_tokens: 3,
      total_tokens: 18,
    },
  )}\n`;
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
  const contents = `${codexSessionMeta("26262626-2626-4626-8626-262626262626")}\n${codexTokenCount(
    "2026-08-10T12:00:00Z",
    {
      input_tokens: 10,
      cached_input_tokens: 3,
      cache_write_input_tokens: 2,
      output_tokens: 8,
      reasoning_output_tokens: 3,
      total_tokens: 18,
    },
  )}\n`;
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

test("turns a disappearing compressed Codex rollout into an incomplete warning", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-missing-zstd-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  const path = join(directory, "missing.jsonl.zst");
  await mkdir(directory, { recursive: true });

  const result = await collectCodexSessionUsage(
    { dataPath: root },
    { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" },
    {},
    {
      discover: async () => ({
        files: [{ path, size: 100, modifiedAt: Date.parse("2026-08-10T12:00:00Z") }],
        incomplete: false,
        issues: [],
      }),
    },
  );
  assert.deepEqual(result.entries, []);
  assert.deepEqual(result.warnings, ["codex_session_components_incomplete"]);
});

test("blocks intermediate dates between path and mtime evidence for a skipped rollout", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-range-gap-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const sessions = join(root, "sessions");
  const validPath = join(sessions, "2026", "08", "11", "valid.jsonl");
  const skippedPath = join(sessions, "2026", "08", "10", "oversized.jsonl");
  const contents = `${codexTokenCount("2026-08-11T12:00:00Z", {
    input_tokens: 10,
    cached_input_tokens: 3,
    cache_write_input_tokens: 2,
    output_tokens: 8,
    reasoning_output_tokens: 3,
    total_tokens: 18,
  })}\n`;
  await mkdir(join(sessions, "2026", "08", "11"), { recursive: true });
  await writeFile(validPath, contents);

  const result = await collectCodexSessionUsage(
    { dataPath: root },
    { rangeStart: "2026-08-09", rangeEnd: "2026-08-13" },
    {},
    {
      discover: async () => ({
        files: [
          {
            path: validPath,
            size: Buffer.byteLength(contents),
            modifiedAt: Date.parse("2026-08-11T12:00:00Z"),
          },
        ],
        incomplete: true,
        issues: [
          {
            path: skippedPath,
            size: 100_000_001,
            modifiedAt: Date.parse("2026-08-12T12:00:00Z"),
            reason: "oversized",
          },
        ],
      }),
    },
  );
  assert.deepEqual(result.entries, []);
  assert.deepEqual(result.warnings, ["codex_session_components_incomplete"]);
});

test("uses descendant file state when a Codex session directory becomes unreadable", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-directory-state-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08");
  const path = join(directory, "rollout.jsonl");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path,
    `${codexSessionMeta("27272727-2727-4727-8727-272727272727")}\n${codexTokenCount(
      "2026-08-10T12:00:00Z",
      {
        input_tokens: 10,
        cached_input_tokens: 3,
        cache_write_input_tokens: 2,
        output_tokens: 8,
        reasoning_output_tokens: 3,
        total_tokens: 18,
      },
    )}\n${codexTokenCount("2026-08-12T12:00:00Z", {
      input_tokens: 12,
      cached_input_tokens: 3,
      cache_write_input_tokens: 2,
      output_tokens: 9,
      reasoning_output_tokens: 3,
      total_tokens: 21,
    })}\n`,
  );
  const range = { rangeStart: "2026-08-09", rangeEnd: "2026-08-13" };
  const first = await collectCodexSessionUsage({ dataPath: root }, range);
  const unreadable = await collectCodexSessionUsage({ dataPath: root }, range, first.nextState, {
    discover: async () => ({
      files: [],
      incomplete: true,
      issues: [{ path: directory, reason: "unreadable" }],
    }),
  });

  assert.deepEqual(unreadable.entries, []);
  assert.deepEqual(unreadable.warnings, ["codex_session_components_incomplete"]);
  assert.deepEqual(unreadable.nextState.files, first.nextState.files);
  assert.deepEqual(unreadable.nextState.events, first.nextState.events);
});

test("omits all Codex components when the bounded scan skips a session file", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-component-budget-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  await mkdir(directory, { recursive: true });
  const first = `${codexSessionMeta("28282828-2828-4828-8828-282828282828")}\n${codexTokenCount(
    "2026-08-10T12:00:00Z",
    {
      input_tokens: 10,
      cached_input_tokens: 3,
      cache_write_input_tokens: 2,
      output_tokens: 8,
      reasoning_output_tokens: 3,
      total_tokens: 18,
    },
  )}\n`;
  const second = `${codexSessionMeta("29292929-2929-4929-8929-292929292928")}\n${codexTokenCount(
    "2026-08-10T12:01:00Z",
    {
      input_tokens: 12,
      cached_input_tokens: 3,
      cache_write_input_tokens: 2,
      output_tokens: 9,
      reasoning_output_tokens: 3,
      total_tokens: 21,
    },
  )}\n`;
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
    `${codexSessionMeta("30303030-3030-4030-8030-303030303030")}\n${codexTokenCount(
      "2026-08-10T12:00:00Z",
      {
        input_tokens: 10,
        cached_input_tokens: 3,
        cache_write_input_tokens: 2,
        output_tokens: 8,
        reasoning_output_tokens: 3,
        total_tokens: 18,
      },
    )}\n`,
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
  const valid = `${codexSessionMeta("37373737-3737-4737-8737-373737373737")}\n${codexTokenCount(
    "2026-08-10T12:00:00Z",
    {
      input_tokens: 10,
      cached_input_tokens: 3,
      cache_write_input_tokens: 2,
      output_tokens: 8,
      reasoning_output_tokens: 3,
      total_tokens: 18,
    },
  )}\n`;
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
    `${codexSessionMeta("38383838-3838-4838-8838-383838383838", {
      timestamp: "2025-01-01T11:59:00Z",
    })}\n${codexTokenCount("2025-01-01T12:00:00Z", {
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
    `${codexSessionMeta("39393939-3939-4939-8939-393939393939")}\n${codexTokenCount(
      "2026-08-10T12:00:00Z",
      {
        input_tokens: 10,
        cached_input_tokens: 3,
        cache_write_input_tokens: 2,
        output_tokens: 8,
        reasoning_output_tokens: 3,
        total_tokens: 18,
      },
    )}\n`,
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

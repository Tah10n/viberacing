import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFile,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zstdCompressSync } from "node:zlib";
import {
  collectClaude,
  collectCodexSessionUsage,
  codexUsageSnapshot,
  codexTotalOnlyEntries,
  deriveCodexProviderAccountKey,
  materializeCodexAuthoritativeDays,
  parseClaudeLines,
  parseAntigravityLines,
  parseCodexUsage,
  parseCodexAccountRead,
  parseCodexAuthIdentity,
  parseCodexProviderAccount,
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
  entriesWithinRange,
  safeCaptureRecord,
  readCodexAuthIdentity,
  wrapperInvocation,
} from "../lib/readers.mjs";
import { jsonLinesChunk } from "../lib/adapters/shared.mjs";

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
      source: options.sessionSource ?? "cli",
      ...(options.forkedFromId ? { forked_from_id: options.forkedFromId } : {}),
      ...(options.historyBase ? { history_base: options.historyBase } : {}),
      ...(options.historyMode ? { history_mode: options.historyMode } : {}),
      ...(options.subagentHistoryStartOrdinal === undefined
        ? {}
        : { subagent_history_start_ordinal: options.subagentHistoryStartOrdinal }),
    },
  });
}

function codexSubagentSource(parentThreadId) {
  return { subagent: { thread_spawn: { parent_thread_id: parentThreadId, depth: 1 } } };
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

test("keeps the exact local Codex tail until delayed authoritative buckets arrive", () => {
  const current = {
    date: "2026-08-12",
    totalTokens: "27",
    inputTokens: "9",
    outputTokens: "8",
    cacheReadTokens: "4",
    cacheWriteTokens: "2",
    reasoningTokens: "4",
  };
  assert.deepEqual(
    codexUsageSnapshot(
      [{ date: "2026-08-10", totalTokens: "18" }],
      [
        {
          ...current,
          date: "2026-08-11",
          totalTokens: "7",
        },
        current,
      ],
      "2026-08-12",
    ),
    {
      completeness: "partial",
      entries: [
        { date: "2026-08-10", totalTokens: "18", completeness: "complete" },
        {
          ...current,
          date: "2026-08-11",
          totalTokens: "7",
          completeness: "partial",
        },
        { ...current, completeness: "partial" },
      ],
    },
  );
});

test("retains every provisional Codex day across a UTC rollover", () => {
  const component = (date, totalTokens) => ({
    date,
    totalTokens,
    inputTokens: totalTokens,
    outputTokens: "0",
    cacheReadTokens: "0",
    cacheWriteTokens: "0",
    reasoningTokens: "0",
  });
  const authoritative = [{ date: "2026-08-20", totalTokens: "10" }];
  assert.deepEqual(
    codexUsageSnapshot(authoritative, [component("2026-08-21", "11")], "2026-08-21"),
    {
      completeness: "partial",
      entries: [
        { date: "2026-08-20", totalTokens: "10", completeness: "complete" },
        { ...component("2026-08-21", "11"), completeness: "partial" },
      ],
    },
  );
  assert.deepEqual(
    codexUsageSnapshot(
      authoritative,
      [component("2026-08-21", "11"), component("2026-08-22", "12")],
      "2026-08-22",
    ),
    {
      completeness: "partial",
      entries: [
        { date: "2026-08-20", totalTokens: "10", completeness: "complete" },
        { ...component("2026-08-21", "11"), completeness: "partial" },
        { ...component("2026-08-22", "12"), completeness: "partial" },
      ],
    },
  );
});

test("materializes complete zero corrections inside the Codex authoritative range", () => {
  const component = (date, totalTokens) => ({
    date,
    totalTokens,
    inputTokens: totalTokens,
    outputTokens: "0",
    cacheReadTokens: "0",
    cacheWriteTokens: "0",
    reasoningTokens: "0",
  });
  assert.deepEqual(
    codexUsageSnapshot(
      [
        { date: "2026-08-20", totalTokens: "10" },
        { date: "2026-08-22", totalTokens: "12" },
      ],
      [component("2026-08-21", "11"), component("2026-08-23", "13")],
      "2026-08-23",
    ),
    {
      completeness: "partial",
      entries: [
        { date: "2026-08-20", totalTokens: "10", completeness: "complete" },
        { ...component("2026-08-21", "11"), totalTokens: "0", completeness: "complete" },
        { date: "2026-08-22", totalTokens: "12", completeness: "complete" },
        { ...component("2026-08-23", "13"), completeness: "partial" },
      ],
    },
  );
});

test("materializes Codex authoritative zeros across a UTC month rollover", () => {
  assert.deepEqual(
    materializeCodexAuthoritativeDays(
      [
        { date: "2026-08-30", totalTokens: "10" },
        { date: "2026-09-01", totalTokens: "12" },
      ],
      "2026-08-30",
      "2026-09-02",
    ),
    [
      { date: "2026-08-30", totalTokens: "10" },
      { date: "2026-08-31", totalTokens: "0" },
      { date: "2026-09-01", totalTokens: "12" },
    ],
  );
});

test("does not extend Codex authoritative zeros before the first returned bucket", () => {
  assert.deepEqual(
    codexUsageSnapshot(
      [
        { date: "2026-08-30", totalTokens: "10" },
        { date: "2026-09-01", totalTokens: "12" },
      ],
      [],
      "2026-09-02",
    ),
    {
      completeness: "partial",
      entries: [
        { date: "2026-08-30", totalTokens: "10", completeness: "complete" },
        { date: "2026-08-31", totalTokens: "0", completeness: "complete" },
        { date: "2026-09-01", totalTokens: "12", completeness: "complete" },
      ],
    },
  );
});

test("does not invent Codex zeros without a proven complete authoritative range", () => {
  assert.deepEqual(materializeCodexAuthoritativeDays([], "2026-08-30", "2026-09-02"), []);
  assert.deepEqual(
    materializeCodexAuthoritativeDays(
      [{ date: "2026-09-01", totalTokens: "12" }],
      "2026-08-30",
      "2026-09-02",
      false,
    ),
    [{ date: "2026-09-01", totalTokens: "12" }],
  );
});

test("prefers the Codex account total once the current UTC bucket is available", () => {
  const current = {
    date: "2026-08-12",
    totalTokens: "27",
    inputTokens: "9",
    outputTokens: "8",
    cacheReadTokens: "4",
    cacheWriteTokens: "2",
    reasoningTokens: "4",
  };
  assert.deepEqual(
    codexUsageSnapshot([{ date: "2026-08-12", totalTokens: "30" }], [current], "2026-08-12"),
    {
      completeness: "complete",
      entries: [{ ...current, totalTokens: "30" }],
    },
  );
});

test("historical Codex collection keeps authoritative range-end entries explicitly complete", async () => {
  const responses = [
    {
      id: 1,
      result: {
        account: { type: "chatgpt", email: "history@example.com", planType: "pro" },
        requiresOpenaiAuth: false,
      },
    },
    {
      id: 2,
      result: { dailyUsageBuckets: [{ startDate: "2026-08-10", tokens: "80" }] },
    },
    {
      id: 3,
      result: {
        account: { type: "chatgpt", email: "history@example.com", planType: "pro" },
        requiresOpenaiAuth: false,
      },
    },
  ][Symbol.iterator]();
  const result = await adapterFor("codex").collect(
    { dataPath: join(tmpdir(), "missing-codex-history") },
    { rangeStart: "2026-07-11", rangeEnd: "2026-08-10" },
    {},
    {
      historical: true,
      providerIdentitySalt: "local-provider-identity-salt-that-is-long-enough",
      readCodexAuthIdentity: async () => [["account", "stable-history-account"]],
      withCodexAppServer: async (_source, callback) =>
        callback({
          next: async () => ({ value: undefined, done: false, ...responses.next().value }),
          write: () => {},
        }),
    },
  );
  assert.equal(result.completeness, "partial");
  assert.deepEqual(result.entries, [
    { date: "2026-08-10", totalTokens: "80", completeness: "complete" },
  ]);
});

test("Codex total-only projection preserves per-entry completeness", () => {
  assert.deepEqual(
    codexTotalOnlyEntries([
      {
        date: "2026-08-10",
        totalTokens: "80",
        inputTokens: "40",
        outputTokens: "40",
        completeness: "complete",
      },
      { date: "2026-08-11", totalTokens: "5" },
    ]),
    [
      { date: "2026-08-10", totalTokens: "80", completeness: "complete" },
      { date: "2026-08-11", totalTokens: "5" },
    ],
  );
});

test("keeps a Codex snapshot partial while the current UTC bucket is unavailable", () => {
  assert.deepEqual(
    codexUsageSnapshot([{ date: "2026-08-11", totalTokens: "18" }], [], "2026-08-12"),
    {
      completeness: "partial",
      entries: [{ date: "2026-08-11", totalTokens: "18", completeness: "complete" }],
    },
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

test("fails closed when a tokenless historical prefix matches a later parent call", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-tokenless-prefix-match-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  await mkdir(directory, { recursive: true });
  const parentId = "41414141-4141-4141-8141-414141414141";
  const childId = "42424242-4242-4242-8242-424242424242";
  const usage = {
    input_tokens: 5,
    cached_input_tokens: 1,
    cache_write_input_tokens: 0,
    output_tokens: 4,
    reasoning_output_tokens: 1,
    total_tokens: 9,
  };
  await writeFile(
    join(directory, "parent.jsonl"),
    `${codexSessionMeta(parentId)}\n${codexThreadSettings(
      "2026-08-10T12:00:00Z",
    )}\n${codexThreadSettings("2026-08-10T12:01:00Z")}\n${codexTokenCount(
      "2026-08-10T12:02:00Z",
      usage,
      usage,
      1,
    )}\n`,
  );
  await writeFile(
    join(directory, "child.jsonl"),
    `${codexSessionMeta(childId, {
      forkedFromId: parentId,
      timestamp: "2026-08-10T12:03:00Z",
    })}\n${codexThreadSettings("2026-08-10T12:00:00Z")}\n${codexThreadSettings(
      "2026-08-10T12:03:01Z",
    )}\n${codexTokenCount("2026-08-10T12:04:00Z", usage, usage, 41)}\n${codexThreadSettings(
      "2026-08-10T12:05:00Z",
    )}\n`,
  );

  const result = await collectCodexSessionUsage(
    { dataPath: root },
    { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" },
  );
  assert.deepEqual(result.entries, []);
  assert.deepEqual(result.warnings, ["codex_session_components_incomplete"]);
  assert.deepEqual(result.diagnostics, [{ code: "codex_lineage_ambiguous", phase: "collect" }]);
});

test("counts both calls when a tokenless historical prefix has distinct child usage", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-tokenless-prefix-distinct-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  await mkdir(directory, { recursive: true });
  const parentId = "43434343-4343-4343-8343-434343434343";
  const childId = "44444444-4444-4444-8444-444444444444";
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
  await writeFile(
    join(directory, "parent.jsonl"),
    `${codexSessionMeta(parentId)}\n${codexThreadSettings(
      "2026-08-10T12:00:00Z",
    )}\n${codexThreadSettings("2026-08-10T12:01:00Z")}\n${codexTokenCount(
      "2026-08-10T12:02:00Z",
      first,
      first,
      1,
    )}\n`,
  );
  await writeFile(
    join(directory, "child.jsonl"),
    `${codexSessionMeta(childId, {
      forkedFromId: parentId,
      timestamp: "2026-08-10T12:03:00Z",
    })}\n${codexThreadSettings("2026-08-10T12:00:00Z")}\n${codexThreadSettings(
      "2026-08-10T12:03:01Z",
    )}\n${codexTokenCount("2026-08-10T12:04:00Z", second, second, 41)}\n${codexThreadSettings(
      "2026-08-10T12:05:00Z",
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
      totalTokens: "27",
      inputTokens: "12",
      outputTokens: "9",
      cacheReadTokens: "3",
      cacheWriteTokens: "0",
      reasoningTokens: "3",
    },
  ]);
});

test("fails closed when a tokenless suffix omits a matching parent tail boundary", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-tokenless-tail-boundary-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  await mkdir(directory, { recursive: true });
  const parentId = "45454545-4545-4545-8545-454545454545";
  const childId = "46464646-4646-4646-8646-464646464646";
  const usage = {
    input_tokens: 5,
    cached_input_tokens: 1,
    cache_write_input_tokens: 0,
    output_tokens: 4,
    reasoning_output_tokens: 1,
    total_tokens: 9,
  };
  await writeFile(
    join(directory, "parent.jsonl"),
    `${codexSessionMeta(parentId)}\n${codexThreadSettings(
      "2026-08-10T12:00:00Z",
    )}\n${codexTokenCount("2026-08-10T12:01:00Z", usage, usage, 1)}\n${codexThreadSettings(
      "2026-08-10T12:02:00Z",
    )}\n`,
  );
  await writeFile(
    join(directory, "child.jsonl"),
    `${codexSessionMeta(childId, {
      forkedFromId: parentId,
      sessionSource: codexSubagentSource(parentId),
      timestamp: "2026-08-10T12:03:00Z",
    })}\n${codexThreadSettings("2026-08-10T12:03:01Z")}\n${codexTokenCount(
      "2026-08-10T12:04:00Z",
      usage,
      usage,
      41,
    )}\n${codexThreadSettings("2026-08-10T12:05:00Z")}\n${codexThreadSettings(
      "2026-08-10T12:06:00Z",
    )}\n`,
  );

  const result = await collectCodexSessionUsage(
    { dataPath: root },
    { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" },
  );
  assert.deepEqual(result.entries, []);
  assert.deepEqual(result.warnings, ["codex_session_components_incomplete"]);
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
      sessionSource: codexSubagentSource(parentId),
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
      sessionSource: codexSubagentSource(rootId),
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
      sessionSource: codexSubagentSource(childId),
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

test("fails closed when a tokenless LastNTurns suffix matches the child's first usage", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-tokenless-suffix-match-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  await mkdir(directory, { recursive: true });
  const parentId = "32323232-3232-4232-8232-323232323232";
  const childId = "33333333-3333-4333-8333-333333333333";
  const usage = {
    input_tokens: 5,
    cached_input_tokens: 1,
    cache_write_input_tokens: 0,
    output_tokens: 4,
    reasoning_output_tokens: 1,
    total_tokens: 9,
  };
  await writeFile(
    join(directory, "parent.jsonl"),
    `${codexSessionMeta(parentId)}\n${codexThreadSettings(
      "2026-08-10T12:00:00Z",
    )}\n${codexTokenCount("2026-08-10T12:01:00Z", usage, usage, 1)}\n`,
  );
  await writeFile(
    join(directory, "child.jsonl"),
    `${codexSessionMeta(childId, {
      forkedFromId: parentId,
      sessionSource: codexSubagentSource(parentId),
      timestamp: "2026-08-10T12:02:00Z",
    })}\n${codexThreadSettings("2026-08-10T12:02:01Z")}\n${codexTokenCount(
      "2026-08-10T12:03:00Z",
      usage,
      usage,
      41,
    )}\n${codexThreadSettings("2026-08-10T12:04:00Z")}\n`,
  );

  const result = await collectCodexSessionUsage(
    { dataPath: root },
    { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" },
  );
  assert.deepEqual(result.entries, []);
  assert.deepEqual(result.warnings, ["codex_session_components_incomplete"]);
});

test("counts both calls when a tokenless LastNTurns suffix has distinct child usage", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-tokenless-suffix-distinct-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  await mkdir(directory, { recursive: true });
  const parentId = "34343434-3434-4434-8434-343434343434";
  const childId = "35353535-3535-4535-8535-353535353535";
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
  await writeFile(
    join(directory, "parent.jsonl"),
    `${codexSessionMeta(parentId)}\n${codexThreadSettings(
      "2026-08-10T12:00:00Z",
    )}\n${codexTokenCount("2026-08-10T12:01:00Z", first, first, 1)}\n`,
  );
  await writeFile(
    join(directory, "child.jsonl"),
    `${codexSessionMeta(childId, {
      forkedFromId: parentId,
      sessionSource: codexSubagentSource(parentId),
      timestamp: "2026-08-10T12:02:00Z",
    })}\n${codexThreadSettings("2026-08-10T12:02:01Z")}\n${codexTokenCount(
      "2026-08-10T12:03:00Z",
      second,
      second,
      41,
    )}\n${codexThreadSettings("2026-08-10T12:04:00Z")}\n`,
  );

  const result = await collectCodexSessionUsage(
    { dataPath: root },
    { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" },
  );
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.entries, [
    {
      date: "2026-08-10",
      totalTokens: "27",
      inputTokens: "12",
      outputTokens: "9",
      cacheReadTokens: "3",
      cacheWriteTokens: "0",
      reasoningTokens: "3",
    },
  ]);
});

test("fails closed when a LastNTurns suffix has only context-window occupancy", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-occupancy-only-suffix-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  await mkdir(directory, { recursive: true });
  const parentId = "36363636-3636-4636-8636-363636363636";
  const childId = "37373737-3737-4737-8737-373737373737";
  const usage = {
    input_tokens: 5,
    cached_input_tokens: 1,
    cache_write_input_tokens: 0,
    output_tokens: 4,
    reasoning_output_tokens: 1,
    total_tokens: 9,
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
    `${codexSessionMeta(parentId)}\n${codexThreadSettings(
      "2026-08-10T12:00:00Z",
    )}\n${codexTokenCount("2026-08-10T12:01:00Z", usage, usage, 1)}\n${codexTokenCount(
      "2026-08-10T12:01:30Z",
      occupancy,
      occupancy,
      2,
    )}\n`,
  );
  await writeFile(
    join(directory, "child.jsonl"),
    `${codexSessionMeta(childId, {
      forkedFromId: parentId,
      sessionSource: codexSubagentSource(parentId),
      timestamp: "2026-08-10T12:02:00Z",
    })}\n${codexTokenCount(
      "2026-08-10T12:01:30Z",
      occupancy,
      occupancy,
      40,
    )}\n${codexThreadSettings("2026-08-10T12:02:01Z")}\n${codexTokenCount(
      "2026-08-10T12:03:00Z",
      usage,
      usage,
      41,
    )}\n${codexThreadSettings("2026-08-10T12:04:00Z")}\n`,
  );

  const result = await collectCodexSessionUsage(
    { dataPath: root },
    { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" },
  );
  assert.deepEqual(result.entries, []);
  assert.deepEqual(result.warnings, ["codex_session_components_incomplete"]);
});

test("fails closed for a tokenless LastNTurns suffix through a fork-of-fork", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-tokenless-suffix-chain-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  await mkdir(directory, { recursive: true });
  const rootId = "38383838-3838-4838-8838-383838383838";
  const childId = "39393939-3939-4939-8939-393939393939";
  const grandchildId = "40404040-4040-4040-8040-404040404040";
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
  await writeFile(
    join(directory, "root.jsonl"),
    `${codexSessionMeta(rootId)}\n${codexThreadSettings(
      "2026-08-10T12:00:00Z",
    )}\n${codexTokenCount("2026-08-10T12:01:00Z", first, first, 1)}\n`,
  );
  await writeFile(
    join(directory, "child.jsonl"),
    `${codexSessionMeta(childId, {
      forkedFromId: rootId,
      sessionSource: codexSubagentSource(rootId),
      timestamp: "2026-08-10T12:02:00Z",
    })}\n${codexTokenCount("2026-08-10T12:01:00Z", first, first, 41)}\n${codexThreadSettings(
      "2026-08-10T12:02:01Z",
    )}\n${codexTokenCount("2026-08-10T12:03:00Z", second, second, 42)}\n`,
  );
  await writeFile(
    join(directory, "grandchild.jsonl"),
    `${codexSessionMeta(grandchildId, {
      forkedFromId: childId,
      sessionSource: codexSubagentSource(childId),
      timestamp: "2026-08-10T12:04:00Z",
    })}\n${codexThreadSettings("2026-08-10T12:04:01Z")}\n${codexTokenCount(
      "2026-08-10T12:05:00Z",
      second,
      second,
      81,
    )}\n${codexThreadSettings("2026-08-10T12:06:00Z")}\n`,
  );

  const result = await collectCodexSessionUsage(
    { dataPath: root },
    { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" },
  );
  assert.deepEqual(result.entries, []);
  assert.deepEqual(result.warnings, ["codex_session_components_incomplete"]);
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

test("fails closed when a prefix boundary precedes a copied token", async (context) => {
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
  assert.deepEqual(recovered.entries, []);
  assert.deepEqual(recovered.warnings, ["codex_session_components_incomplete"]);
});

test("deduplicates a historical legacy thread fork from the parent prefix", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-historical-thread-fork-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  await mkdir(directory, { recursive: true });
  const parentId = "26262626-2626-4626-8626-262626262626";
  const childId = "27272727-2727-4727-8727-272727272727";
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
      ...last,
      input_tokens: 10,
      cached_input_tokens: 2,
      output_tokens: 8,
      reasoning_output_tokens: 2,
      total_tokens: 18,
    },
    {
      ...last,
      input_tokens: 15,
      cached_input_tokens: 3,
      output_tokens: 12,
      reasoning_output_tokens: 3,
      total_tokens: 27,
    },
  ];
  const occupancy = {
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 100,
  };
  const tokenCycle = (startMinute, ordinalBase) =>
    usages
      .map((usage, index) =>
        codexTokenCount(
          `2026-08-10T12:${String(startMinute + index).padStart(2, "0")}:00Z`,
          usage,
          last,
          ordinalBase + index,
        ),
      )
      .join("\n");
  await writeFile(
    join(directory, "parent.jsonl"),
    `${codexSessionMeta(parentId)}\n${tokenCycle(0, 1)}\n${codexTokenCount(
      "2026-08-10T12:03:00Z",
      occupancy,
      occupancy,
      4,
    )}\n${tokenCycle(4, 5)}\n${codexThreadSettings("2026-08-10T12:07:00Z")}\n${codexTokenCount(
      "2026-08-10T12:08:00Z",
      occupancy,
      occupancy,
      8,
    )}\n${tokenCycle(9, 9)}\n${codexThreadSettings("2026-08-10T12:12:00Z")}\n`,
  );
  await writeFile(
    join(directory, "child.jsonl"),
    `${codexSessionMeta(childId, {
      forkedFromId: parentId,
      timestamp: "2026-08-10T12:13:00Z",
    })}\n${tokenCycle(13, 41)}\n${codexThreadSettings(
      "2026-08-10T12:16:00Z",
    )}\n${codexTokenCount("2026-08-10T12:17:00Z", occupancy, occupancy, 44)}\n${tokenCycle(
      18,
      45,
    )}\n${codexThreadSettings("2026-08-10T12:21:00Z")}\n${codexThreadSettings(
      "2026-08-10T12:21:01Z",
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
      totalTokens: "108",
      inputTokens: "48",
      outputTokens: "36",
      cacheReadTokens: "12",
      cacheWriteTokens: "0",
      reasoningTokens: "12",
    },
  ]);
});

test("deduplicates a Guardian legacy fork from its saved parent prefix", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-guardian-prefix-fork-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  await mkdir(directory, { recursive: true });
  const parentId = "30303030-3030-4030-8030-303030303030";
  const childId = "31313131-3131-4131-8131-313131313131";
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
    )}\n${codexThreadSettings("2026-08-10T12:05:00Z")}\n${codexTokenCount(
      "2026-08-10T12:06:00Z",
      occupancy,
      occupancy,
      6,
    )}\n${codexTokenCount("2026-08-10T12:07:00Z", first, first, 7)}\n${codexTokenCount(
      "2026-08-10T12:08:00Z",
      second,
      first,
      8,
    )}\n${codexThreadSettings("2026-08-10T12:09:00Z")}\n`,
  );
  await writeFile(
    join(directory, "child.jsonl"),
    `${codexSessionMeta(childId, {
      forkedFromId: parentId,
      sessionSource: { subagent: { other: "guardian" } },
      timestamp: "2026-08-10T12:10:00Z",
    })}\n${codexTokenCount("2026-08-10T12:10:01Z", first, first, 41)}\n${codexTokenCount(
      "2026-08-10T12:10:02Z",
      second,
      first,
      42,
    )}\n${codexThreadSettings("2026-08-10T12:10:03Z")}\n${codexTokenCount(
      "2026-08-10T12:11:00Z",
      occupancy,
      occupancy,
      43,
    )}\n${codexTokenCount("2026-08-10T12:12:00Z", first, first, 44)}\n${codexTokenCount(
      "2026-08-10T12:13:00Z",
      second,
      first,
      45,
    )}\n${codexThreadSettings("2026-08-10T12:14:00Z")}\n${codexThreadSettings(
      "2026-08-10T12:14:01Z",
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
      totalTokens: "72",
      inputTokens: "32",
      outputTokens: "24",
      cacheReadTokens: "8",
      cacheWriteTokens: "0",
      reasoningTokens: "8",
    },
  ]);
});

test("fails closed for a legacy fork with unknown provenance", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-unknown-fork-provenance-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  await mkdir(directory, { recursive: true });
  const parentId = "28282828-2828-4828-8828-282828282828";
  const childId = "29292929-2929-4929-8929-292929292929";
  const usage = {
    input_tokens: 5,
    cached_input_tokens: 1,
    cache_write_input_tokens: 0,
    output_tokens: 4,
    reasoning_output_tokens: 1,
    total_tokens: 9,
  };
  await writeFile(
    join(directory, "parent.jsonl"),
    `${codexSessionMeta(parentId)}\n${codexTokenCount("2026-08-10T12:00:00Z", usage)}\n`,
  );
  await writeFile(
    join(directory, "child.jsonl"),
    `${codexSessionMeta(childId, {
      forkedFromId: parentId,
      sessionSource: { subagent: { other: "future" } },
    })}\n${codexTokenCount("2026-08-10T12:00:05Z", usage)}\n${codexThreadSettings()}\n`,
  );

  const result = await collectCodexSessionUsage(
    { dataPath: root },
    { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" },
  );
  assert.deepEqual(result.entries, []);
  assert.deepEqual(result.warnings, ["codex_session_components_incomplete"]);
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
      sessionSource: codexSubagentSource(parentId),
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
      sessionSource: codexSubagentSource(parentId),
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
  assert.deepEqual(result.diagnostics, [
    { code: "codex_lineage_parent_missing", phase: "collect" },
  ]);
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
  assert.deepEqual(result.diagnostics, [
    { code: "codex_lineage_parent_missing", phase: "collect" },
  ]);
});

test("classifies an existing conflicting history_base rollout as ambiguous", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-codex-revert-ambiguous-base-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "sessions", "2026", "08", "10");
  await mkdir(directory, { recursive: true });
  const threadId = "56565656-5656-4656-8656-565656565656";
  const parentRolloutId = "57575757-5757-4757-8757-575757575757";
  const childRolloutId = "58585858-5858-4858-8858-585858585858";
  const usage = {
    input_tokens: 10,
    cached_input_tokens: 3,
    cache_write_input_tokens: 2,
    output_tokens: 8,
    reasoning_output_tokens: 3,
    total_tokens: 18,
  };
  const conflictingUsage = { ...usage, input_tokens: 11, total_tokens: 19 };
  for (const [timestamp, value] of [
    ["2026-08-10T12-00-00", usage],
    ["2026-08-10T12-00-01", conflictingUsage],
  ])
    await writeFile(
      join(directory, codexRolloutName(threadId, parentRolloutId, timestamp)),
      `${codexSessionMeta(threadId, { historyMode: "paginated" })}\n${codexTokenCount(
        "2026-08-10T12:00:01Z",
        value,
        value,
        1,
      )}\n`,
    );
  await writeFile(
    join(directory, codexRolloutName(threadId, childRolloutId, "2026-08-10T12-01-00")),
    `${codexSessionMeta(threadId, {
      historyBase: {
        thread_id: parentRolloutId,
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
  assert.deepEqual(result.diagnostics, [{ code: "codex_lineage_ambiguous", phase: "collect" }]);
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
      source: "cli",
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
  assert.deepEqual(unreadable.diagnostics, [{ code: "local_store_unreadable", phase: "collect" }]);
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
  assert.deepEqual(result.diagnostics, [{ code: "local_store_scan_limit", phase: "collect" }]);
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

test("treats a complete JSON record without a final newline as provisional on first scan", async (context) => {
  const range = { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" };
  const cases = [
    {
      agentId: "claude_code",
      name: "session.jsonl",
      record: (await fixture("claude.jsonl")).trim(),
    },
    {
      agentId: "qwen_code",
      name: "token-usage-2026-08.jsonl",
      record: (await fixture("qwen.jsonl")).trim(),
    },
  ];
  for (const item of cases) {
    const directory = await mkdtemp(join(tmpdir(), `viberacing-${item.agentId}-tail-first-`));
    context.after(() => rm(directory, { force: true, recursive: true }));
    await writeFile(join(directory, item.name), item.record);

    const chunk = await jsonLinesChunk(join(directory, item.name));
    assert.equal(chunk.safeOffset, 0, `${item.agentId} safe offset`);
    assert.equal(chunk.tailBytes, Buffer.byteLength(item.record), `${item.agentId} tail bytes`);
    assert.equal(chunk.tail, item.record, `${item.agentId} tail content`);

    const result = await adapterFor(item.agentId).collect({ dataPath: directory }, range, {});

    assert.equal(result.completeness, "partial", item.agentId);
    assert.equal(result.entries.length, 1, item.agentId);
    assert.deepEqual(result.nextState.files, {}, item.agentId);
  }
});

test("keeps committed JSONL state across unterminated append and rewrite", async (context) => {
  const range = { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" };
  const claude = JSON.parse((await fixture("claude.jsonl")).trim());
  const qwen = JSON.parse((await fixture("qwen.jsonl")).trim());
  const cases = [
    {
      agentId: "claude_code",
      name: "session.jsonl",
      first: JSON.stringify(claude),
      appended: JSON.stringify({
        ...claude,
        timestamp: "2026-08-11T12:00:00Z",
        message: { ...claude.message, id: "m2" },
      }),
      rewritten: JSON.stringify({
        ...claude,
        timestamp: "2026-08-12T12:00:00Z",
        message: { ...claude.message, id: "replacement" },
      }),
    },
    {
      agentId: "qwen_code",
      name: "token-usage-2026-08.jsonl",
      first: JSON.stringify(qwen),
      appended: JSON.stringify({ ...qwen, id: "event-2", timestamp: "2026-08-11T12:00:00Z" }),
      rewritten: JSON.stringify({
        ...qwen,
        id: "replacement",
        timestamp: "2026-08-12T12:00:00Z",
      }),
    },
  ];
  for (const item of cases) {
    const directory = await mkdtemp(join(tmpdir(), `viberacing-${item.agentId}-tail-state-`));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const path = join(directory, item.name);
    await writeFile(path, `${item.first}\n`);
    const adapter = adapterFor(item.agentId);
    const first = await adapter.collect({ dataPath: directory }, range, {});

    await appendFile(path, item.appended);
    const appended = await adapter.collect({ dataPath: directory }, range, first.nextState);
    assert.equal(appended.completeness, "partial", `${item.agentId} append`);
    assert.equal(appended.entries.length, 2, `${item.agentId} append provisional entry`);
    assert.deepEqual(appended.nextState, first.nextState, `${item.agentId} append state`);
    assert.ok(
      appended.entries.some((entry) => entry.date === first.entries[0].date),
      `${item.agentId} append retained old daily usage`,
    );

    await writeFile(path, item.rewritten);
    const rewritten = await adapter.collect({ dataPath: directory }, range, first.nextState);
    assert.equal(rewritten.completeness, "partial", `${item.agentId} rewrite`);
    assert.deepEqual(rewritten.entries, first.entries, `${item.agentId} rewrite entries`);
    assert.deepEqual(rewritten.nextState, first.nextState, `${item.agentId} rewrite state`);
  }
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

test("Kimi deduplicates copied session events without merging independent sessions", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-kimi-session-identity-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const first = join(root, "project-a", "session-1", "agents", "main");
  const copied = join(root, "project-b", "session-1", "agents", "main");
  const independent = join(root, "project-a", "session-2", "agents", "main");
  await Promise.all(
    [first, copied, independent].map((directory) => mkdir(directory, { recursive: true })),
  );
  const record = `${(await fixture("kimi.jsonl")).trim().split("\n")[1]}\n`;
  await Promise.all(
    [first, copied, independent].map((directory) =>
      writeFile(join(directory, "wire.jsonl"), record),
    ),
  );

  const result = await adapterFor("kimi_code").collect(
    { dataPath: root, collectionMethod: "kimi_wire_jsonl" },
    { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" },
    {},
  );

  assert.equal(result.completeness, "complete");
  assert.deepEqual(
    result.entries.map(({ totalTokens }) => totalTokens),
    ["40"],
  );
  assert.equal(Object.keys(result.nextState.ledger).length, 2);
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

test("Qwen scans only monthly usage files intersecting the requested range", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-qwen-range-months-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  await writeFile(join(root, "token-usage-2026-07.jsonl"), "not-json\n");
  await writeFile(join(root, "token-usage-2026-08.jsonl"), await fixture("qwen.jsonl"));

  const result = await adapterFor("qwen_code").collect(
    { dataPath: root },
    { rangeStart: "2026-08-01", rangeEnd: "2026-08-31" },
    {},
  );

  assert.equal(result.completeness, "complete");
  assert.deepEqual(
    result.entries.map((entry) => entry.date),
    ["2026-08-10"],
  );
  assert.deepEqual(
    Object.keys(result.nextState.files).map((path) => basename(path)),
    ["token-usage-2026-08.jsonl"],
  );
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
  const refreshed = await adapterFor("qwen_code").collect(source, range, stale);
  assert.equal(refreshed.nextState.parserVersion, 5);
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

test("Antigravity historical capture stays partial even when every retained record is readable", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-antigravity-history-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  await writeFile(
    join(root, "capture.jsonl"),
    `${JSON.stringify({
      date: "2026-08-10",
      id: "capture-1",
      usage: { input_tokens: 10, output_tokens: 5 },
    })}\n`,
  );

  const result = await adapterFor("antigravity").collect(
    { dataPath: root },
    { rangeStart: "2026-08-01", rangeEnd: "2026-08-31" },
    {},
    { historical: true },
  );

  assert.equal(result.completeness, "partial");
  assert.equal(result.entries.length, 1);
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

test("Gemini derives a content-free identity when session records have no ID", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-gemini-fallback-identity-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const native = JSON.parse(await fixture("gemini.json"))[0];
  const { id: _id, ...withoutId } = native;
  const paths = [
    join(root, "project-a", "session-shared.jsonl"),
    join(root, "project-b", "session-shared.jsonl"),
    join(root, "project-a", "session-independent.jsonl"),
  ];
  await Promise.all(paths.map((path) => mkdir(dirname(path), { recursive: true })));
  await Promise.all(paths.map((path) => writeFile(path, `${JSON.stringify(withoutId)}\n`)));

  const result = await adapterFor("gemini_cli").collect(
    { dataPath: root },
    { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" },
    {},
  );

  assert.equal(result.completeness, "complete");
  assert.deepEqual(
    result.entries.map(({ totalTokens }) => totalTokens),
    ["34"],
  );
  assert.equal(Object.keys(result.nextState.ledger).length, 2);
  assert.doesNotMatch(
    JSON.stringify(result.nextState.ledger),
    /session-shared|session-independent/,
  );
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
  assert.deepEqual(
    entriesWithinRange(entries, { rangeStart: "2026-07-14", rangeEnd: "2026-08-13" }),
    entries.slice(1, 3),
  );
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

test("OpenCode marks unsupported assistant usage partial instead of authoritatively clearing days", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "viberacing-opencode-schema-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const path = join(directory, "opencode.db");
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(path);
  database.exec("CREATE TABLE message (id TEXT, time_created INTEGER, data TEXT)");
  database
    .prepare("INSERT INTO message (id, time_created, data) VALUES (?, ?, ?)")
    .run(
      "unsupported-assistant",
      Date.parse("2026-08-10T12:00:00Z"),
      JSON.stringify({ role: "assistant", tokensV2: { input: 10, output: 5 } }),
    );
  database.close();

  const previousState = { lastCompleteRange: "preserve" };
  const result = await adapterFor("opencode").collect(
    { dataPath: path },
    { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" },
    previousState,
  );
  assert.equal(result.completeness, "partial");
  assert.deepEqual(result.entries, []);
  assert.deepEqual(result.nextState, previousState);
  assert.deepEqual(result.diagnostics, [
    { code: "local_store_schema_unsupported", phase: "collect" },
  ]);
});

test("event collectors retain their last complete state when an appended usage record is unsupported", async (context) => {
  const range = { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" };
  const kimi = (await fixture("kimi.jsonl")).trim().split("\n")[1];
  const gemini = JSON.stringify(JSON.parse(await fixture("gemini.json"))[0]);
  const antigravityNative = (await fixture("antigravity.jsonl")).trim();
  const antigravity = JSON.stringify(safeCaptureRecord("antigravity", antigravityNative));
  const cases = [
    {
      agentId: "claude_code",
      name: "session.jsonl",
      valid: (await fixture("claude.jsonl")).trim(),
      unsupported: JSON.stringify({
        type: "assistant.v2",
        timestamp: "2026-08-11T00:00:00Z",
        message: {
          id: "unsupported-claude",
          role: "assistant",
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      }),
    },
    {
      agentId: "kimi_code",
      name: "wire.jsonl",
      source: { collectionMethod: "kimi_wire_jsonl" },
      valid: kimi,
      unsupported: JSON.stringify({
        type: "usage.record.v2",
        time: Date.parse("2026-08-11T00:00:00Z"),
        usage: { inputOther: 10, output: 5, inputCacheRead: 0, inputCacheCreation: 0 },
      }),
    },
    {
      agentId: "qwen_code",
      name: "token-usage-2026-08.jsonl",
      valid: (await fixture("qwen.jsonl")).trim(),
      unsupported: JSON.stringify({
        schemaVersion: 2,
        id: "unsupported-qwen",
        timestamp: "2026-08-11T00:00:00Z",
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      }),
    },
    {
      agentId: "qwen_code",
      label: "missing schemaVersion",
      name: "token-usage-2026-08.jsonl",
      valid: (await fixture("qwen.jsonl")).trim(),
      unsupported: JSON.stringify({
        id: "unsupported-qwen-without-version",
        timestamp: "2026-08-11T00:00:00Z",
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      }),
    },
    {
      agentId: "gemini_cli",
      name: "session-unsupported.jsonl",
      valid: gemini,
      unsupported: JSON.stringify({
        type: "gemini.v2",
        id: "unsupported-gemini",
        timestamp: "2026-08-11T00:00:00Z",
        tokens: { input: 10, output: 5, total: 15 },
      }),
    },
    ...[
      ["usageMetadata", null],
      ["usage", false],
      ["tokenUsage", 0],
      ["tokens", ""],
    ].map(([usageContainer, value]) => ({
      agentId: "gemini_cli",
      label: `invalid ${usageContainer} container`,
      name: "session-unsupported.jsonl",
      valid: gemini,
      unsupported: JSON.stringify({
        type: "gemini.v2",
        id: `unsupported-gemini-${usageContainer}`,
        timestamp: "2026-08-11T00:00:00Z",
        [usageContainer]: value,
      }),
    })),
    {
      agentId: "antigravity",
      name: "capture.jsonl",
      valid: antigravity,
      unsupported: JSON.stringify({
        id: "unsupported-antigravity",
        date: "2026-08-11",
      }),
    },
  ];

  for (const item of cases) {
    const directory = await mkdtemp(join(tmpdir(), `viberacing-${item.agentId}-schema-`));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const path = join(directory, item.name);
    await writeFile(path, `${item.valid}\n`);
    const adapter = adapterFor(item.agentId);
    const source = { dataPath: directory, ...item.source };
    const first = await adapter.collect(source, range, {});
    const caseName = `${item.agentId}${item.label ? ` ${item.label}` : ""}`;
    assert.equal(first.completeness, "complete", caseName);
    assert.equal(typeof first.nextState.parserVersion, "number", caseName);

    await appendFile(path, `${item.unsupported}\n`);
    const partial = await adapter.collect(source, range, first.nextState);
    assert.equal(partial.completeness, "partial", caseName);
    assert.deepEqual(partial.entries, first.entries, `${caseName} retained daily usage`);
    assert.deepEqual(partial.nextState, first.nextState, `${caseName} retained file state`);
    assert.ok(
      partial.diagnostics.some(
        (diagnostic) => diagnostic.code === "local_store_schema_unsupported",
      ),
      caseName,
    );

    await writeFile(path, `${item.unsupported}\n`);
    const rewritten = await adapter.collect(source, range, first.nextState);
    assert.equal(rewritten.completeness, "partial", `${caseName} rewrite`);
    assert.deepEqual(rewritten.entries, first.entries, `${caseName} rewrite retained daily usage`);
    assert.deepEqual(
      rewritten.nextState,
      first.nextState,
      `${caseName} rewrite retained file state`,
    );
    assert.ok(
      rewritten.diagnostics.some(
        (diagnostic) => diagnostic.code === "local_store_schema_unsupported",
      ),
      `${caseName} rewrite diagnostic`,
    );

    const { parserVersion: _parserVersion, ...staleState } = first.nextState;
    const rescanned = await adapter.collect(source, range, staleState);
    assert.equal(rescanned.completeness, "partial", caseName);
    assert.deepEqual(rescanned.entries, first.entries, `${caseName} stale daily usage`);
    assert.deepEqual(rescanned.nextState, first.nextState, `${caseName} migrated stale file state`);
  }
});

test("Gemini upgrades fail-open parser state without making unrelated records candidates", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "viberacing-gemini-schema-upgrade-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const path = join(directory, "session-upgrade.jsonl");
  const range = { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" };
  const valid = JSON.stringify(JSON.parse(await fixture("gemini.json"))[0]);
  const adapter = adapterFor("gemini_cli");
  await writeFile(path, `${valid}\n`);
  const first = await adapter.collect({ dataPath: directory }, range, {});

  await writeFile(
    path,
    `${JSON.stringify({
      type: "gemini.v2",
      id: "unsupported-gemini-upgrade",
      timestamp: "2026-08-11T00:00:00Z",
      usageMetadata: null,
    })}\n`,
  );
  const oldParserState = { ...first.nextState, parserVersion: 1 };
  const upgraded = await adapter.collect({ dataPath: directory }, range, oldParserState);
  assert.equal(upgraded.completeness, "partial");
  assert.deepEqual(upgraded.entries, first.entries);
  assert.deepEqual(upgraded.nextState, first.nextState);
  assert.deepEqual(upgraded.diagnostics, [
    { code: "local_store_schema_unsupported", phase: "collect" },
  ]);

  await writeFile(path, `${JSON.stringify({ type: "metadata", timestamp: "2026-08-11" })}\n`);
  const irrelevant = await adapter.collect({ dataPath: directory }, range, {});
  assert.equal(irrelevant.completeness, "complete");
  assert.deepEqual(irrelevant.entries, []);
  assert.equal(irrelevant.diagnostics.length, 0);
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

test("adapter output excludes the complete provider-identity and content denylist", async () => {
  const sensitive = "synthetic-sensitive-value@privacy.invalid";
  const antigravity = JSON.parse((await fixture("antigravity.jsonl")).trim());
  const forbidden = {
    prompt: sensitive,
    response: sensitive,
    model: sensitive,
    path: sensitive,
    email: sensitive,
    providerAccountId: sensitive,
    accountId: sensitive,
    organization: sensitive,
    workspace: sensitive,
    planType: sensitive,
    authMethod: sensitive,
    apiKey: sensitive,
    accessToken: sensitive,
    refreshToken: sensitive,
    credential: sensitive,
    providerAccountKey: sensitive,
  };
  const output = parseAntigravityLines([
    JSON.stringify({
      ...antigravity,
      ...forbidden,
    }),
  ]);
  const serialized = JSON.stringify(output);
  for (const key of Object.keys(forbidden))
    assert.doesNotMatch(serialized, new RegExp(key, "i"), key);
  assert.doesNotMatch(serialized, /synthetic-sensitive-value|privacy\.invalid/i);
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

test("Codex provider identities are salt-scoped, stable, and content-free", () => {
  const salt = "local-provider-identity-salt-that-is-long-enough";
  const first = deriveCodexProviderAccountKey(salt, [
    ["account", "workspace-1"],
    ["email", "CAF\u00c9@example.com"],
  ]);
  const second = deriveCodexProviderAccountKey(salt, [
    ["account", "workspace-1"],
    ["email", "cafe\u0301@example.com"],
  ]);
  assert.equal(first, second);
  assert.match(first, /^acct1_[A-Za-z0-9_-]{43}$/);
  assert.doesNotMatch(first, /user|example/i);
  assert.notEqual(
    first,
    deriveCodexProviderAccountKey("another-provider-identity-salt-that-is-long-enough", [
      ["account", "workspace-1"],
      ["email", "caf\u00e9@example.com"],
    ]),
  );
  assert.notEqual(
    first,
    deriveCodexProviderAccountKey(salt, [
      ["account", "workspace-2"],
      ["email", "caf\u00e9@example.com"],
    ]),
  );
  assert.notEqual(
    first,
    deriveCodexProviderAccountKey(salt, [
      ["account", "workspace-1"],
      ["email", "other@example.com"],
    ]),
  );
});

test("Codex provider identity fails closed for API keys, Bedrock, and email-only accounts", () => {
  const salt = "local-provider-identity-salt-that-is-long-enough";
  for (const authState of [
    { auth_mode: "apikey", tokens: { account_id: "account-a" } },
    { auth_mode: "chatgpt", tokens: {} },
    { auth_mode: "chatgpt", tokens: { account_id: null } },
  ])
    assert.throws(
      () => parseCodexProviderAccount(authState, salt),
      (error) => error?.diagnosticCode === "provider_account_identity_unavailable",
    );
});

test("Codex identity uses only account_id plus normalized App Server email", () => {
  const salt = "local-provider-identity-salt-that-is-long-enough";
  const authState = (accountId) => ({
    auth_mode: "chatgpt",
    tokens: {
      account_id: accountId,
      id_token: "not-read",
      access_token: "not-read",
      refresh_token: "not-read",
    },
  });
  const first = parseCodexProviderAccount(authState("account-a"), salt, "Racer@Example.com");
  const second = parseCodexProviderAccount(authState("account-b"), salt, "racer@example.com");
  assert.notEqual(first, second);
  assert.doesNotMatch(`${first}${second}`, /account-[ab]|not-read/i);
  assert.deepEqual(parseCodexAuthIdentity(authState("account-a")), [["account", "account-a"]]);
});

test("Codex account/read accepts and normalizes the official ChatGPT identity shape", () => {
  assert.deepEqual(
    parseCodexAccountRead({
      result: {
        account: { type: "chatgpt", email: " Racer@Example.com ", planType: "pro" },
        requiresOpenaiAuth: true,
      },
    }),
    { type: "chatgpt", email: "racer@example.com" },
  );
  for (const account of [{ type: "apiKey" }, { type: "chatgpt", email: null }])
    assert.throws(
      () => parseCodexAccountRead({ result: { account, requiresOpenaiAuth: true } }),
      (error) => error?.diagnosticCode === "provider_account_identity_unavailable",
    );
  assert.deepEqual(
    parseCodexAccountRead({
      result: {
        account: {
          type: "chatgpt",
          email: "racer@example.com",
          planType: "pro",
          userId: "synthetic-field-is-ignored",
        },
        requiresOpenaiAuth: true,
      },
    }),
    { type: "chatgpt", email: "racer@example.com" },
  );
});

test("Codex account/read contract matches the current official generated schema", async () => {
  const schema = JSON.parse(
    await readFile(
      process.env.VIBERACING_CODEX_ACCOUNT_SCHEMA ??
        fileURLToPath(new URL("fixtures/codex-get-account-response.schema.json", import.meta.url)),
      "utf8",
    ),
  );
  const chatgpt = schema.definitions.Account.oneOf.find(
    (account) => account.title === "ChatgptAccount",
  );
  assert.deepEqual(Object.keys(chatgpt.properties).sort(), ["email", "planType", "type"]);
  assert.deepEqual([...chatgpt.required].sort(), ["email", "planType", "type"]);
  assert.deepEqual(schema.required, ["requiresOpenaiAuth"]);
  assert.doesNotMatch(
    JSON.stringify(chatgpt),
    /accountId|account_id|userId|user_id|workspaceId|workspace_id/,
  );
});

test("Codex auth reader requires a bounded regular file and Unix owner-only permissions", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "viberacing-codex-auth-state-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const authPath = join(directory, "auth.json");
  await writeFile(
    authPath,
    `${JSON.stringify({ auth_mode: "chatgpt", tokens: { account_id: "stable-account" } })}\n`,
    { mode: 0o600 },
  );
  assert.deepEqual(await readCodexAuthIdentity({ dataPath: directory }), [
    ["account", "stable-account"],
  ]);
  if (process.platform !== "win32") {
    await chmod(authPath, 0o644);
    await assert.rejects(
      readCodexAuthIdentity({ dataPath: directory }),
      (error) => error?.diagnosticCode === "provider_account_identity_unavailable",
    );
    await unlink(authPath);
    const target = join(directory, "auth-target.json");
    await writeFile(
      target,
      `${JSON.stringify({ auth_mode: "chatgpt", tokens: { account_id: "stable-account" } })}\n`,
      { mode: 0o600 },
    );
    await symlink(target, authPath);
    await assert.rejects(
      readCodexAuthIdentity({ dataPath: directory }),
      (error) => error?.diagnosticCode === "provider_account_identity_unavailable",
    );
  }
});

test("Codex collection brackets usage with one stable account and retries one switch", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "viberacing-codex-account-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const attempts = [];
  const accountIds = [
    ["account-1", "account-2"],
    ["account-2", "account-2"],
  ];
  let identityReads = 0;
  const withCodexAppServer = async (_source, callback) => {
    const attempt = attempts.length;
    const writes = [];
    attempts.push(writes);
    const responses = [
      {
        id: 1,
        result: {
          account: { type: "chatgpt", email: "same@example.com", planType: "pro" },
          requiresOpenaiAuth: true,
        },
      },
      {
        id: 2,
        result: { dailyUsageBuckets: [{ startDate: "2026-08-10", tokens: "42" }] },
      },
      {
        id: 3,
        result: {
          account: { type: "chatgpt", email: "same@example.com", planType: "pro" },
          requiresOpenaiAuth: true,
        },
      },
    ][Symbol.iterator]();
    return callback({
      next: async () => ({ value: undefined, done: false, ...responses.next().value }),
      write: (message) => writes.push(message),
    });
  };
  const result = await adapterFor("codex").collect(
    { dataPath: directory },
    { rangeStart: "2026-07-11", rangeEnd: "2026-08-10" },
    {},
    {
      providerIdentitySalt: "local-provider-identity-salt-that-is-long-enough",
      withCodexAppServer,
      readCodexAuthIdentity: async () => {
        const attempt = Math.floor(identityReads / 2);
        const position = identityReads % 2;
        identityReads += 1;
        return [["account", accountIds[attempt][position]]];
      },
    },
  );
  assert.equal(attempts.length, 2);
  assert.deepEqual(
    attempts[1].map(({ method, params }) => ({ method, params })),
    [
      { method: "account/read", params: { refreshToken: false } },
      { method: "account/usage/read", params: null },
      { method: "account/read", params: { refreshToken: false } },
    ],
  );
  assert.equal(result.entries[0].totalTokens, "42");
  assert.equal(
    result.providerAccountKey,
    deriveCodexProviderAccountKey("local-provider-identity-salt-that-is-long-enough", [
      ["account", "account-2"],
      ["email", "same@example.com"],
    ]),
  );
});

test("Codex reads account_id before App Server startup and rejects a startup switch race", async () => {
  const events = [];
  let identityReads = 0;
  let starts = 0;
  await assert.rejects(
    adapterFor("codex").collect(
      { dataPath: join(tmpdir(), "codex-startup-switch") },
      { rangeStart: "2026-07-11", rangeEnd: "2026-08-10" },
      {},
      {
        providerIdentitySalt: "local-provider-identity-salt-that-is-long-enough",
        readCodexAuthIdentity: async () => {
          const accountId = identityReads++ % 2 === 0 ? "account-A" : "account-B";
          events.push(`auth:${accountId}`);
          return [["account", accountId]];
        },
        withCodexAppServer: async (_source, callback) => {
          starts += 1;
          events.push("server:start-A");
          const responses = [
            {
              id: 1,
              result: {
                account: { type: "chatgpt", email: "a@example.com", planType: "pro" },
                requiresOpenaiAuth: false,
              },
            },
            {
              id: 2,
              result: { dailyUsageBuckets: [{ startDate: "2026-08-10", tokens: "999" }] },
            },
            {
              id: 3,
              result: {
                account: { type: "chatgpt", email: "a@example.com", planType: "pro" },
                requiresOpenaiAuth: false,
              },
            },
          ][Symbol.iterator]();
          return callback({
            next: async () => ({ value: undefined, done: false, ...responses.next().value }),
            write: () => {},
          });
        },
      },
    ),
    (error) => error?.diagnosticCode === "provider_account_changed_during_collection",
  );
  assert.equal(starts, 2);
  assert.deepEqual(events, [
    "auth:account-A",
    "server:start-A",
    "auth:account-B",
    "auth:account-A",
    "server:start-A",
    "auth:account-B",
  ]);
});

test("Codex rejects App Server email drift even when account_id is stable", async () => {
  await assert.rejects(
    adapterFor("codex").collect(
      { dataPath: join(tmpdir(), "codex-email-switch") },
      { rangeStart: "2026-07-11", rangeEnd: "2026-08-10" },
      {},
      {
        providerIdentitySalt: "local-provider-identity-salt-that-is-long-enough",
        readCodexAuthIdentity: async () => [["account", "shared-workspace"]],
        withCodexAppServer: async (_source, callback) => {
          const responses = [
            {
              id: 1,
              result: {
                account: { type: "chatgpt", email: "a@example.com", planType: "pro" },
                requiresOpenaiAuth: false,
              },
            },
            {
              id: 2,
              result: { dailyUsageBuckets: [{ startDate: "2026-08-10", tokens: "999" }] },
            },
            {
              id: 3,
              result: {
                account: { type: "chatgpt", email: "b@example.com", planType: "pro" },
                requiresOpenaiAuth: false,
              },
            },
          ][Symbol.iterator]();
          return callback({
            next: async () => ({ value: undefined, done: false, ...responses.next().value }),
            write: () => {},
          });
        },
      },
    ),
    (error) => error?.diagnosticCode === "provider_account_changed_during_collection",
  );
});

test("Codex 0.4.3 state keeps the authoritative remote total after local history is deleted", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "viberacing-codex-043-bootstrap-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const writes = [];
  const responses = [
    {
      id: 1,
      result: {
        account: { type: "chatgpt", email: "racer@example.com", planType: "pro" },
        requiresOpenaiAuth: true,
      },
    },
    {
      id: 2,
      result: { dailyUsageBuckets: [{ startDate: "2026-08-10", tokens: "91" }] },
    },
    {
      id: 3,
      result: {
        account: { type: "chatgpt", email: "racer@example.com", planType: "pro" },
        requiresOpenaiAuth: true,
      },
    },
  ][Symbol.iterator]();
  const result = await adapterFor("codex").collect(
    { dataPath: directory },
    { rangeStart: "2026-07-11", rangeEnd: "2026-08-10" },
    { componentUsage: { files: {}, events: {} } },
    {
      providerIdentitySalt: "local-provider-identity-salt-that-is-long-enough",
      readCodexAuthIdentity: async () => [["account", "stable-account"]],
      withCodexAppServer: async (_source, callback) =>
        callback({
          next: async () => ({ value: undefined, done: false, ...responses.next().value }),
          write: (message) => writes.push(message),
        }),
    },
  );
  assert.equal(result.completeness, "complete");
  assert.deepEqual(result.entries, [{ date: "2026-08-10", totalTokens: "91" }]);
  assert.deepEqual(
    writes.map(({ method, params }) => ({ method, params })),
    [
      { method: "account/read", params: { refreshToken: false } },
      { method: "account/usage/read", params: null },
      { method: "account/read", params: { refreshToken: false } },
    ],
  );
  assert.doesNotMatch(JSON.stringify(writes), /workspace-stable|acct1_/i);
});

test("Codex discards usage when the account changes in both bounded attempts", async () => {
  const attempts = [];
  let identityReads = 0;
  const withCodexAppServer = async (_source, callback) => {
    const writes = [];
    attempts.push(writes);
    const responses = [
      {
        id: 1,
        result: {
          account: { type: "chatgpt", email: "same@example.com", planType: "pro" },
          requiresOpenaiAuth: true,
        },
      },
      {
        id: 2,
        result: { dailyUsageBuckets: [{ startDate: "2026-08-10", tokens: "999" }] },
      },
      {
        id: 3,
        result: {
          account: { type: "chatgpt", email: "same@example.com", planType: "pro" },
          requiresOpenaiAuth: true,
        },
      },
    ][Symbol.iterator]();
    return callback({
      next: async () => ({ value: undefined, done: false, ...responses.next().value }),
      write: (message) => writes.push(message),
    });
  };
  const priorState = Object.freeze({ componentUsage: Object.freeze({ sentinel: "unchanged" }) });
  await assert.rejects(
    adapterFor("codex").collect(
      { dataPath: join(tmpdir(), "missing-codex-switch") },
      { rangeStart: "2026-07-11", rangeEnd: "2026-08-10" },
      priorState,
      {
        providerIdentitySalt: "local-provider-identity-salt-that-is-long-enough",
        withCodexAppServer,
        readCodexAuthIdentity: async () => [
          ["account", identityReads++ % 2 === 0 ? "before" : "after"],
        ],
      },
    ),
    (error) => error?.diagnosticCode === "provider_account_changed_during_collection",
  );
  assert.equal(attempts.length, 2);
  assert.deepEqual(priorState, { componentUsage: { sentinel: "unchanged" } });
});

test("Codex keeps components for a separate profile and suppresses them for a shared profile", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "viberacing-codex-shared-components-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const threadId = "51515151-5151-4515-8515-515151515151";
  const sessions = join(directory, "sessions");
  await mkdir(sessions);
  await writeFile(
    join(sessions, codexRolloutName(threadId)),
    `${[
      codexSessionMeta(threadId),
      codexTokenCount("2026-08-10T12:00:00Z", {
        input_tokens: 10,
        cached_input_tokens: 3,
        cache_write_input_tokens: 2,
        output_tokens: 8,
        reasoning_output_tokens: 3,
        total_tokens: 18,
      }),
    ].join("\n")}\n`,
  );
  const withCodexAppServer = async (_source, callback) => {
    const responses = [
      {
        id: 1,
        result: {
          account: { type: "chatgpt", email: "racer@example.com", planType: "pro" },
          requiresOpenaiAuth: true,
        },
      },
      {
        id: 2,
        result: { dailyUsageBuckets: [{ startDate: "2026-08-10", tokens: "42" }] },
      },
      {
        id: 3,
        result: {
          account: { type: "chatgpt", email: "racer@example.com", planType: "pro" },
          requiresOpenaiAuth: true,
        },
      },
    ][Symbol.iterator]();
    return callback({
      next: async () => ({ value: undefined, done: false, ...responses.next().value }),
      write: () => {},
    });
  };
  const collect = (suppressComponents) =>
    adapterFor("codex").collect(
      { dataPath: directory },
      { rangeStart: "2026-07-11", rangeEnd: "2026-08-10" },
      {},
      {
        providerIdentitySalt: "local-provider-identity-salt-that-is-long-enough",
        suppressComponents,
        withCodexAppServer,
        readCodexAuthIdentity: async () => [["account", "stable-account"]],
      },
    );

  const separate = await collect(false);
  assert.deepEqual(separate.entries, [
    {
      date: "2026-08-10",
      totalTokens: "42",
      inputTokens: "5",
      outputTokens: "5",
      cacheReadTokens: "3",
      cacheWriteTokens: "2",
      reasoningTokens: "3",
    },
  ]);

  const shared = await collect(true);
  assert.deepEqual(shared.entries, [{ date: "2026-08-10", totalTokens: "42" }]);
  assert.deepEqual(shared.nextState, { componentUsage: {} });
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
  assert.equal(partialLine.completeness, "partial");
  assert.deepEqual(partialLine.nextState, unchanged.nextState);
  assert.equal(partialLine.nextState.files[path].safeOffset, priorOffset);
  assert.deepEqual(
    partialLine.entries.map((entry) => entry.date),
    ["2026-08-10", "2026-08-11"],
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
    ["2026-08-10", "2026-08-11"],
  );
});

test("0.4.3 JSONL states preserve accepted baselines while adding account switches", async (context) => {
  const range = { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" };
  const antigravity = JSON.stringify(
    safeCaptureRecord("antigravity", (await fixture("antigravity.jsonl")).trim()),
  );
  const cases = [
    {
      agentId: "claude_code",
      name: "session.jsonl",
      record: (await fixture("claude.jsonl")).trim(),
      nextRecord: (record) => {
        const value = JSON.parse(record);
        return JSON.stringify({
          ...value,
          timestamp: "2026-08-11T12:00:00Z",
          message: { ...value.message, id: "m2" },
        });
      },
      rawId: "m1",
      legacyParserVersion: 1,
    },
    {
      agentId: "qwen_code",
      name: "token-usage-2026-08.jsonl",
      record: (await fixture("qwen.jsonl")).trim(),
      nextRecord: (record) =>
        JSON.stringify({
          ...JSON.parse(record),
          id: "event-2",
          timestamp: "2026-08-11T23:30:00Z",
        }),
      rawId: "event-1",
      legacyParserVersion: 4,
    },
    {
      agentId: "antigravity",
      name: "capture.jsonl",
      record: antigravity,
      nextRecord: (record) => {
        const value = JSON.parse(record);
        return JSON.stringify({
          ...value,
          id: "session-2",
          date: "2026-08-11",
          usage: { ...value.usage, date: "2026-08-11" },
        });
      },
      rawId: "session-1",
      legacyParserVersion: 1,
    },
  ];
  for (const item of cases) {
    const directory = await mkdtemp(join(tmpdir(), `viberacing-${item.agentId}-ledger-`));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const path = join(directory, item.name);
    await writeFile(path, `${item.record}\n`);
    const adapter = adapterFor(item.agentId);
    const firstSource = {
      dataPath: directory,
      syntheticAuthHint: "account-a@switch.invalid",
      ...item.source,
    };
    const first = await adapter.collect(firstSource, range, {});
    const checkpoint = first.nextState.files[path];
    const legacyState =
      item.agentId === "claude_code"
        ? {
            parserVersion: item.legacyParserVersion,
            files: { [path]: { ...checkpoint, ids: [item.rawId] } },
            messages: { [item.rawId]: first.entries[0] },
          }
        : {
            parserVersion: item.legacyParserVersion,
            files: {
              [path]: {
                ...checkpoint,
                entries: first.entries,
                eventDays: {
                  [Object.keys(first.nextState.ledger)[0]]: first.entries[0].date,
                },
              },
            },
          };
    await unlink(path);
    const nextDirectory = join(directory, "next");
    await mkdir(nextDirectory);
    await writeFile(join(nextDirectory, item.name), `${item.nextRecord(item.record)}\n`);
    const switchedSource = {
      ...firstSource,
      syntheticAuthHint: "account-b@switch.invalid",
    };
    const combined = await adapter.collect(switchedSource, range, legacyState);
    assert.equal(combined.completeness, "complete", item.agentId);
    assert.equal(combined.entries.length, 2, item.agentId);
    assert.deepEqual(
      combined.entries.map(({ date }) => date),
      ["2026-08-10", "2026-08-11"],
      item.agentId,
    );
    assert.equal(
      BigInt(combined.entries[0].totalTokens),
      BigInt(first.entries[0].totalTokens),
      `${item.agentId} retained account A`,
    );
    assert.equal(
      Object.keys(combined.nextState.ledger ?? {}).length,
      item.agentId === "claude_code" ? 2 : 1,
      item.agentId,
    );
    if (item.agentId !== "claude_code") {
      assert.deepEqual(combined.nextState.legacyBaseline, first.entries, item.agentId);
      assert.equal(Object.keys(combined.nextState.legacyEventDays).length, 1, item.agentId);
    }
    const serialized = JSON.stringify(combined.nextState);
    if (item.rawId) assert.doesNotMatch(serialized, new RegExp(item.rawId), item.agentId);
    assert.doesNotMatch(serialized, /account-[ab]@switch\.invalid/i, item.agentId);
    assert.doesNotMatch(JSON.stringify(combined.entries), /syntheticAuthHint|providerAccount/i);

    const pruned = await adapter.collect(
      switchedSource,
      { rangeStart: "2026-08-11", rangeEnd: "2026-09-10" },
      combined.nextState,
    );
    assert.deepEqual(
      pruned.entries.map(({ date }) => date),
      ["2026-08-11"],
      `${item.agentId} pruned account A after the rolling window`,
    );
    assert.equal(Object.keys(pruned.nextState.ledger ?? {}).length, 1, item.agentId);
    if (item.agentId !== "claude_code") {
      assert.deepEqual(pruned.nextState.legacyBaseline, [], item.agentId);
      assert.deepEqual(pruned.nextState.legacyEventDays, {}, item.agentId);
    }
  }
});

async function materialize043State(template, path) {
  const state = structuredClone(template);
  const checkpoint = state.files.$SOURCE_FILE;
  delete state.files.$SOURCE_FILE;
  const metadata = await stat(path);
  state.files[path] = {
    ...checkpoint,
    modifiedAt: metadata.mtimeMs,
    ino: metadata.ino,
  };
  return state;
}

test("real Kimi 0.4.3 fixture survives append, full-file move/copy, and truncation", async (context) => {
  const migration = JSON.parse(await fixture("migration-0.4.3.json"));
  assert.equal(migration.generatedFrom, "v0.4.3");
  const directory = await mkdtemp(join(tmpdir(), "viberacing-kimi-real-043-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const root = join(directory, "sessions");
  const original = join(root, "work", "session-a", "agents", "main", "wire.jsonl");
  await mkdir(dirname(original), { recursive: true });
  await writeFile(original, `${migration.kimi.record}\n`);
  const adapter = adapterFor("kimi_code");
  const source = { dataPath: root, collectionMethod: "kimi_wire_jsonl" };
  const legacyState = await materialize043State(migration.kimi.state, original);

  const upgraded = await adapter.collect(source, migration.range, legacyState);
  assert.deepEqual(
    upgraded.entries.map(({ totalTokens }) => totalTokens),
    ["20"],
  );
  assert.deepEqual(
    upgraded.nextState.legacyBaseline.map(({ totalTokens }) => totalTokens),
    ["20"],
  );
  assert.equal(Object.keys(upgraded.nextState.ledger).length, 0);

  const appendedRecord = JSON.stringify({
    ...JSON.parse(migration.kimi.record),
    time: Date.parse("2026-08-11T12:00:00Z"),
    usage: { ...JSON.parse(migration.kimi.record).usage, output: 6 },
  });
  await appendFile(original, `${appendedRecord}\n`);
  const appended = await adapter.collect(source, migration.range, upgraded.nextState);
  assert.deepEqual(
    appended.entries.map(({ date, totalTokens }) => [date, totalTokens]),
    [
      ["2026-08-10", "20"],
      ["2026-08-11", "21"],
    ],
  );
  assert.equal(Object.keys(appended.nextState.ledger).length, 1);

  const copied = join(root, "copy", "session-a", "agents", "main", "wire.jsonl");
  await mkdir(dirname(copied), { recursive: true });
  await copyFile(original, copied);
  const afterCopy = await adapter.collect(source, migration.range, appended.nextState);
  assert.deepEqual(afterCopy.entries, appended.entries);
  assert.equal(Object.keys(afterCopy.nextState.ledger).length, 1);

  await unlink(original);
  const afterMove = await adapter.collect(source, migration.range, afterCopy.nextState);
  assert.deepEqual(afterMove.entries, appended.entries);
  await writeFile(copied, `${appendedRecord}\n`);
  const truncated = await adapter.collect(source, migration.range, afterMove.nextState);
  assert.deepEqual(truncated.entries, appended.entries);
  assert.equal(Object.keys(truncated.nextState.ledger).length, 1);
});

test("real Gemini 0.4.3 fixture keeps no-ID append stable through move and rescan", async (context) => {
  const migration = JSON.parse(await fixture("migration-0.4.3.json"));
  const directory = await mkdtemp(join(tmpdir(), "viberacing-gemini-real-043-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const original = join(directory, "session-original.jsonl");
  await writeFile(original, `${migration.gemini.record}\n`);
  const adapter = adapterFor("gemini_cli");
  const source = { dataPath: directory };
  const legacyState = await materialize043State(migration.gemini.state, original);
  const upgraded = await adapter.collect(source, migration.range, legacyState);
  assert.deepEqual(
    upgraded.entries.map(({ totalTokens }) => totalTokens),
    ["17"],
  );

  const noId = JSON.stringify({
    type: "gemini",
    timestamp: "2026-08-11T12:00:00Z",
    tokens: { input: 8, output: 5, cached: 2, thoughts: 1, total: 14 },
  });
  await appendFile(original, `${noId}\n`);
  const appended = await adapter.collect(source, migration.range, upgraded.nextState);
  assert.deepEqual(
    appended.entries.map(({ date, totalTokens }) => [date, totalTokens]),
    [
      ["2026-08-10", "17"],
      ["2026-08-11", "14"],
    ],
  );
  assert.equal(Object.keys(appended.nextState.ledger).length, 1);

  const movedDirectory = join(directory, "moved");
  await mkdir(movedDirectory);
  const moved = join(movedDirectory, "session-original.jsonl");
  await rename(original, moved);
  const rescanned = await adapter.collect(source, migration.range, appended.nextState);
  assert.deepEqual(rescanned.entries, appended.entries);
  assert.equal(Object.keys(rescanned.nextState.ledger).length, 1);
  const copiedDirectory = join(directory, "copy");
  await mkdir(copiedDirectory);
  const copied = join(copiedDirectory, "session-original.jsonl");
  await copyFile(moved, copied);
  const copiedRescan = await adapter.collect(source, migration.range, rescanned.nextState);
  assert.deepEqual(copiedRescan.entries, appended.entries);
  assert.equal(Object.keys(copiedRescan.nextState.ledger).length, 1);
});

test("OpenCode ledger adds an account switch after deletion from the current database view", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "viberacing-opencode-ledger-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const path = join(directory, "opencode.db");
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(path);
  database.exec("CREATE TABLE message (id TEXT, time_created INTEGER, data TEXT)");
  database.prepare("INSERT INTO message (id, time_created, data) VALUES (?, ?, ?)").run(
    "content-free-message-id",
    Date.parse("2026-08-10T12:00:00Z"),
    JSON.stringify({
      role: "assistant",
      tokens: { input: 10, output: 5, cache: { read: 3, write: 2 }, reasoning: 0 },
    }),
  );
  database.close();
  const adapter = adapterFor("opencode");
  const range = { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" };
  const firstSource = {
    dataPath: path,
    syntheticAuthHint: "account-a@switch.invalid",
  };
  const first = await adapter.collect(firstSource, range, {});
  const reopened = new DatabaseSync(path);
  reopened.exec("DELETE FROM message");
  reopened.prepare("INSERT INTO message (id, time_created, data) VALUES (?, ?, ?)").run(
    "second-content-free-message-id",
    Date.parse("2026-08-11T12:00:00Z"),
    JSON.stringify({
      role: "assistant",
      tokens: { input: 4, output: 3, cache: { read: 0, write: 0 }, reasoning: 0 },
    }),
  );
  reopened.close();
  const switchedSource = {
    ...firstSource,
    syntheticAuthHint: "account-b@switch.invalid",
  };
  const combined = await adapter.collect(switchedSource, range, first.nextState);
  assert.deepEqual(
    combined.entries.map(({ date, totalTokens }) => [date, totalTokens]),
    [
      ["2026-08-10", "20"],
      ["2026-08-11", "7"],
    ],
  );
  assert.equal(Object.keys(combined.nextState.ledger).length, 2);
  assert.doesNotMatch(
    JSON.stringify(combined.nextState),
    /content-free-message-id|account-[ab]@switch\.invalid/,
  );
  assert.doesNotMatch(JSON.stringify(combined.entries), /syntheticAuthHint|providerAccount/i);

  const pruned = await adapter.collect(
    switchedSource,
    { rangeStart: "2026-08-11", rangeEnd: "2026-09-10" },
    combined.nextState,
  );
  assert.deepEqual(
    pruned.entries.map(({ date, totalTokens }) => [date, totalTokens]),
    [["2026-08-11", "7"]],
  );
  assert.equal(Object.keys(pruned.nextState.ledger).length, 1);
});

test("OpenCode direct 0.4.3 upgrade fails closed without a confirmed exact-ID cutover", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "viberacing-opencode-direct-043-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const path = join(directory, "opencode.db");
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(path);
  database.exec("CREATE TABLE message (id TEXT PRIMARY KEY, time_created INTEGER, data TEXT)");
  database.close();
  await assert.rejects(
    adapterFor("opencode").collect(
      { dataPath: path },
      { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" },
      {
        serverBaseline: {
          acceptedAt: "2026-08-10T23:59:59.000Z",
          acceptedSequence: "7",
          entries: [{ date: "2026-08-10", totalTokens: "100" }],
        },
      },
    ),
    (error) =>
      error?.diagnosticCode === "opencode_cutover_required" && /0\.4\.4/.test(error.message),
  );
});

test("OpenCode confirmed 0.4.4 cutover counts a scan-to-accept race exactly once", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "viberacing-opencode-bootstrap-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const path = join(directory, "opencode.db");
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(path);
  database.exec("CREATE TABLE message (id TEXT PRIMARY KEY, time_created INTEGER, data TEXT)");
  database
    .prepare("INSERT INTO message (id, time_created, data) VALUES (?, ?, ?)")
    .run(
      "accepted-message",
      Date.parse("2026-08-10T12:00:00Z"),
      JSON.stringify({ role: "assistant", tokens: { input: 60, output: 40, total: 100 } }),
    );
  const oldScan = parseOpenCodeMessages(
    database.prepare("SELECT id, time_created, data FROM message").all(),
  );
  database
    .prepare("INSERT INTO message (id, time_created, data) VALUES (?, ?, ?)")
    .run(
      "race-before-server-accept",
      Date.parse("2026-08-11T12:00:00Z"),
      JSON.stringify({ role: "assistant", tokens: { input: 4, output: 3, total: 7 } }),
    );
  database.close();
  const result = await adapterFor("opencode").collect(
    { dataPath: path },
    { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" },
    {
      serverBaseline: {
        acceptedAt: "2026-08-10T23:59:59.000Z",
        acceptedSequence: "7",
        entries: oldScan.map(({ date, totalTokens }) => ({ date, totalTokens })),
      },
      cutover: {
        version: 1,
        confirmedSequence: "7",
        confirmedRangeEnd: "2026-08-14",
        aliases: {
          [createHash("sha256").update("accepted-message").digest("hex")]: "2026-08-10",
        },
      },
    },
  );
  assert.equal(result.completeness, "partial");
  assert.deepEqual(
    result.entries.map(({ date, totalTokens }) => [date, totalTokens]),
    [
      ["2026-08-10", "100"],
      ["2026-08-11", "7"],
    ],
  );
  assert.equal(result.nextState.bootstrapComplete, true);
  assert.equal(Object.keys(result.nextState.legacyAliases).length, 1);
  assert.equal(Object.keys(result.nextState.ledger).length, 1);
  assert.equal(result.nextState.legacyAcceptedAt, "2026-08-10T23:59:59.000Z");
  assert.doesNotMatch(
    JSON.stringify(result.nextState),
    /accepted-message|race-before-server-accept/,
  );

  const afterCutover = new DatabaseSync(path);
  afterCutover
    .prepare("INSERT INTO message (id, time_created, data) VALUES (?, ?, ?)")
    .run(
      "post-cutover-message",
      Date.parse("2026-08-12T12:00:00Z"),
      JSON.stringify({ role: "assistant", tokens: { input: 5, output: 4, total: 9 } }),
    );
  afterCutover.close();
  const next = await adapterFor("opencode").collect(
    { dataPath: path },
    { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" },
    result.nextState,
  );
  assert.equal(next.completeness, "partial");
  assert.deepEqual(
    next.entries.map(({ date, totalTokens }) => [date, totalTokens]),
    [
      ["2026-08-10", "100"],
      ["2026-08-11", "7"],
      ["2026-08-12", "9"],
    ],
  );
  assert.equal(Object.keys(next.nextState.ledger).length, 2);
});

test("OpenCode cutover ignores server clock skew and counts only locally unseen IDs", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "viberacing-opencode-clock-skew-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const path = join(directory, "opencode.db");
  const { DatabaseSync } = await import("node:sqlite");
  let database = new DatabaseSync(path);
  database.exec("CREATE TABLE message (id TEXT PRIMARY KEY, time_created INTEGER, data TEXT)");
  const insert = database.prepare("INSERT INTO message (id, time_created, data) VALUES (?, ?, ?)");
  const message = (total) =>
    JSON.stringify({ role: "assistant", tokens: { input: total, output: 0, total } });
  const acceptedAt = Date.parse("2026-08-10T12:00:00Z");
  insert.run("legacy-minus-five", acceptedAt - 5 * 60_000, message(11));
  insert.run("legacy-plus-five", acceptedAt + 5 * 60_000, message(13));
  database.close();
  const adapter = adapterFor("opencode");
  const range = { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" };
  const cutover = await adapter.collect({ dataPath: path }, range, {
    serverBaseline: {
      acceptedAt: new Date(acceptedAt).toISOString(),
      acceptedSequence: "3",
      entries: [{ date: "2026-08-10", totalTokens: "24" }],
    },
    cutover: {
      version: 1,
      confirmedSequence: "3",
      confirmedRangeEnd: range.rangeEnd,
      aliases: Object.fromEntries(
        ["legacy-minus-five", "legacy-plus-five"].map((id) => [
          createHash("sha256").update(id).digest("hex"),
          "2026-08-10",
        ]),
      ),
    },
  });
  assert.deepEqual(cutover.entries, [{ date: "2026-08-10", totalTokens: "24" }]);
  assert.equal(Object.keys(cutover.nextState.legacyAliases).length, 2);

  database = new DatabaseSync(path);
  const append = database.prepare("INSERT INTO message (id, time_created, data) VALUES (?, ?, ?)");
  append.run("new-minus-five", acceptedAt - 5 * 60_000, message(17));
  append.run("new-plus-five", acceptedAt + 5 * 60_000, message(19));
  database.close();
  const collected = await adapter.collect({ dataPath: path }, range, cutover.nextState);
  assert.deepEqual(collected.entries, [{ date: "2026-08-10", totalTokens: "60" }]);
  assert.equal(Object.keys(collected.nextState.ledger).length, 2);
});

test("a full JSONL ledger replays the first unsaved event exactly once after pruning", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "viberacing-ledger-overflow-replay-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const path = join(directory, "capture.jsonl");
  const native = JSON.parse((await fixture("antigravity.jsonl")).trim());
  const appended = safeCaptureRecord(
    "antigravity",
    JSON.stringify({ ...native, session_id: "replay-event", timestamp: "2026-08-11T12:00:00Z" }),
  );
  await writeFile(path, `${JSON.stringify(appended)}\n`);
  const ledger = {};
  for (let index = 0; index < 65_536; index += 1)
    ledger[index.toString(16).padStart(64, "0")] = {
      date: "2026-08-10",
      usage: { totalTokens: "1" },
      parserVersion: 2,
    };
  const adapter = adapterFor("antigravity");
  const full = await adapter.collect(
    { dataPath: path },
    { rangeStart: "2026-08-10", rangeEnd: "2026-09-09" },
    { parserVersion: 2, files: {}, ledger },
  );
  assert.equal(full.completeness, "partial");
  assert.equal(full.nextState.files[path], undefined);
  assert.equal(Object.keys(full.nextState.ledger).length, 65_536);

  const replayed = await adapter.collect(
    { dataPath: path },
    { rangeStart: "2026-08-11", rangeEnd: "2026-09-10" },
    full.nextState,
  );
  assert.equal(replayed.completeness, "complete");
  assert.deepEqual(replayed.entries, [
    {
      date: "2026-08-11",
      totalTokens: "20",
      inputTokens: "10",
      outputTokens: "5",
      cacheReadTokens: "3",
      cacheWriteTokens: "2",
      reasoningTokens: "0",
    },
  ]);
  assert.equal(Object.keys(replayed.nextState.ledger).length, 1);
  const unchanged = await adapter.collect(
    { dataPath: path },
    { rangeStart: "2026-08-11", rangeEnd: "2026-09-10" },
    replayed.nextState,
  );
  assert.deepEqual(unchanged.entries, replayed.entries);
  assert.equal(Object.keys(unchanged.nextState.ledger).length, 1);
});

test("OpenCode retains a conflicting tuple while committing unrelated new events", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "viberacing-opencode-conflict-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const path = join(directory, "opencode.db");
  const { DatabaseSync } = await import("node:sqlite");
  const timestamp = Date.parse("2026-08-10T12:00:00Z");
  let database = new DatabaseSync(path);
  database.exec("CREATE TABLE message (id TEXT PRIMARY KEY, time_created INTEGER, data TEXT)");
  database
    .prepare("INSERT INTO message (id, time_created, data) VALUES (?, ?, ?)")
    .run(
      "stable-message",
      timestamp,
      JSON.stringify({ role: "assistant", tokens: { input: 10, output: 5, total: 15 } }),
    );
  database.close();
  const adapter = adapterFor("opencode");
  const range = { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" };
  const first = await adapter.collect({ dataPath: path }, range, {});

  database = new DatabaseSync(path);
  database
    .prepare("UPDATE message SET data = ? WHERE id = ?")
    .run(
      JSON.stringify({ role: "assistant", tokens: { input: 20, output: 5, total: 25 } }),
      "stable-message",
    );
  database
    .prepare("INSERT INTO message (id, time_created, data) VALUES (?, ?, ?)")
    .run(
      "new-message",
      timestamp + 1_000,
      JSON.stringify({ role: "assistant", tokens: { input: 2, output: 3, total: 5 } }),
    );
  database.close();

  const conflict = await adapter.collect({ dataPath: path }, range, first.nextState);
  assert.equal(conflict.completeness, "partial");
  assert.deepEqual(
    conflict.entries.map(({ totalTokens }) => totalTokens),
    ["20"],
  );
  assert.ok(conflict.diagnostics.some(({ code }) => code === "local_event_identity_conflict"));
  assert.equal(Object.keys(conflict.nextState.ledger).length, 2);
});

test("OpenCode bounds the SQLite scan before materializing an oversized ledger", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "viberacing-opencode-scan-limit-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const path = join(directory, "opencode.db");
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(path);
  database.exec("CREATE TABLE message (id TEXT PRIMARY KEY, time_created INTEGER, data TEXT)");
  database
    .prepare(
      `WITH RECURSIVE generated(value) AS (
         SELECT 1
         UNION ALL
         SELECT value + 1 FROM generated WHERE value < 65537
       )
       INSERT INTO message (id, time_created, data)
       SELECT printf('message-%05d', value), ?, ? FROM generated`,
    )
    .run(
      Date.parse("2026-08-10T12:00:00Z"),
      JSON.stringify({ role: "assistant", tokens: { input: 1, output: 0, total: 1 } }),
    );
  database.close();

  const result = await adapterFor("opencode").collect(
    { dataPath: path },
    { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" },
    {},
  );
  assert.equal(result.completeness, "partial");
  assert.ok(result.diagnostics.some(({ code }) => code === "local_store_scan_limit"));
  assert.ok(Object.keys(result.nextState.ledger ?? {}).length <= 65_536);
  assert.ok(Buffer.byteLength(JSON.stringify(result.nextState.ledger ?? {})) <= 16 * 1_024 * 1_024);
});

test("event identity conflicts retain the first exact tuple and report a partial diagnostic", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "viberacing-ledger-conflict-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const path = join(directory, "capture.jsonl");
  const native = JSON.parse((await fixture("antigravity.jsonl")).trim());
  const firstRecord = safeCaptureRecord("antigravity", JSON.stringify(native));
  await writeFile(path, `${JSON.stringify(firstRecord)}\n`);
  const adapter = adapterFor("antigravity");
  const range = { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" };
  const first = await adapter.collect({ dataPath: directory }, range, {});
  const conflictNative = {
    ...native,
    usage: { ...native.usage, input_tokens: 30, total_tokens: 40 },
  };
  const conflictRecord = safeCaptureRecord("antigravity", JSON.stringify(conflictNative));
  await appendFile(path, `${JSON.stringify(conflictRecord)}\n`);
  const conflict = await adapter.collect({ dataPath: directory }, range, first.nextState);
  assert.equal(conflict.completeness, "partial");
  assert.deepEqual(conflict.entries, first.entries);
  assert.ok(conflict.diagnostics.some(({ code }) => code === "local_event_identity_conflict"));
  assert.deepEqual(conflict.nextState.ledger, first.nextState.ledger);
});

test("corrupt observed-event ledger state fails closed across parser upgrades", async () => {
  const adapter = adapterFor("antigravity");
  const source = { dataPath: join(tmpdir(), `missing-ledger-${Date.now().toString()}`) };
  await assert.rejects(
    adapter.collect(
      source,
      { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" },
      {
        parserVersion: 2,
        ledger: {
          not_a_hash: {
            date: "2026-08-10",
            usage: { totalTokens: "1" },
            parserVersion: 2,
          },
        },
      },
    ),
    /Observed-event ledger is invalid/,
  );
  await assert.rejects(
    adapter.collect(
      source,
      { rangeStart: "2026-07-15", rangeEnd: "2026-08-14" },
      {
        parserVersion: 1,
        files: { legacy: {} },
        ledger: {
          not_a_hash: {
            date: "2026-08-10",
            usage: { totalTokens: "1" },
            parserVersion: 1,
          },
        },
      },
    ),
    /Observed-event ledger is invalid/,
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

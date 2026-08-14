import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectClaude,
  parseClaudeLines,
  parseAntigravityLines,
  parseCodexUsage,
  codexProfileEnvironment,
  parseCursorLines,
  parseGeminiRecords,
  parseKimiLines,
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

test("projects authoritative Codex UTC buckets", async () => {
  assert.deepEqual(parseCodexUsage(JSON.parse(await fixture("codex.json"))), [
    { date: "2026-08-10", totalTokens: "9007199254740993" },
  ]);
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

test("reads Kimi wire usage with stable event deduplication", async () => {
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
});

test("reads Qwen content-free stats using UTC timestamp instead of localDate", async () => {
  const lines = (await fixture("qwen.jsonl")).trim().split("\n");
  assert.deepEqual(parseQwenLines(lines), [
    {
      date: "2026-08-10",
      totalTokens: "20",
      inputTokens: "7",
      outputTokens: "5",
      cacheReadTokens: "3",
      cacheWriteTokens: "0",
      reasoningTokens: "5",
    },
  ]);
});

test("does not count current Cursor terminal results without authoritative counters", async () => {
  const lines = (await fixture("cursor.jsonl")).trim().split("\n");
  assert.deepEqual(parseCursorLines(lines), []);
  assert.equal(safeCaptureRecord("cursor", lines.at(-1)), null);
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

test("all eight adapters expose the complete collection contract", () => {
  assert.deepEqual(
    adapters.map((adapter) => adapter.id),
    [
      "codex",
      "claude_code",
      "opencode",
      "kimi_code",
      "qwen_code",
      "cursor",
      "antigravity",
      "gemini_cli",
    ],
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
  assert.deepEqual(parseCursorLines(["bad", "{}"]), []);
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
    timestamp: parsedKimi.timestamp + 86_400,
    message: {
      ...parsedKimi.message,
      payload: { ...parsedKimi.message.payload, message_id: "synthetic-kimi-message-3" },
    },
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

test("capture adapters deduplicate events and aggregate multiple UTC days", async () => {
  const cursor = (await fixture("cursor.jsonl")).trim().split("\n");
  assert.deepEqual(parseCursorLines(cursor), []);
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
  const adapter = adapterFor("cursor");
  const source = {
    dataPath: join(tmpdir(), `missing-viberacing-${Date.now().toString()}.jsonl`),
    collectionMethod: "cursor_cli_capture",
    supportedSurface: "cli",
  };
  const result = await adapter.collect(source, undefined, {});
  const diagnostic = await adapter.diagnose(source);
  assert.equal(result.completeness, "partial");
  assert.deepEqual(result.warnings, ["collector_limits_or_unreadable_files"]);
  assert.equal(diagnostic.dataLocationAvailable, false);
  assert.deepEqual(diagnostic.excluded, ["Cursor Desktop usage"]);
});

test("capture wrappers use current executables and required headless structured flags", () => {
  assert.deepEqual(wrapperInvocation("cursor", ["hello"]), {
    executable: "cursor-agent",
    args: ["--print", "hello", "--output-format", "stream-json"],
  });
  assert.deepEqual(
    wrapperInvocation("antigravity", ["-p", "hello", "--output-format=stream-json"]),
    {
      executable: "agy",
      args: ["-p", "hello", "--output-format=stream-json"],
    },
  );
});

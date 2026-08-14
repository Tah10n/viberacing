import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseClaudeLines,
  parseAntigravityLines,
  parseCodexUsage,
  parseCursorLines,
  parseGeminiRecords,
  parseKimiLines,
  parseOpenCodeMessages,
  parseQwenLines,
  adapters,
  adapterFor,
  recentEntries,
  safeCaptureRecord,
} from "../lib/readers.mjs";

async function fixture(name) {
  return readFile(fileURLToPath(new URL(`fixtures/${name}`, import.meta.url)), "utf8");
}

test("projects authoritative Codex UTC buckets", async () => {
  assert.deepEqual(parseCodexUsage(JSON.parse(await fixture("codex.json"))), [
    { date: "2026-08-10", totalTokens: "9007199254740993" },
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
  assert.deepEqual(parseKimiLines([...lines, lines[0]]), [
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

test("reads Cursor CLI terminal-result usage", async () => {
  const lines = (await fixture("cursor.jsonl")).trim().split("\n");
  assert.deepEqual(parseCursorLines(lines), [
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
  const cursor = JSON.parse((await fixture("cursor.jsonl")).trim().split("\n").at(-1));
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
      parseCursorLines,
      [
        JSON.stringify(cursor),
        JSON.stringify(cursor),
        JSON.stringify({ ...cursor, id: "session-2", timestamp: "2026-08-11T00:00:00Z" }),
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

  const kimi = (await fixture("kimi.jsonl")).trim();
  const nextKimi = JSON.stringify({ ...JSON.parse(kimi), time: "2026-08-11T00:00:00Z" });
  assert.deepEqual(
    parseKimiLines([kimi, kimi, nextKimi]).map((entry) => entry.date),
    ["2026-08-10", "2026-08-11"],
  );
});

test("adapter output never carries prompt, response, model, path, or credential fields", async () => {
  const sensitive = "synthetic-sensitive-value";
  const cursor = JSON.parse((await fixture("cursor.jsonl")).trim().split("\n").at(-1));
  const output = parseCursorLines([
    JSON.stringify({
      ...cursor,
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
  const cursor = (await fixture("cursor.jsonl")).trim().split("\n").at(-1);
  const second = JSON.stringify({
    ...JSON.parse(cursor),
    id: "session-2",
    timestamp: "2026-08-11T00:00:00Z",
  });
  assert.deepEqual(
    parseCursorLines([cursor, cursor, second]).map((entry) => entry.date),
    ["2026-08-10", "2026-08-11"],
  );
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
  for (const agentId of ["cursor", "antigravity"]) {
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

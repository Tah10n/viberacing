import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseClaudeLines,
  parseCodexUsage,
  readClaudeUsage,
  recentEntries,
} from "../lib/readers.mjs";

test("projects Codex daily buckets without summary data", () => {
  assert.deepEqual(
    parseCodexUsage({ result: { dailyUsageBuckets: [{ startDate: "2026-08-10", tokens: 123 }] } }),
    [{ agent: "codex", date: "2026-08-10", tokens: "123" }],
  );
});

test("accepts a Codex account before daily buckets exist", () => {
  assert.deepEqual(parseCodexUsage({ result: { dailyUsageBuckets: null } }), []);
});

test("deduplicates Claude messages and sums only usage components", () => {
  const record = {
    type: "assistant",
    timestamp: "2026-08-10T12:00:00Z",
    message: {
      id: "m1",
      role: "assistant",
      content: "private",
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: 2,
        cache_read_input_tokens: 3,
      },
    },
  };
  assert.deepEqual(parseClaudeLines([JSON.stringify(record), JSON.stringify(record)]), [
    { agent: "claude_code", date: "2026-08-10", tokens: "20" },
  ]);
});

test("treats absent optional Claude cache counters as zero", () => {
  const record = {
    type: "assistant",
    timestamp: "2026-08-10T12:00:00Z",
    message: { id: "m2", role: "assistant", usage: { input_tokens: 10, output_tokens: 5 } },
  };
  assert.deepEqual(parseClaudeLines([JSON.stringify(record)]), [
    { agent: "claude_code", date: "2026-08-10", tokens: "15" },
  ]);
});

test("ignores malformed Claude records", () => {
  assert.deepEqual(
    parseClaudeLines([
      "not-json",
      JSON.stringify({ type: "user", message: { content: "private" } }),
    ]),
    [],
  );
});

test("reads the most recently modified Claude logs when the file limit is reached", async () => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-claude-"));
  const records = [
    ["old.jsonl", "old", "2026-08-10T12:00:00Z", 10, "2026-08-10T12:00:00Z"],
    ["middle.jsonl", "middle", "2026-08-11T12:00:00Z", 20, "2026-08-11T12:00:00Z"],
    ["new.jsonl", "new", "2026-08-12T12:00:00Z", 30, "2026-08-12T12:00:00Z"],
  ];
  for (const [name, id, timestamp, tokens, modifiedAt] of records) {
    const path = join(root, name);
    await writeFile(
      path,
      `${JSON.stringify({
        type: "assistant",
        timestamp,
        message: {
          id,
          role: "assistant",
          usage: { input_tokens: tokens, output_tokens: 0 },
        },
      })}\n`,
    );
    await utimes(path, new Date(modifiedAt), new Date(modifiedAt));
  }

  assert.deepEqual(await readClaudeUsage(root, 2), [
    { agent: "claude_code", date: "2026-08-11", tokens: "20" },
    { agent: "claude_code", date: "2026-08-12", tokens: "30" },
  ]);
});

test("keeps only the 31 UTC dates accepted by usage ingestion", () => {
  const entries = [
    { agent: "claude_code", date: "2026-07-13", tokens: "1" },
    { agent: "claude_code", date: "2026-07-14", tokens: "2" },
    { agent: "codex", date: "2026-08-13", tokens: "3" },
    { agent: "codex", date: "2026-08-14", tokens: "4" },
  ];
  assert.deepEqual(recentEntries(entries, new Date("2026-08-13T23:00:00Z")), [
    { agent: "claude_code", date: "2026-07-14", tokens: "2" },
    { agent: "codex", date: "2026-08-13", tokens: "3" },
  ]);
});

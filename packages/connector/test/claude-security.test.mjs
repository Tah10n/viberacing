import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectClaude } from "../lib/adapters/claude.mjs";

function message(id, inputTokens) {
  return JSON.stringify({
    type: "assistant",
    timestamp: "2026-08-19T12:00:00.000Z",
    message: { id, role: "assistant", usage: { input_tokens: inputTokens, output_tokens: 1 } },
  });
}

test("Claude message ids cannot mutate collector prototypes", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "viberacing-claude-prototype-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "session.jsonl");
  await writeFile(
    path,
    `${["__proto__", "constructor", "prototype"].map((id, index) => message(id, index + 1)).join("\n")}\n`,
  );
  const range = { rangeStart: "2026-08-01", rangeEnd: "2026-08-31" };
  const first = await collectClaude({ dataPath: directory }, range);
  assert.equal(Object.keys(first.nextState.ledger).length, 3);
  assert.ok(Object.keys(first.nextState.ledger).every((key) => /^[0-9a-f]{64}$/.test(key)));
  assert.doesNotMatch(JSON.stringify(first.nextState.ledger), /__proto__|constructor|prototype/);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(first.nextState)));
  await appendFile(path, `${message("__proto__", 100)}\n${message("ordinary", 4)}\n`);
  const second = await collectClaude({ dataPath: directory }, range, first.nextState);
  assert.equal(Object.keys(second.nextState.ledger).length, 4);
  assert.doesNotMatch(
    JSON.stringify(second.nextState.ledger),
    /__proto__|constructor|ordinary|prototype/,
  );
  assert.ok(second.diagnostics.some(({ code }) => code === "local_event_identity_conflict"));
  assert.equal(second.entries[0].totalTokens, "14");
});

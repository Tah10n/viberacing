import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  readFile,
  appendFile,
  rm,
  chmod,
  link,
  symlink,
  stat,
  truncate,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  initializeCursorLedger,
  readCursorLedger,
  recordCursorCapture,
  maximumCursorLedgerBytes,
  compactCursorLedger,
  repairCursorLedger,
} from "../lib/cursor-ledger.mjs";
import { ensurePrivateStateDirectory } from "../lib/windows-security.mjs";
import { collectCursor } from "../lib/adapters/cursor.mjs";

const profile = "11111111-1111-4111-8111-111111111111";
const captureId = "22222222-2222-4222-8222-222222222222";
const salt = "s".repeat(43);
const start = "2026-09-04T00:00:00.000Z";
const at = "2026-09-04T23:59:59.999Z";
const later = "2026-09-05T00:00:00.001Z";
const stop = {
  hook_event_name: "stop",
  cursor_version: "3.19.7",
  status: "completed",
  user_email: "private@example.test",
  generation_id: "private-generation",
  session_id: "private-session",
  input_tokens: 100,
  output_tokens: 10,
  cache_read_tokens: 20,
  cache_write_tokens: 3,
  prompt: "private-prompt",
  result: "private-response",
  cwd: "/private/project",
  model: "private-model",
  api_key: "private-secret",
};
const result = {
  type: "result",
  subtype: "success",
  is_error: false,
  request_id: "private-request",
  session_id: stop.session_id,
  usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 20, cacheWriteTokens: 3 },
};
const end = {
  hook_event_name: "sessionEnd",
  cursor_version: "2026.09.02-c22c1a3",
  final_status: "completed",
  reason: "completed",
  session_id: stop.session_id,
  user_email: stop.user_email,
};
const file = (root) => join(root, "captures", `cursor-${profile}.jsonl`);
async function fixture(context) {
  const root = await mkdtemp(join(tmpdir(), "viberacing-cursor-ledger-"));
  await ensurePrivateStateDirectory(root);
  context.after(() => rm(root, { recursive: true, force: true }));
  await initializeCursorLedger(root, profile, start);
  return root;
}
const recordStop = (root, payload = stop, capturedAt = at) =>
  recordCursorCapture(root, profile, { kind: "stop", salt, payload, capturedAt });
const half = (root, kind, payload, capturedAt = at, id = captureId) =>
  recordCursorCapture(root, profile, {
    kind,
    payload,
    salt,
    capturedAt,
    captureId: id,
    version: "2026.09.02-c22c1a3",
  });

test("Cursor ledger atomically preserves sanitized event and identity across reopen and replay", async (context) => {
  const root = await fixture(context);
  assert.equal(await initializeCursorLedger(root, profile, later), start);
  await recordStop(root);
  const before = await readFile(file(root));
  assert.equal((await recordStop(root, stop, later)).status, "duplicate");
  assert.deepEqual(await readFile(file(root)), before);
  const reopened = await readCursorLedger(root, profile, later);
  assert.equal(reopened.events.length, 1);
  assert.equal(reopened.accounts.length, 1);
  assert.equal(reopened.events[0].capturedAt, at);
  assert.equal(reopened.events[0].tokens.totalTokens, "133");
  for (const value of Object.values(stop).filter(
    (value) =>
      typeof value === "string" && (value.startsWith("private") || value.startsWith("/private")),
  ))
    assert.equal(before.toString().includes(value), false);
  if (process.platform !== "win32") assert.equal((await stat(file(root))).mode & 0o077, 0);
});

test("Cursor concurrent invocations count every generation once", async (context) => {
  const root = await fixture(context);
  await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      recordStop(root, { ...stop, generation_id: `generation-${index}` }),
    ),
  );
  const read = await readCursorLedger(root, profile, later);
  assert.equal(read.events.length, 10);
  assert.equal(
    read.events.reduce((sum, item) => sum + BigInt(item.tokens.totalTokens), 0n),
    1330n,
  );
  assert.equal(read.accounts.length, 1);
});

test("Cursor conflicting tuples retain the first event and persist a partial gap", async (context) => {
  const root = await fixture(context);
  await recordStop(root);
  assert.equal((await recordStop(root, { ...stop, output_tokens: 999 }, later)).status, "partial");
  const read = await readCursorLedger(root, profile, later);
  assert.equal(read.events.length, 1);
  assert.equal(read.events[0].tokens.outputTokens, "10");
  assert.equal(read.gaps.at(-1).code, "cursor_event_identity_conflict");
  assert.equal(read.gaps.at(-1).from, at);
});

test("Cursor one session cannot be assigned to two accounts", async (context) => {
  const root = await fixture(context);
  await recordStop(root);
  await recordStop(
    root,
    { ...stop, generation_id: "next-generation", user_email: "other@example.test" },
    later,
  );
  const read = await readCursorLedger(root, profile, later);
  assert.equal(read.events.length, 0);
  assert.equal(read.gaps.at(-1).code, "cursor_account_identity_conflict");
});

for (const order of ["result-first", "binding-first"]) {
  test(`Cursor headless halves survive reopen in ${order} order`, async (context) => {
    const root = await fixture(context);
    const firstKind = order === "result-first" ? "result" : "binding";
    await half(
      root,
      firstKind,
      firstKind === "result" ? result : end,
      firstKind === "result" ? at : later,
    );
    const pending = await readCursorLedger(root, profile, later);
    assert.equal(pending.events.length, 0);
    assert.equal(pending.pendingPairs, 1);
    const secondKind = firstKind === "result" ? "binding" : "result";
    await half(
      root,
      secondKind,
      secondKind === "result" ? result : end,
      secondKind === "result" ? at : later,
    );
    const paired = await readCursorLedger(root, profile, later);
    assert.equal(paired.pendingPairs, 0);
    assert.equal(paired.events.length, 1);
    assert.equal(paired.events[0].date, "2026-09-04");
    assert.equal(paired.gaps.length, 0);
    const bytes = await readFile(file(root));
    await half(root, "result", result, later);
    await half(root, "binding", end, later);
    assert.deepEqual(await readFile(file(root)), bytes);
  });
}

test("Cursor headless marker suppresses stop and only aggregate result is counted", async (context) => {
  const root = await fixture(context);
  const initial = await readFile(file(root));
  assert.equal(
    (
      await recordCursorCapture(root, profile, {
        kind: "stop",
        payload: stop,
        salt,
        capturedAt: at,
        headlessOwned: true,
      })
    ).status,
    "suppressed",
  );
  assert.deepEqual(await readFile(file(root)), initial);
  await half(root, "result", result);
  await half(root, "binding", end);
  const read = await readCursorLedger(root, profile, later);
  assert.equal(read.events.length, 1);
  assert.equal(read.events[0].tokens.totalTokens, "133");
});

test("Cursor pending-half replay is byte-idempotent and contradictory replay closes the pair", async (context) => {
  const root = await fixture(context);
  await half(root, "result", result);
  const bytes = await readFile(file(root));
  await half(root, "result", result, later);
  assert.deepEqual(await readFile(file(root)), bytes);
  await half(root, "result", { ...result, usage: { ...result.usage, outputTokens: 80 } }, later);
  await half(root, "binding", end, later);
  const read = await readCursorLedger(root, profile, later);
  assert.equal(read.events.length, 0);
  assert.equal(read.pendingPairs, 0);
  assert.equal(read.gaps.at(-1).code, "cursor_account_identity_conflict");
});

test("Cursor time before capture start records a gap without adding usage", async (context) => {
  const root = await fixture(context);
  assert.equal((await recordStop(root, stop, "2026-09-03T23:59:59.999Z")).status, "partial");
  const read = await readCursorLedger(root, profile, later);
  assert.equal(read.events.length, 0);
  assert.equal(read.gaps[0].code, "cursor_usage_incomplete");
});

test("Cursor conflicting completed result is diagnosed without overwriting accepted counters", async (context) => {
  const root = await fixture(context);
  await half(root, "result", result);
  await half(root, "binding", end);
  await half(root, "result", { ...result, usage: { ...result.usage, outputTokens: 50 } }, later);
  const read = await readCursorLedger(root, profile, later);
  assert.equal(read.events[0].tokens.totalTokens, "133");
  assert.equal(read.gaps.at(-1).code, "cursor_event_identity_conflict");
});

test("Cursor abort, invalid half and timed-out pair never revive on a late counterpart", async (context) => {
  const root = await fixture(context);
  for (const ending of ["abort", "invalid", "timeout"]) {
    const id = randomUUID();
    await half(root, "result", result, start, id);
    if (ending === "abort") await half(root, "abort", null, start, id);
    if (ending === "invalid")
      await half(root, "binding", { ...end, final_status: "error" }, start, id);
    await half(root, "binding", end, ending === "timeout" ? at : start, id);
  }
  const read = await readCursorLedger(root, profile, later);
  assert.equal(read.events.length, 0);
  assert.equal(read.pendingPairs, 0);
  assert.ok(read.gaps.some((item) => item.code === "cursor_headless_pair_incomplete"));
});

test("Cursor torn suffix preserves committed prefix and blocks further writes", async (context) => {
  const root = await fixture(context);
  await recordStop(root);
  await appendFile(file(root), '{"v":1');
  const before = await readFile(file(root));
  const read = await readCursorLedger(root, profile, later);
  assert.equal(read.torn, true);
  assert.equal(read.events.length, 1);
  await assert.rejects(recordStop(root));
  assert.deepEqual(await readFile(file(root)), before);
});

test("Cursor unsafe and over-limit ledgers fail closed", async (context) => {
  const root = await fixture(context);
  await link(file(root), join(root, "other-link"));
  await assert.rejects(readCursorLedger(root, profile, later));
  await rm(join(root, "other-link"));
  if (process.platform !== "win32") {
    await chmod(file(root), 0o644);
    await assert.rejects(recordStop(root));
    await chmod(file(root), 0o600);
    const original = `${file(root)}.original`;
    await link(file(root), original);
    await rm(file(root));
    await symlink(original, file(root));
    await assert.rejects(readCursorLedger(root, profile, later));
    await rm(file(root));
    await link(original, file(root));
    await rm(original);
  }
  await truncate(file(root), maximumCursorLedgerBytes + 1);
  await assert.rejects(readCursorLedger(root, profile, later));
});

test("Cursor capture does not initialize a missing ledger or disclose malformed content", async (context) => {
  const root = await fixture(context);
  await rm(file(root));
  await assert.rejects(recordStop(root));
  await assert.rejects(stat(file(root)), { code: "ENOENT" });
  await initializeCursorLedger(root, profile, start);
  await appendFile(file(root), '{"prompt":"private-malformed-content"}\n');
  await assert.rejects(readCursorLedger(root, profile, later), {
    message: "cursor_schema_unsupported",
  });
});

test("Cursor contradictory account after headless completion blocks that session", async (context) => {
  const root = await fixture(context);
  await half(root, "result", result);
  await half(root, "binding", end);
  await half(root, "binding", { ...end, user_email: "other@example.test" }, later);
  const read = await readCursorLedger(root, profile, later);
  assert.equal(read.events.length, 0);
  assert.equal(read.gaps.at(-1).code, "cursor_account_identity_conflict");
});

test("Cursor repair retains the committed prefix and persists the unknown write interval", async (context) => {
  const root = await fixture(context);
  await recordStop(root);
  const committed = await readFile(file(root));
  await appendFile(file(root), '{"v":1');
  const torn = await readFile(file(root));
  await assert.rejects(
    repairCursorLedger(root, profile, later, {
      beforePublish() {
        throw new Error("interrupted");
      },
    }),
  );
  assert.deepEqual(await readFile(file(root)), torn);
  assert.equal(await repairCursorLedger(root, profile, later), true);
  const repaired = await readFile(file(root));
  assert.deepEqual(repaired.subarray(0, committed.length), committed);
  const read = await readCursorLedger(root, profile, later);
  assert.equal(read.torn, false);
  assert.equal(read.events.length, 1);
  assert.deepEqual(read.gaps.at(-1), { from: start, to: later, code: "cursor_usage_incomplete" });
  assert.equal(await repairCursorLedger(root, profile, later), false);
  await recordStop(root, { ...stop, generation_id: "after-repair" }, later);
  assert.equal((await readCursorLedger(root, profile, later)).events.length, 2);
});

test("Cursor acknowledged-prefix compaction preserves suffix, replay identity and headless pairs", async (context) => {
  const root = await fixture(context);
  await recordStop(root);
  await half(root, "result", result);
  await half(root, "binding", end);
  const pendingId = randomUUID();
  await half(root, "binding", { ...end, session_id: "pending-session" }, at, pendingId);
  const acknowledged = (await readCursorLedger(root, profile, later)).checkpoint;
  const oldPrefix = await readFile(file(root));
  await recordStop(
    root,
    {
      ...stop,
      generation_id: "unacknowledged",
      session_id: "new-session",
      user_email: "second@example.test",
    },
    later,
  );
  const full = await readFile(file(root));
  const suffix = full.subarray(oldPrefix.length);
  const before = await readCursorLedger(root, profile, later);
  assert.equal(await compactCursorLedger(root, profile, acknowledged), true);
  const compacted = await readFile(file(root));
  assert.ok(compacted.length < full.length);
  assert.deepEqual(compacted.subarray(compacted.length - suffix.length), suffix);
  const after = await readCursorLedger(root, profile, later);
  const withoutCheckpoint = ({ checkpoint, ...rest }) => rest;
  assert.deepEqual(withoutCheckpoint(after), withoutCheckpoint(before));
  assert.equal(await compactCursorLedger(root, profile, acknowledged), false);
  await recordStop(root, stop, later);
  await half(root, "result", result, later);
  assert.equal((await readCursorLedger(root, profile, later)).events.length, before.events.length);
  await half(
    root,
    "result",
    { ...result, request_id: "pending-request", session_id: "pending-session" },
    later,
    pendingId,
  );
  const paired = await readCursorLedger(root, profile, later);
  assert.equal(paired.pendingPairs, 0);
  assert.equal(paired.events.length, before.events.length + 1);
});

test("Cursor compaction detects a raced append and interrupted publication without losing bytes", async (context) => {
  const root = await fixture(context);
  for (let index = 0; index < 3; index++)
    await recordStop(root, { ...stop, generation_id: `item-${index}` });
  const proof = (await readCursorLedger(root, profile, later)).checkpoint;
  const initial = await readFile(file(root));
  await assert.rejects(
    compactCursorLedger(root, profile, proof, {
      beforePublish() {
        throw new Error("interrupted");
      },
    }),
  );
  assert.deepEqual(await readFile(file(root)), initial);
  const concurrent = Buffer.from(`${JSON.stringify({ v: 1, kind: "current", at: later })}\n`);
  await assert.rejects(
    compactCursorLedger(root, profile, proof, {
      beforePublish() {
        return appendFile(file(root), concurrent);
      },
    }),
  );
  assert.deepEqual(await readFile(file(root)), Buffer.concat([initial, concurrent]));
  await assert.rejects(
    compactCursorLedger(root, profile, proof, {
      afterPublish() {
        throw new Error("interrupted-after-rename");
      },
    }),
  );
  const read = await readCursorLedger(root, profile, later);
  assert.equal(read.events.length, 3);
  assert.equal(await compactCursorLedger(root, profile, proof), false);
});

test("Cursor compaction rejects an unproven prefix and preserves gaps and account conflicts", async (context) => {
  const root = await fixture(context);
  await recordStop(root);
  await recordStop(root, { ...stop, generation_id: "second" });
  await recordStop(
    root,
    { ...stop, generation_id: "conflicting", user_email: "other@example.test" },
    later,
  );
  const before = await readCursorLedger(root, profile, later);
  const original = await readFile(file(root));
  assert.equal(
    await compactCursorLedger(root, profile, { ...before.checkpoint, sha256: "0".repeat(64) }),
    false,
  );
  assert.deepEqual(await readFile(file(root)), original);
  assert.equal(await compactCursorLedger(root, profile, before.checkpoint), true);
  const after = await readCursorLedger(root, profile, later);
  assert.equal(after.events.length, 0);
  assert.deepEqual(after.gaps, before.gaps);
});

test("Cursor adapter isolates accounts, sums per-turn events and preserves component arithmetic", async (context) => {
  const root = await fixture(context);
  await recordStop(root);
  await recordStop(root, { ...stop, generation_id: "a-second", output_tokens: 5 });
  await recordStop(root, {
    ...stop,
    generation_id: "b-first",
    session_id: "b-session",
    user_email: "b@example.test",
  });
  const ledger = await readCursorLedger(root, profile, later);
  const [a, b] = ledger.accounts;
  const source = {
    agentId: "cursor",
    collectionMethod: "cursor_local_events",
    clientSourceId: profile,
    providerAccountKey: a.accountKey,
  };
  const range = { rangeStart: "2026-09-04", rangeEnd: "2026-09-04" };
  const collected = await collectCursor(
    source,
    range,
    {},
    { stateRoot: root, now: later, hooksCurrent: true },
  );
  assert.deepEqual(collected.entries, [
    {
      date: "2026-09-04",
      totalTokens: "261",
      inputTokens: "200",
      outputTokens: "15",
      cacheReadTokens: "40",
      cacheWriteTokens: "6",
      reasoningTokens: "0",
    },
  ]);
  assert.equal(collected.completeness, "complete");
  const secondary = await collectCursor(
    {
      ...source,
      clientSourceId: randomUUID(),
      profileClientSourceId: profile,
      providerAccountKey: b.accountKey,
    },
    range,
    {},
    { stateRoot: root, now: later, hooksCurrent: true },
  );
  assert.equal(secondary.entries[0].totalTokens, "133");
  assert.equal(JSON.stringify(collected.entries).includes(a.accountKey), false);
});

test("Cursor adapter never invents pre-capture zeros and current-day coverage remains partial", async (context) => {
  const root = await fixture(context);
  await recordStop(root);
  const accountKey = (await readCursorLedger(root, profile, later)).accounts[0].accountKey;
  const source = {
    agentId: "cursor",
    collectionMethod: "cursor_local_events",
    clientSourceId: profile,
    providerAccountKey: accountKey,
  };
  const old = await collectCursor(
    source,
    { rangeStart: "2026-01-01", rangeEnd: "2026-01-31" },
    {},
    { stateRoot: root, now: later, hooksCurrent: true },
  );
  assert.deepEqual(old.entries, []);
  assert.equal(old.completeness, "partial");
  const current = await collectCursor(
    source,
    { rangeStart: "2026-09-04", rangeEnd: "2026-09-04" },
    {},
    { stateRoot: root, now: at, hooksCurrent: true },
  );
  assert.equal(current.completeness, "partial");
  const unchecked = await collectCursor(
    source,
    { rangeStart: "2026-09-04", rangeEnd: "2026-09-04" },
    {},
    { stateRoot: root, now: later },
  );
  assert.equal(unchecked.completeness, "partial");
});

test("Cursor adapter rejects truncated history and cannot substitute another account", async (context) => {
  const root = await fixture(context);
  await recordStop(root);
  const prefixSize = (await stat(file(root))).size;
  await recordStop(root, { ...stop, generation_id: "second" });
  const accountKey = (await readCursorLedger(root, profile, later)).accounts[0].accountKey;
  const source = {
    agentId: "cursor",
    collectionMethod: "cursor_local_events",
    clientSourceId: profile,
    providerAccountKey: accountKey,
  };
  const range = { rangeStart: "2026-09-04", rangeEnd: "2026-09-04" };
  const collected = await collectCursor(source, range, {}, { stateRoot: root, now: later });
  await assert.rejects(
    collectCursor(
      { ...source, providerAccountKey: `acct1_${"x".repeat(43)}` },
      range,
      {},
      { stateRoot: root, now: later },
    ),
    { diagnosticCode: "cursor_account_identity_unavailable" },
  );
  await truncate(file(root), prefixSize);
  await assert.rejects(
    collectCursor(source, range, collected.nextState, { stateRoot: root, now: later }),
    { diagnosticCode: "cursor_usage_incomplete" },
  );
});

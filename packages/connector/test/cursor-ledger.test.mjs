import assert from "node:assert/strict";
import test from "node:test";
import {
  readFile,
  appendFile,
  rm,
  chmod,
  link,
  symlink,
  stat,
  truncate,
  rename,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  initializeCursorLedger,
  beginCursorHeadlessCapture,
  readCursorLedger,
  maximumCursorLedgerBytes,
  compactCursorLedger,
  repairCursorLedger,
  reserveCursorEvents,
  acknowledgeCursorCapture,
  compactAcknowledgedCursorCapture,
} from "../lib/cursor-ledger.mjs";
import { collectCursor } from "../lib/adapters/cursor.mjs";
import {
  profile,
  captureId,
  start,
  at,
  later,
  stop,
  result,
  end,
  file,
  fixture,
  recordStop,
  half,
} from "../test-support/cursor-ledger-fixture.mjs";

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

test("Cursor source reservations survive an unknown upload outcome, reset and compaction", async (context) => {
  const root = await fixture(context);
  await recordStop(root);
  const accountKey = (await readCursorLedger(root, profile, later)).accounts[0].accountKey;
  const range = { rangeStart: "2026-09-04", rangeEnd: "2026-09-05" };
  const oldSource = randomUUID();
  const newSource = randomUUID();
  assert.equal(
    await reserveCursorEvents(root, profile, { sourceId: oldSource, accountKey, ...range }, later),
    1,
  );
  // The request might have succeeded remotely; neither a missing ACK nor reset can transfer it.
  const source = {
    agentId: "cursor",
    collectionMethod: "cursor_local_events",
    clientSourceId: profile,
    providerAccountKey: accountKey,
  };
  const collect = (sourceId) =>
    collectCursor({ ...source, sourceId }, range, {}, { stateRoot: root, now: later });
  assert.deepEqual((await collect(newSource)).entries, []);
  assert.equal((await collect(oldSource)).entries[0].totalTokens, "133");
  await recordStop(root, { ...stop, generation_id: "new-after-reset", input_tokens: 200 }, later);
  assert.equal((await collect(newSource)).entries[0].totalTokens, "233");
  assert.equal((await collect(oldSource)).entries[0].totalTokens, "133");
  const before = await readCursorLedger(root, profile, later);
  assert.equal(await compactCursorLedger(root, profile, before.checkpoint), true);
  const after = await readCursorLedger(root, profile, later);
  assert.deepEqual(after.eventOwners, before.eventOwners);
  assert.equal((await collect(newSource)).entries[0].totalTokens, "233");
  assert.equal((await collect(oldSource)).entries[0].totalTokens, "133");
});

test("Cursor ACK compaction proves each account and range and retains the unacknowledged suffix", async (context) => {
  const root = await fixture(context);
  await recordStop(root);
  await recordStop(root, { ...stop, generation_id: "same-day-second" });
  const accountKey = (await readCursorLedger(root, profile, later)).accounts[0].accountKey;
  const sourceId = randomUUID();
  const range = { rangeStart: "2026-09-04", rangeEnd: "2026-09-04" };
  await reserveCursorEvents(root, profile, { sourceId, accountKey, ...range }, later);
  const checkpoint = (await readCursorLedger(root, profile, later)).checkpoint;
  const before = await readFile(file(root));
  assert.equal(await compactAcknowledgedCursorCapture(root, profile), false);
  assert.deepEqual(await readFile(file(root)), before);
  await recordStop(root, { ...stop, generation_id: "next-day", input_tokens: 200 }, later);
  const unacknowledgedSuffix = (await readFile(file(root))).subarray(before.length);
  const proof = { sourceId, ...range, checkpoint };
  assert.equal(
    await acknowledgeCursorCapture(root, profile, { ...proof, sourceId: randomUUID() }, later),
    true,
  );
  assert.equal(await compactAcknowledgedCursorCapture(root, profile), false);
  assert.equal(
    await acknowledgeCursorCapture(
      root,
      profile,
      { ...proof, checkpoint: { ...checkpoint, sha256: "0".repeat(64) } },
      later,
    ),
    false,
  );
  assert.equal(await acknowledgeCursorCapture(root, profile, proof, later), true);
  const once = await readFile(file(root));
  assert.equal(await acknowledgeCursorCapture(root, profile, proof, later), true);
  assert.deepEqual(await readFile(file(root)), once);
  assert.equal(await compactAcknowledgedCursorCapture(root, profile), true);
  const compacted = await readFile(file(root));
  assert.ok(compacted.includes(unacknowledgedSuffix));
  const ledger = await readCursorLedger(root, profile, later);
  assert.deepEqual(
    ledger.events.map((event) => event.tokens.totalTokens),
    ["133", "133", "233"],
  );
  assert.equal(await compactAcknowledgedCursorCapture(root, profile), false);
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

test("Cursor time before capture start records a gap without adding usage", async (context) => {
  const root = await fixture(context);
  assert.equal((await recordStop(root, stop, "2026-09-03T23:59:59.999Z")).status, "partial");
  const read = await readCursorLedger(root, profile, later);
  assert.equal(read.events.length, 0);
  assert.equal(read.gaps[0].code, "cursor_usage_incomplete");
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
  await assert.rejects(initializeCursorLedger(root, profile, start));
  const fresh = await fixture(context);
  await appendFile(file(fresh), '{"prompt":"private-malformed-content"}\n');
  await assert.rejects(readCursorLedger(fresh, profile, later), {
    message: "cursor_schema_unsupported",
  });
});

test("Cursor durable proof rejects truncation and same-content replacement without a sync cache", async (context) => {
  const root = await fixture(context);
  const prefix = (await stat(file(root))).size;
  await recordStop(root);
  await truncate(file(root), prefix);
  await assert.rejects(readCursorLedger(root, profile, later), {
    diagnosticCode: "cursor_usage_incomplete",
  });
  const other = await fixture(context);
  const bytes = await readFile(file(other));
  const replacement = `${file(other)}.replacement`;
  await writeFile(replacement, bytes, { mode: 0o600 });
  await rename(replacement, file(other));
  await assert.rejects(readCursorLedger(other, profile, later), {
    diagnosticCode: "cursor_usage_incomplete",
  });
});

test("Cursor observed append after a writer crash advances durable proof before returning", async (context) => {
  const root = await fixture(context);
  const prefix = (await stat(file(root))).size;
  // Simulate a complete fsynced line whose writer died before updating the sidecar.
  await appendFile(file(root), `${JSON.stringify({ v: 1, kind: "current", at: later })}\n`);
  await readCursorLedger(root, profile, later);
  await truncate(file(root), prefix);
  await assert.rejects(readCursorLedger(root, profile, later));
});

test("Cursor observed torn suffix cannot be manually removed to erase its coverage gap", async (context) => {
  const root = await fixture(context);
  const prefix = (await stat(file(root))).size;
  await appendFile(file(root), '{"v":1,"kind":');
  assert.equal((await readCursorLedger(root, profile, later)).torn, true);
  await truncate(file(root), prefix);
  await assert.rejects(readCursorLedger(root, profile, later));
});

test("Cursor capacity exhaustion stays partial after acknowledged compaction frees space", async (context) => {
  const root = await fixture(context);
  await recordStop(root);
  const bytes = await readFile(file(root));
  const event = bytes
    .toString()
    .split("\n")
    .find((line) => line.includes('"kind":"event"'));
  const duplicate = Buffer.from(`${event}\n`);
  const copies = Math.floor((maximumCursorLedgerBytes - bytes.length) / duplicate.length);
  await appendFile(file(root), Buffer.from(duplicate.toString().repeat(copies)));
  const nearLimit = await readCursorLedger(root, profile, later);
  assert.equal(nearLimit.events.length, 1);
  assert.ok(nearLimit.gaps.some((gap) => gap.code === "local_store_scan_limit"));
  assert.equal(await compactCursorLedger(root, profile, nearLimit.checkpoint), true);
  assert.ok((await stat(file(root))).size < maximumCursorLedgerBytes - 16_384);
  const compacted = await readCursorLedger(root, profile, later);
  assert.equal(compacted.events.length, 1);
  assert.ok(compacted.gaps.some((gap) => gap.code === "local_store_scan_limit"));
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

for (const order of ["stop-first", "headless-first"]) {
  test(`Cursor secondary dedup ${order} preserves the final result UTC date across replay and compaction`, async (context) => {
    const root = await fixture(context);
    await beginCursorHeadlessCapture(root, profile, captureId, "2026-09-04T23:59:50.000Z");
    if (order === "stop-first") {
      await recordStop(root);
      assert.equal((await readCursorLedger(root, profile, at)).events.length, 0);
    }
    await half(root, "result", result, later);
    await half(root, "binding", end, "2026-09-05T00:00:00.100Z");
    if (order === "headless-first") await recordStop(root);
    let ledger = await readCursorLedger(root, profile, later);
    assert.equal(ledger.events.length, 1);
    assert.equal(ledger.events[0].origin, "headless");
    assert.equal(ledger.events[0].date, "2026-09-05");
    assert.equal(ledger.events[0].capturedAt, later);
    assert.equal(ledger.events[0].tokens.totalTokens, "133");
    assert.equal(ledger.gaps.length, 0);
    const before = await readFile(file(root));
    await recordStop(root, stop, "2026-09-06T00:00:00.000Z");
    assert.deepEqual(await readFile(file(root)), before);
    assert.equal(await compactCursorLedger(root, profile, ledger.checkpoint), true);
    ledger = await readCursorLedger(root, profile, later);
    assert.equal(ledger.events.length, 1);
    assert.equal(ledger.events[0].capturedAt, later);
    // A later normal turn may reuse the session and exact tuple without being the same run.
    await recordStop(
      root,
      { ...stop, generation_id: "later-normal-turn" },
      "2026-09-05T00:00:01.000Z",
    );
    assert.equal(
      (await readCursorLedger(root, profile, "2026-09-05T00:00:02.000Z")).events.length,
      2,
    );
  });

  test(`Cursor secondary tuple conflict ${order} retains the first confirmed event with a partial gap`, async (context) => {
    const root = await fixture(context);
    await beginCursorHeadlessCapture(root, profile, captureId, "2026-09-04T23:59:50.000Z");
    const conflict = { ...stop, input_tokens: 200 };
    if (order === "stop-first") await recordStop(root, conflict);
    await half(root, "result", result, later);
    await half(root, "binding", end, later);
    if (order === "headless-first") await recordStop(root, conflict);
    const ledger = await readCursorLedger(root, profile, later);
    assert.equal(ledger.events.length, 1);
    assert.equal(ledger.events[0].origin, order === "stop-first" ? "stop" : "headless");
    assert.equal(ledger.events[0].tokens.totalTokens, order === "stop-first" ? "233" : "133");
    assert.ok(ledger.gaps.some((gap) => gap.code === "cursor_event_identity_conflict"));
  });
}

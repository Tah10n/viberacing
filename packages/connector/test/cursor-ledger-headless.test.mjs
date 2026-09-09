import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { releaseOwnedLock } from "../lib/owned-lock.mjs";
import {
  beginCursorHeadlessCapture,
  finishCursorHeadlessCapture,
  readCursorLedger,
  recordCursorCapture,
} from "../lib/cursor-ledger.mjs";
import {
  profile,
  captureId,
  salt,
  start,
  at,
  later,
  stop,
  result,
  end,
  file,
  fixture,
  half,
  compactHeadlessFixture,
} from "../test-support/cursor-ledger-fixture.mjs";

for (const order of ["result-first", "binding-first"]) {
  test(`Cursor long-running wrapper keeps exact aggregate in ${order} order`, async (context) => {
    const root = await fixture(context);
    const owner = await beginCursorHeadlessCapture(root, profile, captureId, start);
    const firstKind = order === "result-first" ? "result" : "binding";
    const secondKind = firstKind === "result" ? "binding" : "result";
    const finished = "2026-09-04T00:31:00.000Z";
    if (firstKind === "result")
      await finishCursorHeadlessCapture(root, profile, captureId, owner, finished);
    await half(root, firstKind, firstKind === "result" ? result : end, finished);
    if (firstKind === "binding")
      await finishCursorHeadlessCapture(root, profile, captureId, owner, finished);
    await releaseOwnedLock(owner);
    await half(root, secondKind, secondKind === "result" ? result : end, finished);
    const ledger = await readCursorLedger(root, profile, finished);
    assert.equal(ledger.events.length, 1);
    assert.equal(ledger.events[0].origin, "headless");
    assert.equal(ledger.events[0].tokens.totalTokens, "133");
    assert.equal(ledger.events[0].capturedAt, finished);
    assert.equal(ledger.pendingPairs, 0);
    assert.equal(ledger.gaps.length, 0);
    const bytes = await readFile(file(root));
    await half(root, "result", result, "2026-09-04T02:00:00.000Z");
    await half(root, "binding", end, "2026-09-04T02:00:00.000Z");
    assert.deepEqual(await readFile(file(root)), bytes);
    await compactHeadlessFixture(root, finished);
    assert.deepEqual((await readCursorLedger(root, profile, finished)).events, ledger.events);
  });

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

test("Cursor contradictory account after headless completion blocks that session", async (context) => {
  const root = await fixture(context);
  await half(root, "result", result);
  await half(root, "binding", end);
  await half(root, "binding", { ...end, user_email: "other@example.test" }, later);
  const read = await readCursorLedger(root, profile, later);
  assert.equal(read.events.length, 0);
  assert.equal(read.gaps.at(-1).code, "cursor_account_identity_conflict");
});

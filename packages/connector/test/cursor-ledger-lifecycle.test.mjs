import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { releaseOwnedLock } from "../lib/owned-lock.mjs";
import {
  beginCursorHeadlessCapture,
  finishCursorHeadlessCapture,
  readCursorLedger,
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
  hookObservation,
  file,
  fixture,
  recordStop,
  half,
  compactHeadlessFixture,
} from "../test-support/cursor-ledger-fixture.mjs";

test("Cursor unresolved wrapper holds ambiguous stops but releases a proven independent Desktop session", async (context) => {
  const root = await fixture(context);
  await beginCursorHeadlessCapture(root, profile, captureId, "2026-09-04T23:59:50.000Z");
  await recordStop(root, { ...stop, session_id: "independent-desktop-session" });
  assert.equal((await readCursorLedger(root, profile, at)).events.length, 0);
  await half(root, "binding", end, later);
  assert.equal((await readCursorLedger(root, profile, later)).events.length, 1);
  await half(root, "result", result, later);
  const ledger = await readCursorLedger(root, profile, later);
  assert.equal(ledger.events.length, 2);
  assert.equal(ledger.gaps.length, 0);
});

test("Cursor abandoned wrapper excludes ambiguous stops only inside its bounded failed interval", async (context) => {
  const root = await fixture(context);
  const owner = await beginCursorHeadlessCapture(root, profile, captureId, at);
  await recordStop(root);
  assert.equal((await readCursorLedger(root, profile, at)).events.length, 0);
  await releaseOwnedLock(owner);
  // Observe the lost owner after the crash grace, before a later independent turn.
  const abandonedAt = "2026-09-05T00:31:00.000Z";
  assert.equal((await readCursorLedger(root, profile, abandonedAt)).pendingPairs, 0);
  // A later independent capture expires the old marker without discarding subsequent days.
  await recordStop(root, { ...stop, generation_id: "next-day-turn" }, "2026-09-06T00:00:00.000Z");
  const ledger = await readCursorLedger(root, profile, "2026-09-06T00:00:00.000Z");
  assert.equal(ledger.pendingPairs, 0);
  assert.equal(ledger.events.length, 1);
  assert.equal(ledger.events[0].date, "2026-09-06");
  assert.ok(ledger.gaps.some((gap) => gap.code === "cursor_headless_pair_incomplete"));
});

test("Cursor live long wrapper survives Desktop traffic and another wrapper without uploading a markerless stop across UTC", async (context) => {
  const root = await fixture(context);
  const began = "2026-09-04T23:00:00.000Z";
  const running = "2026-09-04T23:45:00.000Z";
  const finished = "2026-09-05T00:15:00.000Z";
  const owner = await beginCursorHeadlessCapture(root, profile, captureId, began);
  await recordStop(root, stop, running);
  await recordStop(
    root,
    { ...stop, session_id: "independent-desktop", generation_id: "desktop-during-long-wrapper" },
    running,
  );
  let ledger = await readCursorLedger(root, profile, running);
  assert.equal(ledger.pendingPairs, 1);
  assert.deepEqual(ledger.events, []);
  const sourceId = randomUUID();
  const account = ledger.accounts[0].accountKey;
  const scope = { sourceId, accountKey: account, rangeStart: "2026-09-04", rangeEnd: "2026-09-05" };
  assert.equal(await reserveCursorEvents(root, profile, scope, running), 0);
  const secondId = randomUUID();
  const second = await beginCursorHeadlessCapture(root, profile, secondId, running);
  await half(root, "binding", { ...end, session_id: "second-wrapper-session" }, running, secondId);
  ledger = await readCursorLedger(root, profile, running);
  assert.equal(ledger.pendingPairs, 2);
  assert.deepEqual(ledger.events, []);
  // Even an acknowledged prefix cannot erase or release the live unresolved capture.
  await compactHeadlessFixture(root, running);
  assert.deepEqual((await readCursorLedger(root, profile, finished)).events, []);
  await half(root, "binding", end, finished);
  await finishCursorHeadlessCapture(root, profile, captureId, owner, finished);
  await half(root, "result", result, finished);
  await releaseOwnedLock(owner);
  await half(root, "abort", null, finished, secondId);
  await releaseOwnedLock(second);
  const source = {
    agentId: "cursor",
    collectionMethod: "cursor_local_events",
    clientSourceId: profile,
    providerAccountKey: account,
  };
  const collected = await collectCursor(
    source,
    scope,
    {},
    { stateRoot: root, now: finished, hookObservation },
  );
  assert.deepEqual(
    collected.entries.map(({ date, totalTokens }) => ({ date, totalTokens })),
    [
      { date: "2026-09-04", totalTokens: "133" },
      { date: "2026-09-05", totalTokens: "133" },
    ],
  );
  ledger = await readCursorLedger(root, profile, finished);
  assert.equal(ledger.events.length, 2);
  assert.equal(ledger.events.find((event) => event.origin === "headless").capturedAt, finished);
  assert.equal(await reserveCursorEvents(root, profile, scope, finished), 2);
  ledger = await readCursorLedger(root, profile, finished);
  assert.equal(
    await acknowledgeCursorCapture(
      root,
      profile,
      {
        sourceId,
        rangeStart: scope.rangeStart,
        rangeEnd: scope.rangeEnd,
        checkpoint: ledger.checkpoint,
      },
      finished,
    ),
    true,
  );
  // The independent unresolved prefix still prevents an acknowledged rewrite.
  assert.equal(await compactAcknowledgedCursorCapture(root, profile), false);
  assert.deepEqual((await readCursorLedger(root, profile, finished)).events, ledger.events);
});

test("Cursor finished long wrapper bounds missing-half wait from native close, even while its owner lives", async (context) => {
  for (const expired of [false, true]) {
    const root = await fixture(context);
    const owner = await beginCursorHeadlessCapture(root, profile, captureId, start);
    const finished = "2026-09-04T00:31:00.000Z";
    await half(root, "binding", end, finished);
    await finishCursorHeadlessCapture(root, profile, captureId, owner, finished);
    const arrival = expired ? "2026-09-04T01:02:00.000Z" : "2026-09-04T01:00:00.000Z";
    if (expired) assert.equal((await readCursorLedger(root, profile, arrival)).pendingPairs, 0);
    await half(root, "result", result, arrival);
    await releaseOwnedLock(owner);
    const ledger = await readCursorLedger(root, profile, arrival);
    assert.equal(ledger.events.length, expired ? 0 : 1);
    assert.equal(ledger.pendingPairs, 0);
    assert.equal(
      ledger.gaps.some((gap) => gap.code === "cursor_headless_pair_incomplete"),
      expired,
    );
    const bytes = await readFile(file(root));
    await half(root, "binding", end, arrival);
    await half(root, "result", result, arrival);
    assert.deepEqual(await readFile(file(root)), bytes);
  }
});

test("Cursor long capture uses native close for its window without changing the earlier result timestamp", async (context) => {
  const root = await fixture(context);
  const began = "2026-09-04T23:00:00.000Z";
  const emitted = "2026-09-04T23:59:59.999Z";
  const stopped = "2026-09-05T00:00:00.001Z";
  const closed = "2026-09-05T00:00:10.000Z";
  const owner = await beginCursorHeadlessCapture(root, profile, captureId, began);
  await assert.rejects(
    finishCursorHeadlessCapture(
      root,
      profile,
      captureId,
      {
        ...owner,
        owner: `${process.pid}:${randomUUID()}\n`,
      },
      closed,
    ),
    { diagnosticCode: "cursor_usage_incomplete" },
  );
  await half(root, "binding", end, emitted);
  await recordStop(root, stop, stopped);
  assert.deepEqual((await readCursorLedger(root, profile, stopped)).events, []);
  await finishCursorHeadlessCapture(root, profile, captureId, owner, closed);
  await releaseOwnedLock(owner);
  await half(root, "result", result, emitted);
  let ledger = await readCursorLedger(root, profile, closed);
  assert.equal(ledger.events.length, 1);
  assert.equal(ledger.events[0].origin, "headless");
  assert.equal(ledger.events[0].capturedAt, emitted);
  assert.equal(ledger.events[0].date, "2026-09-04");
  await compactHeadlessFixture(root, closed);
  ledger = await readCursorLedger(root, profile, closed);
  assert.equal(ledger.events.length, 1);
  assert.equal(ledger.events[0].capturedAt, emitted);
});

test("Cursor crashed wrapper is bounded by real owner liveness and never revives after compaction", async (context) => {
  const root = await fixture(context);
  const moduleUrl = new URL("../lib/cursor-ledger.mjs", import.meta.url).href;
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    const { beginCursorHeadlessCapture } = await import(${JSON.stringify(moduleUrl)});
    await beginCursorHeadlessCapture(${JSON.stringify(root)}, ${JSON.stringify(profile)}, ${JSON.stringify(captureId)}, ${JSON.stringify(start)});
  `,
    ],
    { timeout: 60_000 },
  );
  const expired = "2026-09-04T00:31:00.000Z";
  const ledger = await readCursorLedger(root, profile, expired);
  assert.equal(ledger.pendingPairs, 0);
  assert.equal(ledger.gaps.at(-1).code, "cursor_headless_pair_incomplete");
  await compactHeadlessFixture(root, expired);
  await half(root, "result", result, expired);
  await half(root, "binding", end, expired);
  assert.deepEqual((await readCursorLedger(root, profile, expired)).events, []);
});

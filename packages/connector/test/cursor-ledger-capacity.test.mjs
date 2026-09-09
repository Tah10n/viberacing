import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { releaseOwnedLock } from "../lib/owned-lock.mjs";
import { withCursorDeadline } from "../lib/cursor-deadline.mjs";
import { beginCursorHeadlessCapture, readCursorLedger } from "../lib/cursor-ledger.mjs";
import { inspectOwnerOnlyWindowsFile } from "../lib/windows-security.mjs";
import {
  profile,
  start,
  stop,
  file,
  fixture,
  recordStop,
} from "../test-support/cursor-ledger-fixture.mjs";

test("Cursor pending capacity includes all 64 live long wrappers without evicting the oldest", async (context) => {
  const root = await fixture(context);
  const owners = [];
  for (let index = 0; index < 64; index++)
    owners.push(await beginCursorHeadlessCapture(root, profile, randomUUID(), start));
  assert.equal(await inspectOwnerOnlyWindowsFile(owners[0].path), true);
  const running = "2026-09-04T00:31:00.000Z";
  await assert.rejects(beginCursorHeadlessCapture(root, profile, randomUUID(), running), {
    diagnosticCode: "local_store_scan_limit",
  });
  const ledger = await readCursorLedger(root, profile, running);
  assert.equal(ledger.pendingPairs, 64);
  assert.equal(ledger.gaps.length, 64);
  assert.equal((await readFile(file(root), "utf8")).includes('"kind":"abort"'), false);
  // Reading all live owner proofs must also fit the unchanged production hook budget.
  await withCursorDeadline(() => recordStop(root, stop, running));
  assert.deepEqual((await readCursorLedger(root, profile, running)).events, []);
  for (const owner of owners) await releaseOwnedLock(owner);
});

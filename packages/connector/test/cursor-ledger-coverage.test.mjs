import assert from "node:assert/strict";
import test from "node:test";
import { readFile, rm, stat, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  initializeCursorLedger,
  beginCursorHeadlessCapture,
  recordCursorHookObservation,
  readCursorLedger,
  compactCursorLedger,
} from "../lib/cursor-ledger.mjs";
import { collectCursor } from "../lib/adapters/cursor.mjs";
import {
  profile,
  captureId,
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
} from "../test-support/cursor-ledger-fixture.mjs";

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
    { stateRoot: root, now: later, hookObservation },
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
    { stateRoot: root, now: later, hookObservation },
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
    { stateRoot: root, now: later, hookObservation },
  );
  assert.deepEqual(old.entries, []);
  assert.equal(old.completeness, "partial");
  const current = await collectCursor(
    source,
    { rangeStart: "2026-09-04", rangeEnd: "2026-09-04" },
    {},
    { stateRoot: root, now: at, hookObservation },
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

test("Cursor collection cannot upload the stop day before a midnight headless pair resolves", async (context) => {
  const root = await fixture(context);
  await beginCursorHeadlessCapture(root, profile, captureId, "2026-09-04T23:59:50.000Z");
  await recordStop(root);
  const account = (await readCursorLedger(root, profile, at)).accounts[0];
  const source = {
    agentId: "cursor",
    collectionMethod: "cursor_local_events",
    clientSourceId: profile,
    providerAccountKey: account.accountKey,
  };
  const range = { rangeStart: "2026-09-04", rangeEnd: "2026-09-05" };
  const before = await collectCursor(
    source,
    range,
    {},
    { stateRoot: root, now: at, hookObservation },
  );
  assert.deepEqual(before.entries, []);
  assert.equal(before.completeness, "partial");
  await half(root, "result", result, later);
  await half(root, "binding", end, later);
  const after = await collectCursor(source, range, before.nextState, {
    stateRoot: root,
    now: later,
    hookObservation,
  });
  assert.equal(after.entries.length, 1);
  assert.equal(after.entries[0].date, "2026-09-05");
  assert.equal(after.entries[0].totalTokens, "133");
});

test("Cursor pending account conflict cannot release a stop for the same session", async (context) => {
  const root = await fixture(context);
  await beginCursorHeadlessCapture(root, profile, captureId, "2026-09-04T23:59:50.000Z");
  await recordStop(root);
  await half(root, "binding", { ...end, user_email: "conflicting-account@example.test" }, later);
  assert.equal((await readCursorLedger(root, profile, later)).events.length, 0);
  await half(root, "result", result, later);
  const ledger = await readCursorLedger(root, profile, later);
  assert.equal(ledger.events.length, 0);
  assert.ok(ledger.gaps.some((gap) => gap.code === "cursor_account_identity_conflict"));
});

test("Cursor hook continuity closes only observed intact past days and retains repair gaps", async (context) => {
  const root = await fixture(context);
  await recordStop(root);
  await recordStop(root, { ...stop, generation_id: "second-observed-turn" });
  await recordCursorHookObservation(root, profile, hookObservation, "2026-09-05T00:00:00.000Z");
  const missing = { hooks: { stop: "missing", sessionEnd: "missing" }, fingerprint: null };
  await recordCursorHookObservation(root, profile, missing, "2026-09-05T12:00:00.000Z");
  const repaired = {
    ...hookObservation,
    fingerprint: { ...hookObservation.fingerprint, ino: "3" },
  };
  await recordCursorHookObservation(root, profile, repaired, "2026-09-05T13:00:00.000Z");
  await recordCursorHookObservation(root, profile, repaired, "2026-09-07T00:00:00.000Z");
  const ledger = await readCursorLedger(root, profile, "2026-09-07T00:00:00.000Z");
  const source = {
    agentId: "cursor",
    collectionMethod: "cursor_local_events",
    clientSourceId: profile,
    providerAccountKey: ledger.accounts[0].accountKey,
  };
  for (const [day, expected] of [
    ["2026-09-03", "partial"],
    ["2026-09-04", "complete"],
    ["2026-09-05", "partial"],
    ["2026-09-06", "complete"],
    ["2026-09-07", "partial"],
  ]) {
    const result = await collectCursor(
      source,
      { rangeStart: day, rangeEnd: day },
      {},
      { stateRoot: root, now: "2026-09-07T00:00:00.000Z" },
    );
    assert.equal(result.completeness, expected, day);
  }
  assert.ok(
    ledger.gaps.some(
      (gap) => gap.code === "cursor_hook_missing" && gap.from === "2026-09-05T00:00:00.000Z",
    ),
  );
  const before = ledger.currentIntervals;
  assert.equal(await compactCursorLedger(root, profile, ledger.checkpoint), true);
  const compacted = await readCursorLedger(root, profile, "2026-09-07T00:00:00.000Z");
  assert.deepEqual(compacted.currentIntervals, before);
  assert.deepEqual(compacted.gaps, ledger.gaps);
  assert.equal(compacted.versions.desktop, "3.19.7");
});

test("Cursor current hook replacement and backward clock observations cannot silently complete history", async (context) => {
  const root = await fixture(context);
  const changed = {
    ...hookObservation,
    fingerprint: { ...hookObservation.fingerprint, mtimeMs: 5678 },
  };
  await recordCursorHookObservation(root, profile, changed, "2026-09-06T00:00:00.000Z");
  let ledger = await readCursorLedger(root, profile, "2026-09-06T00:00:00.000Z");
  assert.equal(ledger.currentIntervals.length, 0);
  assert.ok(ledger.gaps.some((gap) => gap.code === "cursor_hook_stale"));
  await recordCursorHookObservation(root, profile, changed, "2026-09-05T12:00:00.000Z");
  ledger = await readCursorLedger(root, profile, "2026-09-06T00:00:00.000Z");
  assert.ok(
    ledger.gaps.some(
      (gap) => gap.code === "cursor_usage_incomplete" && gap.from === "2026-09-05T12:00:00.000Z",
    ),
  );
});

test("Cursor repeated same-day or unchanged missing-hook inspections do not churn retry generations", async (context) => {
  const root = await fixture(context);
  const initial = await readFile(file(root));
  assert.equal(await recordCursorHookObservation(root, profile, hookObservation, at), false);
  assert.deepEqual(await readFile(file(root)), initial);
  await recordCursorHookObservation(root, profile, hookObservation, later);
  const advanced = await readFile(file(root));
  assert.ok(advanced.length > initial.length);
  const missing = {
    hooks: { stop: "missing", sessionEnd: "current" },
    fingerprint: hookObservation.fingerprint,
  };
  await recordCursorHookObservation(root, profile, missing, "2026-09-05T12:00:00.000Z");
  const interrupted = await readFile(file(root));
  assert.equal(
    await recordCursorHookObservation(root, profile, missing, "2026-09-08T12:00:00.000Z"),
    false,
  );
  assert.deepEqual(await readFile(file(root)), interrupted);
  const ledger = await readCursorLedger(root, profile, "2026-09-08T12:00:00.000Z");
  assert.ok(
    ledger.gaps.some(
      (gap) => gap.code === "cursor_hook_missing" && gap.to === "2026-09-08T12:00:00.000Z",
    ),
  );
});

test("an unfinished durable hook intent changes a complete past day to partial and survives repair", async (context) => {
  const { prepareCursorIngress, beginCursorIngress, completeCursorIngress } =
    await import("../lib/cursor-ingress.mjs");
  const { ensureOwnerOnlyWindowsFile } = await import("../lib/windows-security.mjs");
  const root = await fixture(context);
  await recordStop(root);
  const ledger = await readCursorLedger(root, profile, later);
  const source = {
    agentId: "cursor",
    collectionMethod: "cursor_local_events",
    clientSourceId: profile,
    providerAccountKey: ledger.accounts[0].accountKey,
  };
  const range = { rangeStart: "2026-09-04", rangeEnd: "2026-09-04" };
  const collect = () =>
    collectCursor(source, range, {}, { stateRoot: root, now: later, hookObservation });
  assert.equal((await collect()).completeness, "complete");
  const request = { profileId: profile, installationId: randomUUID() };
  await writeFile(join(root, "config.json"), "{}", { mode: 0o600 });
  await ensureOwnerOnlyWindowsFile(join(root, "config.json"));
  await prepareCursorIngress(root, request);
  const intent = await beginCursorIngress(root, request, at);
  assert.ok(intent);
  assert.equal(await readFile(intent.file, "utf8"), at);
  const partial = await collect();
  assert.equal(partial.completeness, "partial");
  assert.ok(partial.diagnostics.some((item) => item.code === "cursor_capture_deadline"));
  await initializeCursorLedger(root, profile, later);
  await prepareCursorIngress(root, request);
  assert.equal((await collect()).completeness, "partial");
  // Existing exact event is durable; completing its retry may now remove the intent.
  await completeCursorIngress(intent);
  assert.equal((await collect()).completeness, "complete");
  await rm(join(root, "captures", `cursor-${profile}.ingress`), { recursive: true });
  await assert.rejects(readCursorLedger(root, profile, later));
  await assert.rejects(initializeCursorLedger(root, profile, later));
});

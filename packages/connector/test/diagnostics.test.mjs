import test from "node:test";
import assert from "node:assert/strict";
import {
  acknowledgeDiagnosticEvents,
  collectorDiagnostic,
  diagnosticCodesByPhase,
  ensureDiagnosticState,
  forgetSourceDiagnostics,
  normalizeAdapterDiagnostics,
  pendingDiagnosticEvents,
  reconcileDiagnosticPhase,
} from "../lib/diagnostics.mjs";

const sourceId = "11111111-1111-4111-8111-111111111111";

test("collector diagnostics use only explicit allowlisted codes", () => {
  assert.deepEqual(collectorDiagnostic(new Error("ENOENT /private/repository")), {
    code: "collector_failed",
    phase: "collect",
  });
  assert.deepEqual(
    collectorDiagnostic({ diagnosticCode: "agent_api_timeout", message: "secret" }),
    {
      code: "agent_api_timeout",
      phase: "collect",
    },
  );
  assert.deepEqual(
    normalizeAdapterDiagnostics([
      { code: "codex_lineage_ambiguous", phase: "collect", message: "secret" },
      { code: "codex_lineage_ambiguous", phase: "collect" },
      { code: "future_code", phase: "collect" },
      { code: "automatic_sync_failed", phase: "sync" },
    ]),
    [{ code: "codex_lineage_ambiguous", phase: "collect" }],
  );
});

test("diagnostic transitions emit opened once and resolved once", () => {
  const state = { version: 1, sequences: {} };
  const active = [{ code: "codex_lineage_ambiguous", phase: "collect" }];

  reconcileDiagnosticPhase(state, sourceId, "collect", active);
  reconcileDiagnosticPhase(state, sourceId, "collect", active);
  assert.deepEqual(pendingDiagnosticEvents(state, [sourceId]), [
    {
      sourceId,
      code: "codex_lineage_ambiguous",
      state: "opened",
      phase: "collect",
    },
  ]);

  reconcileDiagnosticPhase(state, sourceId, "collect", []);
  assert.deepEqual(pendingDiagnosticEvents(state, [sourceId]), [
    {
      sourceId,
      code: "codex_lineage_ambiguous",
      state: "opened",
      phase: "collect",
    },
    {
      sourceId,
      code: "codex_lineage_ambiguous",
      state: "resolved",
      phase: "collect",
    },
  ]);
});

test("pending diagnostics can be scoped without pruning another configured source", () => {
  const otherSourceId = "22222222-2222-4222-8222-222222222222";
  const state = { version: 1, sequences: {} };
  for (const id of [sourceId, otherSourceId]) {
    reconcileDiagnosticPhase(state, id, "collect", [
      { code: "collector_failed", phase: "collect" },
    ]);
  }

  const selected = pendingDiagnosticEvents(state, [sourceId, otherSourceId], 32, [sourceId]);
  assert.deepEqual(
    selected.map((event) => event.sourceId),
    [sourceId],
  );
  acknowledgeDiagnosticEvents(state, selected);

  assert.deepEqual(
    pendingDiagnosticEvents(state, [sourceId, otherSourceId]).map((event) => event.sourceId),
    [otherSourceId],
  );
});

test("offline oscillation remains bounded while preserving the current transition", () => {
  const state = { version: 1, sequences: {} };
  const active = [{ code: "collector_failed", phase: "collect" }];
  reconcileDiagnosticPhase(state, sourceId, "collect", active);
  reconcileDiagnosticPhase(state, sourceId, "collect", []);
  reconcileDiagnosticPhase(state, sourceId, "collect", active);

  assert.deepEqual(pendingDiagnosticEvents(state, [sourceId]), [
    { sourceId, code: "collector_failed", state: "opened", phase: "collect" },
  ]);
});

test("acknowledgement removes only the delivered batch", () => {
  const state = { version: 1, sequences: {} };
  reconcileDiagnosticPhase(state, sourceId, "collect", [
    { code: "collector_failed", phase: "collect" },
    { code: "local_store_unreadable", phase: "collect" },
    { code: "local_store_schema_unsupported", phase: "collect" },
  ]);
  const [first] = pendingDiagnosticEvents(state, [sourceId], 1);
  acknowledgeDiagnosticEvents(state, [first]);

  assert.equal(pendingDiagnosticEvents(state, [sourceId]).length, 2);
  assert.notEqual(pendingDiagnosticEvents(state, [sourceId])[0].code, first.code);
});

test("state sanitization and source removal retain no raw diagnostic data", () => {
  const state = {
    version: 1,
    diagnostics: {
      version: 1,
      activeBySource: {
        [sourceId]: ["collect:collector_failed", "message:/private/repository"],
        hostile: ["collect:collector_failed"],
      },
      outboxBySource: {
        [sourceId]: {
          "collect:collector_failed": ["opened", "opened", "resolved"],
          "collect:future_code": ["opened"],
        },
      },
      message: "secret",
      stack: "private stack",
    },
  };

  ensureDiagnosticState(state);
  const serialized = JSON.stringify(state.diagnostics);
  assert.doesNotMatch(serialized, /private|secret|stack|message|future_code|hostile/);
  forgetSourceDiagnostics(state, sourceId);
  assert.deepEqual(state.diagnostics, { version: 1, activeBySource: {}, outboxBySource: {} });
});

test("outbox is bounded by sources, allowlisted keys, and two transitions per key", () => {
  const state = { version: 1, sequences: {} };
  const sourceIds = Array.from(
    { length: 32 },
    (_, index) =>
      `11111111-1111-4111-8${index.toString().padStart(3, "0")}-${index
        .toString()
        .padStart(12, "0")}`,
  );
  for (const id of sourceIds) {
    for (const [phase, codes] of Object.entries(diagnosticCodesByPhase)) {
      reconcileDiagnosticPhase(
        state,
        id,
        phase,
        codes.map((code) => ({ code, phase })),
      );
      reconcileDiagnosticPhase(state, id, phase, []);
    }
  }
  let count = 0;
  for (;;) {
    const events = pendingDiagnosticEvents(state, sourceIds, 32);
    if (events.length === 0) break;
    assert.ok(events.length <= 32);
    count += events.length;
    acknowledgeDiagnosticEvents(state, events);
  }
  const allowlistedKeys = Object.values(diagnosticCodesByPhase).reduce(
    (total, codes) => total + codes.length,
    0,
  );
  assert.equal(count, 32 * allowlistedKeys * 2);
});

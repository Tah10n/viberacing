import assert from "node:assert/strict";
import test from "node:test";
import {
  cursorVersionSupported,
  decodeCursorInput,
  maximumCursorInputBytes,
  parseCursorStop,
  parseCursorResult,
  parseCursorSessionEnd,
  pairCursorHeadless,
  reconcileCursorEvent,
} from "../lib/cursor-events.mjs";

const salt = "s".repeat(43);
const capturedAt = "2026-09-04T23:59:59.999Z";
const later = "2026-09-05T00:00:00.001Z";
const options = { salt, capturedAt };
const version = "2026.09.02-c22c1a3";
const stop = {
  hook_event_name: "stop",
  cursor_version: "3.18.25",
  status: "completed",
  user_email: "synthetic@example.test",
  generation_id: "synthetic-generation",
  session_id: "synthetic-session",
  input_tokens: 100,
  output_tokens: 12,
  cache_read_tokens: 30,
  cache_write_tokens: 4,
};
const result = {
  type: "result",
  subtype: "success",
  is_error: false,
  request_id: "synthetic-request",
  session_id: stop.session_id,
  usage: { inputTokens: 100, outputTokens: 12, cacheReadTokens: 30, cacheWriteTokens: 4 },
};
const end = {
  hook_event_name: "sessionEnd",
  cursor_version: version,
  final_status: "completed",
  reason: "completed",
  session_id: stop.session_id,
  user_email: stop.user_email,
};

test("Cursor stop accepts exact Desktop and interactive contracts without inventing provider time", () => {
  for (const cursor_version of ["3.18.25", "3.19.7", version]) {
    const parsed = parseCursorStop({ ...stop, cursor_version }, options);
    assert.equal(parsed.event.tokens.totalTokens, "146");
    assert.equal(parsed.event.tokens.reasoningTokens, "0");
    assert.equal(parsed.event.capturedAt, capturedAt);
    assert.equal(parsed.event.date, "2026-09-04");
    assert.equal(Object.hasOwn(parsed.event, "providerTimestamp"), false);
  }
});

test("Cursor version gates reject every unverified release and build even with a matching field shape", () => {
  for (const value of [
    "3.18.24",
    "3.18.26",
    "3.19.8",
    "3.20.0",
    "2.99.99",
    "4.0.0",
    "3.19.0-beta",
    "3.019.0",
    "2026.09.01-c22c1a3",
    "2026.09.02-deadbee",
    "2026.09.03-c22c1a3",
    "2026.02.30-c22c1a3",
    "2026.13.01-c22c1a3",
    "unknown",
    null,
  ])
    assert.equal(cursorVersionSupported(value), false);
  assert.equal(cursorVersionSupported("3.19.7", "cli"), false);
  assert.equal(cursorVersionSupported(version, "desktop"), false);
  assert.throws(() => parseCursorResult(result, { ...options, version: "4.0.0" }), {
    diagnosticCode: "cursor_version_unsupported",
  });
});

test("Cursor exact counters reject missing, noncanonical, fractional and unsafe numbers", () => {
  for (const key of ["input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens"]) {
    for (const value of [
      undefined,
      null,
      "1",
      -1,
      -0,
      0.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ])
      assert.throws(() => parseCursorStop({ ...stop, [key]: value }, options), {
        diagnosticCode: "cursor_usage_incomplete",
      });
  }
  assert.throws(() => parseCursorStop({ ...stop, total_tokens: 145 }, options), {
    diagnosticCode: "cursor_usage_incomplete",
  });
  const large = parseCursorStop(
    {
      ...stop,
      input_tokens: Number.MAX_SAFE_INTEGER,
      output_tokens: Number.MAX_SAFE_INTEGER,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    },
    options,
  );
  assert.equal(large.event.tokens.totalTokens, "18014398509481982");
});

test("Cursor schema, identities and capture time are required independently", () => {
  for (const key of [
    "generation_id",
    "session_id",
    "user_email",
    "status",
    "hook_event_name",
    "cursor_version",
  ])
    assert.throws(() => parseCursorStop({ ...stop, [key]: undefined }, options));
  for (const time of [
    undefined,
    "2026-09-04",
    "2026-02-30T00:00:00.000Z",
    "2026-09-04T00:00:00+02:00",
  ])
    assert.throws(() => parseCursorStop(stop, { salt, capturedAt: time }), {
      diagnosticCode: "cursor_usage_incomplete",
    });
  assert.throws(() => parseCursorStop({ ...stop, status: "error" }, options), {
    diagnosticCode: "cursor_usage_incomplete",
  });
});

test("Cursor content descendants cannot supply counters or leak through sanitized results", () => {
  const canaries = {
    prompt: "secret-prompt",
    result: "secret-response",
    code: "secret-source",
    cwd: "/secret/repository",
    model: "secret-model",
    cost: "secret-cost",
    access_token: "secret-access",
    api_key: "secret-api-key",
    tool_arguments: "secret-tool-arguments",
  };
  const payload = { ...stop, ...canaries, reasoning_tokens: 50, tool: { input_tokens: 999999 } };
  const parsed = parseCursorStop(payload, options);
  assert.equal(parsed.event.tokens.totalTokens, "146");
  const serialized = JSON.stringify(parsed);
  for (const value of [
    ...Object.values(canaries),
    stop.user_email,
    stop.generation_id,
    stop.session_id,
  ])
    assert.equal(serialized.includes(value), false);
  assert.throws(() => parseCursorStop({ ...payload, input_tokens: undefined }, options));
});

test("Cursor bounded JSON decoder rejects invalid UTF-8, malformed JSON and oversized input", () => {
  assert.deepEqual(decodeCursorInput(Buffer.from(JSON.stringify(stop))), stop);
  for (const bytes of [
    Buffer.from([0xff]),
    Buffer.from("{"),
    Buffer.from("null"),
    Buffer.from("[]"),
    Buffer.alloc(maximumCursorInputBytes + 1),
  ])
    assert.throws(() => decodeCursorInput(bytes), { diagnosticCode: "cursor_schema_unsupported" });
});

test("Cursor headless uses result capture day with either half arriving first", () => {
  let first;
  for (const order of ["result-first", "hook-first"]) {
    let usage, binding;
    if (order === "result-first") {
      usage = parseCursorResult(result, { ...options, version });
      binding = parseCursorSessionEnd(end, { salt, capturedAt: later }).binding;
    } else {
      binding = parseCursorSessionEnd(end, { salt, capturedAt: later }).binding;
      usage = parseCursorResult(result, { ...options, version });
    }
    const event = pairCursorHeadless(usage, binding);
    assert.equal(event.date, "2026-09-04");
    assert.equal(event.tokens.totalTokens, "146");
    if (first) assert.deepEqual(event, first);
    first = event;
  }
  assert.throws(
    () =>
      pairCursorHeadless(
        parseCursorResult(result, { ...options, version }),
        parseCursorSessionEnd({ ...end, session_id: "different" }, options).binding,
      ),
    { diagnosticCode: "cursor_account_identity_conflict" },
  );
});

test("Cursor aborted and incomplete headless input cannot produce successful parsed usage", () => {
  for (const patch of [
    { is_error: true },
    { subtype: "error" },
    { request_id: undefined },
    { session_id: undefined },
    { usage: {} },
  ])
    assert.throws(() => parseCursorResult({ ...result, ...patch }, { ...options, version }));
  for (const patch of [
    { final_status: "error" },
    { reason: "error" },
    { user_email: undefined },
    { session_id: undefined },
  ])
    assert.throws(() => parseCursorSessionEnd({ ...end, ...patch }, options));
  assert.deepEqual(parseCursorStop(stop, { ...options, headlessOwned: true }), {
    suppressed: true,
  });
});

test("Cursor replay preserves first capture time and counts per-generation usage once", () => {
  const initial = parseCursorStop(stop, options).event;
  const repeated = parseCursorStop(stop, { salt, capturedAt: later }).event;
  const merged = reconcileCursorEvent(initial, repeated);
  assert.equal(merged.status, "duplicate");
  assert.equal(merged.event.capturedAt, capturedAt);
  assert.equal(merged.event.date, "2026-09-04");
  const next = parseCursorStop(
    { ...stop, generation_id: "second", output_tokens: 3 },
    { salt, capturedAt: later },
  ).event;
  assert.notEqual(next.eventKey, initial.eventKey);
  assert.equal(BigInt(initial.tokens.totalTokens) + BigInt(next.tokens.totalTokens), 283n);
  const conflict = reconcileCursorEvent(initial, {
    ...repeated,
    tokens: { ...repeated.tokens, totalTokens: "200" },
  });
  assert.equal(conflict.status, "conflict");
  assert.deepEqual(conflict.event, initial);
});

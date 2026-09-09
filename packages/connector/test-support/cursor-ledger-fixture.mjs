import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  initializeCursorLedger,
  recordCursorHookObservation,
  readCursorLedger,
  recordCursorCapture,
  compactCursorLedger,
} from "../lib/cursor-ledger.mjs";
import { ensurePrivateStateDirectory } from "../lib/windows-security.mjs";

export const profile = "11111111-1111-4111-8111-111111111111";
export const captureId = "22222222-2222-4222-8222-222222222222";
export const salt = "s".repeat(43);
export const start = "2026-09-04T00:00:00.000Z";
export const at = "2026-09-04T23:59:59.999Z";
export const later = "2026-09-05T00:00:00.001Z";
export const stop = {
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
export const result = {
  type: "result",
  subtype: "success",
  is_error: false,
  request_id: "private-request",
  session_id: stop.session_id,
  usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 20, cacheWriteTokens: 3 },
};
export const end = {
  hook_event_name: "sessionEnd",
  cursor_version: "2026.09.02-c22c1a3",
  final_status: "completed",
  reason: "completed",
  session_id: stop.session_id,
  user_email: stop.user_email,
};
export const hookObservation = {
  hooks: { stop: "current", sessionEnd: "current" },
  fingerprint: { dev: "1", ino: "2", size: 100, mtimeMs: 1234, ctimeMs: 1234 },
};
export const file = (root) => join(root, "captures", `cursor-${profile}.jsonl`);
export async function fixture(context) {
  const root = await mkdtemp(join(tmpdir(), "viberacing-cursor-ledger-"));
  await ensurePrivateStateDirectory(root);
  context.after(() => rm(root, { recursive: true, force: true }));
  await initializeCursorLedger(root, profile, start);
  await recordCursorHookObservation(root, profile, hookObservation, start);
  return root;
}
export const recordStop = (root, payload = stop, capturedAt = at) =>
  recordCursorCapture(root, profile, { kind: "stop", salt, payload, capturedAt });
export const half = (root, kind, payload, capturedAt = at, id = captureId) =>
  recordCursorCapture(root, profile, {
    kind,
    payload,
    salt,
    capturedAt,
    captureId: id,
    version: "2026.09.02-c22c1a3",
  });

export async function compactHeadlessFixture(root, now) {
  // Repeated account snapshots make lossless compaction smaller; the independent
  // pending sessions also prove that its suffix/half preservation remains intact.
  for (let index = 0; index < 2; index++)
    await half(
      root,
      "binding",
      { ...end, session_id: `compaction-session-${index}` },
      now,
      randomUUID(),
    );
  const before = await readCursorLedger(root, profile, now);
  assert.equal(await compactCursorLedger(root, profile, before.checkpoint), true);
  assert.deepEqual((await readCursorLedger(root, profile, now)).events, before.events);
}

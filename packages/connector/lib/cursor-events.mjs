import { createHmac } from "node:crypto";
import { resolveCursorAccount } from "./cursor-identity.mjs";

export const cursorParserVersion = 1;
export const maximumCursorInputBytes = 1_048_576;
const components = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"];

function fail(code) {
  const error = new Error(code);
  error.diagnosticCode = code;
  throw error;
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function cursorVersionSupported(version, surface) {
  if (typeof version !== "string") return false;
  if (surface !== "cli") {
    const desktop = /^3\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/.exec(version);
    if (desktop)
      return Number(desktop[1]) > 18 || (Number(desktop[1]) === 18 && Number(desktop[2]) >= 25);
  }
  if (surface === "desktop") return false;
  const cli = /^(20\d{2})\.(\d{2})\.(\d{2})-[a-f0-9]{7,40}$/.exec(version);
  if (!cli) return false;
  const date = `${cli[1]}-${cli[2]}-${cli[3]}`;
  const ms = Date.parse(`${date}T00:00:00.000Z`);
  return (
    Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === date && date >= "2026-09-02"
  );
}

export function decodeCursorInput(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > maximumCursorInputBytes)
    fail("cursor_schema_unsupported");
  const text = bytes.toString("utf8");
  if (!bytes.equals(Buffer.from(text))) fail("cursor_schema_unsupported");
  try {
    const value = JSON.parse(text);
    if (!object(value)) fail("cursor_schema_unsupported");
    return value;
  } catch {
    fail("cursor_schema_unsupported");
  }
}

function captureTime(capturedAt) {
  if (
    typeof capturedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(capturedAt)
  )
    fail("cursor_usage_incomplete");
  const ms = Date.parse(capturedAt);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== capturedAt)
    fail("cursor_usage_incomplete");
  return { capturedAt, date: capturedAt.slice(0, 10) };
}

function identityKey(value, salt, domain) {
  if (
    typeof salt !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(salt) ||
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 1_024 ||
    value.trim() !== value ||
    /[\p{Cc}\p{Cs}]/u.test(value)
  )
    fail("cursor_usage_incomplete");
  return `evt1_${createHmac("sha256", salt).update(`viberacing/cursor/${domain}/v1\0`).update(value).digest("base64url")}`;
}

function tokenTuple(values, declaredTotal) {
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)))
    fail("cursor_usage_incomplete");
  const total = values.reduce((sum, value) => sum + BigInt(value), 0n);
  if (
    declaredTotal !== undefined &&
    (!Number.isSafeInteger(declaredTotal) || declaredTotal < 0 || BigInt(declaredTotal) !== total)
  )
    fail("cursor_usage_incomplete");
  return {
    ...Object.fromEntries(components.map((component, index) => [component, String(values[index])])),
    // Cursor includes reasoning in output. This zero is only our normalized representation.
    reasoningTokens: "0",
    totalTokens: total.toString(),
  };
}

function hook(payload, name) {
  if (!object(payload) || payload.hook_event_name !== name) fail("cursor_schema_unsupported");
  if (!cursorVersionSupported(payload.cursor_version)) fail("cursor_version_unsupported");
}

export function parseCursorStop(
  payload,
  { salt, accounts = [], capturedAt, headlessOwned = false },
) {
  if (headlessOwned) return { suppressed: true };
  hook(payload, "stop");
  if (payload.status !== "completed") fail("cursor_usage_incomplete");
  const time = captureTime(capturedAt);
  const eventKey = identityKey(payload.generation_id, salt, "generation");
  const sessionKey = identityKey(payload.session_id, salt, "session");
  const tokens = tokenTuple(
    [
      payload.input_tokens,
      payload.output_tokens,
      payload.cache_read_tokens,
      payload.cache_write_tokens,
    ],
    payload.total_tokens,
  );
  // Only this identity path is supported by the authenticated hook evidence.
  const account = resolveCursorAccount({ email: payload.user_email }, salt, accounts);
  return {
    accounts: account.accounts,
    event: {
      schemaVersion: 1,
      parserVersion: cursorParserVersion,
      eventKey,
      sessionKey,
      accountKey: account.accountKey,
      ...time,
      origin: "stop",
      tokens,
    },
  };
}

export function parseCursorResult(payload, { salt, version, capturedAt }) {
  if (!cursorVersionSupported(version, "cli")) fail("cursor_version_unsupported");
  if (
    !object(payload) ||
    payload.type !== "result" ||
    payload.subtype !== "success" ||
    payload.is_error !== false ||
    !object(payload.usage)
  )
    fail("cursor_schema_unsupported");
  return {
    eventKey: identityKey(payload.request_id, salt, "request"),
    sessionKey: identityKey(payload.session_id, salt, "session"),
    ...captureTime(capturedAt),
    tokens: tokenTuple(
      components.map((key) => payload.usage[key]),
      payload.usage.totalTokens,
    ),
  };
}

export function parseCursorSessionEnd(payload, { salt, accounts = [], capturedAt }) {
  hook(payload, "sessionEnd");
  if (payload.final_status !== "completed" || payload.reason !== "completed")
    fail("cursor_usage_incomplete");
  const account = resolveCursorAccount({ email: payload.user_email }, salt, accounts);
  return {
    accounts: account.accounts,
    binding: {
      accountKey: account.accountKey,
      sessionKey: identityKey(payload.session_id, salt, "session"),
      ...captureTime(capturedAt),
    },
  };
}

// The result receipt time owns headless attribution; hook arrival order never changes it.
export function pairCursorHeadless(result, binding) {
  if (result.sessionKey !== binding.sessionKey) fail("cursor_account_identity_conflict");
  return {
    schemaVersion: 1,
    parserVersion: cursorParserVersion,
    eventKey: result.eventKey,
    sessionKey: result.sessionKey,
    accountKey: binding.accountKey,
    capturedAt: result.capturedAt,
    date: result.date,
    origin: "headless",
    tokens: { ...result.tokens },
  };
}

// Called under the capture lock before writing. A replay cannot move an accepted event to
// a new day. A conflicting identity preserves the original tuple and requires a partial gap.
export function reconcileCursorEvent(existing, incoming) {
  if (existing === undefined) return { status: "new", event: incoming };
  if (existing.eventKey !== incoming.eventKey) fail("cursor_event_identity_conflict");
  const same =
    existing.accountKey === incoming.accountKey &&
    existing.sessionKey === incoming.sessionKey &&
    existing.origin === incoming.origin &&
    [...components, "reasoningTokens", "totalTokens"].every(
      (key) => existing.tokens[key] === incoming.tokens[key],
    );
  return { status: same ? "duplicate" : "conflict", event: existing };
}

import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { acquireOwnedLock, releaseOwnedLock } from "./owned-lock.mjs";
import {
  ensureOwnerOnlyWindowsFile,
  ensurePrivateStateDirectory,
  inspectOwnerOnlyWindowsDirectory,
  inspectOwnerOnlyWindowsFile,
} from "./windows-security.mjs";
import { diagnosticCodesByPhase } from "./diagnostics.mjs";
import {
  parseCursorStop,
  parseCursorResult,
  parseCursorSessionEnd,
  pairCursorHeadless,
  reconcileCursorEvent,
  cursorVersionSupported,
  maximumCursorInputBytes,
} from "./cursor-events.mjs";

export const maximumCursorLedgerBytes = 8 * 1024 * 1024;
export const cursorPairTimeoutMs = 30 * 60 * 1000;
const maximumLineBytes = 16_384;
const capacityWarningBytes = maximumCursorLedgerBytes - maximumLineBytes;
const maximumPendingPairs = 64;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash = /^evt1_[A-Za-z0-9_-]{43}$/;
const accountHash = /^acct1_[A-Za-z0-9_-]{43}$/;
const aliasHash = /^alias1_[A-Za-z0-9_-]{43}$/;
const tokenKeys = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "reasoningTokens",
  "totalTokens",
];
const failureCodes = new Set(diagnosticCodesByPhase.collect);

function fail(code = "cursor_usage_incomplete") {
  const error = new Error(code);
  error.diagnosticCode = code;
  throw error;
}
function keys(value, allowed) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === allowed.length &&
    allowed.every((key) => Object.hasOwn(value, key))
  );
}
function time(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}
function tokens(value) {
  if (
    !keys(value, tokenKeys) ||
    tokenKeys.some(
      (key) => typeof value[key] !== "string" || !/^(0|[1-9]\d{0,16})$/.test(value[key]),
    )
  )
    return false;
  return (
    value.reasoningTokens === "0" &&
    tokenKeys.slice(0, 4).reduce((sum, key) => sum + BigInt(value[key]), 0n) ===
      BigInt(value.totalTokens)
  );
}
function accounts(value) {
  if (!Array.isArray(value) || value.length > 8) return false;
  const seen = new Set();
  for (const item of value) {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      !accountHash.test(item.accountKey) ||
      Object.keys(item).some((key) => !["accountKey", "emailKey", "idKey"].includes(key)) ||
      (item.emailKey === undefined && item.idKey === undefined)
    )
      return false;
    for (const key of ["accountKey", "emailKey", "idKey"]) {
      const digest = item[key];
      if (digest === undefined) continue;
      if ((key !== "accountKey" && !aliasHash.test(digest)) || seen.has(digest)) return false;
      seen.add(digest);
    }
  }
  return true;
}
function usage(value) {
  return (
    keys(value, ["eventKey", "sessionKey", "capturedAt", "date", "tokens"]) &&
    hash.test(value.eventKey) &&
    hash.test(value.sessionKey) &&
    time(value.capturedAt) &&
    value.date === value.capturedAt.slice(0, 10) &&
    tokens(value.tokens)
  );
}
function binding(value) {
  return (
    keys(value, ["accountKey", "sessionKey", "capturedAt", "date"]) &&
    accountHash.test(value.accountKey) &&
    hash.test(value.sessionKey) &&
    time(value.capturedAt) &&
    value.date === value.capturedAt.slice(0, 10)
  );
}
function event(value) {
  if (
    !keys(value, [
      "schemaVersion",
      "parserVersion",
      "eventKey",
      "sessionKey",
      "accountKey",
      "capturedAt",
      "date",
      "origin",
      "tokens",
    ])
  )
    return false;
  const { schemaVersion, parserVersion, accountKey, origin, ...rest } = value;
  return (
    schemaVersion === 1 &&
    parserVersion === 1 &&
    accountHash.test(accountKey) &&
    ["stop", "headless"].includes(origin) &&
    usage(rest)
  );
}
const hookStates = new Set(["current", "missing", "modified", "stale"]);
function hookFingerprint(value) {
  return (
    value === null ||
    (keys(value, ["dev", "ino", "size", "mtimeMs", "ctimeMs"]) &&
      typeof value.dev === "string" &&
      /^\d{1,32}$/.test(value.dev) &&
      typeof value.ino === "string" &&
      /^\d{1,32}$/.test(value.ino) &&
      Number.isSafeInteger(value.size) &&
      value.size >= 0 &&
      value.size <= maximumCursorInputBytes &&
      Number.isFinite(value.mtimeMs) &&
      value.mtimeMs >= 0 &&
      value.mtimeMs <= Number.MAX_SAFE_INTEGER &&
      Number.isFinite(value.ctimeMs) &&
      value.ctimeMs >= 0 &&
      value.ctimeMs <= Number.MAX_SAFE_INTEGER)
  );
}
function validRecord(record) {
  if (!record || record.v !== 1) return false;
  if (record.kind === "ack")
    return (
      keys(record, ["v", "kind", "sourceId", "eventKeys"]) &&
      uuid.test(record.sourceId) &&
      Array.isArray(record.eventKeys) &&
      record.eventKeys.length > 0 &&
      record.eventKeys.length <= 128 &&
      record.eventKeys.every((value) => hash.test(value)) &&
      new Set(record.eventKeys).size === record.eventKeys.length
    );
  if (record.kind === "owner")
    return (
      keys(record, ["v", "kind", "at", "sourceId", "accountKey", "eventKeys"]) &&
      time(record.at) &&
      uuid.test(record.sourceId) &&
      accountHash.test(record.accountKey) &&
      Array.isArray(record.eventKeys) &&
      record.eventKeys.length > 0 &&
      record.eventKeys.length <= 128 &&
      record.eventKeys.every((value) => hash.test(value)) &&
      new Set(record.eventKeys).size === record.eventKeys.length
    );
  if (record.kind === "hooks")
    return (
      keys(record, ["v", "kind", "at", "hooks", "fingerprint"]) &&
      time(record.at) &&
      keys(record.hooks, ["stop", "sessionEnd"]) &&
      Object.values(record.hooks).every((value) => hookStates.has(value)) &&
      hookFingerprint(record.fingerprint) &&
      (!(record.hooks.stop === "current" && record.hooks.sessionEnd === "current") ||
        record.fingerprint !== null)
    );
  if (record.kind === "version")
    return (
      keys(record, ["v", "kind", "at", "surface", "value"]) &&
      time(record.at) &&
      ["desktop", "cli"].includes(record.surface) &&
      cursorVersionSupported(record.value, record.surface)
    );
  if (["start", "current"].includes(record.kind))
    return keys(record, ["v", "kind", "at"]) && time(record.at);
  if (record.kind === "gap")
    return (
      keys(record, ["v", "kind", "from", "to", "code"]) &&
      time(record.from) &&
      time(record.to) &&
      record.from <= record.to &&
      failureCodes.has(record.code)
    );
  if (record.kind === "accounts")
    return keys(record, ["v", "kind", "accounts"]) && accounts(record.accounts);
  if (record.kind === "captured")
    return keys(record, ["v", "kind", "event"]) && event(record.event);
  if (record.kind === "accountBinding")
    return (
      keys(record, ["v", "kind", "captureId", "binding"]) &&
      uuid.test(record.captureId) &&
      binding(record.binding)
    );
  if (record.kind === "event")
    return (
      keys(record, ["v", "kind", "event", "accounts"]) &&
      event(record.event) &&
      accounts(record.accounts) &&
      record.accounts.some((item) => item.accountKey === record.event.accountKey)
    );
  if (record.kind === "result")
    return (
      keys(record, ["v", "kind", "captureId", "usage"]) &&
      uuid.test(record.captureId) &&
      usage(record.usage)
    );
  if (record.kind === "binding")
    return (
      keys(record, ["v", "kind", "captureId", "binding", "accounts"]) &&
      uuid.test(record.captureId) &&
      binding(record.binding) &&
      accounts(record.accounts) &&
      record.accounts.some((item) => item.accountKey === record.binding.accountKey)
    );
  if (["begin", "abort"].includes(record.kind))
    return (
      keys(record, ["v", "kind", "captureId", "at"]) &&
      uuid.test(record.captureId) &&
      time(record.at)
    );
  return false;
}

// A compatible stop must fall inside the same durable wrapper invocation. Session reuse
// outside that interval remains a separate per-turn event, even with identical counters.
function captureWindow(pending, end, eventKey) {
  const times = [pending.firstAt, pending.result?.capturedAt, pending.binding?.capturedAt, end]
    .filter(Boolean)
    .sort();
  return {
    from: times[0],
    to: times.at(-1),
    sessionKey: pending.result?.sessionKey ?? pending.binding?.sessionKey,
    accountKey: pending.binding?.accountKey,
    eventKey,
  };
}
function insideCapture(event, window) {
  return (
    event.capturedAt >= window.from &&
    event.capturedAt <= window.to &&
    (!window.sessionKey || event.sessionKey === window.sessionKey) &&
    (!window.accountKey || event.accountKey === window.accountKey)
  );
}
function capturedEvents(state, now) {
  const pending = [...state.pending.values()].map((item) => ({
    ...captureWindow(
      item,
      new Date(
        Math.min(Date.parse(now), Date.parse(item.firstAt) + cursorPairTimeoutMs),
      ).toISOString(),
    ),
    // A conflicting account on the same session is not proof of an independent stop.
    accountKey: undefined,
  }));
  return [...state.events.values()].filter(
    (item) =>
      !state.blockedSessions.has(item.sessionKey) &&
      !state.suppressedEvents.has(item.eventKey) &&
      // Defer a possibly duplicated stop until the wrapper's outcome is known. This also
      // prevents an early stop upload on the day before the final result crosses midnight.
      (item.origin !== "stop" || !pending.some((window) => insideCapture(item, window))),
  );
}

function fold(records) {
  const state = {
    accounts: [],
    events: new Map(),
    owners: new Map(),
    acknowledged: new Set(),
    pending: new Map(),
    completed: new Map(),
    gaps: [],
    captureStartedAt: null,
    lastObservedAt: null,
    sessionAccounts: new Map(),
    blockedSessions: new Set(),
    hookObservation: null,
    currentIntervals: [],
    versions: {},
    captureWindows: [],
    suppressedEvents: new Set(),
  };
  const gap = (from, to, code) =>
    state.gaps.push({ from: from < to ? from : to, to: from < to ? to : from, code });
  const accept = (incoming) => {
    const owner = state.sessionAccounts.get(incoming.sessionKey);
    if (owner && owner !== incoming.accountKey) {
      state.blockedSessions.add(incoming.sessionKey);
      gap(state.captureStartedAt, incoming.capturedAt, "cursor_account_identity_conflict");
      return;
    }
    state.sessionAccounts.set(incoming.sessionKey, incoming.accountKey);
    const old = state.events.get(incoming.eventKey);
    const result = reconcileCursorEvent(old, incoming);
    if (result.status === "conflict")
      gap(old.capturedAt, incoming.capturedAt, "cursor_event_identity_conflict");
    else state.events.set(incoming.eventKey, result.event);
  };
  for (const record of records) {
    if (!validRecord(record)) fail("cursor_schema_unsupported");
    const kind =
      record.kind === "captured"
        ? "event"
        : record.kind === "accountBinding"
          ? "binding"
          : record.kind;
    if (!state.captureStartedAt && record.kind !== "start") fail("cursor_schema_unsupported");
    const at =
      record.at ??
      record.event?.capturedAt ??
      record.usage?.capturedAt ??
      record.binding?.capturedAt ??
      record.to;
    // Pending halves can be committed in reverse capture-time order.
    if (at !== undefined)
      state.lastObservedAt =
        state.lastObservedAt && state.lastObservedAt > at ? state.lastObservedAt : at;
    if (record.accounts) {
      for (const old of state.accounts) {
        const next = record.accounts.find((item) => item.accountKey === old.accountKey);
        if (
          !next ||
          (old.emailKey && next.emailKey !== old.emailKey) ||
          (old.idKey && next.idKey !== old.idKey)
        )
          fail("cursor_account_identity_conflict");
      }
    }
    if (record.kind === "start") {
      if (state.captureStartedAt) fail("cursor_schema_unsupported");
      state.captureStartedAt = record.at;
    } else if (record.kind === "ack") {
      for (const eventKey of record.eventKeys) {
        if (state.owners.get(eventKey) !== record.sourceId) fail();
        state.acknowledged.add(eventKey);
      }
    } else if (record.kind === "owner") {
      for (const eventKey of record.eventKeys) {
        const event = state.events.get(eventKey);
        if (!event || event.accountKey !== record.accountKey)
          fail("cursor_event_identity_conflict");
        const owner = state.owners.get(eventKey);
        if (owner && owner !== record.sourceId)
          gap(event.capturedAt, record.at, "cursor_event_identity_conflict");
        else state.owners.set(eventKey, record.sourceId);
      }
    } else if (record.kind === "version") state.versions[record.surface] = record.value;
    else if (record.kind === "hooks") {
      const previous = state.hookObservation;
      const current = record.hooks.stop === "current" && record.hooks.sessionEnd === "current";
      if (previous && record.at < previous.at)
        gap(record.at, previous.at, "cursor_usage_incomplete");
      else if (
        previous &&
        current &&
        previous.hooks.stop === "current" &&
        previous.hooks.sessionEnd === "current" &&
        JSON.stringify(previous.fingerprint) === JSON.stringify(record.fingerprint)
      ) {
        const interval = state.currentIntervals.at(-1);
        if (interval?.to === previous.at) interval.to = record.at;
        else state.currentIntervals.push({ from: previous.at, to: record.at });
      } else if (previous)
        gap(
          previous.at,
          record.at,
          Object.values(record.hooks).includes("missing")
            ? "cursor_hook_missing"
            : "cursor_hook_stale",
        );
      state.hookObservation = record;
    } else if (record.kind === "gap")
      state.gaps.push({ from: record.from, to: record.to, code: record.code });
    else if (kind === "accounts") state.accounts = record.accounts;
    else if (kind === "event") {
      if (record.accounts) state.accounts = record.accounts;
      if (!state.accounts.some((item) => item.accountKey === record.event.accountKey))
        fail("cursor_account_identity_conflict");
      accept(record.event);
    } else if (record.kind === "begin") {
      if (!state.completed.has(record.captureId) && !state.pending.has(record.captureId))
        state.pending.set(record.captureId, { firstAt: record.at });
    } else if (record.kind === "abort") {
      const pending = state.pending.get(record.captureId);
      gap(pending?.firstAt ?? record.at, record.at, "cursor_headless_pair_incomplete");
      if (pending)
        state.captureWindows.push(
          captureWindow(
            pending,
            new Date(
              Math.min(Date.parse(record.at), Date.parse(pending.firstAt) + cursorPairTimeoutMs),
            ).toISOString(),
          ),
        );
      state.pending.delete(record.captureId);
      state.completed.set(record.captureId, null);
    } else if (kind === "result" || kind === "binding") {
      if (record.accounts) state.accounts = record.accounts;
      if (
        kind === "binding" &&
        !state.accounts.some((item) => item.accountKey === record.binding.accountKey)
      )
        fail("cursor_account_identity_conflict");
      if (state.completed.has(record.captureId)) continue;
      const pending = state.pending.get(record.captureId) ?? { firstAt: at };
      const half = kind === "result" ? record.usage : record.binding;
      const previous = pending[kind];
      if (
        previous &&
        JSON.stringify({ ...previous, capturedAt: "", date: "" }) !==
          JSON.stringify({ ...half, capturedAt: "", date: "" })
      ) {
        gap(pending.firstAt, at, "cursor_account_identity_conflict");
        state.pending.delete(record.captureId);
        state.completed.set(record.captureId, null);
        continue;
      }
      pending[kind] ??= half;
      if (pending.result && pending.binding) {
        if (pending.result.sessionKey !== pending.binding.sessionKey) {
          gap(pending.firstAt, at, "cursor_account_identity_conflict");
          state.blockedSessions.add(pending.result.sessionKey);
          state.blockedSessions.add(pending.binding.sessionKey);
        } else {
          accept(pairCursorHeadless(pending.result, pending.binding));
          state.captureWindows.push(captureWindow(pending, at, pending.result.eventKey));
        }
        state.pending.delete(record.captureId);
        state.completed.set(record.captureId, pending.result.eventKey);
      } else state.pending.set(record.captureId, pending);
    }
  }
  if (state.pending.size > maximumPendingPairs) fail("local_store_scan_limit");
  const positions = new Map([...state.events.keys()].map((key, index) => [key, index]));
  const stops = [...state.events.values()].filter((item) => item.origin === "stop");
  for (const window of state.captureWindows) {
    const headless = window.eventKey && state.events.get(window.eventKey);
    const matching = stops.filter((stop) => insideCapture(stop, window));
    if (
      !headless ||
      matching.every((stop) => JSON.stringify(stop.tokens) === JSON.stringify(headless.tokens))
    ) {
      for (const stop of matching) state.suppressedEvents.add(stop.eventKey);
      continue;
    }
    const candidates = [headless, ...matching].sort(
      (left, right) => positions.get(left.eventKey) - positions.get(right.eventKey),
    );
    for (const other of candidates.slice(1)) {
      gap(candidates[0].capturedAt, other.capturedAt, "cursor_event_identity_conflict");
      state.suppressedEvents.add(other.eventKey);
    }
  }
  return state;
}

function pathFor(root, profileId) {
  if (!isAbsolute(root) || !uuid.test(profileId)) fail("cursor_schema_unsupported");
  return join(root, "captures", `cursor-${profileId}.jsonl`);
}
async function safeDirectory(path) {
  const info = await lstat(path);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (typeof process.getuid === "function" &&
      (info.uid !== process.getuid() || (info.mode & 0o077) !== 0)) ||
    !(await inspectOwnerOnlyWindowsDirectory(path))
  )
    fail();
}
async function safeFile(path, allowMissing = false, checkAcl = true) {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (allowMissing && error.code === "ENOENT") return null;
    throw error;
  }
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    info.size > maximumCursorLedgerBytes ||
    (typeof process.getuid === "function" &&
      (info.uid !== process.getuid() || (info.mode & 0o077) !== 0)) ||
    (checkAcl && !(await inspectOwnerOnlyWindowsFile(path)))
  )
    fail();
  return info;
}

function validCheckpoint(value) {
  return (
    keys(value, ["version", "bytes", "sha256", "ino", "dev"]) &&
    value.version === 1 &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes >= 0 &&
    value.bytes <= maximumCursorLedgerBytes &&
    /^[a-f0-9]{64}$/.test(value.sha256) &&
    /^\d+$/.test(value.ino) &&
    /^\d+$/.test(value.dev)
  );
}
function matchesCheckpoint(proof, bytes, info) {
  return (
    validCheckpoint(proof) &&
    proof.bytes <= bytes.length &&
    proof.ino === String(info.ino) &&
    proof.dev === String(info.dev) &&
    checkpoint(bytes.subarray(0, proof.bytes), info).sha256 === proof.sha256
  );
}
async function syncDirectory(directory) {
  if (process.platform === "win32") return;
  const parent = await open(directory, constants.O_RDONLY);
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}
async function readLedgerProof(path) {
  const info = await safeFile(path, true);
  if (!info) return null;
  if (info.size > 1024) fail();
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (
      opened.ino !== info.ino ||
      opened.dev !== info.dev ||
      opened.size !== info.size ||
      opened.nlink !== 1
    )
      fail();
    const bytes = Buffer.alloc(info.size);
    if ((await handle.read(bytes, 0, bytes.length, 0)).bytesRead !== bytes.length) fail();
    const proof = JSON.parse(bytes.toString("utf8"));
    if (
      !keys(proof, proof.next ? ["version", "current", "next"] : ["version", "current"]) ||
      proof.version !== 1 ||
      !validCheckpoint(proof.current) ||
      (proof.next !== undefined && !validCheckpoint(proof.next))
    )
      fail();
    return proof;
  } finally {
    await handle.close();
  }
}
async function writeLedgerProof(path, directory, proof) {
  const before = await safeFile(path, true);
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let staged;
  try {
    staged = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    await ensureOwnerOnlyWindowsFile(temporary);
    await staged.writeFile(`${JSON.stringify(proof)}\n`);
    await staged.sync();
    await staged.close();
    staged = null;
    const current = await safeFile(path, true);
    if (
      before
        ? !current ||
          current.ino !== before.ino ||
          current.dev !== before.dev ||
          current.size !== before.size ||
          current.mtimeMs !== before.mtimeMs
        : current
    )
      fail();
    await safeFile(temporary);
    await rename(temporary, path);
    await syncDirectory(directory);
  } finally {
    await staged?.close();
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
async function withLedger(...args) {
  try {
    return await withLedgerFile(...args);
  } catch (error) {
    if (
      process.env.NODE_ENV === "test" &&
      process.env.VIBERACING_TEST_CURSOR_LEDGER_FAILURE === "1"
    ) {
      const sites = [...(error?.stack ?? "").matchAll(/cursor-ledger\.mjs:(\d+):\d+/g)]
        .slice(0, 4)
        .map((match) => match[1])
        .join(",");
      const code = ["EACCES", "EPERM", "ENOENT", "EEXIST", "EBUSY"].includes(error?.code)
        ? error.code
        : "unavailable";
      process.stderr.write(
        `Cursor ledger test failure: sites=${sites || "external"}; code=${code}\n`,
      );
    }
    fail(
      failureCodes.has(error?.diagnosticCode) ? error.diagnosticCode : "cursor_usage_incomplete",
    );
  }
}

async function withLedgerFile(root, profileId, operation, initialize = false) {
  await safeDirectory(root);
  const path = pathFor(root, profileId);
  const directory = join(root, "captures");
  if (initialize) {
    try {
      await mkdir(directory, { mode: 0o700 });
      await ensurePrivateStateDirectory(directory);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  await safeDirectory(directory);
  // The lock contains only a PID and random ownership token; the enclosing directory is private.
  await safeFile(`${path}.lock`, true, false);
  const lock = await acquireOwnedLock(`${path}.lock`, {
    waitMs: process.platform === "win32" ? 60_000 : 5_000,
  });
  if (!lock) fail();
  let handle;
  try {
    const proofPath = `${path}.proof.json`;
    const durableProof = await readLedgerProof(proofPath);
    let before = await safeFile(path, initialize);
    if (!before) {
      if (durableProof) fail();
      handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR, 0o600);
      await ensureOwnerOnlyWindowsFile(path);
      before = await safeFile(path);
    } else handle = await open(path, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    if (opened.ino !== before.ino || opened.dev !== before.dev || opened.nlink !== 1) fail();
    const bytes = Buffer.alloc(opened.size);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== bytes.length || !bytes.equals(Buffer.from(bytes.toString("utf8")))) fail();
    const lastNewline = bytes.lastIndexOf(10) + 1;
    const torn = lastNewline !== bytes.length;
    const lines = bytes.subarray(0, lastNewline).toString("utf8").split("\n").filter(Boolean);
    let records;
    try {
      records = lines.map((line) => {
        if (Buffer.byteLength(line) > maximumLineBytes) fail();
        return JSON.parse(line);
      });
    } catch {
      fail("cursor_schema_unsupported");
    }
    const state = fold(records);
    // This high-water mark lives beside the ledger, outside resettable sync state.
    // An interrupted replacement is accepted only with its precommitted inode and digest.
    if (durableProof) {
      if (
        !matchesCheckpoint(durableProof.current, bytes, opened) &&
        !matchesCheckpoint(durableProof.next, bytes, opened)
      )
        fail();
    } else if (!initialize || bytes.length !== 0) fail();
    const observedProof = {
      version: 1,
      current: checkpoint(bytes, opened),
    };
    if (JSON.stringify(observedProof) !== JSON.stringify(durableProof))
      await writeLedgerProof(proofPath, directory, observedProof);
    let durableBytes = bytes;
    let expectedSize = opened.size;
    const append = async (record) => {
      if (!validRecord(record)) fail("cursor_schema_unsupported");
      const line = Buffer.from(`${JSON.stringify(record)}\n`);
      const current = await safeFile(path);
      if (
        current.ino !== opened.ino ||
        current.dev !== opened.dev ||
        current.size !== expectedSize ||
        current.size !== (await handle.stat()).size ||
        torn
      )
        fail();
      if (line.length > maximumLineBytes || current.size + line.length > maximumCursorLedgerBytes)
        fail("local_store_scan_limit");
      for (let offset = 0; offset < line.length;) {
        const { bytesWritten } = await handle.write(
          line,
          offset,
          line.length - offset,
          current.size + offset,
        );
        if (bytesWritten < 1) fail();
        offset += bytesWritten;
      }
      expectedSize += line.length;
      await handle.sync();
      durableBytes = Buffer.concat([durableBytes, line]);
      await writeLedgerProof(proofPath, directory, {
        version: 1,
        current: checkpoint(durableBytes, opened),
      });
      if (process.platform !== "win32" && current.size === 0) {
        const parent = await open(directory, constants.O_RDONLY);
        try {
          await parent.sync();
        } finally {
          await parent.close();
        }
      }
      records.push(record);
    };
    const publish = async (replacement, options = {}) => {
      if (!Buffer.isBuffer(replacement) || replacement.length > maximumCursorLedgerBytes)
        fail("local_store_scan_limit");
      const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
      let staged;
      try {
        staged = await open(
          temporary,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
          0o600,
        );
        await ensureOwnerOnlyWindowsFile(temporary);
        await staged.writeFile(replacement);
        await staged.sync();
        await staged.close();
        staged = null;
        await options.beforePublish?.();
        const current = await safeFile(path);
        const currentBytes = Buffer.alloc(current.size);
        const { bytesRead } = await handle.read(currentBytes, 0, currentBytes.length, 0);
        if (
          current.ino !== opened.ino ||
          current.dev !== opened.dev ||
          current.size !== bytes.length ||
          bytesRead !== currentBytes.length ||
          !currentBytes.equals(bytes)
        )
          fail();
        const replacementInfo = await safeFile(temporary);
        const replacementProof = checkpoint(replacement, replacementInfo);
        await writeLedgerProof(proofPath, directory, {
          version: 1,
          current: checkpoint(bytes, opened),
          next: replacementProof,
        });
        if (process.platform === "win32") {
          // Release the old destination before Windows replaces it, retaining the ledger lock.
          await handle.close();
          handle = null;
          const afterClose = await safeFile(path);
          if (
            afterClose.ino !== current.ino ||
            afterClose.dev !== current.dev ||
            afterClose.size !== current.size ||
            afterClose.mtimeMs !== current.mtimeMs
          )
            fail();
        }
        await rename(temporary, path);
        if (process.platform !== "win32") {
          const parent = await open(directory, constants.O_RDONLY);
          try {
            await parent.sync();
          } finally {
            await parent.close();
          }
        }
        await options.afterPublish?.();
        await writeLedgerProof(proofPath, directory, { version: 1, current: replacementProof });
      } finally {
        await staged?.close();
        await unlink(temporary).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
    };
    return await operation({ state, append, torn, records, bytes, opened, publish, lastNewline });
  } finally {
    await handle?.close();
    await releaseOwnedLock(lock);
  }
}

export async function initializeCursorLedger(root, profileId, capturedAt) {
  if (!time(capturedAt)) fail();
  return withLedger(
    root,
    profileId,
    async ({ state, append, torn }) => {
      if (torn) fail();
      if (!state.captureStartedAt) await append({ v: 1, kind: "start", at: capturedAt });
      return state.captureStartedAt ?? capturedAt;
    },
    true,
  );
}

// Reserve before a request can leave this installation. A lost response or reset must not
// move the same source_sum event to a new server source. Reservations survive cache resets.
export async function reserveCursorEvents(root, profileId, scope, now) {
  if (
    !uuid.test(scope?.sourceId ?? "") ||
    !accountHash.test(scope?.accountKey ?? "") ||
    !time(now) ||
    !time(`${scope?.rangeStart}T00:00:00.000Z`) ||
    !time(`${scope?.rangeEnd}T00:00:00.000Z`) ||
    scope.rangeStart > scope.rangeEnd
  )
    fail();
  return withLedger(root, profileId, async ({ state, append, torn }) => {
    if (torn || !state.captureStartedAt) fail();
    const eventKeys = capturedEvents(state, now)
      .filter(
        (event) =>
          event.accountKey === scope.accountKey &&
          event.date >= scope.rangeStart &&
          event.date <= scope.rangeEnd &&
          !state.owners.has(event.eventKey),
      )
      .map((event) => event.eventKey);
    for (let offset = 0; offset < eventKeys.length; offset += 128)
      await append({
        v: 1,
        kind: "owner",
        at: now,
        sourceId: scope.sourceId.toLowerCase(),
        accountKey: scope.accountKey,
        eventKeys: eventKeys.slice(offset, offset + 128),
      });
    return eventKeys.length;
  });
}

export async function recordCursorCaptureGap(root, profileId, capturedAt, code) {
  if (!time(capturedAt) || !failureCodes.has(code)) fail();
  return withLedger(root, profileId, async ({ state, append, torn }) => {
    if (torn || !state.captureStartedAt) fail();
    await append({ v: 1, kind: "gap", from: capturedAt, to: capturedAt, code });
  });
}

export async function recordCursorHookObservation(root, profileId, observation, capturedAt) {
  const record = {
    v: 1,
    kind: "hooks",
    at: capturedAt,
    hooks: observation?.hooks,
    fingerprint: observation?.fingerprint,
  };
  if (!validRecord(record)) fail("cursor_hook_stale");
  return withLedger(root, profileId, async ({ state, append, torn }) => {
    if (torn || !state.captureStartedAt) fail();
    const previous = state.hookObservation;
    const same =
      previous &&
      JSON.stringify(previous.hooks) === JSON.stringify(record.hooks) &&
      JSON.stringify(previous.fingerprint) === JSON.stringify(record.fingerprint);
    const current = record.hooks.stop === "current" && record.hooks.sessionEnd === "current";
    // One unchanged current observation per UTC day is sufficient to close past-day coverage.
    // Repeated missing/stale inspections must not endlessly change the history retry generation.
    if (
      same &&
      capturedAt >= previous.at &&
      (!current || capturedAt.slice(0, 10) === previous.at.slice(0, 10))
    )
      return false;
    await append(record);
    return true;
  });
}

// A wrapper marker is owned only after this durable, bounded registration succeeds.
export async function beginCursorHeadlessCapture(root, profileId, captureId, capturedAt) {
  if (!uuid.test(captureId) || !time(capturedAt)) fail();
  return withLedger(root, profileId, async ({ state, append, torn }) => {
    if (torn || !state.captureStartedAt || capturedAt < state.captureStartedAt) fail();
    if (state.pending.has(captureId) || state.completed.has(captureId)) fail();
    for (const [id, pending] of state.pending)
      if (Date.parse(capturedAt) - Date.parse(pending.firstAt) > cursorPairTimeoutMs)
        await append({ v: 1, kind: "abort", captureId: id, at: capturedAt });
    const active = [...state.pending.values()].filter(
      (pending) => Date.parse(capturedAt) - Date.parse(pending.firstAt) <= cursorPairTimeoutMs,
    );
    if (active.length >= maximumPendingPairs) fail("local_store_scan_limit");
    await append({ v: 1, kind: "begin", captureId, at: capturedAt });
    return captureId;
  });
}

export async function readCursorLedger(
  root,
  profileId,
  now = new Date().toISOString(),
  options = {},
) {
  if (!time(now)) fail();
  return withLedger(root, profileId, async ({ state, torn, bytes, opened }) => {
    const pending = [...state.pending.values()];
    return {
      captureStartedAt: state.captureStartedAt,
      currentIntervals: state.currentIntervals,
      hooks: state.hookObservation?.hooks ?? null,
      versions: state.versions,
      accounts: state.accounts,
      events: capturedEvents(state, now),
      eventOwners: Object.fromEntries(state.owners),
      pendingPairs: pending.length,
      headlessCaptureIds: [...new Set([...state.pending.keys(), ...state.completed.keys()])],
      gaps: [
        ...state.gaps,
        ...(bytes.length > capacityWarningBytes
          ? [
              {
                from: [state.captureStartedAt ?? now, now].sort()[0],
                to: [state.captureStartedAt ?? now, now].sort()[1],
                code: "local_store_scan_limit",
              },
            ]
          : []),
        ...(state.hookObservation &&
        Object.values(state.hookObservation.hooks).some((value) => value !== "current")
          ? [
              {
                from: [state.hookObservation.at, now].sort()[0],
                to: [state.hookObservation.at, now].sort()[1],
                code: Object.values(state.hookObservation.hooks).includes("missing")
                  ? "cursor_hook_missing"
                  : "cursor_hook_stale",
              },
            ]
          : []),
        ...pending.map((item) => ({
          from: item.firstAt,
          to: now > item.firstAt ? now : item.firstAt,
          code: "cursor_headless_pair_incomplete",
        })),
        ...(torn
          ? [
              {
                from: [state.captureStartedAt ?? now, now].sort()[0],
                to: [state.captureStartedAt ?? now, now].sort()[1],
                code: "cursor_usage_incomplete",
              },
            ]
          : []),
      ],
      torn,
      checkpoint: torn ? null : checkpoint(bytes, opened),
      previousCheckpointMatches:
        !options.checkpoint ||
        (options.checkpoint.bytes <= bytes.length &&
          options.checkpoint.ino === String(opened.ino) &&
          options.checkpoint.dev === String(opened.dev) &&
          checkpoint(bytes.subarray(0, options.checkpoint.bytes), opened).sha256 ===
            options.checkpoint.sha256),
    };
  });
}

// The caller must verify current installation ownership and hold the connection lifecycle lock.
// No provider payload reaches this journal: only parser projections enter append().
export async function recordCursorCapture(root, profileId, input) {
  if (!time(input.capturedAt)) fail();
  return withLedger(root, profileId, async ({ state, append, torn, records }) => {
    if (torn || !state.captureStartedAt) fail();
    if (input.capturedAt < state.captureStartedAt) {
      await append({
        v: 1,
        kind: "gap",
        from: input.capturedAt,
        to: state.captureStartedAt,
        code: "cursor_usage_incomplete",
      });
      return { status: "partial" };
    }
    for (const [captureId, pending] of state.pending) {
      if (Date.parse(input.capturedAt) - Date.parse(pending.firstAt) > cursorPairTimeoutMs)
        await append({ v: 1, kind: "abort", captureId, at: input.capturedAt });
    }
    state = fold(records);
    const options = { salt: input.salt, capturedAt: input.capturedAt, accounts: state.accounts };
    let record;
    try {
      if (input.kind === "stop") {
        const parsed = parseCursorStop(input.payload, {
          ...options,
          headlessOwned: input.headlessOwned === true,
        });
        if (parsed.suppressed) return { status: "suppressed" };
        const merged = reconcileCursorEvent(state.events.get(parsed.event.eventKey), parsed.event);
        if (merged.status === "duplicate") return { status: "duplicate", event: merged.event };
        if (
          merged.status === "conflict" &&
          merged.event.sessionKey === parsed.event.sessionKey &&
          merged.event.accountKey !== parsed.event.accountKey
        )
          record = { v: 1, kind: "event", ...parsed };
        else if (merged.status === "conflict")
          record = {
            v: 1,
            kind: "gap",
            from: [merged.event.capturedAt, input.capturedAt].sort()[0],
            to: [merged.event.capturedAt, input.capturedAt].sort()[1],
            code: "cursor_event_identity_conflict",
          };
        else record = { v: 1, kind: "event", ...parsed };
      } else if (["result", "binding", "abort"].includes(input.kind)) {
        if (!uuid.test(input.captureId)) fail("cursor_schema_unsupported");
        if (state.completed.has(input.captureId)) {
          const committed = state.events.get(state.completed.get(input.captureId));
          if (!committed) return { status: "duplicate" };
          if (input.kind === "result") {
            const incoming = parseCursorResult(input.payload, {
              ...options,
              version: input.version,
            });
            const merged = reconcileCursorEvent(committed, pairCursorHeadless(incoming, committed));
            if (merged.status === "conflict") fail("cursor_event_identity_conflict");
          } else if (input.kind === "binding") {
            const parsed = parseCursorSessionEnd(input.payload, options);
            const incoming = parsed.binding;
            if (
              incoming.accountKey !== committed.accountKey &&
              incoming.sessionKey === committed.sessionKey
            ) {
              await append({
                v: 1,
                kind: "event",
                accounts: parsed.accounts,
                event: {
                  ...committed,
                  accountKey: incoming.accountKey,
                  capturedAt: input.capturedAt,
                  date: input.capturedAt.slice(0, 10),
                },
              });
              return { status: "partial" };
            }
            if (
              incoming.accountKey !== committed.accountKey ||
              incoming.sessionKey !== committed.sessionKey
            )
              fail("cursor_account_identity_conflict");
          } else fail("cursor_headless_pair_incomplete");
          return { status: "duplicate", event: committed };
        }
        if (!state.pending.has(input.captureId) && state.pending.size >= maximumPendingPairs)
          fail("local_store_scan_limit");
        const pending = state.pending.get(input.captureId);
        if (
          input.kind === "abort" ||
          (pending &&
            Date.parse(input.capturedAt) - Date.parse(pending.firstAt) > cursorPairTimeoutMs)
        )
          record = { v: 1, kind: "abort", captureId: input.captureId, at: input.capturedAt };
        else if (input.kind === "result")
          record = {
            v: 1,
            kind: "result",
            captureId: input.captureId,
            usage: parseCursorResult(input.payload, { ...options, version: input.version }),
          };
        else
          record = {
            v: 1,
            kind: "binding",
            captureId: input.captureId,
            ...parseCursorSessionEnd(input.payload, options),
          };
      } else fail("cursor_schema_unsupported");
    } catch (error) {
      const code = failureCodes.has(error.diagnosticCode)
        ? error.diagnosticCode
        : "cursor_usage_incomplete";
      if (
        ["result", "binding", "abort"].includes(input.kind) &&
        uuid.test(input.captureId) &&
        !state.completed.has(input.captureId)
      )
        await append({ v: 1, kind: "abort", captureId: input.captureId, at: input.capturedAt });
      record = { v: 1, kind: "gap", from: input.capturedAt, to: input.capturedAt, code };
    }
    if (record.kind === "result" || record.kind === "binding") {
      const previous = state.pending.get(record.captureId)?.[record.kind];
      const incoming = record.kind === "result" ? record.usage : record.binding;
      if (
        previous &&
        JSON.stringify({ ...previous, capturedAt: "", date: "" }) ===
          JSON.stringify({ ...incoming, capturedAt: "", date: "" })
      )
        return { status: "duplicate" };
    }
    await append(record);
    if (["event", "binding", "result"].includes(record.kind)) {
      const value = input.kind === "result" ? input.version : input.payload?.cursor_version;
      const surface = cursorVersionSupported(value, "desktop") ? "desktop" : "cli";
      if (cursorVersionSupported(value, surface) && state.versions[surface] !== value)
        await append({ v: 1, kind: "version", at: input.capturedAt, surface, value });
    }
    if (record.kind === "abort" && failureCodes.has(input.diagnosticCode))
      await append({
        v: 1,
        kind: "gap",
        from: [
          state.pending.get(record.captureId)?.firstAt ?? input.capturedAt,
          input.capturedAt,
        ].sort()[0],
        to: [
          state.pending.get(record.captureId)?.firstAt ?? input.capturedAt,
          input.capturedAt,
        ].sort()[1],
        code: input.diagnosticCode,
      });
    const next = fold(records);
    return {
      status: next.gaps.length > state.gaps.length ? "partial" : "recorded",
      events: capturedEvents(next, input.capturedAt),
      pendingPairs: next.pending.size,
    };
  });
}

function checkpoint(bytes, info) {
  return {
    version: 1,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    ino: String(info.ino),
    dev: String(info.dev),
  };
}

export function validCursorAcknowledgement(value) {
  return (
    keys(value, ["sourceId", "rangeStart", "rangeEnd", "checkpoint"]) &&
    uuid.test(value.sourceId) &&
    time(`${value.rangeStart}T00:00:00.000Z`) &&
    time(`${value.rangeEnd}T00:00:00.000Z`) &&
    value.rangeStart <= value.rangeEnd &&
    validCheckpoint(value.checkpoint) &&
    value.checkpoint.bytes > 0
  );
}

// The pending envelope carries only source/range/file proof, never event/account HMACs.
// Call only after the aggregate request has a validated successful acknowledgement.
export async function acknowledgeCursorCapture(
  root,
  profileId,
  acknowledgement,
  now = new Date().toISOString(),
) {
  if (!validCursorAcknowledgement(acknowledgement) || !time(now)) fail();
  return withLedger(root, profileId, async ({ state, bytes, opened, append, torn }) => {
    const { checkpoint: proof, sourceId, rangeStart, rangeEnd } = acknowledgement;
    if (torn || !matchesCheckpoint(proof, bytes, opened) || bytes[proof.bytes - 1] !== 10)
      return false;
    const prefix = fold(
      bytes
        .subarray(0, proof.bytes)
        .toString("utf8")
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line)),
    );
    const eventKeys = capturedEvents(prefix, now)
      .filter(
        (event) =>
          prefix.owners.get(event.eventKey) === sourceId &&
          event.date >= rangeStart &&
          event.date <= rangeEnd &&
          !state.acknowledged.has(event.eventKey),
      )
      .map((event) => event.eventKey);
    for (let offset = 0; offset < eventKeys.length; offset += 128)
      await append({
        v: 1,
        kind: "ack",
        sourceId,
        eventKeys: eventKeys.slice(offset, offset + 128),
      });
    return true;
  });
}

export async function compactAcknowledgedCursorCapture(root, profileId, options = {}) {
  // Stop at the first unacknowledged event or unresolved pair. Later bytes stay byte-exact.
  const proof = await withLedger(
    root,
    profileId,
    async ({ state, records, bytes, opened, torn }) => {
      if (torn) return null;
      let offset = 0;
      for (const record of records) {
        if (
          record.event &&
          !state.acknowledged.has(record.event.eventKey) &&
          !state.suppressedEvents.has(record.event.eventKey)
        )
          break;
        if (
          record.captureId &&
          (!state.completed.has(record.captureId) ||
            (state.completed.get(record.captureId) &&
              !state.acknowledged.has(state.completed.get(record.captureId))))
        )
          break;
        offset = bytes.indexOf(10, offset) + 1;
      }
      return offset > 0 ? checkpoint(bytes.subarray(0, offset), opened) : null;
    },
  );
  return proof ? compactCursorLedger(root, profileId, proof, options) : false;
}

// The sync caller supplies only a checkpoint whose aggregate snapshot was acknowledged.
// This operation is lossless: even acknowledged event identities/counters remain available
// for replay detection and current-year history. An unacknowledged suffix is copied verbatim.
export async function compactCursorLedger(root, profileId, acknowledged, options = {}) {
  if (
    !keys(acknowledged, ["version", "bytes", "sha256", "ino", "dev"]) ||
    acknowledged.version !== 1 ||
    !Number.isSafeInteger(acknowledged.bytes) ||
    acknowledged.bytes < 1 ||
    !/^[a-f0-9]{64}$/.test(acknowledged.sha256) ||
    !/^\d+$/.test(acknowledged.ino) ||
    !/^\d+$/.test(acknowledged.dev)
  )
    fail();
  return withLedger(root, profileId, async ({ bytes, opened, publish, torn }) => {
    if (
      torn ||
      acknowledged.bytes > bytes.length ||
      acknowledged.ino !== String(opened.ino) ||
      acknowledged.dev !== String(opened.dev)
    )
      return false;
    const prefix = bytes.subarray(0, acknowledged.bytes);
    if (prefix.at(-1) !== 10 || checkpoint(prefix, opened).sha256 !== acknowledged.sha256)
      return false;
    const original = prefix
      .toString("utf8")
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
    const state = fold(original);
    const compacted = [original[0], { v: 1, kind: "accounts", accounts: state.accounts }];
    for (const record of original.slice(1)) {
      if (record.kind === "accounts") continue;
      if (record.kind === "event") compacted.push({ v: 1, kind: "captured", event: record.event });
      else if (record.kind === "binding")
        compacted.push({
          v: 1,
          kind: "accountBinding",
          captureId: record.captureId,
          binding: record.binding,
        });
      else compacted.push(record);
    }
    fold(compacted);
    const newPrefix = Buffer.from(
      `${compacted.map((record) => JSON.stringify(record)).join("\n")}\n`,
    );
    if (newPrefix.length >= prefix.length) return false;
    // A writer may have run out of room for even its failure marker. Recovery must retain
    // that unknown interval before the smaller file can ever prove complete coverage again.
    const recoveredAt = new Date().toISOString();
    const capacityGap =
      bytes.length > capacityWarningBytes
        ? Buffer.from(
            `${JSON.stringify({ v: 1, kind: "gap", from: [state.captureStartedAt ?? recoveredAt, recoveredAt].sort()[0], to: [state.captureStartedAt ?? recoveredAt, recoveredAt].sort()[1], code: "local_store_scan_limit" })}\n`,
          )
        : Buffer.alloc(0);
    await publish(
      Buffer.concat([newPrefix, bytes.subarray(acknowledged.bytes), capacityGap]),
      options,
    );
    return true;
  });
}

export async function repairCursorLedger(
  root,
  profileId,
  now = new Date().toISOString(),
  options = {},
) {
  if (!time(now)) fail();
  return withLedger(root, profileId, async ({ state, torn, bytes, lastNewline, publish }) => {
    if (!torn) return false;
    if (!state.captureStartedAt) fail();
    const bounds = [state.captureStartedAt ?? now, now].sort();
    const gap = {
      v: 1,
      kind: "gap",
      from: bounds[0],
      to: bounds[1],
      code: "cursor_usage_incomplete",
    };
    await publish(
      Buffer.concat([bytes.subarray(0, lastNewline), Buffer.from(`${JSON.stringify(gap)}\n`)]),
      options,
    );
    return true;
  });
}

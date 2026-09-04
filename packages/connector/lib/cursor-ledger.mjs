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
} from "./cursor-events.mjs";

export const maximumCursorLedgerBytes = 8 * 1024 * 1024;
export const cursorPairTimeoutMs = 30 * 60 * 1000;
const maximumLineBytes = 16_384;
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
function validRecord(record) {
  if (!record || record.v !== 1) return false;
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
  if (record.kind === "abort")
    return (
      keys(record, ["v", "kind", "captureId", "at"]) &&
      uuid.test(record.captureId) &&
      time(record.at)
    );
  return false;
}

function fold(records) {
  const state = {
    accounts: [],
    events: new Map(),
    pending: new Map(),
    completed: new Map(),
    gaps: [],
    captureStartedAt: null,
    lastObservedAt: null,
    sessionAccounts: new Map(),
    blockedSessions: new Set(),
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
    } else if (record.kind === "gap")
      state.gaps.push({ from: record.from, to: record.to, code: record.code });
    else if (kind === "accounts") state.accounts = record.accounts;
    else if (kind === "event") {
      if (record.accounts) state.accounts = record.accounts;
      if (!state.accounts.some((item) => item.accountKey === record.event.accountKey))
        fail("cursor_account_identity_conflict");
      accept(record.event);
    } else if (record.kind === "abort") {
      const pending = state.pending.get(record.captureId);
      gap(pending?.firstAt ?? record.at, record.at, "cursor_headless_pair_incomplete");
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
        if (pending.result.sessionKey !== pending.binding.sessionKey)
          gap(pending.firstAt, at, "cursor_account_identity_conflict");
        else accept(pairCursorHeadless(pending.result, pending.binding));
        state.pending.delete(record.captureId);
        state.completed.set(record.captureId, pending.result.eventKey);
      } else state.pending.set(record.captureId, pending);
    }
  }
  if (state.pending.size > maximumPendingPairs) fail("local_store_scan_limit");
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
async function withLedger(...args) {
  try {
    return await withLedgerFile(...args);
  } catch (error) {
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
    let before = await safeFile(path, initialize);
    if (!before) {
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
        await safeFile(temporary);
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
      accounts: state.accounts,
      events: [...state.events.values()].filter(
        (item) => !state.blockedSessions.has(item.sessionKey),
      ),
      pendingPairs: pending.length,
      gaps: [
        ...state.gaps,
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
    const next = fold(records);
    return {
      status: next.gaps.length > state.gaps.length ? "partial" : "recorded",
      events: [...next.events.values()].filter(
        (item) => !next.blockedSessions.has(item.sessionKey),
      ),
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
    await publish(Buffer.concat([newPrefix, bytes.subarray(acknowledged.bytes)]), options);
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

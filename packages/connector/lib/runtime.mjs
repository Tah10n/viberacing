import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  appendFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  connectedAgentSourceIdsIfInstallationMatches,
  connectedSourceMappingMatches,
  connectedStateExists,
  ensurePrivateStateDirectory,
  stateDirectory,
  withConnectionStateLock,
  withExistingConnectionStateLock,
} from "./config.mjs";
import { acquireOwnedLock, ownedLockActive, releaseOwnedLock } from "./owned-lock.mjs";

const statePath = join(stateDirectory, "state.json");
const lockPath = join(stateDirectory, "sync.lock");
const pendingDirectory = join(stateDirectory, "pending");
const quarantineDirectory = join(pendingDirectory, "quarantine");
const dirtyPath = join(stateDirectory, "dirty.json");
const dirtyLockPath = join(stateDirectory, "dirty.lock");
const schedulerLockPath = join(stateDirectory, "scheduler.lock");
const schedulerLaunchLockPath = join(stateDirectory, "scheduler-launch.lock");
const lifecycleLockPath = join(stateDirectory, "lifecycle.lock");
const lifecycleMarkerPath = join(stateDirectory, "lifecycle-revoking.lock");
export const automaticSyncTimings = Object.freeze({
  debounceMs: 15_000,
  minimumIntervalMs: 120_000,
  maximumDelayMs: 120_000,
});

export function configuredAutomaticSyncTimings(environment = process.env) {
  if (
    environment.NODE_ENV !== "test" ||
    environment.VIBERACING_TEST_AUTOMATIC_SYNC_TIMINGS === undefined
  )
    return automaticSyncTimings;
  const values = environment.VIBERACING_TEST_AUTOMATIC_SYNC_TIMINGS.split(",").map(Number);
  if (
    values.length !== 3 ||
    values.some((value) => !Number.isSafeInteger(value) || value < 1 || value > 60_000)
  ) {
    throw new Error("Invalid test automatic sync timings");
  }
  return Object.freeze({
    debounceMs: values[0],
    minimumIntervalMs: values[1],
    maximumDelayMs: values[2],
  });
}
const sourceIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const decimalPattern = /^(?:0|[1-9]\d*)$/;
const maximumCaptureLineBytes = 1_000_000;
const captureTokenKeys = [
  "totalTokens",
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "reasoningTokens",
];
const runtimeStateVersion = 3;
const sha256Pattern = /^[0-9a-f]{64}$/;

function validHistoryState(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([sourceId, cursor]) =>
        sourceIdPattern.test(sourceId) &&
        cursor !== null &&
        typeof cursor === "object" &&
        !Array.isArray(cursor) &&
        [
          "hadPartialChunk,nextRangeEnd,year",
          "hadPartialChunk,nextRangeEnd,retentionSafe,year",
          "hadPartialChunk,nextRangeEnd,rangeStart,retentionSafe,year",
          "hadPartialChunk,mode,nextRangeEnd,rangeStart,retentionSafe,year",
        ].includes(Object.keys(cursor).sort().join(",")) &&
        Number.isSafeInteger(cursor.year) &&
        cursor.year >= 1970 &&
        cursor.year <= 9999 &&
        dayPattern.test(cursor.nextRangeEnd ?? "") &&
        cursor.nextRangeEnd.startsWith(`${String(cursor.year).padStart(4, "0")}-`) &&
        (cursor.rangeStart === undefined ||
          (dayPattern.test(cursor.rangeStart) &&
            cursor.rangeStart.startsWith(`${String(cursor.year).padStart(4, "0")}-`) &&
            cursor.rangeStart <= cursor.nextRangeEnd)) &&
        typeof cursor.hadPartialChunk === "boolean" &&
        (cursor.mode === undefined || ["initial", "gap", "full"].includes(cursor.mode)) &&
        (cursor.retentionSafe === undefined || typeof cursor.retentionSafe === "boolean"),
    )
  );
}

function validCaptureCompactionPending(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([sourceId, proof]) =>
        sourceIdPattern.test(sourceId) &&
        (Number.isSafeInteger(proof) || validCaptureCleanupProof(proof)),
    )
  );
}

function validCaptureCleanupProof(proof) {
  const result = proof?.compactionResult;
  const validSegments = (segments, maximumOffset, allowEmpty = false) =>
    Array.isArray(segments) &&
    (allowEmpty ? segments.length <= 4_096 : segments.length >= 1 && segments.length <= 4_096) &&
    segments.every(
      (segment) =>
        segment !== null &&
        typeof segment === "object" &&
        !Array.isArray(segment) &&
        JSON.stringify(Object.keys(segment).sort()) ===
          JSON.stringify(["rangeEnd", "rangeStart", "safeOffset"]) &&
        Number.isSafeInteger(segment.safeOffset) &&
        segment.safeOffset >= 0 &&
        segment.safeOffset <= maximumOffset &&
        dayPattern.test(segment.rangeStart ?? "") &&
        dayPattern.test(segment.rangeEnd ?? "") &&
        segment.rangeStart <= segment.rangeEnd,
    );
  return (
    proof !== null &&
    typeof proof === "object" &&
    !Array.isArray(proof) &&
    proof.version === 1 &&
    typeof proof.ino === "string" &&
    /^\d+$/.test(proof.ino) &&
    Number.isSafeInteger(proof.safeOffset) &&
    proof.safeOffset >= 0 &&
    sha256Pattern.test(proof.prefixHash ?? "") &&
    validSegments(proof.acknowledgedSegments, proof.safeOffset) &&
    (result === undefined ||
      (result !== null &&
        typeof result === "object" &&
        !Array.isArray(result) &&
        JSON.stringify(Object.keys(result).sort()) ===
          JSON.stringify([
            "acknowledgedSegments",
            "prefixHash",
            "proofPrefixHash",
            "proofSafeOffset",
            "safeOffset",
          ]) &&
        Number.isSafeInteger(result.safeOffset) &&
        result.safeOffset >= 0 &&
        sha256Pattern.test(result.prefixHash ?? "") &&
        Number.isSafeInteger(result.proofSafeOffset) &&
        result.proofSafeOffset >= 0 &&
        result.proofSafeOffset <= result.safeOffset &&
        sha256Pattern.test(result.proofPrefixHash ?? "") &&
        validSegments(result.acknowledgedSegments, result.proofSafeOffset, true)))
  );
}

function validHistoryRetries(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([sourceId, year]) =>
        sourceIdPattern.test(sourceId) &&
        Number.isSafeInteger(year) &&
        year >= 1970 &&
        year <= 9999,
    )
  );
}

function validHistoryGapAttempts(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([sourceId, attempt]) =>
        sourceIdPattern.test(sourceId) &&
        attempt !== null &&
        typeof attempt === "object" &&
        !Array.isArray(attempt) &&
        Object.keys(attempt).sort().join(",") ===
          "localGeneration,rangeEnd,rangeStart,result,year" &&
        Number.isSafeInteger(attempt.year) &&
        attempt.year >= 1970 &&
        attempt.year <= 9999 &&
        dayPattern.test(attempt.rangeStart ?? "") &&
        dayPattern.test(attempt.rangeEnd ?? "") &&
        attempt.rangeStart.startsWith(`${String(attempt.year).padStart(4, "0")}-`) &&
        attempt.rangeStart <= attempt.rangeEnd &&
        attempt.result === "partial" &&
        sha256Pattern.test(attempt.localGeneration ?? ""),
    )
  );
}

function normalizedRuntimeState(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Connector runtime state is unsupported");
  if (![1, 2, runtimeStateVersion].includes(value.version))
    throw new Error("Connector runtime state was written by an unsupported connector version");
  if (
    value.sequences === null ||
    typeof value.sequences !== "object" ||
    Array.isArray(value.sequences) ||
    Object.entries(value.sequences).some(
      ([sourceId, sequence]) => !sourceIdPattern.test(sourceId) || !decimalPattern.test(sequence),
    )
  )
    throw new Error("Connector runtime sequences are invalid");
  for (const key of [
    "adapters",
    "historyAdapters",
    "fingerprints",
    "quarantine",
    "collectionWarnings",
    "diagnostics",
  ])
    if (
      value[key] !== undefined &&
      (value[key] === null || typeof value[key] !== "object" || Array.isArray(value[key]))
    )
      throw new Error("Connector runtime state is invalid");
  if (value.history !== undefined && !validHistoryState(value.history))
    throw new Error("Connector runtime history state is invalid");
  if (value.historyRetries !== undefined && !validHistoryRetries(value.historyRetries))
    throw new Error("Connector runtime history retry state is invalid");
  if (value.historyGapAttempts !== undefined && !validHistoryGapAttempts(value.historyGapAttempts))
    throw new Error("Connector runtime history gap attempt state is invalid");
  if (
    value.captureCompactionPending !== undefined &&
    !validCaptureCompactionPending(value.captureCompactionPending)
  )
    throw new Error("Connector runtime capture compaction state is invalid");
  return { ...value, version: runtimeStateVersion, sequences: { ...value.sequences } };
}

function pendingPath(sourceId, kind = "snapshot") {
  if (!sourceIdPattern.test(sourceId)) throw new Error("Invalid pending source id");
  return join(pendingDirectory, `${sourceId}${kind === "error" ? ".error" : ""}.json`);
}

async function atomicJson(path, value) {
  await ensurePrivateStateDirectory();
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function atomicJsonExisting(path, value) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export function dirtyEntries(dirty) {
  if (dirty?.version !== 2 || dirty.sources === null || typeof dirty.sources !== "object")
    return [];
  return Object.entries(dirty.sources).filter(
    ([clientSourceId, entry]) =>
      sourceIdPattern.test(clientSourceId) &&
      typeof entry?.dirtySince === "string" &&
      typeof entry?.lastEventAt === "string" &&
      typeof entry?.generation === "string",
  );
}

export function automaticDueAt(dirty, lastAutomaticSyncAt = 0, timings = automaticSyncTimings) {
  const entries = dirtyEntries(dirty).map(([, entry]) => entry);
  const candidates = entries.length > 0 ? entries : [dirty];
  const dirtySince = Math.min(...candidates.map((entry) => Date.parse(entry?.dirtySince)));
  const lastEventAt = Math.max(...candidates.map((entry) => Date.parse(entry?.lastEventAt)));
  if (!Number.isFinite(dirtySince) || !Number.isFinite(lastEventAt)) {
    throw new Error("Invalid automatic sync state");
  }
  const debounceAt = lastEventAt + timings.debounceMs;
  const maximumAt = dirtySince + timings.maximumDelayMs;
  const cooldownAt = Number(lastAutomaticSyncAt || 0) + timings.minimumIntervalMs;
  return Math.max(Math.min(debounceAt, maximumAt), cooldownAt);
}

export async function readDirty() {
  await ensurePrivateStateDirectory();
  try {
    return JSON.parse(await readFile(dirtyPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function withDirtyLock(callback) {
  const lock = await acquireRuntimeOwnedLock(dirtyLockPath, { waitMs: 5_000, staleMs: 60_000 });
  if (!lock) throw new Error("Timed out waiting for dirty state lock");
  try {
    return await callback();
  } finally {
    await releaseOwnedLock(lock);
  }
}

async function withExistingDirtyLock(callback) {
  let lock;
  try {
    lock = await acquireOwnedLock(dirtyLockPath, { waitMs: 5_000, staleMs: 60_000 });
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  if (!lock) throw new Error("Timed out waiting for dirty state lock");
  try {
    return await callback();
  } finally {
    await releaseOwnedLock(lock);
  }
}

async function writeDirtyEntry(clientSourceId, now, existingOnly = false) {
  let previous;
  if (existingOnly) {
    try {
      previous = JSON.parse(await readFile(dirtyPath, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      previous = null;
    }
  } else previous = await readDirty().catch(() => null);
  const previousEntry = dirtyEntries(previous).find(([id]) => id === clientSourceId)?.[1];
  const timestamp = now.toISOString();
  const dirty =
    previous?.version === 2 && previous.sources && typeof previous.sources === "object"
      ? previous
      : { version: 2, sources: {} };
  dirty.sources[clientSourceId] = {
    dirtySince: previousEntry?.dirtySince ?? timestamp,
    lastEventAt: timestamp,
    generation: randomUUID(),
  };
  if (existingOnly) await atomicJsonExisting(dirtyPath, dirty);
  else await atomicJson(dirtyPath, dirty);
  return dirty;
}

export async function markDirty(clientSourceId, now = new Date()) {
  if (!sourceIdPattern.test(clientSourceId)) throw new Error("Invalid dirty source id");
  return withDirtyLock(() => writeDirtyEntry(clientSourceId, now));
}

export async function markDirtyIfConnected(clientSourceId, agentId, now = new Date()) {
  if (!sourceIdPattern.test(clientSourceId)) throw new Error("Invalid dirty source id");
  if (typeof agentId !== "string" || agentId.length === 0)
    throw new Error("Invalid dirty agent id");
  if (!(await connectedStateExists())) return false;
  return withExistingDirtyLock(async () => {
    if ((await lifecycleMutationActive()) || !(await connectedStateExists())) return false;
    if (!(await connectedSourceMappingMatches(clientSourceId, agentId))) return false;
    await writeDirtyEntry(clientSourceId, now, true);
    return true;
  });
}

export async function markAgentSourcesDirtyIfConnected({
  agentId,
  installationId,
  now = new Date(),
}) {
  if (typeof agentId !== "string" || agentId.length === 0)
    throw new Error("Invalid dirty agent id");
  if (!sourceIdPattern.test(installationId ?? "")) throw new Error("Invalid dirty installation id");
  if ((await lifecycleMutationActive()) || !(await connectedStateExists())) return [];
  return withExistingDirtyLock(async () => {
    if ((await lifecycleMutationActive()) || !(await connectedStateExists())) return [];
    const clientSourceIds = await connectedAgentSourceIdsIfInstallationMatches(
      installationId,
      agentId,
    );
    if (clientSourceIds.length === 0) return [];
    let previous;
    try {
      previous = JSON.parse(await readFile(dirtyPath, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      previous = null;
    }
    const dirty =
      previous?.version === 2 && previous.sources && typeof previous.sources === "object"
        ? previous
        : { version: 2, sources: {} };
    const previousEntries = new Map(dirtyEntries(previous));
    const timestamp = now.toISOString();
    for (const clientSourceId of clientSourceIds) {
      const previousEntry = previousEntries.get(clientSourceId);
      dirty.sources[clientSourceId] = {
        dirtySince: previousEntry?.dirtySince ?? timestamp,
        lastEventAt: timestamp,
        generation: randomUUID(),
      };
    }
    await atomicJsonExisting(dirtyPath, dirty);
    return clientSourceIds;
  });
}

export function dirtyClaims(dirty, clientSourceIds) {
  const selected = clientSourceIds ? new Set(clientSourceIds) : null;
  return Object.fromEntries(
    dirtyEntries(dirty)
      .filter(([clientSourceId]) => selected === null || selected.has(clientSourceId))
      .map(([clientSourceId, entry]) => [clientSourceId, entry.generation]),
  );
}

export async function clearDirty(claims) {
  return withDirtyLock(async () => {
    const current = await readDirty();
    if (!current) return false;
    if (current.version !== 2) {
      await unlink(dirtyPath).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
      return true;
    }
    let changed = false;
    for (const [clientSourceId, generation] of Object.entries(claims ?? {})) {
      if (current.sources?.[clientSourceId]?.generation !== generation) continue;
      delete current.sources[clientSourceId];
      changed = true;
    }
    if (!changed) return false;
    if (dirtyEntries(current).length === 0)
      await unlink(dirtyPath).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
    else await atomicJson(dirtyPath, current);
    return true;
  });
}

export async function clearDirtyForSources(clientSourceIds) {
  const selected = new Set(clientSourceIds);
  return withDirtyLock(async () => {
    const current = await readDirty();
    if (!current) return false;
    if (current.version !== 2) {
      await unlink(dirtyPath).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
      return true;
    }
    let changed = false;
    for (const clientSourceId of selected)
      if (current.sources?.[clientSourceId]) {
        delete current.sources[clientSourceId];
        changed = true;
      }
    if (!changed) return false;
    if (dirtyEntries(current).length === 0)
      await unlink(dirtyPath).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
    else await atomicJson(dirtyPath, current);
    return true;
  });
}

async function acquireRuntimeOwnedLock(path, options = {}) {
  await ensurePrivateStateDirectory();
  return acquireOwnedLock(path, options);
}

export async function claimScheduler() {
  return (await acquireRuntimeOwnedLock(schedulerLockPath)) ?? false;
}

export async function claimConnectedScheduler() {
  const scheduler = await withExistingConnectionStateLock(async () => {
    if (await lifecycleMutationActive()) return false;
    await ensurePrivateStateDirectory();
    if (!(await connectedStateExists())) return false;
    return (await acquireOwnedLock(schedulerLockPath)) ?? false;
  });
  return scheduler ?? false;
}

export async function claimSchedulerLaunch(options = {}) {
  try {
    return await acquireOwnedLock(schedulerLaunchLockPath, options);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export function releaseSchedulerLaunch(launch) {
  if (launch?.path !== schedulerLaunchLockPath) return false;
  return releaseOwnedLock(launch);
}

export async function ownsScheduler(scheduler) {
  if (!scheduler?.owner || scheduler.path !== schedulerLockPath) return false;
  const owner = await readFile(schedulerLockPath, "utf8").catch(() => null);
  return owner === scheduler.owner;
}

export function releaseScheduler(scheduler) {
  if (scheduler?.path !== schedulerLockPath) return false;
  return releaseOwnedLock(scheduler);
}

export async function clearAutomaticState(options = {}) {
  const waitMs = process.env.NODE_ENV === "test" ? 5_000 : 60_000;
  const launchGate = await acquireOwnedLock(schedulerLaunchLockPath, { waitMs });
  if (!launchGate) throw new Error("Timed out waiting for an automatic scheduler launch");
  try {
    await withDirtyLock(() =>
      unlink(dirtyPath).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      }),
    );
    const deadline = Date.now() + waitMs;
    for (;;) {
      const schedulerOwner = await readFile(schedulerLockPath, "utf8").catch(() => null);
      if (schedulerOwner === null || schedulerOwner.startsWith(`${process.pid}:`)) break;
      if (!(await ownedLockActive(schedulerLockPath))) break;
      if (Date.now() >= deadline)
        throw new Error("Timed out waiting for the automatic scheduler to stop");
      await delay(25);
    }
    await options.afterStopped?.();
  } finally {
    await releaseOwnedLock(launchGate);
  }
}

export async function clearPendingPayloads() {
  const paths = await pendingPayloads();
  await Promise.all(paths.map((path) => removePending(path)));
}

function safeCaptureLine(line, oldestDate) {
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    return null;
  }
  if (
    typeof record?.id !== "string" ||
    record.id.length < 1 ||
    record.id.length > 256 ||
    !dayPattern.test(record?.date ?? "") ||
    record.date < oldestDate ||
    record?.usage?.date !== record.date ||
    !decimalPattern.test(record.usage.totalTokens ?? "")
  )
    return null;
  const usage = { date: record.date, totalTokens: record.usage.totalTokens };
  for (const key of captureTokenKeys.slice(1)) {
    const value = record.usage[key];
    if (value !== undefined) {
      if (!decimalPattern.test(value)) return null;
      usage[key] = value;
    }
  }
  return JSON.stringify({ id: record.id, date: record.date, usage });
}

async function withCaptureLock(path, callback) {
  const captureLockPath = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const lock = await acquireOwnedLock(captureLockPath, { waitMs: 5_000 });
  if (!lock) throw new Error("Timed out waiting for capture file lock");
  try {
    return await callback();
  } finally {
    await releaseOwnedLock(lock);
  }
}

export async function appendCapture(source, records) {
  if (
    source?.agentId !== "antigravity" ||
    !sourceIdPattern.test(source?.clientSourceId ?? "") ||
    typeof source?.dataPath !== "string" ||
    !Array.isArray(records)
  ) {
    throw new Error("Invalid capture append request");
  }
  const lines = records.map((record) => safeCaptureLine(JSON.stringify(record), "0000-00-00"));
  if (lines.some((line) => line === null)) throw new Error("Invalid capture usage record");
  if (lines.length === 0) return null;
  const path = resolve(source.dataPath);
  await withCaptureLock(path, () => appendFile(path, `${lines.join("\n")}\n`, { mode: 0o600 }));
  return path;
}

export async function compactCapture(path, now = new Date(), maximumBytes = 1_000_000) {
  return withCaptureLock(path, async () => {
    let info;
    try {
      info = await stat(path);
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
    const oldest = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    oldest.setUTCDate(oldest.getUTCDate() - 35);
    const oldestDate = oldest.toISOString().slice(0, 10);
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    if (info.size <= Math.min(maximumBytes, 1_000_000)) {
      const contents = await readFile(path, "utf8");
      const retained = contents
        .split(/\r?\n/)
        .map((line) => safeCaptureLine(line, oldestDate))
        .filter(Boolean);
      const compacted = `${retained.join("\n")}${retained.length ? "\n" : ""}`;
      if (compacted === contents) return false;
      await writeFile(temporary, compacted, { mode: 0o600 });
      await rename(temporary, path);
      return true;
    }
    const output = await open(temporary, "w", 0o600);
    let pending = Buffer.alloc(0);
    let discardingLongLine = false;
    let changed = info.size > maximumBytes;
    const retain = async (line, terminated = true) => {
      const raw = line.toString("utf8");
      const normalized = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      const safe = safeCaptureLine(normalized, oldestDate);
      if (safe === null) {
        changed = true;
        return;
      }
      if (safe !== normalized || raw !== normalized || !terminated) changed = true;
      await output.write(`${safe}\n`);
    };
    try {
      for await (const chunk of createReadStream(path)) {
        let start = 0;
        while (start < chunk.length) {
          const newline = chunk.indexOf(10, start);
          const end = newline < 0 ? chunk.length : newline;
          const part = chunk.subarray(start, end);
          if (!discardingLongLine) {
            if (pending.length + part.length > maximumCaptureLineBytes) {
              pending = Buffer.alloc(0);
              discardingLongLine = true;
              changed = true;
            } else if (part.length > 0) {
              pending = pending.length === 0 ? Buffer.from(part) : Buffer.concat([pending, part]);
            }
          }
          if (newline < 0) break;
          if (!discardingLongLine) await retain(pending);
          pending = Buffer.alloc(0);
          discardingLongLine = false;
          start = newline + 1;
        }
      }
      if (discardingLongLine) changed = true;
      else if (pending.length > 0) await retain(pending, false);
      await output.close();
      if (!changed) {
        await unlink(temporary);
        return false;
      }
      await rename(temporary, path);
      return true;
    } catch (error) {
      await output.close().catch(() => {});
      await unlink(temporary).catch(() => {});
      throw error;
    }
  });
}

async function filePrefixHash(path, length) {
  if (!Number.isSafeInteger(length) || length < 0) return null;
  const hash = createHash("sha256");
  let bytes = 0;
  if (length > 0)
    for await (const chunk of createReadStream(path, { start: 0, end: length - 1 })) {
      bytes += chunk.length;
      hash.update(chunk);
    }
  return bytes === length ? hash.digest("hex") : null;
}

export async function createCaptureCleanupProof(path, observedFile, acknowledgedRange) {
  if (
    observedFile === null ||
    typeof observedFile !== "object" ||
    !Number.isSafeInteger(observedFile.safeOffset) ||
    observedFile.safeOffset < 0 ||
    observedFile.safeOffset !== observedFile.size ||
    !dayPattern.test(acknowledgedRange?.rangeStart ?? "") ||
    !dayPattern.test(acknowledgedRange?.rangeEnd ?? "") ||
    acknowledgedRange.rangeStart > acknowledgedRange.rangeEnd
  )
    return null;
  return withCaptureLock(path, async () => {
    let info;
    try {
      info = await stat(path);
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
    if (
      info.size < observedFile.safeOffset ||
      (observedFile.ino !== undefined && String(info.ino) !== String(observedFile.ino))
    )
      return null;
    const prefixHash = await filePrefixHash(path, observedFile.safeOffset);
    if (prefixHash === null) return null;
    return {
      version: 1,
      ino: String(info.ino),
      safeOffset: observedFile.safeOffset,
      prefixHash,
      acknowledgedSegments: [{ safeOffset: observedFile.safeOffset, ...acknowledgedRange }],
    };
  });
}

export async function mergeCaptureCleanupProof(path, previous, next) {
  if (!validCaptureCleanupProof(next) || !validCaptureCleanupProof(previous)) return next;
  return withCaptureLock(path, async () => {
    let info;
    try {
      info = await stat(path);
    } catch {
      return next;
    }
    const [previousHash, nextHash] = await Promise.all([
      filePrefixHash(path, previous.safeOffset),
      filePrefixHash(path, next.safeOffset),
    ]);
    if (
      previous.compactionResult !== undefined ||
      previous.ino !== next.ino ||
      String(info.ino) !== next.ino ||
      previous.safeOffset > next.safeOffset ||
      info.size < next.safeOffset ||
      previousHash !== previous.prefixHash ||
      nextHash !== next.prefixHash
    )
      return next;
    return {
      ...next,
      acknowledgedSegments: [...previous.acknowledgedSegments, ...next.acknowledgedSegments]
        .filter(
          (segment, index, values) =>
            values.findIndex(
              (candidate) =>
                candidate.safeOffset === segment.safeOffset &&
                candidate.rangeStart === segment.rangeStart &&
                candidate.rangeEnd === segment.rangeEnd,
            ) === index,
        )
        .slice(-4_096),
    };
  });
}

export async function compactCaptureWithProof(path, proof, now = new Date(), options = {}) {
  if (!validCaptureCleanupProof(proof)) return { status: "invalid" };
  return withCaptureLock(path, async () => {
    let info;
    try {
      info = await stat(path);
    } catch (error) {
      if (error?.code === "ENOENT") return { status: "invalid" };
      throw error;
    }
    const completed = proof.compactionResult;
    if (
      completed &&
      info.size >= completed.safeOffset &&
      (await filePrefixHash(path, completed.safeOffset)) === completed.prefixHash
    ) {
      const retainedProof =
        completed.acknowledgedSegments.length === 0
          ? null
          : {
              version: 1,
              ino: String(info.ino),
              safeOffset: completed.proofSafeOffset,
              prefixHash: completed.proofPrefixHash,
              acknowledgedSegments: completed.acknowledgedSegments,
            };
      return { status: "already-compacted", retainedProof };
    }
    if (
      String(info.ino) !== proof.ino ||
      info.size < proof.safeOffset ||
      (await filePrefixHash(path, proof.safeOffset)) !== proof.prefixHash
    )
      return { status: "invalid" };
    const oldest = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    oldest.setUTCDate(oldest.getUTCDate() - 35);
    const oldestDate = oldest.toISOString().slice(0, 10);
    const acknowledged = (date, lineEnd) =>
      proof.acknowledgedSegments.some(
        (segment) =>
          lineEnd <= segment.safeOffset && date >= segment.rangeStart && date <= segment.rangeEnd,
      );
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    const output = await open(temporary, "w", 0o600);
    const proofHash = createHash("sha256");
    const fullHash = createHash("sha256");
    const transformedSegments = proof.acknowledgedSegments
      .map((segment, index) => ({ ...segment, index, transformedOffset: 0 }))
      .sort((left, right) => left.safeOffset - right.safeOffset || left.index - right.index);
    let segmentIndex = 0;
    let compactedOffset = 0;
    let position = 0;
    let pending = Buffer.alloc(0);
    let changed = false;
    const finalizeSegmentsBefore = (lineEnd) => {
      while (
        segmentIndex < transformedSegments.length &&
        transformedSegments[segmentIndex].safeOffset < lineEnd
      ) {
        transformedSegments[segmentIndex].transformedOffset = compactedOffset;
        segmentIndex += 1;
      }
    };
    try {
      const prefixStream =
        proof.safeOffset > 0 ? createReadStream(path, { start: 0, end: proof.safeOffset - 1 }) : [];
      for await (const chunk of prefixStream) {
        let start = 0;
        while (start < chunk.length) {
          const newline = chunk.indexOf(10, start);
          const end = newline < 0 ? chunk.length : newline;
          const part = chunk.subarray(start, end);
          position += part.length;
          if (pending.length + part.length > maximumCaptureLineBytes)
            throw new Error("invalid_capture_prefix");
          if (part.length > 0)
            pending = pending.length === 0 ? Buffer.from(part) : Buffer.concat([pending, part]);
          if (newline < 0) break;
          position += 1;
          finalizeSegmentsBefore(position);
          const raw = pending.toString("utf8");
          if (!pending.equals(Buffer.from(raw))) throw new Error("invalid_capture_prefix");
          const normalized = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
          if (safeCaptureLine(normalized, "0000-00-00") === null)
            throw new Error("invalid_capture_prefix");
          const record = JSON.parse(normalized);
          if (record.date >= oldestDate || !acknowledged(record.date, position)) {
            const retained = Buffer.concat([pending, Buffer.from("\n")]);
            await output.write(retained);
            proofHash.update(retained);
            fullHash.update(retained);
            compactedOffset += retained.length;
          } else changed = true;
          pending = Buffer.alloc(0);
          start = newline + 1;
        }
      }
      if (pending.length > 0 || position !== proof.safeOffset)
        throw new Error("invalid_capture_prefix");
      while (segmentIndex < transformedSegments.length) {
        transformedSegments[segmentIndex].transformedOffset = compactedOffset;
        segmentIndex += 1;
      }
      const proofSafeOffset = compactedOffset;
      if (proof.safeOffset < info.size)
        for await (const chunk of createReadStream(path, {
          start: proof.safeOffset,
          end: info.size - 1,
        })) {
          await output.write(chunk);
          fullHash.update(chunk);
          compactedOffset += chunk.length;
        }
      await output.close();
      if (!changed) {
        await unlink(temporary);
        return { status: "unchanged" };
      }
      const acknowledgedSegments = transformedSegments
        .sort((left, right) => left.index - right.index)
        .map(({ transformedOffset, rangeStart, rangeEnd }) => ({
          safeOffset: transformedOffset,
          rangeStart,
          rangeEnd,
        }))
        .filter((segment) => segment.safeOffset > 0);
      const compactionResult = {
        safeOffset: compactedOffset,
        prefixHash: fullHash.digest("hex"),
        proofSafeOffset,
        proofPrefixHash: proofHash.digest("hex"),
        acknowledgedSegments,
      };
      await options.beforeRename?.(compactionResult);
      const current = await stat(path);
      if (
        String(current.ino) !== String(info.ino) ||
        current.size !== info.size ||
        current.mtimeMs !== info.mtimeMs
      ) {
        await unlink(temporary);
        return { status: "invalid" };
      }
      await rename(temporary, path);
      await options.afterRename?.();
      const compactedInfo = await stat(path);
      const retainedProof =
        acknowledgedSegments.length === 0
          ? null
          : {
              version: 1,
              ino: String(compactedInfo.ino),
              safeOffset: proofSafeOffset,
              prefixHash: compactionResult.proofPrefixHash,
              acknowledgedSegments,
            };
      return { status: "compacted", compactionResult, retainedProof };
    } catch (error) {
      await output.close().catch(() => {});
      await unlink(temporary).catch(() => {});
      if (error?.message === "invalid_capture_prefix") return { status: "invalid" };
      throw error;
    }
  });
}

export async function quarantinePending(sourceId, payload, errorCode) {
  if (!sourceIdPattern.test(sourceId)) throw new Error("Invalid quarantined source id");
  await mkdir(quarantineDirectory, { recursive: true, mode: 0o700 });
  await atomicJson(join(quarantineDirectory, `${sourceId}.json`), {
    errorCode,
    payload,
  });
}

export async function quarantinedPayloads() {
  try {
    return (await readdir(quarantineDirectory))
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => join(quarantineDirectory, name));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export async function clearQuarantine(sourceId) {
  if (!sourceIdPattern.test(sourceId)) throw new Error("Invalid quarantined source id");
  await unlink(join(quarantineDirectory, `${sourceId}.json`)).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
}

export async function readState() {
  await ensurePrivateStateDirectory();
  try {
    const stored = JSON.parse(await readFile(statePath, "utf8"));
    return normalizedRuntimeState(stored);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return { version: runtimeStateVersion, sequences: {} };
  }
}

export async function inspectState() {
  try {
    return normalizedRuntimeState(JSON.parse(await readFile(statePath, "utf8")));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return { version: runtimeStateVersion, sequences: {} };
  }
}

export async function writeState(value) {
  await ensurePrivateStateDirectory();
  await atomicJson(statePath, normalizedRuntimeState(value));
}

export function lifecycleMutationActive(activeCheck = ownedLockActive) {
  return activeCheck(lifecycleMarkerPath);
}

export async function withSyncLock(callback, options = {}) {
  if (!options.allowDuringLifecycle && (await lifecycleMutationActive()))
    return { skipped: true, lifecycle: true };
  const lock = await acquireRuntimeOwnedLock(lockPath, { waitMs: options.waitMs ?? 0 });
  if (!lock) return { skipped: true };
  if (!options.allowDuringLifecycle && (await lifecycleMutationActive())) {
    await releaseOwnedLock(lock);
    return { skipped: true, lifecycle: true };
  }
  try {
    return await callback();
  } finally {
    await releaseOwnedLock(lock);
  }
}

export async function withLifecycleMutation(callback, options = {}) {
  const waitMs = options.waitMs ?? 60_000;
  const lifecycleLock = await acquireRuntimeOwnedLock(lifecycleLockPath, { waitMs });
  if (!lifecycleLock) throw new Error("Timed out waiting for another lifecycle operation");
  let markerLock;
  try {
    markerLock = await withConnectionStateLock(() =>
      acquireRuntimeOwnedLock(lifecycleMarkerPath, { waitMs }),
    );
    if (!markerLock) throw new Error("Timed out waiting for a lifecycle marker");
    const result = await withSyncLock(
      async () => {
        await options.afterExclusion?.();
        return callback();
      },
      { waitMs, allowDuringLifecycle: true },
    );
    if (result?.skipped) throw new Error("Timed out waiting for active sync to finish");
    return result;
  } finally {
    await releaseOwnedLock(markerLock);
    await releaseOwnedLock(lifecycleLock);
  }
}

export async function savePending(payload) {
  await mkdir(pendingDirectory, { recursive: true, mode: 0o700 });
  for (const snapshot of payload.snapshots ?? []) {
    const pendingRegistrationSupersessions = (
      payload.pendingRegistrationSupersessions ?? []
    ).filter((supersession) => supersession.sourceId === snapshot.sourceId);
    const historyAdvances = (payload.historyAdvances ?? []).filter(
      (advance) => advance.sourceId === snapshot.sourceId,
    );
    const captureCleanupProofs = (payload.captureCleanupProofs ?? []).filter(
      (proof) => proof.sourceId === snapshot.sourceId,
    );
    await atomicJson(pendingPath(snapshot.sourceId), {
      ...payload,
      snapshots: [snapshot],
      sourceErrors: [],
      ...(pendingRegistrationSupersessions.length === 0
        ? { pendingRegistrationSupersessions: undefined }
        : { pendingRegistrationSupersessions }),
      ...(historyAdvances.length === 0 ? { historyAdvances: undefined } : { historyAdvances }),
      ...(captureCleanupProofs.length === 0
        ? { captureCleanupProofs: undefined }
        : { captureCleanupProofs }),
    });
    await unlink(pendingPath(snapshot.sourceId, "error")).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
  for (const sourceError of payload.sourceErrors ?? [])
    await atomicJson(pendingPath(sourceError.sourceId, "error"), {
      protocolVersion: payload.protocolVersion,
      snapshots: [],
      sourceErrors: [sourceError],
      pendingRegistrationSupersessions: undefined,
    });
}

export async function pendingPayloads() {
  try {
    return (await readdir(pendingDirectory))
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => join(pendingDirectory, name));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export async function readPending(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
export async function removePending(path) {
  await unlink(path).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
}

export async function removePendingForSource(sourceId) {
  for (const kind of ["snapshot", "error"])
    await unlink(pendingPath(sourceId, kind)).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
}

export function mergePendingPayloads(payloads) {
  return {
    protocolVersion: payloads[0]?.protocolVersion,
    snapshots: payloads.flatMap((payload) => payload.snapshots ?? []),
    sourceErrors: payloads.flatMap((payload) => payload.sourceErrors ?? []),
  };
}

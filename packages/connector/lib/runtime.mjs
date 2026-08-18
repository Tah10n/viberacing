import { randomUUID } from "node:crypto";
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
import { ensurePrivateStateDirectory, stateDirectory, withConnectionStateLock } from "./config.mjs";
import { acquireOwnedLock, deadLockOwner, releaseOwnedLock } from "./owned-lock.mjs";

const statePath = join(stateDirectory, "state.json");
const lockPath = join(stateDirectory, "sync.lock");
const pendingDirectory = join(stateDirectory, "pending");
const quarantineDirectory = join(pendingDirectory, "quarantine");
const dirtyPath = join(stateDirectory, "dirty.json");
const dirtyLockPath = join(stateDirectory, "dirty.lock");
const schedulerLockPath = join(stateDirectory, "scheduler.lock");
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
  await ensurePrivateStateDirectory();
  const deadline = Date.now() + 5_000;
  let handle;
  for (;;) {
    try {
      handle = await open(dirtyLockPath, "wx", 0o600);
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const info = await stat(dirtyLockPath).catch(() => null);
      if (info && Date.now() - info.mtimeMs > 60_000) {
        await unlink(dirtyLockPath).catch(() => {});
        continue;
      }
      if (Date.now() >= deadline) throw new Error("Timed out waiting for dirty state lock");
      await delay(10);
    }
  }
  try {
    await handle.writeFile(`${process.pid}\n`);
    return await callback();
  } finally {
    await handle.close();
    await unlink(dirtyLockPath).catch(() => {});
  }
}

export async function markDirty(clientSourceId, now = new Date()) {
  if (!sourceIdPattern.test(clientSourceId)) throw new Error("Invalid dirty source id");
  return withDirtyLock(async () => {
    const previous = await readDirty().catch(() => null);
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
    await atomicJson(dirtyPath, dirty);
    return dirty;
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

export async function ownsScheduler(ownershipToken) {
  if (typeof ownershipToken !== "string" || ownershipToken.length === 0) return false;
  const owner = await readFile(schedulerLockPath, "utf8").catch(() => null);
  return owner?.endsWith(`:${ownershipToken}\n`) === true;
}

export async function releaseScheduler(ownershipToken) {
  if (typeof ownershipToken !== "string" || ownershipToken.length === 0) return false;
  const owner = await readFile(schedulerLockPath, "utf8").catch(() => null);
  if (owner?.endsWith(`:${ownershipToken}\n`) !== true) return false;
  await unlink(schedulerLockPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  return true;
}

export async function clearAutomaticState() {
  await withDirtyLock(() =>
    unlink(dirtyPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    }),
  );
  await unlink(schedulerLockPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
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
  const ownershipToken = randomUUID();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + 5_000;
  let handle;
  for (;;) {
    try {
      handle = await open(captureLockPath, "wx", 0o600);
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const info = await stat(captureLockPath).catch(() => null);
      if (info && Date.now() - info.mtimeMs > 10 * 60_000) {
        await unlink(captureLockPath).catch(() => {});
        continue;
      }
      if (Date.now() >= deadline) throw new Error("Timed out waiting for capture file lock");
      await delay(25);
    }
  }
  try {
    await handle.writeFile(`${process.pid}:${ownershipToken}\n`);
    return await callback();
  } finally {
    await handle.close();
    const currentOwner = await readFile(captureLockPath, "utf8").catch(() => null);
    if (currentOwner === `${process.pid}:${ownershipToken}\n`)
      await unlink(captureLockPath).catch(() => {});
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
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return { version: 1, sequences: {} };
  }
}

export async function writeState(value) {
  await ensurePrivateStateDirectory();
  await atomicJson(statePath, value);
}

export async function lifecycleMutationActive() {
  const info = await stat(lifecycleMarkerPath).catch(() => null);
  if (!info) return false;
  if (Date.now() - info.mtimeMs <= 10 * 60_000 && !(await deadLockOwner(lifecycleMarkerPath)))
    return true;
  await unlink(lifecycleMarkerPath).catch(() => {});
  return false;
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
  let markerWritten = false;
  try {
    await withConnectionStateLock(() =>
      writeFile(lifecycleMarkerPath, lifecycleLock.owner, { mode: 0o600 }),
    );
    markerWritten = true;
    const result = await withSyncLock(callback, { waitMs, allowDuringLifecycle: true });
    if (result?.skipped) throw new Error("Timed out waiting for active sync to finish");
    return result;
  } finally {
    if (markerWritten) {
      const markerOwner = await readFile(lifecycleMarkerPath, "utf8").catch(() => null);
      if (markerOwner === lifecycleLock.owner) await unlink(lifecycleMarkerPath).catch(() => {});
    }
    await releaseOwnedLock(lifecycleLock);
  }
}

export async function savePending(payload) {
  await mkdir(pendingDirectory, { recursive: true, mode: 0o700 });
  for (const snapshot of payload.snapshots ?? []) {
    await atomicJson(pendingPath(snapshot.sourceId), {
      ...payload,
      snapshots: [snapshot],
      sourceErrors: [],
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

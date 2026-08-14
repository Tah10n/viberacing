import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stateDirectory } from "./config.mjs";

const statePath = join(stateDirectory, "state.json");
const lockPath = join(stateDirectory, "sync.lock");
const pendingDirectory = join(stateDirectory, "pending");
const quarantineDirectory = join(pendingDirectory, "quarantine");
const dirtyPath = join(stateDirectory, "dirty.json");
const schedulerLockPath = join(stateDirectory, "scheduler.lock");
export const automaticSyncTimings = Object.freeze({
  debounceMs: 15_000,
  minimumIntervalMs: 120_000,
  maximumDelayMs: 120_000,
});
const sourceIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const decimalPattern = /^(?:0|[1-9]\d*)$/;
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
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export function automaticDueAt(dirty, lastAutomaticSyncAt = 0, timings = automaticSyncTimings) {
  const dirtySince = Date.parse(dirty.dirtySince);
  const lastEventAt = Date.parse(dirty.lastEventAt);
  if (!Number.isFinite(dirtySince) || !Number.isFinite(lastEventAt)) {
    throw new Error("Invalid automatic sync state");
  }
  const debounceAt = lastEventAt + timings.debounceMs;
  const maximumAt = dirtySince + timings.maximumDelayMs;
  const cooldownAt = Number(lastAutomaticSyncAt || 0) + timings.minimumIntervalMs;
  return Math.max(Math.min(debounceAt, maximumAt), cooldownAt);
}

export async function readDirty() {
  try {
    return JSON.parse(await readFile(dirtyPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function markDirty(now = new Date()) {
  const previous = await readDirty().catch(() => null);
  const timestamp = now.toISOString();
  const dirty = {
    dirtySince: previous?.dirtySince ?? timestamp,
    lastEventAt: timestamp,
    nonce: randomUUID(),
  };
  await atomicJson(dirtyPath, dirty);
  return dirty;
}

export async function clearDirty(nonce) {
  const current = await readDirty();
  if (current?.nonce !== nonce) return false;
  await unlink(dirtyPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  return true;
}

export async function claimScheduler() {
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  let handle;
  try {
    handle = await open(schedulerLockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const info = await stat(schedulerLockPath).catch(() => null);
    if (info && Date.now() - info.mtimeMs <= 10 * 60_000) return false;
    await unlink(schedulerLockPath).catch(() => {});
    handle = await open(schedulerLockPath, "wx", 0o600);
  }
  await handle.writeFile(`${process.pid}\n`);
  await handle.close();
  return true;
}

export async function releaseScheduler() {
  await unlink(schedulerLockPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
}

export async function clearAutomaticState() {
  await Promise.all(
    [dirtyPath, schedulerLockPath].map((path) =>
      unlink(path).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      }),
    ),
  );
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

export async function compactCapture(path, now = new Date(), maximumBytes = 1_000_000) {
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
  const contents = await readFile(path, "utf8");
  const retained = contents
    .split(/\r?\n/)
    .map((line) => safeCaptureLine(line, oldestDate))
    .filter(Boolean);
  const compacted = `${retained.join("\n")}${retained.length ? "\n" : ""}`;
  if (info.size <= maximumBytes && compacted === contents) return false;
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, compacted, { mode: 0o600 });
  await rename(temporary, path);
  return true;
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
  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return { version: 1, sequences: {} };
  }
}

export async function writeState(value) {
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  await atomicJson(statePath, value);
}

export async function withSyncLock(callback) {
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const info = await stat(lockPath).catch(() => null);
    if (info && Date.now() - info.mtimeMs <= 10 * 60_000) return { skipped: true };
    await unlink(lockPath).catch(() => {});
    handle = await open(lockPath, "wx", 0o600);
  }
  try {
    await handle.writeFile(`${process.pid}\n`);
    return await callback();
  } finally {
    await handle.close();
    await unlink(lockPath).catch(() => {});
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

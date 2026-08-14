import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stateDirectory } from "./config.mjs";

const statePath = join(stateDirectory, "state.json");
const lockPath = join(stateDirectory, "sync.lock");
const pendingDirectory = join(stateDirectory, "pending");
const sourceIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function pendingPath(sourceId, kind = "snapshot") {
  if (!sourceIdPattern.test(sourceId)) throw new Error("Invalid pending source id");
  return join(pendingDirectory, `${sourceId}${kind === "error" ? ".error" : ""}.json`);
}

async function atomicJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await rename(temporary, path);
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

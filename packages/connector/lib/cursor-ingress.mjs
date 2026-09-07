import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  ensurePrivateStateDirectory,
  ensureOwnerOnlyWindowsFile,
  inspectOwnerOnlyWindowsDirectory,
} from "./windows-security.mjs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function directory(root, profileId) {
  if (!uuid.test(profileId ?? "")) throw new Error("cursor_capture_deadline");
  return join(root, "captures", `cursor-${profileId}.ingress`);
}
async function privateDirectory(path, { metadataOnly = false } = {}) {
  const info = await lstat(path);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (typeof process.getuid === "function" &&
      (info.uid !== process.getuid() || info.mode & 0o077)) ||
    (!metadataOnly && !(await inspectOwnerOnlyWindowsDirectory(path)))
  )
    throw new Error("cursor_capture_deadline");
}
async function syncDirectory(path) {
  if (process.platform === "win32") return;
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function readSmallFile(path) {
  const before = await lstat(path);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.size > 64 ||
    (typeof process.getuid === "function" &&
      (before.uid !== process.getuid() || before.mode & 0o077))
  )
    throw new Error("cursor_capture_deadline");
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (opened.ino !== before.ino || opened.dev !== before.dev || opened.size !== before.size)
      throw new Error("cursor_capture_deadline");
    const bytes = Buffer.alloc(65);
    const { bytesRead } = await handle.read(bytes, 0, 65, 0);
    const after = await handle.stat();
    if (bytesRead > 64 || after.size !== bytesRead) throw new Error("cursor_capture_deadline");
    return bytes.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}
async function writeExclusive(path, text) {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    await handle.writeFile(text);
    await handle.sync();
    await ensureOwnerOnlyWindowsFile(path);
  } finally {
    await handle.close();
  }
}
export async function initializeCursorIngress(root, profileId, { create = true } = {}) {
  const path = directory(root, profileId);
  try {
    if (!create) {
      await privateDirectory(path);
      return;
    }
    await mkdir(path, { mode: 0o700 });
    await ensurePrivateStateDirectory(path);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  await privateDirectory(path);
}
export async function prepareCursorIngress(root, request) {
  await initializeCursorIngress(root, request.profileId);
  const path = directory(root, request.profileId);
  const permit = join(path, "permit");
  // Lifecycle owns this operation; old attempts are retained across repair/reconnect.
  await unlink(permit).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  await writeExclusive(permit, request.installationId);
  await syncDirectory(path);
}
export async function revokeCursorIngress(root, profileId) {
  await unlink(join(directory(root, profileId), "permit")).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}
// This journal is deliberately independent of the connection and ledger locks. Each hook leaves
// a timestamp-only intent BEFORE it waits on either lock. Only a durable event/gap removes it.
// No mkdir is allowed here: a stale installed command cannot recreate removed state.
export async function beginCursorIngress(root, request, at) {
  const path = directory(root, request.profileId);
  try {
    // An intent contains only a timestamp. Write it before any external ACL subprocess,
    // then verify ACLs before entering the exact capture path. A stalled ACL check therefore
    // also leaves a gap. Metadata checks reject replaced directories/symlinks up front.
    await privateDirectory(root, { metadataOnly: true });
    await privateDirectory(join(root, "captures"), { metadataOnly: true });
    await privateDirectory(path, { metadataOnly: true });
    for (const file of [join(root, "config.json"), join(path, "permit")]) {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) return null;
    }
    if ((await readSmallFile(join(path, "permit"))) !== request.installationId) return null;
    const names = new Set(await readdir(path));
    // Fixed slots bound storage even if many hooks race. Overflow is permanent and starts
    // at its first capture, so subsequent failures cannot erase an earlier missing day.
    for (let index = 0; index < 256 && !names.has("overflow"); index++) {
      const name = `${String(index).padStart(3, "0")}.gap`;
      if (names.has(name)) continue;
      const file = join(path, name);
      try {
        await writeExclusive(file, at);
      } catch (error) {
        if (error.code === "EEXIST") continue;
        throw error;
      }
      await syncDirectory(path);
      await privateDirectory(root);
      await privateDirectory(join(root, "captures"));
      await privateDirectory(path);
      return { path, file, overflow: false };
    }
    const file = join(path, "overflow");
    try {
      await writeExclusive(file, at);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    await syncDirectory(path);
    return { path, file, overflow: true };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
export async function completeCursorIngress(intent) {
  if (!intent || intent.overflow) return;
  await unlink(intent.file).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  await syncDirectory(intent.path);
}
export async function readCursorIngressGaps(root, profileId, now) {
  const path = directory(root, profileId);
  const names = await readdir(path);
  if (names.length > 258) throw new Error("cursor_capture_deadline");
  await privateDirectory(path);
  const gaps = [];
  for (const name of names) {
    if (name === "permit") continue;
    if (name !== "overflow" && !/^\d{3}\.gap$/.test(name))
      throw new Error("cursor_capture_deadline");
    const file = join(path, name);
    let info;
    try {
      info = await lstat(file);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 64)
      throw new Error("cursor_capture_deadline");
    let at;
    try {
      at = await readSmallFile(file);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    // A torn/empty intent still makes all potentially affected days partial.
    const from = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(at)
      ? at
      : "1970-01-01T00:00:00.000Z";
    gaps.push({
      from,
      to: name === "overflow" || from.startsWith("1970-") ? now : from,
      code: "cursor_capture_deadline",
    });
  }
  return gaps;
}

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, win32 } from "node:path";
import { acquireOwnedLock } from "./owned-lock.mjs";
import {
  inspectOwnerOnlyWindowsDirectory,
  inspectOwnerOnlyWindowsFile,
  ensureOwnerOnlyWindowsFile,
} from "./windows-security.mjs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = /^[a-f0-9]{64}$/;
export const cursorOwnerPrefix = "--viberacing-cursor-hook-v2=";
export function cursorOwnerFailure() {
  const error = new Error(
    "cursor_profile_already_owned: disconnect the previous Cursor capture owner, or use doctor --repair to reclaim a verified inactive owner",
  );
  error.diagnosticCode = "cursor_profile_already_owned";
  return error;
}
export function cursorOriginKey(origin = "https://viberacing.up.railway.app") {
  return createHash("sha256").update(new URL(origin).origin).digest("hex");
}
export function cursorOwner(options) {
  const owner = {
    installationId: options.installationId?.toLowerCase(),
    profileId: options.profileId?.toLowerCase(),
    originKey: options.originKey ?? cursorOriginKey(options.origin),
    launcher: options.launcher,
    nodePath: options.nodePath ?? process.execPath,
    launcherHash: options.launcherHash ?? "0".repeat(64),
  };
  if (!validOwner(owner)) throw cursorOwnerFailure();
  return owner;
}
function validOwner(owner) {
  return (
    owner &&
    typeof owner === "object" &&
    Object.keys(owner).length === 6 &&
    uuid.test(owner.installationId ?? "") &&
    uuid.test(owner.profileId ?? "") &&
    digest.test(owner.originKey ?? "") &&
    digest.test(owner.launcherHash ?? "") &&
    [owner.launcher, owner.nodePath].every(
      (value) =>
        typeof value === "string" &&
        value.length < 2048 &&
        (isAbsolute(value) || win32.isAbsolute(value)) &&
        !/[\0\r\n]/.test(value),
    )
  );
}
export function encodeCursorOwner(options) {
  return (
    cursorOwnerPrefix + Buffer.from(JSON.stringify(cursorOwner(options))).toString("base64url")
  );
}
export function decodeCursorOwner(marker) {
  if (typeof marker !== "string" || !marker.startsWith(cursorOwnerPrefix) || marker.length > 8192)
    return null;
  try {
    const encoded = marker.slice(cursorOwnerPrefix.length);
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
    const owner = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return validOwner(owner) ? owner : null;
  } catch {
    return null;
  }
}
export function sameCursorOwner(left, right) {
  return ["installationId", "profileId", "originKey", "launcher"].every(
    (key) => left[key] === right[key],
  );
}
export async function readPrivateCursorOwnerFile(path, allowMissing = false) {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (allowMissing && error.code === "ENOENT") return null;
    throw cursorOwnerFailure();
  }
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    info.size > 1024 * 1024 ||
    (typeof process.getuid === "function" &&
      (info.uid !== process.getuid() || (info.mode & 0o077) !== 0)) ||
    !(await inspectOwnerOnlyWindowsFile(path))
  )
    throw cursorOwnerFailure();
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (opened.ino !== info.ino || opened.dev !== info.dev || opened.size !== info.size)
      throw cursorOwnerFailure();
    const bytes = await handle.readFile();
    const after = await lstat(path);
    if (
      after.ino !== info.ino ||
      after.dev !== info.dev ||
      after.size !== info.size ||
      bytes.length !== info.size
    )
      throw cursorOwnerFailure();
    return bytes;
  } finally {
    await handle.close();
  }
}
// The caller holds the shared hooks lock and keeps these connection locks until CAS publication.
// An old reconnect cannot race the inactivity decision, and no other owner's command is executed.
export async function lockInactiveCursorOwner(owner, heldLocks) {
  const root = dirname(dirname(owner.launcher));
  if (
    basename(owner.launcher) !== "viberacing-hook.mjs" ||
    basename(dirname(owner.launcher)) !== "bin"
  )
    throw cursorOwnerFailure();
  for (const path of [root, dirname(owner.launcher)]) {
    const info = await lstat(path);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (typeof process.getuid === "function" &&
        (info.uid !== process.getuid() || (info.mode & 0o077) !== 0)) ||
      !(await inspectOwnerOnlyWindowsDirectory(path))
    )
      throw cursorOwnerFailure();
  }
  const bytes = await readPrivateCursorOwnerFile(owner.launcher);
  if (createHash("sha256").update(bytes).digest("hex") !== owner.launcherHash)
    throw cursorOwnerFailure();
  const path = join(root, "connection-state.lock");
  if (!heldLocks.has(path)) {
    const lock = await acquireOwnedLock(path, { waitMs: 0 });
    if (!lock) throw cursorOwnerFailure();
    heldLocks.set(path, lock);
    await ensureOwnerOnlyWindowsFile(path);
  }
  const config = await readPrivateCursorOwnerFile(join(root, "config.json"), true);
  // Any remaining connection or in-flight connection transaction is conservatively active.
  if (
    config !== null ||
    (await readPrivateCursorOwnerFile(join(root, "connection-commit.json"), true)) !== null ||
    (await readPrivateCursorOwnerFile(join(root, "connect-attempt.json"), true)) !== null
  )
    throw cursorOwnerFailure();
  const installation = await readPrivateCursorOwnerFile(join(root, "installation.json"), true);
  if (
    installation !== null &&
    JSON.parse(installation.toString("utf8")).id !== owner.installationId
  )
    throw cursorOwnerFailure();
}

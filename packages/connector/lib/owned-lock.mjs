import { randomUUID } from "node:crypto";
import { open, readFile, rename, stat, unlink } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

export async function deadLockOwner(path) {
  const owner = await readFile(path, "utf8").catch(() => null);
  const match = typeof owner === "string" ? /^(\d+):[0-9a-f-]{36}\n$/i.exec(owner) : null;
  if (!match) return false;
  const pid = Number(match[1]);
  if (!Number.isSafeInteger(pid) || pid < 1 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error?.code === "ESRCH";
  }
}

export async function acquireOwnedLock(path, options = {}) {
  const ownershipToken = randomUUID();
  const owner = `${process.pid}:${ownershipToken}\n`;
  const deadline = Date.now() + (options.waitMs ?? 0);
  const staleMs = options.staleMs ?? 10 * 60_000;
  for (;;) {
    let handle;
    let created = false;
    try {
      handle = await open(path, "wx", 0o600);
      created = true;
      await handle.writeFile(owner);
      await handle.close();
      return { path, owner, ownershipToken };
    } catch (error) {
      await handle?.close().catch(() => {});
      if (created) await unlink(path).catch(() => {});
      if (error?.code !== "EEXIST") throw error;
      const info = await stat(path).catch(() => null);
      if ((info && Date.now() - info.mtimeMs > staleMs) || (await deadLockOwner(path))) {
        const stalePath = `${path}.stale.${ownershipToken}`;
        try {
          await rename(path, stalePath);
          await unlink(stalePath).catch(() => {});
        } catch (renameError) {
          if (renameError?.code !== "ENOENT") throw renameError;
        }
        continue;
      }
      if (Date.now() >= deadline) return null;
      await delay(25);
    }
  }
}

export async function releaseOwnedLock(lock) {
  if (!lock) return false;
  const currentOwner = await readFile(lock.path, "utf8").catch(() => null);
  if (currentOwner !== lock.owner) return false;
  await unlink(lock.path).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  return true;
}

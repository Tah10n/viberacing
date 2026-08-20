import { randomUUID } from "node:crypto";
import { open, readFile, rename, stat, unlink } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

async function lockOwnerState(path) {
  const owner = await readFile(path, "utf8").catch(() => null);
  const match = typeof owner === "string" ? /^(\d+):[0-9a-f-]{36}\n$/i.exec(owner) : null;
  if (!match) return { kind: "malformed", owner };
  const pid = Number(match[1]);
  if (!Number.isSafeInteger(pid) || pid < 1) return { kind: "malformed", owner };
  if (pid === process.pid) return { kind: "live", owner, pid };
  try {
    process.kill(pid, 0);
    return { kind: "live", owner, pid };
  } catch (error) {
    return { kind: error?.code === "ESRCH" ? "dead" : "live", owner, pid };
  }
}

export async function deadLockOwner(path) {
  return (await lockOwnerState(path)).kind === "dead";
}

export async function ownedLockActive(path, staleMs = 10 * 60_000) {
  const info = await stat(path).catch(() => null);
  if (!info) return false;
  const state = await lockOwnerState(path);
  if (state.kind === "live") return true;
  return state.kind !== "dead" && Date.now() - info.mtimeMs <= staleMs;
}

export async function acquireOwnedLock(path, options = {}) {
  const ownershipToken = randomUUID();
  const owner = `${process.pid}:${ownershipToken}\n`;
  const deadline = Date.now() + (options.waitMs ?? 0);
  const staleMs = options.staleMs ?? 10 * 60_000;
  const openFile = options.openFile ?? open;
  const unlinkFile = options.unlinkFile ?? unlink;
  for (;;) {
    let handle;
    let created = false;
    try {
      handle = await openFile(path, "wx", 0o600);
      created = true;
      await handle.writeFile(owner);
      await handle.close();
      return { path, owner, ownershipToken };
    } catch (error) {
      await handle?.close().catch(() => {});
      if (created)
        await unlinkFile(path).catch((unlinkError) => {
          if (unlinkError?.code !== "ENOENT") throw unlinkError;
        });
      if (error?.code !== "EEXIST") throw error;
      const info = await stat(path).catch(() => null);
      const state = info ? await lockOwnerState(path) : null;
      if (
        state?.kind === "dead" ||
        (state?.kind === "malformed" && Date.now() - info.mtimeMs > staleMs)
      ) {
        await options.onRecoveryCandidate?.();
        const recoveryPath = `${path}.recovery`;
        const recoveryToken = randomUUID();
        const recoveryOwner = `${process.pid}:${recoveryToken}\n`;
        let recoveryAcquired = false;
        while (!recoveryAcquired) {
          let recoveryHandle;
          let recoveryCreated = false;
          try {
            recoveryHandle = await openFile(recoveryPath, "wx", 0o600);
            recoveryCreated = true;
            await recoveryHandle.writeFile(recoveryOwner);
            await recoveryHandle.close();
            recoveryAcquired = true;
          } catch (recoveryError) {
            await recoveryHandle?.close().catch(() => {});
            if (recoveryCreated) await unlinkFile(recoveryPath).catch(() => {});
            if (recoveryError?.code !== "EEXIST") throw recoveryError;
            const recoveryInfo = await stat(recoveryPath).catch(() => null);
            const recoveryState = recoveryInfo ? await lockOwnerState(recoveryPath) : null;
            if (
              recoveryState?.kind === "dead" ||
              (recoveryState?.kind === "malformed" && Date.now() - recoveryInfo.mtimeMs > staleMs)
            ) {
              const abandonedRecovery = `${recoveryPath}.stale.${ownershipToken}`;
              try {
                await rename(recoveryPath, abandonedRecovery);
                const abandonedOwner = await readFile(abandonedRecovery, "utf8").catch(() => null);
                if (abandonedOwner !== recoveryState.owner) {
                  await rename(abandonedRecovery, recoveryPath).catch((restoreError) => {
                    if (restoreError?.code !== "EEXIST" && restoreError?.code !== "ENOENT")
                      throw restoreError;
                  });
                } else await unlinkFile(abandonedRecovery).catch(() => {});
              } catch (renameError) {
                if (renameError?.code !== "ENOENT") throw renameError;
              }
              continue;
            }
            if (Date.now() >= deadline) return null;
            await delay(25);
          }
        }
        const recoveryLock = {
          path: recoveryPath,
          owner: recoveryOwner,
          ownershipToken: recoveryToken,
        };
        try {
          await options.onRecoveryGuardAcquired?.();
          if ((await readFile(recoveryPath, "utf8").catch(() => null)) !== recoveryOwner) continue;
          const currentInfo = await stat(path).catch(() => null);
          const currentState = currentInfo ? await lockOwnerState(path) : null;
          if (
            currentState?.kind === "dead" ||
            (currentState?.kind === "malformed" && Date.now() - currentInfo.mtimeMs > staleMs)
          ) {
            const stalePath = `${path}.stale.${ownershipToken}`;
            try {
              await rename(path, stalePath);
              await unlinkFile(stalePath).catch(() => {});
            } catch (renameError) {
              if (renameError?.code !== "ENOENT") throw renameError;
            }
          }
        } finally {
          await releaseOwnedLock(recoveryLock);
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

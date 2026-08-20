import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, open, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireOwnedLock, releaseOwnedLock } from "../lib/owned-lock.mjs";

test("owned locks preserve live owners and recover dead or old malformed owners", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "viberacing-owned-lock-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "state.lock");
  const moduleUrl = new URL("../lib/owned-lock.mjs", import.meta.url).href;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { acquireOwnedLock } from ${JSON.stringify(moduleUrl)}; const lock = await acquireOwnedLock(process.argv[1]); process.stdout.write(lock.ownershipToken + "\\n"); await new Promise((resolve) => process.stdin.once("data", resolve));`,
      path,
    ],
    { stdio: ["pipe", "pipe", "inherit"] },
  );
  context.after(() => {
    if (child.exitCode === null) child.kill();
  });
  const childPid = child.pid;
  const childExit = once(child, "exit");
  const startup = await Promise.race([
    once(child.stdout, "data").then(() => ({ ready: true })),
    childExit.then(([code, signal]) => ({ ready: false, code, signal })),
  ]);
  assert.deepEqual(startup, { ready: true });
  const old = new Date(Date.now() - 60 * 60_000);
  await utimes(path, old, old);
  assert.equal(await acquireOwnedLock(path, { waitMs: 25, staleMs: 1 }), null);
  child.stdin.end("continue\n");
  assert.deepEqual(await childExit, [0, null]);

  await writeFile(path, `${childPid}:11111111-1111-4111-8111-111111111111\n`);
  let recoveryObserved;
  const recoveryObservedPromise = new Promise((resolve) => {
    recoveryObserved = resolve;
  });
  let continueRecovery;
  const continueRecoveryPromise = new Promise((resolve) => {
    continueRecovery = resolve;
  });
  const staleContender = acquireOwnedLock(path, {
    onRecoveryCandidate: async () => {
      recoveryObserved();
      await continueRecoveryPromise;
    },
  });
  await recoveryObservedPromise;
  const recoveredDead = await acquireOwnedLock(path);
  assert.ok(recoveredDead);
  continueRecovery();
  assert.equal(await staleContender, null);
  assert.equal(await readFile(path, "utf8"), recoveredDead.owner);
  await releaseOwnedLock(recoveredDead);

  await writeFile(path, "malformed\n");
  await utimes(path, old, old);
  const recoveredMalformed = await acquireOwnedLock(path, { staleMs: 1 });
  assert.ok(recoveredMalformed);
  await releaseOwnedLock(recoveredMalformed);
});

test("release requires the exact owner and callbacks can release after failure", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "viberacing-owned-release-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "state.lock");
  const first = await acquireOwnedLock(path);
  assert.equal(await acquireOwnedLock(path), null);
  const replacement = `${process.pid}:22222222-2222-4222-8222-222222222222\n`;
  await writeFile(path, replacement);
  assert.equal(await releaseOwnedLock(first), false);
  assert.equal(await readFile(path, "utf8"), replacement);
  await rm(path);
  const final = await acquireOwnedLock(path);
  try {
    throw new Error("callback failed");
  } catch (error) {
    assert.match(error.message, /failed/);
  } finally {
    assert.equal(await releaseOwnedLock(final), true);
  }
  await assert.rejects(stat(path), { code: "ENOENT" });
});

test(
  "Windows access errors on an existing lock remain bounded contention",
  { skip: process.platform !== "win32" },
  async (context) => {
    const directory = await mkdtemp(join(tmpdir(), "viberacing-owned-windows-contention-"));
    context.after(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, "state.lock");
    await writeFile(path, `${process.pid}:11111111-1111-4111-8111-111111111111\n`);

    const deniedOpen = async () => {
      const error = new Error("injected Windows sharing violation");
      error.code = "EPERM";
      throw error;
    };
    assert.equal(await acquireOwnedLock(path, { openFile: deniedOpen }), null);

    await rm(path);
    await assert.rejects(acquireOwnedLock(path, { openFile: deniedOpen }), { code: "EPERM" });
  },
);

test("an initial owner-write failure removes the exclusively created malformed lock", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "viberacing-owned-write-failure-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "state.lock");

  await assert.rejects(
    acquireOwnedLock(path, {
      openFile: async (...arguments_) => {
        const handle = await open(...arguments_);
        return {
          close: () => handle.close(),
          writeFile: async () => {
            throw new Error("injected owner write failure");
          },
        };
      },
    }),
    /injected owner write failure/,
  );
  await assert.rejects(stat(path), { code: "ENOENT" });
});

test("stale recovery survives a process crash while holding the recovery guard", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "viberacing-owned-recovery-crash-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "state.lock");
  await writeFile(path, "99999999:33333333-3333-4333-8333-333333333333\n");

  const moduleUrl = new URL("../lib/owned-lock.mjs", import.meta.url).href;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { acquireOwnedLock } from ${JSON.stringify(moduleUrl)}; await acquireOwnedLock(process.argv[1], { waitMs: 5000, onRecoveryGuardAcquired: async () => { process.stdout.write("ready\\n"); await new Promise((resolve) => process.stdin.once("data", resolve)); } });`,
      path,
    ],
    { stdio: ["pipe", "pipe", "inherit"] },
  );
  context.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  });
  await once(child.stdout, "data");
  assert.match(await readFile(`${path}.recovery`, "utf8"), new RegExp(`^${child.pid}:`));
  child.kill();
  await once(child, "exit");

  const recovered = await acquireOwnedLock(path, { waitMs: 1_000 });
  assert.ok(recovered);
  assert.equal(await releaseOwnedLock(recovered), true);
  assert.deepEqual(await readdir(directory), []);
});

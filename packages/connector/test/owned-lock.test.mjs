import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { acquireOwnedLock, releaseOwnedLock } from "../lib/owned-lock.mjs";

test("owned locks preserve live owners and recover dead or old malformed owners", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "viberacing-owned-lock-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "state.lock");
  const moduleUrl = pathToFileURL(new URL("../lib/owned-lock.mjs", import.meta.url).pathname).href;
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
  await once(child.stdout, "data");
  const old = new Date(Date.now() - 60 * 60_000);
  await utimes(path, old, old);
  assert.equal(await acquireOwnedLock(path, { waitMs: 25, staleMs: 1 }), null);
  child.stdin.end("continue\n");
  await once(child, "exit");

  await writeFile(path, `99999999:11111111-1111-4111-8111-111111111111\n`);
  const recoveredDead = await acquireOwnedLock(path);
  assert.ok(recoveredDead);
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

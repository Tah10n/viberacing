import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireOwnedLock, releaseOwnedLock } from "../lib/owned-lock.mjs";

test("an inactive lifecycle check never deletes a marker created during the check", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "viberacing-lifecycle-marker-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const previous = process.env.VIBERACING_STATE_DIR;
  process.env.VIBERACING_STATE_DIR = directory;
  context.after(() => {
    if (previous === undefined) delete process.env.VIBERACING_STATE_DIR;
    else process.env.VIBERACING_STATE_DIR = previous;
  });

  const runtime = await import(
    `../lib/runtime.mjs?lifecycle-marker=${encodeURIComponent(directory)}`
  );
  let liveMarker;
  const active = await runtime.lifecycleMutationActive(async (path) => {
    liveMarker = await acquireOwnedLock(path);
    return false;
  });

  assert.equal(active, false);
  assert.equal(await readFile(liveMarker.path, "utf8"), liveMarker.owner);
  assert.equal(await releaseOwnedLock(liveMarker), true);
});

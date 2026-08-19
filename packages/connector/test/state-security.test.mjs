import test from "node:test";
import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test(
  "POSIX state security repairs private modes and rejects symlinks",
  { skip: process.platform === "win32" },
  async (context) => {
    const root = await mkdtemp(join(tmpdir(), "viberacing-state-security-"));
    context.after(() => rm(root, { recursive: true, force: true }));
    const state = join(root, "state");
    const previousState = process.env.VIBERACING_STATE_DIR;
    context.after(() => {
      if (previousState === undefined) delete process.env.VIBERACING_STATE_DIR;
      else process.env.VIBERACING_STATE_DIR = previousState;
    });
    await mkdir(join(state, "pending"), { recursive: true, mode: 0o777 });
    await mkdir(join(state, "runtime", "0.1.0", "bin"), { recursive: true });
    await writeFile(join(state, "config.json"), "{}\n", { mode: 0o777 });
    await writeFile(join(state, "runtime", "0.1.0", "bin", "viberacing.mjs"), "", {
      mode: 0o755,
    });
    await writeFile(join(state, "runtime", "0.1.0", "bin", "unexpected.mjs"), "", {
      mode: 0o755,
    });
    await chmod(state, 0o777);
    process.env.VIBERACING_STATE_DIR = state;
    const config = await import(`../lib/config.mjs?state-modes=${encodeURIComponent(root)}`);
    await config.ensurePrivateStateDirectory();
    assert.equal((await lstat(state)).mode & 0o777, 0o700);
    assert.equal((await lstat(join(state, "pending"))).mode & 0o777, 0o700);
    assert.equal((await lstat(join(state, "config.json"))).mode & 0o777, 0o600);
    assert.equal(
      (await lstat(join(state, "runtime", "0.1.0", "bin", "viberacing.mjs"))).mode & 0o777,
      0o700,
    );
    assert.equal(
      (await lstat(join(state, "runtime", "0.1.0", "bin", "unexpected.mjs"))).mode & 0o777,
      0o600,
    );

    const linkedState = join(root, "linked-state");
    await symlink(state, linkedState);
    process.env.VIBERACING_STATE_DIR = linkedState;
    const linkedConfig = await import(`../lib/config.mjs?state-link=${encodeURIComponent(root)}`);
    await assert.rejects(linkedConfig.ensurePrivateStateDirectory(), /real directory/);

    const unsafeState = join(root, "unsafe-state");
    await mkdir(unsafeState);
    await symlink(join(state, "config.json"), join(unsafeState, "config.json"));
    process.env.VIBERACING_STATE_DIR = unsafeState;
    const unsafeConfig = await import(
      `../lib/config.mjs?state-child-link=${encodeURIComponent(root)}`
    );
    await assert.rejects(unsafeConfig.ensurePrivateStateDirectory(), /symbolic link/);
  },
);

test("stored connector origins fail closed before configuration is returned", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-stored-origin-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const state = join(root, "state");
  await mkdir(state, { recursive: true });
  await writeFile(
    join(state, "config.json"),
    `${JSON.stringify({ version: 2, origin: "https://user:secret@example.com", deviceToken: "bearer", sources: [] })}\n`,
  );
  await writeFile(join(state, "sources.json"), '{"version":1,"sources":[]}\n');
  const previousState = process.env.VIBERACING_STATE_DIR;
  process.env.VIBERACING_STATE_DIR = state;
  context.after(() => {
    if (previousState === undefined) delete process.env.VIBERACING_STATE_DIR;
    else process.env.VIBERACING_STATE_DIR = previousState;
  });
  const config = await import(`../lib/config.mjs?stored-origin=${encodeURIComponent(root)}`);
  await assert.rejects(config.readConfig(), /Stored connector origin/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test(
  "hook commands quote hostile state paths as one literal argument",
  { skip: process.platform === "win32" },
  async (context) => {
    const root = await mkdtemp(join(tmpdir(), "viberacing-hook-quoting-"));
    context.after(() => rm(root, { recursive: true, force: true }));
    const state = join(root, "state ' ; touch marker ; echo '");
    const hookRoot = join(root, "codex");
    await mkdir(hookRoot, { recursive: true });
    const previous = {
      state: process.env.VIBERACING_STATE_DIR,
      codex: process.env.CODEX_HOME,
    };
    process.env.VIBERACING_STATE_DIR = state;
    process.env.CODEX_HOME = hookRoot;
    context.after(() => {
      if (previous.state === undefined) delete process.env.VIBERACING_STATE_DIR;
      else process.env.VIBERACING_STATE_DIR = previous.state;
      if (previous.codex === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previous.codex;
    });
    const config = await import(`../lib/config.mjs?hostile-hook=${encodeURIComponent(root)}`);
    const installed = await config.prepareRuntime(
      new URL("../bin/viberacing.mjs", import.meta.url),
    );
    const source = {
      clientSourceId: "45454545-4545-4454-8454-454545454545",
      agentId: "codex",
      collectionMethod: "codex_app_server",
      dataPath: hookRoot,
      suggestedLabel: "Codex",
      supportedSurface: "desktop",
    };
    await config.installHookForSource(source, installed);
    const settings = JSON.parse(await readFile(join(hookRoot, "hooks.json"), "utf8"));
    const command = settings.hooks.SessionEnd[0].hooks[0].command;
    assert.match(command, /viberacing-hook-v3:45454545/);
    await execFileAsync("/bin/sh", ["-c", `${command} </dev/null`], {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: "test",
        VIBERACING_TEST_AUTOMATIC_SYNC_TIMINGS: "60000,60000,60000",
      },
    });
    await assert.rejects(access(join(root, "marker")), { code: "ENOENT" });
  },
);

test("hook argument encoders reject control bytes and preserve shell metacharacters", async () => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-hook-encoder-"));
  try {
    process.env.VIBERACING_STATE_DIR = join(root, "state");
    const config = await import(`../lib/config.mjs?hook-encoder=${encodeURIComponent(root)}`);
    assert.throws(() => config.quoteHookArgument("bad\narg"), /NUL or newlines/);
    assert.throws(() => config.quoteHookArgument("bad\0arg"), /NUL or newlines/);
    const hostile = "path % ! ^ & (literal)";
    const encoded = config.quoteHookArgument(hostile, "win32");
    assert.match(encoded, /^\^".*\^"$/);
    assert.match(encoded, /\^%|\^!|\^\^|\^&|\^\(/);
    assert.match(
      config.quoteHookArgument("--viberacing-hook-id=viberacing-hook-v3:45454545", "win32"),
      /--viberacing-hook-id=viberacing-hook-v3:45454545/,
    );
    const command = config.hookCommandForPlatform(
      "C:\\state % ! ^ & (literal)\\viberacing.mjs",
      { clientSourceId: "45454545-4545-4454-8454-454545454545", agentId: "codex" },
      "win32",
    );
    assert.match(command, /^"\^".*\^""$/);
    assert.match(command, /--viberacing-hook-id=viberacing-hook-v3:45454545/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

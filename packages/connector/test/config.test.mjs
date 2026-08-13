import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);

test("installs a runnable connector copy and additive hooks", async () => {
  const previousHome = process.env.HOME;
  const home = await mkdtemp(join(tmpdir(), "viberacing-connector-"));
  process.env.HOME = home;
  try {
    await mkdir(join(home, ".codex"));
    await writeFile(
      join(home, ".codex", "hooks.json"),
      JSON.stringify({
        hooks: {
          SessionEnd: [
            { hooks: [{ type: "command", command: "keep-me" }] },
            { hooks: [{ type: "command", command: 'node "old/viberacing.mjs" sync --quiet' }] },
          ],
        },
      }),
    );
    const module = await import(`../lib/config.mjs?home=${encodeURIComponent(home)}`);
    await module.installHooks(new URL("../bin/viberacing.mjs", import.meta.url), [
      "codex",
      "claude_code",
    ]);
    await access(join(home, ".viberacing", "bin", "viberacing.mjs"));
    await access(join(home, ".viberacing", "lib", "browser.mjs"));
    await access(join(home, ".viberacing", "lib", "config.mjs"));
    await access(join(home, ".viberacing", "lib", "readers.mjs"));
    const codex = JSON.parse(await readFile(join(home, ".codex", "hooks.json"), "utf8"));
    const claude = JSON.parse(await readFile(join(home, ".claude", "settings.json"), "utf8"));
    assert.match(JSON.stringify(codex), /SessionEnd/);
    assert.equal(codex.hooks.SessionEnd[0].hooks[0].command, "keep-me");
    assert.ok(codex.hooks.SessionEnd[1].hooks[0].command.endsWith('viberacing.mjs\" hook'));
    assert.match(JSON.stringify(claude), /viberacing\.mjs/);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }
});

test("reports invalid existing hook settings instead of claiming success", async () => {
  const previousHome = process.env.HOME;
  const home = await mkdtemp(join(tmpdir(), "viberacing-connector-invalid-settings-"));
  process.env.HOME = home;
  try {
    await mkdir(join(home, ".claude"));
    await writeFile(join(home, ".claude", "settings.json"), "{not-json");
    const module = await import(`../lib/config.mjs?invalid-home=${encodeURIComponent(home)}`);
    await assert.rejects(
      module.installHooks(new URL("../bin/viberacing.mjs", import.meta.url), ["claude_code"]),
      /Cannot read hook settings/,
    );
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }
});

test("treats an empty first sync as a connected waiting state", async () => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-connector-empty-sync-"));
  await mkdir(join(home, ".viberacing"));
  await writeFile(
    join(home, ".viberacing", "config.json"),
    JSON.stringify({
      version: 1,
      origin: "https://viberacing.example",
      agents: [],
      deviceToken: "synthetic-device-token-that-is-never-sent",
    }),
  );
  const { stdout } = await execute(
    process.execPath,
    [fileURLToPath(new URL("../bin/viberacing.mjs", import.meta.url)), "sync"],
    { env: { ...process.env, HOME: home } },
  );
  assert.match(stdout, /waiting for the first agent session/i);
});

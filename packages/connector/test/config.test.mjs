import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

function source(agentId) {
  return { agentId };
}

test("installs a runnable connector copy and additive, owned hooks", async () => {
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
            {
              hooks: [
                { type: "command", command: "node old --viberacing-hook-id=viberacing-hook-v2" },
              ],
            },
          ],
        },
      }),
    );
    const module = await import(`../lib/config.mjs?home=${encodeURIComponent(home)}`);
    await module.installHooks(new URL("../bin/viberacing.mjs", import.meta.url), [
      source("codex"),
      source("claude_code"),
      source("gemini_cli"),
      source("qwen_code"),
      source("kimi_code"),
    ]);
    for (const name of ["browser.mjs", "config.mjs", "readers.mjs", "registry.mjs", "runtime.mjs"])
      await access(join(home, ".viberacing", "lib", name));
    await access(join(home, ".viberacing", "lib", "adapters", "codex.mjs"));
    const codex = JSON.parse(await readFile(join(home, ".codex", "hooks.json"), "utf8"));
    const claude = JSON.parse(await readFile(join(home, ".claude", "settings.json"), "utf8"));
    const gemini = JSON.parse(await readFile(join(home, ".gemini", "settings.json"), "utf8"));
    const qwen = JSON.parse(await readFile(join(home, ".qwen", "settings.json"), "utf8"));
    const kimi = await readFile(join(home, ".kimi-code", "config.toml"), "utf8");
    assert.equal(codex.hooks.SessionEnd[0].hooks[0].command, "keep-me");
    assert.equal(
      codex.hooks.SessionEnd.filter((group) => JSON.stringify(group).includes(module.hookMarker))
        .length,
      1,
    );
    assert.match(JSON.stringify(claude), /viberacing-hook-v2/);
    assert.match(JSON.stringify(gemini), /viberacing-hook-v2/);
    assert.match(JSON.stringify(qwen), /viberacing-hook-v2/);
    assert.match(kimi, /\[\[hooks\]\][\s\S]*SessionEnd[\s\S]*viberacing-hook-v2/);
    const hooks = await module.diagnoseHooks([
      source("codex"),
      source("claude_code"),
      source("gemini_cli"),
      source("qwen_code"),
      source("kimi_code"),
      source("opencode"),
      source("cursor"),
    ]);
    assert.deepEqual(hooks, {
      codex: "current",
      claude_code: "current",
      gemini_cli: "current",
      qwen_code: "current",
      kimi_code: "current",
      opencode: "manual-sync",
      cursor: "capture-wrapper",
    });
    await writeFile(
      join(home, ".claude", "settings.json"),
      JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [
                {
                  type: "command",
                  command: "node obsolete.mjs hook --viberacing-hook-id=viberacing-hook-v2",
                },
              ],
            },
          ],
        },
      }),
    );
    assert.equal((await module.diagnoseHooks([source("claude_code")])).claude_code, "outdated");
    await module.installHooks(pathToFileURL(join(home, ".viberacing", "bin", "viberacing.mjs")), [
      source("codex"),
    ]);
    await module.removeHooks();
    assert.doesNotMatch(
      await readFile(join(home, ".codex", "hooks.json"), "utf8"),
      /viberacing-hook-v2/,
    );
    assert.match(await readFile(join(home, ".codex", "hooks.json"), "utf8"), /keep-me/);
    assert.doesNotMatch(
      await readFile(join(home, ".kimi-code", "config.toml"), "utf8"),
      /viberacing-hook-v2/,
    );
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
      module.installHooks(new URL("../bin/viberacing.mjs", import.meta.url), [
        source("claude_code"),
      ]),
      /Cannot read hook settings/,
    );
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }
});

test("keeps installation identity stable and pairing state separate", async () => {
  const previousHome = process.env.HOME;
  const home = await mkdtemp(join(tmpdir(), "viberacing-connector-identity-"));
  process.env.HOME = home;
  try {
    const module = await import(`../lib/config.mjs?identity-home=${encodeURIComponent(home)}`);
    const first = await module.readOrCreateInstallation();
    const second = await module.readOrCreateInstallation();
    assert.deepEqual(second, first);
    assert.match(first.id, /^[0-9a-f-]{36}$/);
    await module.writeConfig({ version: 2, origin: "https://example.test", sources: [] });
    assert.equal((await module.readConfig()).origin, "https://example.test");
    if (process.platform !== "win32") {
      assert.equal((await stat(join(home, ".viberacing"))).mode & 0o777, 0o700);
      assert.equal((await stat(join(home, ".viberacing", "config.json"))).mode & 0o777, 0o600);
      assert.equal(
        (await stat(join(home, ".viberacing", "installation.json"))).mode & 0o777,
        0o600,
      );
    }
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }
});

test("prevents overlapping syncs with an atomic lock", async () => {
  const previousHome = process.env.HOME;
  const home = await mkdtemp(join(tmpdir(), "viberacing-runtime-lock-"));
  process.env.HOME = home;
  try {
    const runtime = await import(`../lib/runtime.mjs?lock-home=${encodeURIComponent(home)}`);
    let release;
    const first = runtime.withSyncLock(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(await runtime.withSyncLock(() => "should-not-run"), { skipped: true });
    release("done");
    assert.equal(await first, "done");
    const sourceId = "11111111-1111-4111-8111-111111111111";
    await runtime.savePending({
      protocolVersion: 2,
      snapshots: [{ sourceId, syncSequence: "1", entries: [] }],
    });
    await runtime.savePending({
      protocolVersion: 2,
      snapshots: [{ sourceId, syncSequence: "2", entries: [] }],
    });
    const pending = await runtime.pendingPayloads();
    assert.equal(pending.length, 1);
    assert.equal((await runtime.readPending(pending[0])).snapshots[0].syncSequence, "2");
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }
});

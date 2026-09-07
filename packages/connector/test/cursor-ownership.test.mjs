import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, lstat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCursorLedger } from "../lib/cursor-ledger.mjs";
import { cursorHookMarker } from "../lib/cursor-hooks.mjs";
import { cursorHookTimeoutSeconds } from "../lib/cursor-deadline.mjs";
import { ensurePrivateStateDirectory } from "../lib/windows-security.mjs";

const configUrl = new URL("../lib/config.mjs", import.meta.url).href;
const bin = new URL("../bin/viberacing.mjs", import.meta.url);
const bootstrap = `
  import { randomUUID } from 'node:crypto';
  const config = await import(process.argv[1]);
  const installation = await config.readOrCreateInstallation();
  const { source } = await config.addSource({ agentId:'cursor', collectionMethod:'cursor_local_events', dataPath:process.env.CURSOR_TEST_ROOT, hookConfigRoot:process.env.CURSOR_TEST_ROOT, supportedSurface:'desktop', suggestedLabel:'Cursor' });
  await config.writeConfig({ version:2, origin:'https://example.test', installationId:installation.id, deviceToken:'synthetic-local-only', sources:[{...source, sourceId:randomUUID(), accountLabel:'Cursor account 1'}] });
  const script = await config.prepareRuntime(new URL(process.argv[2]));
  let diagnostic = null;
  try { await config.installHookForSource(source, script); } catch (error) { diagnostic=error.diagnosticCode; if (!diagnostic) throw error; }
  const profile=(await config.readSources())[0];
  const options=await config.cursorHookOptions(profile);
  const runtime=await import(new URL('./runtime.mjs',process.argv[1]));
  await runtime.writeState({...await runtime.readState(), automaticDisabledReason:'unsupported_connector'});
  process.stdout.write(JSON.stringify({diagnostic,options}));
`;

test("two custom state directories cannot capture one physical Cursor turn twice; uninstall releases ownership", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "viberacing-cursor-owner-installations-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const root = join(home, ".cursor");
  await mkdir(root, { mode: 0o700 });
  await ensurePrivateStateDirectory(root);
  const stateA = join(home, "custom-state-a");
  const stateB = join(home, "custom-state-b");
  const env = (state) => ({
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    VIBERACING_STATE_DIR: state,
    CURSOR_TEST_ROOT: root,
    NODE_ENV: "test",
  });
  const bootstrapAt = (state) => {
    const run = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", bootstrap, configUrl, bin.href],
      {
        env: env(state),
        encoding: "utf8",
        timeout: process.platform === "win32" ? 180_000 : 20_000,
      },
    );
    assert.equal(run.status, 0, run.stderr);
    return JSON.parse(run.stdout);
  };
  const a = bootstrapAt(stateA);
  assert.equal(a.diagnostic, null);
  const before = await readFile(join(root, "hooks.json"));
  const b = bootstrapAt(stateB);
  assert.equal(b.diagnostic, "cursor_profile_already_owned");
  assert.deepEqual(await readFile(join(root, "hooks.json")), before);
  const stop = {
    hook_event_name: "stop",
    cursor_version: "3.19.7",
    status: "completed",
    user_email: "synthetic@example.test",
    generation_id: "one-turn",
    session_id: "one-session",
    input_tokens: 10,
    output_tokens: 2,
    cache_read_tokens: 3,
    cache_write_tokens: 4,
  };
  const invoke = (state, owner) =>
    spawnSync(
      process.execPath,
      [owner.launcher, "cursor-hook", "--event", "stop", cursorHookMarker(owner)],
      {
        env: env(state),
        input: JSON.stringify(stop),
        encoding: "utf8",
        timeout: cursorHookTimeoutSeconds * 1000,
      },
    );
  for (const [state, owner] of [
    [stateA, a.options],
    [stateB, b.options],
  ]) {
    const run = invoke(state, owner);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, "{}\n");
  }
  assert.equal((await readCursorLedger(stateA, a.options.profileId)).events.length, 1);
  assert.equal((await readCursorLedger(stateB, b.options.profileId)).events.length, 0);
  const detach = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "const config=await import(process.argv[1]); await config.removeConfig();",
      configUrl,
    ],
    { env: env(stateA), encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(detach.status, 0, detach.stderr);
  const uninstall = spawnSync(process.execPath, [a.options.launcher, "uninstall"], {
    env: env(stateA),
    input: "",
    encoding: "utf8",
    timeout: process.platform === "win32" ? 180_000 : 30_000,
  });
  assert.equal(uninstall.status, 0, uninstall.stderr);
  await assert.rejects(lstat(stateA), { code: "ENOENT" });
  // Simulate an already-started stale runtime after uninstall. The original installed command
  // no longer exists; neither it nor a process that already imported the runtime may recreate state.
  const stale = spawnSync(
    process.execPath,
    [fileURLToPath(bin), "cursor-hook", "--event", "stop", cursorHookMarker(a.options)],
    {
      env: env(stateA),
      input: JSON.stringify(stop),
      encoding: "utf8",
      timeout: cursorHookTimeoutSeconds * 1000,
    },
  );
  assert.equal(stale.status, 0, stale.stderr);
  await assert.rejects(lstat(stateA), { code: "ENOENT" });
  const reconnect = bootstrapAt(stateB);
  assert.equal(reconnect.diagnostic, null);
  assert.equal(JSON.parse(await readFile(join(root, "hooks.json"), "utf8")).hooks.stop.length, 1);
});

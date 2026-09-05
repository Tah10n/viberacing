import assert from "node:assert/strict";
import test, { after } from "node:test";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCursorLedger } from "../lib/cursor-ledger.mjs";
import { cursorHookMarker } from "../lib/cursor-hooks.mjs";
import { ensurePrivateStateDirectory } from "../lib/windows-security.mjs";

const root = await mkdtemp(join(tmpdir(), "viberacing-cursor-run-"));
const oldState = process.env.VIBERACING_STATE_DIR;
process.env.VIBERACING_STATE_DIR = join(root, "state");
const config = await import("../lib/config.mjs");
const runtime = await import("../lib/runtime.mjs");
after(async () => {
  if (oldState === undefined) delete process.env.VIBERACING_STATE_DIR;
  else process.env.VIBERACING_STATE_DIR = oldState;
  await rm(root, { recursive: true, force: true });
});
const version = "2026.09.02-c22c1a3";
const usage = { inputTokens: 10, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 };

test(
  "installed Cursor wrapper pairs either arrival order, suppresses owned stop and preserves failure and disconnect boundaries",
  { timeout: 120_000 },
  async () => {
    const providerRoot = join(root, "cursor");
    await mkdir(providerRoot, { mode: 0o700 });
    await ensurePrivateStateDirectory(providerRoot);
    const installation = await config.readOrCreateInstallation();
    const { source } = await config.addSource({
      agentId: "cursor",
      collectionMethod: "cursor_local_events",
      dataPath: providerRoot,
      hookConfigRoot: providerRoot,
      supportedSurface: "desktop",
      suggestedLabel: "Cursor",
    });
    await config.writeConfig({
      version: 2,
      origin: "https://example.test",
      installationId: installation.id,
      deviceToken: "synthetic-device-token",
      sources: [{ ...source, sourceId: randomUUID(), accountLabel: "Cursor account 1" }],
    });
    const script = await config.prepareRuntime(new URL("../bin/viberacing.mjs", import.meta.url));
    await config.installHookForSource(source, script);
    const profile = (await config.readSources())[0];
    assert.equal(await config.diagnoseHookForSource(profile), "current");
    assert.equal(
      await config.diagnoseHookForSource((await config.readConfig()).sources[0]),
      "current",
    );
    const options = await config.cursorHookOptions(profile);
    await runtime.writeState({
      ...(await runtime.readState()),
      automaticDisabledReason: "unsupported_connector",
    });
    const fixture = join(root, "provider.cjs");
    const receipt = join(root, "receipt.json");
    const agent = join(root, process.platform === "win32" ? "agent.cmd" : "agent");
    await writeFile(
      agent,
      process.platform === "win32"
        ? `@echo off\r\n"${process.execPath}" "${fixture}" %*\r\n`
        : `#!/bin/sh\nexec '${process.execPath}' '${fixture}' "$@"\n`,
      { mode: 0o700 },
    );
    const environment = {
      ...process.env,
      HOME: join(root, "home"),
      USERPROFILE: join(root, "home"),
      VIBERACING_CURSOR_BIN: agent,
    };
    const invokeHook = (eventName, payload, captureId) =>
      spawnSync(
        process.execPath,
        [options.launcher, "cursor-hook", "--event", eventName, cursorHookMarker(options)],
        {
          input: JSON.stringify(payload),
          encoding: "utf8",
          timeout: 15_000,
          env: { ...environment, VIBERACING_CURSOR_HEADLESS_CAPTURE_ID: captureId },
        },
      );
    let expectedEvents = 0;
    for (const mode of ["binding-first", "result-first", "failure", "malformed", "disconnect"]) {
      const session = `canary-session-${mode}`;
      const end = {
        hook_event_name: "sessionEnd",
        cursor_version: version,
        final_status: "completed",
        reason: "completed",
        user_email: "canary-email@example.test",
        session_id: session,
      };
      const stop = {
        hook_event_name: "stop",
        cursor_version: version,
        status: "completed",
        user_email: end.user_email,
        session_id: session,
        generation_id: `canary-generation-${mode}`,
        input_tokens: 10,
        output_tokens: 2,
        cache_read_tokens: 3,
        cache_write_tokens: 4,
      };
      const result = {
        type: "result",
        subtype: "success",
        is_error: false,
        request_id: `canary-request-${mode}`,
        session_id: session,
        usage,
        result: "canary-response",
        model: "canary-model",
        cost: "canary-cost",
      };
      const stream =
        JSON.stringify(result) + "\n" + (mode === "malformed" ? "canary-malformed\n" : "");
      const hookArgs = [options.launcher, "cursor-hook", "--event"];
      await writeFile(
        fixture,
        `
const fs = require('node:fs');
if (process.argv.includes('--version')) { console.log(${JSON.stringify(version)}); }
else {
  const marker = process.env.VIBERACING_CURSOR_HEADLESS_CAPTURE_ID;
  function hook(name, payload) {
    const result = require('node:child_process').spawnSync(process.execPath, [...${JSON.stringify(hookArgs)}, name, ${JSON.stringify(cursorHookMarker(options))}], {input: JSON.stringify(payload), encoding:'utf8', env:process.env});
    if (result.status !== 0 || result.stdout !== '{}\\n' || result.stderr !== '') process.exit(91);
  }
  hook('stop', ${JSON.stringify(stop)});
  if (${JSON.stringify(mode)} !== 'result-first') hook('sessionEnd', ${JSON.stringify(end)});
  fs.writeFileSync(${JSON.stringify(receipt)}, JSON.stringify({marker, beforeResult:new Date().toISOString()}));
  process.stdout.write(${JSON.stringify(stream)});
  process.stderr.write('provider-stderr-canary\\n');
  setTimeout(() => {
    const data = JSON.parse(fs.readFileSync(${JSON.stringify(receipt)}));
    data.beforeExit = new Date().toISOString();
    fs.writeFileSync(${JSON.stringify(receipt)}, JSON.stringify(data));
    if (${JSON.stringify(mode)} === 'disconnect') fs.unlinkSync(${JSON.stringify(join(config.stateDirectory, "config.json"))});
    process.exitCode = ${mode === "failure" ? 37 : 0};
  }, 80);
}
`,
      );
      const child = spawnSync(
        process.execPath,
        [options.launcher, "run", "cursor", "--", "canary-prompt"],
        { env: environment, encoding: "utf8", timeout: 30_000 },
      );
      assert.equal(child.status, mode === "failure" ? 37 : 0, child.stderr);
      assert.equal(child.stdout, stream);
      assert.equal(child.stderr, "provider-stderr-canary\n");
      const recorded = JSON.parse(await readFile(receipt));
      let ledger = await readCursorLedger(config.stateDirectory, source.clientSourceId);
      if (mode === "result-first") {
        assert.equal(ledger.events.length, expectedEvents);
        assert.equal(ledger.pendingPairs, 1);
        const hook = invokeHook("sessionEnd", end, recorded.marker);
        assert.equal(hook.status, 0, hook.stderr);
        assert.equal(hook.stdout, "{}\n");
        ledger = await readCursorLedger(config.stateDirectory, source.clientSourceId);
      }
      if (["binding-first", "result-first"].includes(mode)) {
        expectedEvents++;
        const event = ledger.events.at(-1);
        assert.equal(event.tokens.totalTokens, "19");
        assert.ok(
          event.capturedAt >= recorded.beforeResult && event.capturedAt < recorded.beforeExit,
        );
        const retry = invokeHook("sessionEnd", end, recorded.marker);
        assert.equal(retry.status, 0);
        assert.equal(
          (await readCursorLedger(config.stateDirectory, source.clientSourceId)).events.length,
          expectedEvents,
        );
      }
      assert.equal(ledger.events.length, expectedEvents, mode);
      if (mode === "malformed")
        assert.ok(ledger.gaps.some((gap) => gap.code === "cursor_schema_unsupported"));
      if (mode === "disconnect") {
        await assert.rejects(readFile(join(config.stateDirectory, "config.json")), {
          code: "ENOENT",
        });
        assert.equal(ledger.pendingPairs, 1);
      } else assert.equal(ledger.pendingPairs, 0);
    }
    async function privateFiles(directory) {
      let content = "";
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name === "runtime" || entry.name === "bin") continue;
        const path = join(directory, entry.name);
        content += entry.isDirectory() ? await privateFiles(path) : await readFile(path, "utf8");
      }
      return content;
    }
    const persisted = await privateFiles(config.stateDirectory);
    for (const value of [
      "canary-email",
      "canary-session",
      "canary-generation",
      "canary-request",
      "canary-prompt",
      "canary-response",
      "canary-model",
      "canary-cost",
      "canary-malformed",
      "provider-stderr-canary",
    ])
      assert.ok(!persisted.includes(value), value);
  },
);

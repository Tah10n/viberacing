import assert from "node:assert/strict";
import test, { after } from "node:test";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
  initializeCursorLedger,
  beginCursorHeadlessCapture,
  readCursorLedger,
  recordCursorCapture,
} from "../lib/cursor-ledger.mjs";
import { cursorHookMarker, inspectCursorHooks } from "../lib/cursor-hooks.mjs";
import { ensurePrivateStateDirectory } from "../lib/windows-security.mjs";

const root = await mkdtemp(join(tmpdir(), "viberacing-cursor-capture-"));
const oldState = process.env.VIBERACING_STATE_DIR;
process.env.VIBERACING_STATE_DIR = join(root, "state");
const config = await import("../lib/config.mjs");
const capture = await import("../lib/cursor-capture.mjs");
const runtime = await import("../lib/runtime.mjs");
after(async () => {
  if (oldState === undefined) delete process.env.VIBERACING_STATE_DIR;
  else process.env.VIBERACING_STATE_DIR = oldState;
  await rm(root, { recursive: true, force: true });
});
const stop = {
  hook_event_name: "stop",
  cursor_version: "3.19.7",
  status: "completed",
  user_email: "canary-email@example.test",
  generation_id: "canary-generation",
  session_id: "canary-session",
  input_tokens: 10,
  output_tokens: 2,
  cache_read_tokens: 3,
  cache_write_tokens: 4,
  prompt: "canary-prompt",
  response: "canary-response",
  code: "canary-source-code",
  arguments: "canary-tool-arguments",
  repository: "canary-repository",
  cwd: "/canary-private-path",
  access_token: "canary-access-token",
  api_key: "canary-api-key",
  model: "canary-model",
  cost: "canary-cost",
};

test("Cursor hook request parser only accepts a complete owned event invocation", () => {
  const options = { installationId: randomUUID(), profileId: randomUUID() };
  const marker = cursorHookMarker(options);
  assert.deepEqual(capture.parseCursorHookRequest(["--event", "stop", marker]), {
    ...options,
    eventName: "stop",
  });
  for (const args of [
    [],
    ["--event", "stop"],
    ["--event", "other", marker],
    ["--event", "stop", marker, "extra"],
    ["--event", "stop", "private-input"],
  ])
    assert.equal(capture.parseCursorHookRequest(args), null);
});

test("Cursor stdin decoder bounds bytes and time without retaining malformed content", async () => {
  for (const [bytes, expected] of [
    [Buffer.from(JSON.stringify(stop)), stop],
    [Buffer.from("private-malformed"), {}],
    [Buffer.alloc(1024 * 1024 + 1, 120), {}],
    [Buffer.from([255]), {}],
  ]) {
    const stream = new PassThrough();
    const pending = capture.readCursorHookInput(stream);
    stream.end(bytes);
    assert.deepEqual(await pending, expected);
  }
  const stream = new PassThrough();
  assert.deepEqual(await capture.readCursorHookInput(stream, { timeoutMs: 10 }), {});
  stream.emit("error", new Error("canary-private-stream-error"));
  stream.destroy();
});

test("Cursor capture lifecycle owns hooks, records exact private events, rejects stale invocations and preserves cleanup identity", async () => {
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
  const sourceId = randomUUID();
  const connect = (installationId) =>
    config.writeConfig({
      version: 2,
      origin: "https://example.test",
      installationId,
      deviceToken: "synthetic-device-token",
      sources: [{ ...source, sourceId, accountLabel: "Cursor account 1" }],
    });
  await connect(installation.id);
  const script = await config.prepareRuntime(new URL("../bin/viberacing.mjs", import.meta.url));
  await config.installHookForSource(source, script);
  const profile = (await config.readSources())[0];
  const options = await config.cursorHookOptions(profile);
  assert.equal(profile.cursorHookInstallationId, installation.id);
  assert.deepEqual(await inspectCursorHooks(providerRoot, options), {
    stop: "current",
    sessionEnd: "current",
  });
  assert.equal(await config.diagnoseHookForSource(profile), "current");
  const request = {
    installationId: installation.id,
    profileId: source.clientSourceId,
    eventName: "stop",
  };
  await runtime.writeState({
    ...(await runtime.readState()),
    automaticDisabledReason: "unsupported_connector",
  });
  const invoke = () =>
    spawnSync(
      process.execPath,
      [options.launcher, "cursor-hook", "--event", "stop", cursorHookMarker(options)],
      {
        input: JSON.stringify(stop),
        encoding: "utf8",
        timeout: 10_000,
        env: { ...process.env },
      },
    );
  const beforeCapture = new Date().toISOString();
  const invoked = invoke();
  assert.equal(invoked.status, 0, invoked.stderr);
  assert.equal(invoked.stdout, "{}\n");
  assert.equal(invoked.stderr, "");
  const now = (await readCursorLedger(config.stateDirectory, source.clientSourceId)).events[0]
    .capturedAt;
  assert.ok(now >= beforeCapture && now <= new Date().toISOString());
  assert.equal(await capture.captureCursorHook(request, stop, now), true);
  let ledger = await readCursorLedger(config.stateDirectory, source.clientSourceId);
  assert.equal(ledger.events.length, 1);
  assert.equal(ledger.events[0].tokens.totalTokens, "19");
  assert.equal(ledger.events[0].capturedAt, now);
  await runtime.clearDirty();
  // Retrying an already-durable event repairs a failed/missing dirty write, without recounting.
  assert.equal(await capture.captureCursorHook(request, stop, new Date().toISOString()), true);
  assert.ok((await runtime.readDirty()).sources[source.clientSourceId]);
  ledger = await readCursorLedger(config.stateDirectory, source.clientSourceId);
  assert.equal(ledger.events.length, 1);
  assert.equal(ledger.events[0].capturedAt, now);
  assert.equal(
    await capture.captureCursorHook({ ...request, installationId: randomUUID() }, stop, now),
    null,
  );
  await runtime.withLifecycleMutation(async () => {
    assert.equal(
      await capture.captureCursorHook(
        request,
        { ...stop, generation_id: "blocked-generation" },
        now,
      ),
      false,
    );
  });
  const captureId = randomUUID();
  const pairAt = new Date().toISOString();
  const end = {
    hook_event_name: "sessionEnd",
    cursor_version: "2026.09.02-c22c1a3",
    final_status: "completed",
    reason: "completed",
    user_email: stop.user_email,
    session_id: "canary-headless-session",
  };
  const environment = { VIBERACING_CURSOR_HEADLESS_CAPTURE_ID: captureId };
  assert.equal(
    await capture.captureCursorHook({ ...request, eventName: "sessionEnd" }, end, pairAt, {
      environment,
    }),
    false,
  );
  await beginCursorHeadlessCapture(config.stateDirectory, source.clientSourceId, captureId, pairAt);
  assert.equal(
    await capture.captureCursorHook(
      request,
      { ...stop, generation_id: "do-not-count-wrapper-stop" },
      pairAt,
      { environment },
    ),
    false,
  );
  assert.equal(
    await capture.captureCursorHook({ ...request, eventName: "sessionEnd" }, end, pairAt, {
      environment,
    }),
    true,
  );
  const salt = await config.readOrCreateProviderIdentitySalt();
  await recordCursorCapture(config.stateDirectory, source.clientSourceId, {
    kind: "result",
    captureId,
    capturedAt: pairAt,
    salt,
    version: end.cursor_version,
    payload: {
      type: "result",
      subtype: "success",
      is_error: false,
      session_id: end.session_id,
      request_id: "canary-request",
      usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 },
    },
  });
  ledger = await readCursorLedger(config.stateDirectory, source.clientSourceId);
  assert.equal(ledger.events.length, 2);
  assert.equal(ledger.pendingPairs, 0);
  assert.equal(await config.installHookForSource(profile, script), false);
  assert.equal(
    (await readCursorLedger(config.stateDirectory, source.clientSourceId)).captureStartedAt,
    ledger.captureStartedAt,
  );
  for (const filename of [
    "config.json",
    "installation.json",
    "sources.json",
    "dirty.json",
    "state.json",
    join("captures", `cursor-${source.clientSourceId}.jsonl`),
  ])
    assert.doesNotMatch(
      await readFile(join(config.stateDirectory, filename), "utf8"),
      /canary-|do-not-count-wrapper-stop|blocked-generation/,
    );
  await config.removeConfig();
  await config.removeInstallationIdentity();
  const namesBefore = await readdir(config.stateDirectory);
  assert.equal(invoke().stdout, "{}\n");
  assert.equal(await capture.captureCursorHook(request, stop, now), null);
  assert.deepEqual(await readdir(config.stateDirectory), namesBefore);
  // Removal still has the old installation marker after authorization/identity removal.
  await config.removeHookForSource(profile);
  assert.deepEqual(await inspectCursorHooks(providerRoot, options), {
    stop: "missing",
    sessionEnd: "missing",
  });
  const nextInstallation = await config.readOrCreateInstallation();
  await connect(nextInstallation.id);
  await config.installHookForSource(profile, script);
  const rebound = (await config.readSources())[0];
  assert.equal(rebound.cursorHookInstallationId, nextInstallation.id);
  assert.equal(await config.readOrCreateProviderIdentitySalt(), salt);
  assert.equal(await capture.captureCursorHook(request, stop, now), null);
  assert.equal(
    (await readCursorLedger(config.stateDirectory, source.clientSourceId)).events.length,
    2,
  );
});

test("Cursor headless begin accounts for abandoned runs from their start and survives replay", async () => {
  const state = join(root, "begin-state");
  await mkdir(state, { mode: 0o700 });
  await ensurePrivateStateDirectory(state);
  const profileId = randomUUID();
  const id = randomUUID();
  const start = "2026-09-04T23:59:00.000Z";
  await initializeCursorLedger(state, profileId, start);
  await beginCursorHeadlessCapture(state, profileId, id, start);
  const ledger = await readCursorLedger(state, profileId, "2026-09-05T00:01:00.000Z");
  assert.equal(ledger.pendingPairs, 1);
  assert.equal(ledger.gaps[0].from, start);
  assert.deepEqual(ledger.headlessCaptureIds, [id]);
  await assert.rejects(beginCursorHeadlessCapture(state, profileId, id, start));
});

test("importing the agent registry does not capture the caller's real state directory", () => {
  const first = join(root, "before-selected-state");
  const second = join(root, "after-selected-state");
  const registry = new URL("../lib/readers.mjs", import.meta.url).href;
  const configUrl = new URL("../lib/config.mjs", import.meta.url).href;
  const code = `await import(process.argv[1]); process.env.VIBERACING_STATE_DIR = process.argv[3]; const config = await import(process.argv[2]); if (config.stateDirectory !== process.argv[3]) process.exitCode = 1;`;
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", code, registry, configUrl, second],
    { env: { ...process.env, VIBERACING_STATE_DIR: first }, encoding: "utf8", timeout: 10_000 },
  );
  assert.equal(child.status, 0, child.stderr);
});

import assert from "node:assert/strict";
import test, { after } from "node:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import {
  cursorResultReader,
  cursorRunArguments,
  resolveCursorExecutable,
  runCursorProcess,
} from "../lib/cursor-cli.mjs";

const salt = "s".repeat(43);
const version = "2026.09.02-c22c1a3";
const before = "2026-09-04T23:59:59.999Z";
const afterMidnight = "2026-09-05T00:00:00.001Z";
const result = {
  type: "result",
  subtype: "success",
  is_error: false,
  request_id: "canary-request",
  session_id: "canary-session",
  usage: { inputTokens: 100, outputTokens: 12, cacheReadTokens: 30, cacheWriteTokens: 4 },
  result: "canary-response",
  model: "canary-model",
  cost: "canary-cost",
  tool: { usage: { inputTokens: 999999 } },
};
const root = await mkdtemp(join(tmpdir(), "viberacing-cursor-cli-"));
after(() => rm(root, { recursive: true, force: true }));
function reader(now = () => before) {
  return cursorResultReader({ salt, version, now });
}
function bytes(value) {
  return Buffer.from(JSON.stringify(value) + "\n");
}
function sink(delay = 0) {
  const chunks = [];
  const stream = new Writable({
    write(chunk, encoding, done) {
      setTimeout(() => {
        chunks.push(Buffer.from(chunk));
        done();
      }, delay);
    },
  });
  return { stream, bytes: () => Buffer.concat(chunks) };
}
async function fakeAgent(body, extension = process.platform === "win32" ? ".cmd" : "") {
  const id = randomUUID();
  const script = join(root, `provider-${id}.cjs`);
  await writeFile(
    script,
    `if (process.argv.includes('--version')) { console.log(${JSON.stringify(version)}); } else {\n${body}\n}\n`,
  );
  const path = join(root, `agent ${id}${extension}`);
  await writeFile(
    path,
    process.platform === "win32"
      ? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`
      : `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${script}' "$@"\n`,
    { mode: 0o700 },
  );
  const environment = { ...process.env, VIBERACING_CURSOR_BIN: path };
  const executable = await resolveCursorExecutable({ environment });
  return { executable, environment, path, script };
}

test("Cursor run enforces headless stream JSON while preserving literal provider arguments", () => {
  const args = ["--model", "selected", "--", "literal --print & %PATH% ' \" 雪"];
  assert.deepEqual(cursorRunArguments(args), [
    "--print",
    "--output-format",
    "stream-json",
    ...args,
  ]);
  assert.deepEqual(cursorRunArguments(["-p", "--output-format=stream-json", "prompt"]), [
    "-p",
    "--output-format=stream-json",
    "prompt",
  ]);
  assert.deepEqual(cursorRunArguments(["--", "--print"]), [
    "--print",
    "--output-format",
    "stream-json",
    "--",
    "--print",
  ]);
  for (const args of [
    ["--output-format", "json"],
    ["--output-format"],
    ["--output-format=stream-json", "--output-format", "stream-json"],
    ["canary\0argument"],
  ])
    assert.throws(() => cursorRunArguments(args), { diagnosticCode: "cursor_schema_unsupported" });
});

test("Cursor reader retains the first result receipt across midnight and ignores nested subagent counters", () => {
  let calls = 0;
  const capture = reader(() => (calls++ ? afterMidnight : before));
  const stream = Buffer.concat([
    bytes({ type: "tool_call", tool: result, prompt: "canary-prompt" }),
    bytes(result),
    bytes(result),
  ]);
  for (let offset = 0; offset < stream.length; offset += 7)
    capture.push(stream.subarray(offset, offset + 7));
  const selected = capture.finish();
  assert.equal(selected.result.capturedAt, before);
  assert.deepEqual(selected.result.payload.usage, result.usage);
  assert.deepEqual(Object.keys(selected.result.payload), [
    "type",
    "subtype",
    "is_error",
    "request_id",
    "session_id",
    "usage",
  ]);
  for (const canary of [
    "canary-prompt",
    "canary-response",
    "canary-model",
    "canary-cost",
    "999999",
  ])
    assert.ok(!JSON.stringify(selected).includes(canary));
});

test("Cursor reader rejects conflicting finals and malformed, oversized, invalid or incomplete streams", () => {
  for (const bad of [
    Buffer.from("canary-malformed\n"),
    Buffer.from([255, 10]),
    Buffer.alloc(1024 * 1024 + 1, 120),
    bytes({ ...result, usage: { ...result.usage, inputTokens: 101 } }),
    bytes({ ...result, request_id: "conflicting-request" }),
    bytes({ ...result, is_error: true }),
    bytes({ ...result, usage: {} }),
    Buffer.from('{"type":"result"'),
  ]) {
    const capture = reader();
    capture.push(bytes(result));
    capture.push(bad);
    const outcome = capture.finish();
    assert.equal(outcome.result, undefined);
    assert.match(outcome.diagnostic, /^cursor_/);
    assert.ok(!JSON.stringify(outcome).includes("canary"));
  }
  assert.deepEqual(reader().finish(), { diagnostic: "cursor_usage_incomplete" });
  const noNewline = reader();
  noNewline.push(Buffer.from(JSON.stringify(result)));
  assert.equal(noNewline.finish().result.capturedAt, before);
});

test("Cursor process preserves output, argument bytes, exit code and marker without retaining content", async () => {
  for (const extension of process.platform === "win32" ? [".cmd", ".bat"] : [""]) {
    const argumentPath = join(root, `arguments-${randomUUID()}.json`);
    const stream = Buffer.concat([
      bytes({ type: "assistant", text: "canary-response 雪" }),
      bytes(result),
      bytes(result),
    ]);
    const errorBytes = Buffer.from("provider stderr\r\ncanary-error\n");
    const fake = await fakeAgent(
      `require('node:fs').writeFileSync(${JSON.stringify(argumentPath)}, JSON.stringify({args: process.argv.slice(2), marker: process.env.VIBERACING_CURSOR_HEADLESS_CAPTURE_ID}));\nprocess.stdout.write(Buffer.from(${JSON.stringify(stream.toString("base64"))}, 'base64'));\nprocess.stderr.write(Buffer.from(${JSON.stringify(errorBytes.toString("base64"))}, 'base64'));`,
      extension,
    );
    const stdout = sink(5),
      stderr = sink(5),
      captureId = randomUUID();
    const args = [
      "--model",
      "synthetic",
      "quotes \" ' & | %PATH% !value! ^ (x) 雪 " + String.fromCharCode(92),
      "--",
      "--print",
    ];
    const outcome = await runCursorProcess({
      ...fake,
      args,
      salt,
      captureId,
      stdout: stdout.stream,
      stderr: stderr.stream,
      stdin: "ignore",
      now: () => before,
    });
    assert.equal(outcome.code, 0);
    assert.equal(outcome.signal, null);
    assert.equal(outcome.result.capturedAt, before);
    assert.deepEqual(stdout.bytes(), stream);
    assert.deepEqual(stderr.bytes(), errorBytes);
    assert.deepEqual(JSON.parse(await readFile(argumentPath)), {
      args: cursorRunArguments(args),
      marker: captureId,
    });
  }
  const fake = await fakeAgent(
    `process.stdout.write(${JSON.stringify(bytes(result).toString())}); process.exitCode = 37;`,
  );
  const outcome = await runCursorProcess({
    ...fake,
    args: [],
    salt,
    captureId: randomUUID(),
    stdout: sink().stream,
    stderr: sink().stream,
    stdin: "ignore",
  });
  assert.equal(outcome.code, 37);
  assert.equal(outcome.result, undefined);
});

test("Cursor executable resolution requires a safe absolute path and detects replacement after probe", async () => {
  await assert.rejects(
    resolveCursorExecutable({
      environment: { ...process.env, VIBERACING_CURSOR_BIN: "relative-agent" },
    }),
    { diagnosticCode: "agent_executable_missing" },
  );
  const fake = await fakeAgent("process.exitCode = 0;");
  await writeFile(fake.path, "changed");
  await assert.rejects(runCursorProcess({ ...fake, args: [], salt, captureId: randomUUID() }), {
    diagnosticCode: "agent_executable_missing",
  });
  if (process.platform !== "win32") {
    const unsafe = await fakeAgent("process.exitCode = 0;");
    await chmod(unsafe.path, 0o777);
    await assert.rejects(resolveCursorExecutable({ environment: unsafe.environment }), {
      diagnosticCode: "agent_executable_missing",
    });
  }
});

test(
  "Cursor interrupt forwards the real signal to the process group and rejects an otherwise successful result",
  {
    skip: process.platform === "win32" && "POSIX process-group signal semantics",
  },
  async () => {
    const signals = new EventEmitter();
    const fake = await fakeAgent(
      `const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio:'inherit'});\nprocess.stdout.write(${JSON.stringify(bytes(result).toString())});\nsetInterval(() => {}, 1000);`,
    );
    const output = sink();
    const originalWrite = output.stream._write;
    let triggered = false;
    output.stream._write = function (chunk, encoding, done) {
      originalWrite.call(this, chunk, encoding, done);
      if (chunk.length && !triggered) {
        triggered = true;
        signals.emit("SIGINT");
      }
    };
    const outcome = await runCursorProcess({
      ...fake,
      args: [],
      salt,
      captureId: randomUUID(),
      signals,
      stdout: output.stream,
      stderr: sink().stream,
      stdin: "ignore",
    });
    assert.equal(outcome.signal, "SIGINT");
    assert.equal(outcome.code, null);
    assert.equal(outcome.result, undefined);
    assert.equal(signals.listenerCount("SIGINT"), 0);
  },
);

test(
  "Cursor version probe rejects unknown builds and bounds descendant processes",
  { timeout: 15000 },
  async () => {
    const fake = await fakeAgent("process.exitCode = 0;");
    await writeFile(fake.script, "console.log('canary-unknown-provider-version');");
    await assert.rejects(resolveCursorExecutable({ environment: fake.environment }), (error) => {
      assert.equal(error.diagnosticCode, "cursor_version_unsupported");
      assert.ok(!error.message.includes("canary"));
      return true;
    });
    await writeFile(
      fake.script,
      `require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio:'inherit'}); setInterval(() => {}, 1000);`,
    );
    const started = Date.now();
    await assert.rejects(resolveCursorExecutable({ environment: fake.environment }), {
      diagnosticCode: "cursor_version_unsupported",
    });
    assert.ok(Date.now() - started < 10000);
  },
);

test("Cursor output write errors abort capture without changing provider content into a diagnostic", async () => {
  const fake = await fakeAgent(
    `process.stdout.write(${JSON.stringify(bytes(result).toString())}); setInterval(() => {}, 1000);`,
  );
  const stdout = new Writable({
    write(chunk, encoding, done) {
      done(new Error("canary-output-failure"));
    },
  });
  const outcome = await runCursorProcess({
    ...fake,
    args: [],
    salt,
    captureId: randomUUID(),
    stdout,
    stderr: sink().stream,
    stdin: "ignore",
  });
  assert.equal(outcome.result, undefined);
  assert.equal(outcome.diagnostic, "cursor_usage_incomplete");
  assert.ok(!JSON.stringify(outcome).includes("canary"));
});

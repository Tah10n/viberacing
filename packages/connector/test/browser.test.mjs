import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { openBrowser } from "../lib/browser.mjs";

function fakeLauncher(calls, error) {
  return (...arguments_) => {
    calls.push(arguments_);
    const child = new EventEmitter();
    child.unref = () => calls.push(["unref"]);
    if (error) process.nextTick(() => child.emit("error", error));
    return child;
  };
}

test("keeps pairing alive when the injected browser launcher reports ENOENT", async () => {
  const calls = [];
  const error = Object.assign(new Error("missing launcher"), { code: "ENOENT" });
  const child = openBrowser("https://viberacing.example/connect", {
    platform: "linux",
    spawnImplementation: fakeLauncher(calls, error),
  });
  const emitted = once(child, "error");
  assert.equal((await emitted)[0].code, "ENOENT");
  assert.deepEqual(calls, [
    [
      "xdg-open",
      ["https://viberacing.example/connect"],
      { detached: true, shell: false, stdio: "ignore", windowsHide: true },
    ],
    ["unref"],
  ]);
});

test("uses exact platform argv without cmd.exe, /c, or shell mode", () => {
  const calls = [];
  const spawnImplementation = fakeLauncher(calls);
  openBrowser("https://viberacing.example/connect?code=A%26B", {
    platform: "win32",
    environment: { SystemRoot: "C:\\Windows" },
    spawnImplementation,
  });
  openBrowser("https://viberacing.example/connect", {
    platform: "darwin",
    spawnImplementation,
  });
  assert.deepEqual(calls[0], [
    "C:\\Windows\\explorer.exe",
    ["https://viberacing.example/connect?code=A%26B"],
    { detached: true, shell: false, stdio: "ignore", windowsHide: true },
  ]);
  assert.deepEqual(calls[2], [
    "open",
    ["https://viberacing.example/connect"],
    { detached: true, shell: false, stdio: "ignore", windowsHide: true },
  ]);
  for (const call of [calls[0], calls[2]]) {
    assert.notEqual(call[0].toLowerCase(), "cmd.exe");
    assert.ok(!call[1].some((argument) => argument.toLowerCase() === "/c"));
    assert.equal(call[2].shell, false);
  }
});

test("rejects unsafe URLs and invalid Windows roots before spawning", () => {
  const spawnImplementation = () => assert.fail("launcher must not run");
  assert.throws(() => openBrowser("file:///tmp/attacker", { spawnImplementation }), /HTTP/);
  assert.throws(
    () =>
      openBrowser("https://viberacing.example/connect", {
        platform: "win32",
        environment: { SystemRoot: "." },
        spawnImplementation,
      }),
    /SystemRoot/,
  );
});

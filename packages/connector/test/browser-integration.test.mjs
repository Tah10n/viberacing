import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  browserSyncProtocolVersion,
  browserSyncRegistrationStatus,
  registerBrowserSync,
  unregisterBrowserSync,
} from "../lib/browser-integration.mjs";

test("browser Sync protocol identifies installation-scoped handler support", () => {
  assert.equal(browserSyncProtocolVersion, 2);
});

async function macExecute(calls, file, arguments_) {
  calls.push([file, arguments_]);
  if (file === "/usr/bin/osacompile") {
    const output = arguments_[arguments_.indexOf("-o") + 1];
    await mkdir(join(output, "Contents", "MacOS"), { recursive: true });
    await mkdir(join(output, "Contents", "Resources"), { recursive: true });
    await writeFile(join(output, "Contents", "MacOS", "applet"), "synthetic applet\n");
  }
  return { stdout: "" };
}

test("macOS browser Sync registration creates and removes only its owned app", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-mac-handler-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  const execute = (...arguments_) => macExecute(calls, ...arguments_);
  assert.equal(
    await registerBrowserSync("/safe/runtime/viberacing.mjs", {
      allowCustomState: true,
      execute,
      homeDirectory: root,
      platform: "darwin",
      stateDirectory: root,
    }),
    true,
  );
  const app = join(root, "Applications", "Vibe Racing.app");
  const info = await readFile(join(app, "Contents", "Info.plist"), "utf8");
  assert.match(info, /<string>viberacing<\/string>/);
  assert.match(info, /<key>CFBundleTypeRole<\/key><string>Viewer<\/string>/);
  assert.match(info, /<key>LSUIElement<\/key><true\/>/);
  assert.doesNotMatch(info, /NSCameraUsageDescription|NSAppleEventsUsageDescription/);
  const compile = calls.find(([file]) => file === "/usr/bin/osacompile");
  assert.match(compile[1].at(-1), /on open location incomingURL/);
  assert.match(compile[1].at(-1), /handle-url.*incomingURL.*--quiet/);
  assert.doesNotMatch(compile[1].at(-1), /"\$1"/);
  assert.ok(
    calls.some(([file, arguments_]) => file === "/usr/bin/plutil" && arguments_[0] === "-lint"),
  );
  assert.equal(calls.filter(([file]) => file === "/usr/bin/codesign").length, 2);
  assert.ok(calls.some(([, arguments_]) => arguments_[0] === "-f" && arguments_[1] === app));
  assert.equal(
    await browserSyncRegistrationStatus({ homeDirectory: root, platform: "darwin" }),
    "current",
  );
  await unregisterBrowserSync({
    allowCustomState: true,
    execute,
    homeDirectory: root,
    platform: "darwin",
    stateDirectory: root,
  });
  await assert.rejects(readFile(join(app, "Contents", "Info.plist")), { code: "ENOENT" });
  assert.ok(calls.some(([, arguments_]) => arguments_[0] === "-u" && arguments_[1] === app));
});

test("macOS browser Sync registration preserves a foreign app", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-foreign-mac-handler-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const app = join(root, "Applications", "Vibe Racing.app");
  await mkdir(join(app, "Contents"), { recursive: true });
  await writeFile(join(app, "Contents", "Info.plist"), "foreign\n");
  const calls = [];

  assert.equal(
    await registerBrowserSync("/safe/runtime/viberacing.mjs", {
      allowCustomState: true,
      execute: (...arguments_) => macExecute(calls, ...arguments_),
      homeDirectory: root,
      platform: "darwin",
      stateDirectory: root,
    }),
    false,
  );
  assert.equal(
    await browserSyncRegistrationStatus({ homeDirectory: root, platform: "darwin" }),
    "foreign",
  );
  assert.equal(await readFile(join(app, "Contents", "Info.plist"), "utf8"), "foreign\n");
  assert.equal(calls.length, 0);
});

test("macOS browser Sync registration rolls back an owned app when registration fails", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-mac-handler-rollback-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const app = join(root, "Applications", "Vibe Racing.app");
  await mkdir(join(app, "Contents", "Resources"), { recursive: true });
  await writeFile(join(app, "Contents", "Info.plist"), "previous\n");
  await writeFile(
    join(app, "Contents", "Resources", "viberacing-owned"),
    "viberacing-browser-handler-v1\n",
  );
  const calls = [];
  let failed = false;
  const execute = async (...arguments_) => {
    await macExecute(calls, ...arguments_);
    if (!failed && arguments_[1]?.[0] === "-f" && arguments_[1]?.[1] === app) {
      failed = true;
      throw new Error("synthetic registration failure");
    }
    return { stdout: "" };
  };

  assert.equal(
    await registerBrowserSync("/safe/runtime/viberacing.mjs", {
      allowCustomState: true,
      execute,
      homeDirectory: root,
      platform: "darwin",
      stateDirectory: root,
    }),
    false,
  );
  assert.equal(await readFile(join(app, "Contents", "Info.plist"), "utf8"), "previous\n");
  assert.equal(
    await readFile(join(app, "Contents", "Resources", "viberacing-owned"), "utf8"),
    "viberacing-browser-handler-v1\n",
  );
});

test("browser Sync removal with custom state never touches the normal user handler", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-custom-state-handler-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const markerPath = join(
    root,
    "Applications",
    "Vibe Racing.app",
    "Contents",
    "Resources",
    "viberacing-owned",
  );
  await mkdir(join(root, "Applications", "Vibe Racing.app", "Contents", "Resources"), {
    recursive: true,
  });
  await writeFile(markerPath, "viberacing-browser-handler-v1\n");

  await unregisterBrowserSync({
    homeDirectory: root,
    platform: "darwin",
    stateDirectory: join(root, "custom-state"),
  });

  assert.equal(await readFile(markerPath, "utf8"), "viberacing-browser-handler-v1\n");
});

test("Linux browser Sync registration is owned, exact, and removable", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-browser-handler-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  let current = "previous.desktop";
  const execute = async (...arguments_) => {
    calls.push(arguments_);
    if (arguments_[1]?.[0] === "query") return { stdout: `${current}\n` };
    if (arguments_[1]?.[0] === "default") current = arguments_[1][1];
    return { stdout: "" };
  };
  const environment = { XDG_DATA_HOME: root };
  assert.equal(
    await registerBrowserSync("/safe/runtime/viberacing.mjs", {
      allowCustomState: true,
      environment,
      execute,
      platform: "linux",
      stateDirectory: root,
    }),
    true,
  );
  const desktop = join(root, "applications", "viberacing-url.desktop");
  const contents = await readFile(desktop, "utf8");
  assert.match(contents, /viberacing-browser-handler-v1/);
  assert.match(contents, /x-scheme-handler\/viberacing/);
  assert.deepEqual(calls[1], [
    "xdg-mime",
    ["default", "viberacing-url.desktop", "x-scheme-handler/viberacing"],
  ]);
  assert.equal(
    await browserSyncRegistrationStatus({ environment, execute, platform: "linux" }),
    "current",
  );
  await unregisterBrowserSync({
    allowCustomState: true,
    environment,
    execute,
    platform: "linux",
    stateDirectory: root,
  });
  assert.equal(current, "previous.desktop");
  await assert.rejects(readFile(desktop), { code: "ENOENT" });
});

test("Linux uninstall preserves a newer foreign default handler", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-newer-handler-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  let current = "previous.desktop";
  const defaults = [];
  const execute = async (_file, arguments_) => {
    if (arguments_[0] === "query") return { stdout: `${current}\n` };
    if (arguments_[0] === "default") {
      current = arguments_[1];
      defaults.push(current);
    }
    return { stdout: "" };
  };
  const options = {
    allowCustomState: true,
    environment: { XDG_DATA_HOME: root },
    execute,
    platform: "linux",
    stateDirectory: root,
  };
  assert.equal(await registerBrowserSync("/safe/runtime/viberacing.mjs", options), true);
  current = "newer.desktop";
  await unregisterBrowserSync(options);
  assert.deepEqual(defaults, ["viberacing-url.desktop"]);
  assert.equal(current, "newer.desktop");
});

test("Linux reconnect never replaces a newer foreign default handler", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-newer-default-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  let current = "previous.desktop";
  const defaults = [];
  const execute = async (_file, arguments_) => {
    if (arguments_[0] === "query") return { stdout: `${current}\n` };
    if (arguments_[0] === "default") {
      current = arguments_[1];
      defaults.push(current);
    }
    return { stdout: "" };
  };
  const options = {
    allowCustomState: true,
    environment: { XDG_DATA_HOME: root },
    execute,
    platform: "linux",
    stateDirectory: root,
  };
  assert.equal(await registerBrowserSync("/safe/runtime/viberacing.mjs", options), true);
  current = "newer.desktop";
  assert.equal(await registerBrowserSync("/safe/runtime/viberacing.mjs", options), false);
  assert.deepEqual(defaults, ["viberacing-url.desktop"]);
  assert.equal(current, "newer.desktop");
  assert.equal(await browserSyncRegistrationStatus(options), "foreign");
});

test("browser Sync registration never overwrites a foreign Linux handler", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-foreign-handler-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const desktop = join(root, "applications", "viberacing-url.desktop");
  await mkdir(join(root, "applications"), { recursive: true });
  await writeFile(desktop, "[Desktop Entry]\nName=Foreign\n", "utf8");
  assert.equal(
    await registerBrowserSync("/safe/runtime/viberacing.mjs", {
      allowCustomState: true,
      environment: { XDG_DATA_HOME: root },
      execute: async () => assert.fail("foreign registration must not execute commands"),
      platform: "linux",
      stateDirectory: root,
    }),
    false,
  );
  assert.equal(await readFile(desktop, "utf8"), "[Desktop Entry]\nName=Foreign\n");
});

test("Windows browser Sync registration and diagnostics require the owned registry marker", async () => {
  const calls = [];
  const missing = Object.assign(new Error("missing"), { code: 1 });
  const execute = async (file, arguments_) => {
    calls.push([file, arguments_]);
    if (arguments_[0] === "QUERY") throw missing;
    return { stdout: "" };
  };
  const environment = { SystemRoot: "C:\\Windows" };
  assert.equal(
    await registerBrowserSync("C:\\safe\\viberacing.mjs", {
      allowCustomState: true,
      environment,
      execute,
      platform: "win32",
      runtimeExecutable: "C:\\Program Files\\nodejs\\node.exe",
      stateDirectory: "C:\\safe\\state",
    }),
    true,
  );
  assert.equal(calls.filter(([, arguments_]) => arguments_[0] === "ADD").length, 4);
  assert.equal(
    calls.at(-1)?.[1]?.at(-2),
    '"C:\\Program Files\\nodejs\\node.exe" "C:\\safe\\viberacing.mjs" handle-url "%1"',
  );
  assert.doesNotMatch(calls.at(-1)?.[1]?.at(-2), /\^/);
  assert.equal(
    await browserSyncRegistrationStatus({ environment, execute, platform: "win32" }),
    "missing",
  );
  assert.equal(
    await browserSyncRegistrationStatus({
      environment,
      execute: async () => ({ stdout: "VibeRacingOwned    REG_SZ    foreign" }),
      platform: "win32",
    }),
    "foreign",
  );
  assert.equal(
    await browserSyncRegistrationStatus({
      environment,
      execute: async () => ({
        stdout: "VibeRacingOwned    REG_SZ    viberacing-browser-handler-v1",
      }),
      platform: "win32",
    }),
    "current",
  );
});

test("Windows browser Sync registration never overwrites an unmarked existing key", async () => {
  const key = "HKCU\\Software\\Classes\\viberacing";
  const missingValue = Object.assign(new Error("missing value"), { code: 1 });
  const execute = async (_file, arguments_) => {
    if (arguments_[0] === "ADD" || arguments_[0] === "DELETE")
      assert.fail("foreign registry key must not be mutated");
    if (arguments_[0] === "QUERY" && arguments_.length === 2) return { stdout: key };
    if (arguments_[0] === "QUERY" && arguments_[2] === "/v") throw missingValue;
    return { stdout: "" };
  };
  assert.equal(
    await browserSyncRegistrationStatus({
      environment: { SystemRoot: "C:\\Windows" },
      execute,
      platform: "win32",
    }),
    "foreign",
  );
  assert.equal(
    await registerBrowserSync("C:\\safe\\viberacing.mjs", {
      allowCustomState: true,
      environment: { SystemRoot: "C:\\Windows" },
      execute,
      platform: "win32",
      runtimeExecutable: "C:\\Program Files\\nodejs\\node.exe",
      stateDirectory: "C:\\safe\\state",
    }),
    false,
  );
});

test("Windows browser Sync registration rolls back a newly created partial key", async () => {
  const calls = [];
  const missing = Object.assign(new Error("missing"), { code: 1 });
  const failedWrite = new Error("synthetic command write failure");
  const execute = async (_file, arguments_) => {
    calls.push(arguments_);
    if (arguments_[0] === "QUERY") throw missing;
    if (arguments_[0] === "ADD" && String(arguments_[1]).endsWith("shell\\open\\command"))
      throw failedWrite;
    return { stdout: "" };
  };
  assert.equal(
    await registerBrowserSync("C:\\safe\\viberacing.mjs", {
      allowCustomState: true,
      environment: { SystemRoot: "C:\\Windows" },
      execute,
      platform: "win32",
      runtimeExecutable: "C:\\Program Files\\nodejs\\node.exe",
      stateDirectory: "C:\\safe\\state",
    }),
    false,
  );
  assert.deepEqual(calls.at(-1), ["DELETE", "HKCU\\Software\\Classes\\viberacing", "/f"]);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
  link,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import {
  generateOpenCodePlugin,
  inspectOpenCodePlugin,
  openCodePluginEnvironment,
  openCodePluginLocation,
  openCodeStateRootHash,
  reconcileOpenCodePlugin,
} from "../lib/opencode-plugin.mjs";

const installationA = "11111111-1111-4111-8111-111111111111";
const installationB = "22222222-2222-4222-8222-222222222222";

function pluginOptions(root, configRoot = join(root, "config"), overrides = {}) {
  const stateRoot = join(root, "state with spaces 雪");
  return {
    installationId: installationA,
    stateRoot,
    launcherPath: join(stateRoot, "bin", "viberacing-hook.mjs"),
    nodeExecutable: process.execPath,
    environment: { XDG_CONFIG_HOME: configRoot, HOME: root, LANG: "en_US.UTF-8" },
    homeDirectory: root,
    ...(process.platform === "win32"
      ? { inspectWindowsFile: async () => true, secureWindowsFile: async () => {} }
      : {}),
    ...overrides,
  };
}

async function temporaryRoot(context, prefix = "viberacing-opencode-plugin-") {
  const root = await mkdtemp(join(tmpdir(), prefix));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("OpenCode plugin path follows XDG on Linux, macOS, and Windows", () => {
  assert.deepEqual(
    openCodePluginLocation({
      installationId: installationA,
      environment: {},
      homeDirectory: "/Users/racer",
      platform: "darwin",
    }),
    {
      directory: "/Users/racer/.config/opencode/plugins",
      path: `/Users/racer/.config/opencode/plugins/viberacing-${installationA}.js`,
    },
  );
  assert.equal(
    openCodePluginLocation({
      installationId: installationA,
      environment: { XDG_CONFIG_HOME: "/srv/config with spaces/赛车" },
      homeDirectory: "/home/racer",
      platform: "linux",
    }).path,
    `/srv/config with spaces/赛车/opencode/plugins/viberacing-${installationA}.js`,
  );
  assert.equal(
    openCodePluginLocation({
      installationId: installationA,
      environment: {
        USERPROFILE: "C:\\Users\\Racer",
        APPDATA: "C:\\Users\\Racer\\AppData\\Roaming",
        LOCALAPPDATA: "C:\\Users\\Racer\\AppData\\Local",
      },
      homeDirectory: "C:\\Users\\Racer",
      platform: "win32",
    }).path,
    `C:\\Users\\Racer\\.config\\opencode\\plugins\\viberacing-${installationA}.js`,
  );
  assert.equal(
    openCodePluginLocation({
      installationId: installationA,
      environment: { XDG_CONFIG_HOME: "\\\\server\\share\\OpenCode 雪" },
      homeDirectory: "C:\\Users\\Racer",
      platform: "win32",
    }).directory,
    "\\\\server\\share\\OpenCode 雪\\opencode\\plugins",
  );
  assert.equal(
    openCodePluginLocation({
      installationId: installationA,
      environment: { XDG_CONFIG_HOME: "D:\\Portable Config" },
      homeDirectory: "C:\\Users\\Racer",
      platform: "win32",
    }).directory,
    "D:\\Portable Config\\opencode\\plugins",
  );
});

test("OpenCode plugin path rejects relative or unsafe roots and invalid identities", () => {
  for (const platform of ["linux", "darwin", "win32"])
    assert.throws(
      () =>
        openCodePluginLocation({
          installationId: installationA,
          environment: { XDG_CONFIG_HOME: "relative/config" },
          homeDirectory: platform === "win32" ? "C:\\Users\\Racer" : "/home/racer",
          platform,
        }),
      /absolute safe path/,
    );
  assert.throws(
    () =>
      openCodePluginLocation({
        installationId: "copied-identity",
        environment: {},
        homeDirectory: "/home/racer",
      }),
    /Invalid installation id/,
  );
});

test("generated plugin is deterministic, dependency-free, escaped, and privacy-minimized", async () => {
  const options = {
    installationId: installationA,
    stateRoot: "/Users/Racer/Vibe Racing 雪/quoted-'root",
    launcherPath: "/Users/Racer/Vibe Racing 雪/quoted-'root/bin/viberacing-hook.mjs",
    nodeExecutable: "/Applications/Node 雪/bin/node",
    environment: {
      HOME: "/Users/Racer",
      LANG: "en_US.UTF-8",
      HTTPS_PROXY: "http://proxy.invalid",
      PWD: "/private/project",
      OPENCODE_CONFIG_DIR: "/private/opencode",
      OPENAI_API_KEY: "private-provider-key",
      NODE_OPTIONS: "--inspect",
    },
    platform: "linux",
  };
  const first = generateOpenCodePlugin(options);
  assert.equal(first, generateOpenCodePlugin(options));
  assert.match(
    first.split("\n")[0],
    new RegExp(
      `^// viberacing-opencode-plugin \\{"schema":1,"installationId":"${installationA}","stateRootHash":"[0-9a-f]{64}"\\}$`,
    ),
  );
  assert.equal((first.match(/\bexport\b/g) ?? []).length, 1);
  assert.doesNotMatch(
    first,
    /\bimport\b|require\(|shell\s*:|sessionID|messageID|project|worktree|client|OPENAI_API_KEY|NODE_OPTIONS|OPENCODE_|private-provider-key|private\/project/,
  );
  assert.match(first, /Bun\.spawn\(command/);
  assert.match(first, /"--all-sources","--installation"/);
  assert.match(first, /"detached":true|detached: true/);
  assert.match(first, /stdio: \["ignore", "ignore", "ignore"\]/);
  assert.match(first, /windowsHide: true/);
  assert.doesNotMatch(first, /0\.5\.[01]/);
  const module = await import(`data:text/javascript,${encodeURIComponent(first)}`);
  assert.deepEqual(Object.keys(module), ["VibeRacingPlugin"]);
});

test("generated plugin sanitizes environment with Windows case-insensitive matching", () => {
  assert.deepEqual(
    openCodePluginEnvironment(
      "C:\\State Root",
      {
        Path: "private-bin",
        systemroot: "C:\\Windows",
        Https_Proxy: "http://proxy.invalid",
        opencode_token: "private",
        NODE_OPTIONS: "--inspect",
        Node_Env: "test",
        viberacing_test_trace: "C:\\Temp\\trace",
      },
      "win32",
    ),
    {
      systemroot: "C:\\Windows",
      Https_Proxy: "http://proxy.invalid",
      Node_Env: "test",
      viberacing_test_trace: "C:\\Temp\\trace",
      VIBERACING_STATE_DIR: "C:\\State Root",
    },
  );
  assert.deepEqual(
    openCodePluginEnvironment(
      "/state",
      {
        HOME: "/home/racer",
        https_proxy: "http://lowercase-proxy.invalid",
        NODE_ENV: "production",
        VIBERACING_TEST_TRACE: "/tmp/private",
      },
      "linux",
    ),
    {
      HOME: "/home/racer",
      https_proxy: "http://lowercase-proxy.invalid",
      VIBERACING_STATE_DIR: "/state",
    },
  );
});

async function loadGeneratedHandler(options, spawn, now) {
  const bunDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Bun");
  const performanceDescriptor = Object.getOwnPropertyDescriptor(globalThis, "performance");
  Object.defineProperty(globalThis, "Bun", { configurable: true, value: { spawn } });
  Object.defineProperty(globalThis, "performance", {
    configurable: true,
    value: { now: () => now.value },
  });
  const source = generateOpenCodePlugin(options);
  const module = await import(
    `data:text/javascript,${encodeURIComponent(source)}#${Math.random().toString(16).slice(2)}`
  );
  const plugin = await module.VibeRacingPlugin();
  return {
    handler: plugin.event,
    restore() {
      if (bunDescriptor) Object.defineProperty(globalThis, "Bun", bunDescriptor);
      else delete globalThis.Bun;
      if (performanceDescriptor)
        Object.defineProperty(globalThis, "performance", performanceDescriptor);
      else delete globalThis.performance;
      delete globalThis[Symbol.for(`viberacing.opencode.idle.${options.installationId}`)];
    },
  };
}

test("generated synchronous handler accepts only idle events and debounces fallback", async (context) => {
  const root = await temporaryRoot(context);
  const options = pluginOptions(root);
  const calls = [];
  let unrefs = 0;
  const now = { value: 10_000 };
  const loaded = await loadGeneratedHandler(
    options,
    (...arguments_) => {
      calls.push(arguments_);
      return { unref: () => (unrefs += 1) };
    },
    now,
  );
  context.after(loaded.restore);
  const allowedStatus = new Proxy(
    { type: "idle" },
    {
      get(target, property) {
        if (property !== "type") throw new Error(`private status field read: ${String(property)}`);
        return target[property];
      },
    },
  );
  const allowedProperties = new Proxy(
    { status: allowedStatus },
    {
      get(target, property) {
        if (property !== "status")
          throw new Error(`private properties field read: ${String(property)}`);
        return target[property];
      },
    },
  );
  const event = new Proxy(
    { type: "session.status", properties: allowedProperties },
    {
      get(target, property) {
        if (property !== "type" && property !== "properties")
          throw new Error(`private event field read: ${String(property)}`);
        return target[property];
      },
    },
  );
  assert.equal(loaded.handler({ event }), undefined);
  assert.equal(calls.length, 1);
  assert.equal(unrefs, 1);
  assert.deepEqual(calls[0][0], [
    process.execPath,
    options.launcherPath,
    "hook",
    "--agent",
    "opencode",
    "--all-sources",
    "--installation",
    installationA,
  ]);
  assert.deepEqual(calls[0][1], {
    cwd: options.stateRoot,
    env: openCodePluginEnvironment(options.stateRoot, process.env),
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    windowsHide: true,
  });
  loaded.handler({ event: { type: "session.idle" } });
  assert.equal(calls.length, 1);
  now.value += 2_001;
  loaded.handler({ event: { type: "session.idle" } });
  assert.equal(calls.length, 2);
  loaded.handler({ event: { type: "session.status", properties: { status: { type: "busy" } } } });
  loaded.handler({ event: { type: "message.updated", sessionID: "private" } });
  assert.equal(calls.length, 2);
});

test("spawn failure is suppressed and does not block fallback retry", async (context) => {
  const root = await temporaryRoot(context);
  const options = pluginOptions(root, join(root, "config"), { installationId: installationB });
  const now = { value: 50 };
  let attempts = 0;
  const loaded = await loadGeneratedHandler(
    options,
    () => {
      attempts += 1;
      if (attempts === 1) throw new Error("synthetic spawn failure");
      return { unref() {} };
    },
    now,
  );
  context.after(loaded.restore);
  assert.doesNotThrow(() =>
    loaded.handler({ event: { type: "session.status", properties: { status: { type: "idle" } } } }),
  );
  assert.doesNotThrow(() => loaded.handler({ event: { type: "session.idle" } }));
  assert.equal(attempts, 2);
});

test("owned plugin lifecycle is atomic, private, idempotent, and preserves siblings", async (context) => {
  const root = await temporaryRoot(context);
  const options = pluginOptions(root);
  const location = openCodePluginLocation(options);
  await mkdir(location.directory, { recursive: true });
  const sibling = join(location.directory, "foreign-plugin.js");
  await writeFile(sibling, "foreign bytes\n");
  assert.equal((await inspectOpenCodePlugin(options)).status, "missing");
  const created = await reconcileOpenCodePlugin({ ...options, desired: true });
  assert.equal(created.action, "created");
  assert.equal(created.status, "current");
  if (process.platform !== "win32") assert.equal((await stat(location.path)).mode & 0o777, 0o600);
  assert.equal(await readFile(sibling, "utf8"), "foreign bytes\n");
  const bytes = await readFile(location.path, "utf8");
  assert.equal((await reconcileOpenCodePlugin({ ...options, desired: true })).action, "none");
  assert.equal(await readFile(location.path, "utf8"), bytes);
  const alternateNode =
    process.platform === "win32" ? "C:\\different\\node.exe" : "/different/absolute/node";
  const updated = await reconcileOpenCodePlugin({
    ...options,
    nodeExecutable: alternateNode,
    desired: true,
  });
  assert.equal(updated.action, "updated");
  assert.match(await readFile(location.path, "utf8"), /different/);
  const removed = await reconcileOpenCodePlugin({
    ...options,
    nodeExecutable: alternateNode,
    desired: false,
  });
  assert.equal(removed.action, "removed");
  assert.equal((await inspectOpenCodePlugin(options)).status, "missing");
  assert.equal(await readFile(sibling, "utf8"), "foreign bytes\n");
});

test("copied installation identity cannot overwrite a plugin from another state root", async (context) => {
  const root = await temporaryRoot(context);
  const configRoot = join(root, "global-config");
  const first = pluginOptions(join(root, "first"), configRoot);
  const second = pluginOptions(join(root, "second"), configRoot);
  await reconcileOpenCodePlugin({ ...first, desired: true });
  const before = await readFile(openCodePluginLocation(first).path, "utf8");
  const conflict = await reconcileOpenCodePlugin({ ...second, desired: true });
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.action, "blocked");
  assert.equal(await readFile(openCodePluginLocation(first).path, "utf8"), before);
  assert.notEqual(openCodeStateRootHash(first.stateRoot), openCodeStateRootHash(second.stateRoot));
});

test("independent installations coexist in one global OpenCode plugin directory", async (context) => {
  const root = await temporaryRoot(context);
  const configRoot = join(root, "global-config");
  const first = pluginOptions(join(root, "first"), configRoot);
  const second = {
    ...pluginOptions(join(root, "second"), configRoot),
    installationId: installationB,
  };
  await reconcileOpenCodePlugin({ ...first, desired: true });
  await reconcileOpenCodePlugin({ ...second, desired: true });
  const firstLocation = openCodePluginLocation(first);
  const secondLocation = openCodePluginLocation(second);
  assert.notEqual(firstLocation.path, secondLocation.path);
  const firstBytes = await readFile(firstLocation.path, "utf8");
  const secondBytes = await readFile(secondLocation.path, "utf8");
  assert.match(firstBytes, new RegExp(first.installationId));
  assert.match(secondBytes, new RegExp(second.installationId));
  await reconcileOpenCodePlugin({ ...first, desired: false });
  assert.equal(await readFile(secondLocation.path, "utf8"), secondBytes);
});

test("inspection rejects foreign, malformed, newer, oversized, linked, and non-file targets", async (context) => {
  const cases = [
    ["foreign", "export const foreign = true;\n", "conflict"],
    ["malformed", "// viberacing-opencode-plugin {bad json}\n", "conflict"],
    [
      "newer",
      `// viberacing-opencode-plugin ${JSON.stringify({ schema: 2, installationId: installationA, stateRootHash: "a".repeat(64) })}\n`,
      "unsupported-newer",
    ],
    ["oversized", "x".repeat(64 * 1024 + 1), "unsafe"],
  ];
  for (const [name, contents, expected] of cases) {
    const root = await temporaryRoot(context, `viberacing-opencode-${name}-`);
    const options = pluginOptions(root);
    const location = openCodePluginLocation(options);
    await mkdir(location.directory, { recursive: true });
    await writeFile(location.path, contents, { mode: 0o600 });
    assert.equal((await inspectOpenCodePlugin(options)).status, expected);
    const result = await reconcileOpenCodePlugin({ ...options, desired: true });
    assert.equal(result.action, "blocked");
    assert.equal(await readFile(location.path, "utf8"), contents);
  }

  const linkedRoot = await temporaryRoot(context, "viberacing-opencode-linked-");
  const linkedOptions = pluginOptions(linkedRoot);
  const linkedLocation = openCodePluginLocation(linkedOptions);
  await mkdir(linkedLocation.directory, { recursive: true });
  const target = join(linkedRoot, "target.js");
  await writeFile(target, generateOpenCodePlugin(linkedOptions), { mode: 0o600 });
  if (process.platform !== "win32") {
    await symlink(target, linkedLocation.path);
    assert.equal((await inspectOpenCodePlugin(linkedOptions)).status, "unsafe");
    await rm(linkedLocation.path);
  }
  await link(target, linkedLocation.path);
  assert.equal((await inspectOpenCodePlugin(linkedOptions)).status, "unsafe");
  await rm(linkedLocation.path);
  await mkdir(linkedLocation.path);
  assert.equal((await inspectOpenCodePlugin(linkedOptions)).status, "unsafe");
});

test(
  "wrong owner or permissive POSIX mode is unsafe",
  { skip: process.platform === "win32" },
  async (context) => {
    const root = await temporaryRoot(context);
    const options = pluginOptions(root);
    const location = openCodePluginLocation(options);
    await mkdir(location.directory, { recursive: true });
    await writeFile(location.path, generateOpenCodePlugin(options), { mode: 0o644 });
    assert.equal((await inspectOpenCodePlugin(options)).status, "unsafe");
    await rm(location.path);
    await writeFile(location.path, generateOpenCodePlugin(options), { mode: 0o600 });
    const real = await stat(location.path);
    assert.equal(
      (
        await inspectOpenCodePlugin({
          ...options,
          lstat: async () => ({
            ...real,
            uid: (real.uid ?? 0) + 1,
            isFile: () => real.isFile(),
            isDirectory: () => real.isDirectory(),
            isSymbolicLink: () => real.isSymbolicLink(),
          }),
        })
      ).status,
      "unsafe",
    );
  },
);

test("interrupted atomic install removes its temporary file", async (context) => {
  const root = await temporaryRoot(context);
  const options = pluginOptions(root);
  const location = openCodePluginLocation(options);
  await assert.rejects(
    reconcileOpenCodePlugin({
      ...options,
      desired: true,
      rename: async () => {
        throw new Error("synthetic interrupted rename");
      },
    }),
    /synthetic interrupted rename/,
  );
  assert.deepEqual(
    (await readdir(location.directory)).filter((name) => name.includes(".tmp")),
    [],
  );
});

test("Windows plugin reconciliation invokes owner-only ACL checks without chmod", async () => {
  const calls = [];
  const fakeStats = {
    dev: 1,
    ino: 2,
    mode: 0,
    nlink: 1,
    size: 1,
    uid: 0,
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false,
  };
  const options = {
    installationId: installationA,
    stateRoot: "C:\\Vibe Racing\\State",
    launcherPath: "C:\\Vibe Racing\\State\\bin\\viberacing-hook.mjs",
    nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
    homeDirectory: "C:\\Users\\Racer",
    environment: { SystemRoot: "C:\\Windows" },
    platform: "win32",
    lstat: async (path) => {
      calls.push(["lstat", path]);
      return fakeStats;
    },
    readFile: async () => "foreign\n",
    inspectWindowsFile: async (path) => {
      calls.push(["inspect", path]);
      return false;
    },
    chmod: async () => assert.fail("Windows plugin lifecycle must not rely on chmod"),
  };
  assert.equal((await inspectOpenCodePlugin(options)).status, "unsafe");
  assert.equal(
    calls.some(([kind]) => kind === "inspect"),
    true,
  );
});

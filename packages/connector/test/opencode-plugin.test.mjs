import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
  link,
  open,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, win32 } from "node:path";
import {
  generateOpenCodePlugin,
  inspectOpenCodePlugin,
  maximumOpenCodePluginBytes,
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

test("generated plugin reads only allowlisted environment values", async () => {
  const options = pluginOptions(join(tmpdir(), "viberacing-environment-read"));
  const preparationReads = [];
  const suppliedEnvironment = new Proxy(
    {
      HOME: "/home/racer",
      OPENAI_API_KEY: "provider-secret",
      PROJECT_SECRET: "project-secret",
    },
    {
      get(target, property, receiver) {
        if (typeof property === "string") preparationReads.push(property);
        return Reflect.get(target, property, receiver);
      },
    },
  );
  assert.deepEqual(openCodePluginEnvironment(options.stateRoot, suppliedEnvironment), {
    HOME: "/home/racer",
    VIBERACING_STATE_DIR: options.stateRoot,
  });
  const source = generateOpenCodePlugin({ ...options, environment: suppliedEnvironment });
  assert.equal(preparationReads.includes("HOME"), true);
  assert.equal(preparationReads.includes("OPENAI_API_KEY"), false);
  assert.equal(preparationReads.includes("PROJECT_SECRET"), false);
  const originalEnvironment = process.env;
  const reads = [];
  process.env = new Proxy(
    {
      HOME: "/home/racer",
      OPENAI_API_KEY: "provider-secret",
      PROJECT_SECRET: "project-secret",
    },
    {
      get(target, property, receiver) {
        if (typeof property === "string") reads.push(property);
        return Reflect.get(target, property, receiver);
      },
    },
  );
  try {
    await import(`data:text/javascript,${encodeURIComponent(source)}#environment-read`);
  } finally {
    process.env = originalEnvironment;
  }
  assert.equal(reads.includes("HOME"), true);
  assert.equal(reads.includes("OPENAI_API_KEY"), false);
  assert.equal(reads.includes("PROJECT_SECRET"), false);
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

test("owned plugin lifecycle is exclusive, private, idempotent, and preserves siblings", async (context) => {
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
  await assert.rejects(readFile(location.path, "utf8"), { code: "ENOENT" });
  assert.equal(await readFile(sibling, "utf8"), "foreign bytes\n");
  assert.deepEqual(await readdir(location.directory), ["foreign-plugin.js"]);
});

test("plugin mutations journal private artifacts before creation or rename", async (context) => {
  const root = await temporaryRoot(context);
  const options = pluginOptions(root);
  const location = openCodePluginLocation(options);
  const retained = new Set();
  const observed = [];
  const journal = {
    retainRecoveryPath: async (path) => {
      retained.add(path);
      observed.push(["retain", path]);
    },
    releaseRecoveryPath: async (path) => {
      assert.equal(retained.has(path), true);
      retained.delete(path);
      observed.push(["release", path]);
    },
    open: async (path, ...arguments_) => {
      if (path.endsWith(".stage")) assert.equal(retained.has(path), true);
      return open(path, ...arguments_);
    },
    rename: async (source, target) => {
      if (source === location.path) assert.equal(retained.has(target), true);
      return rename(source, target);
    },
  };
  await reconcileOpenCodePlugin({ ...options, ...journal, desired: true });
  await reconcileOpenCodePlugin({
    ...options,
    ...journal,
    nodeExecutable: process.platform === "win32" ? "C:\\different\\node.exe" : "/different/node",
    desired: true,
  });
  assert.equal(retained.size, 0);
  assert.equal(
    observed.some(([event, path]) => event === "retain" && path.endsWith(".stage")),
    true,
  );
  assert.equal(
    observed.some(([event, path]) => event === "retain" && path.includes(".quarantine-")),
    true,
  );
});

test("cleanup removes both links from an uncommitted published stage", async (context) => {
  const root = await temporaryRoot(context);
  const options = pluginOptions(root);
  const location = openCodePluginLocation(options);
  await reconcileOpenCodePlugin({ ...options, desired: true });
  const stage = `${location.path}.${process.pid}.${randomUUID()}.stage`;
  await link(location.path, stage);
  assert.equal((await stat(location.path)).nlink, 2);

  const result = await reconcileOpenCodePlugin({
    ...options,
    pluginPath: stage,
    allowRecoveryPath: true,
    desired: false,
  });
  assert.deepEqual(result, {
    status: "missing",
    action: "removed",
    changed: true,
    path: stage,
  });
  await assert.rejects(stat(stage), { code: "ENOENT" });
  await assert.rejects(stat(location.path), { code: "ENOENT" });
  assert.equal((await inspectOpenCodePlugin(options)).status, "missing");
});

test("cleanup recovers a restored quarantine hardlink without deleting the canonical plugin", async (context) => {
  const root = await temporaryRoot(context);
  const options = pluginOptions(root);
  const location = openCodePluginLocation(options);
  await reconcileOpenCodePlugin({ ...options, desired: true });
  const quarantine = `${location.path}.quarantine-${randomUUID()}`;
  await rename(location.path, quarantine);
  await link(quarantine, location.path);
  assert.equal((await stat(quarantine)).nlink, 2);

  const result = await reconcileOpenCodePlugin({
    ...options,
    pluginPath: quarantine,
    allowRecoveryPath: true,
    desired: false,
  });
  assert.equal(result.action, "removed");
  await assert.rejects(stat(quarantine), { code: "ENOENT" });
  assert.equal((await stat(location.path)).nlink, 1);
  assert.equal((await inspectOpenCodePlugin(options)).status, "current");
});

test("journal-authorized cleanup removes only a private partial stage prefix", async (context) => {
  const root = await temporaryRoot(context);
  const options = pluginOptions(root);
  const location = openCodePluginLocation(options);
  const stage = `${location.path}.${process.pid}.${randomUUID()}.stage`;
  const contents = generateOpenCodePlugin(options);
  await mkdir(location.directory, { recursive: true });
  await writeFile(stage, contents.slice(0, 80), { mode: 0o600 });

  const blocked = await reconcileOpenCodePlugin({
    ...options,
    pluginPath: stage,
    allowRecoveryPath: true,
    desired: false,
  });
  assert.equal(blocked.action, "blocked");
  await stat(stage);

  const removed = await reconcileOpenCodePlugin({
    ...options,
    pluginPath: stage,
    allowRecoveryPath: true,
    allowIncompleteStageCleanup: true,
    desired: false,
  });
  assert.equal(removed.action, "removed");
  await assert.rejects(stat(stage), { code: "ENOENT" });

  const foreignStage = `${location.path}.${process.pid}.${randomUUID()}.stage`;
  await writeFile(foreignStage, "foreign plugin bytes\n", { mode: 0o600 });
  const foreign = await reconcileOpenCodePlugin({
    ...options,
    pluginPath: foreignStage,
    allowRecoveryPath: true,
    allowIncompleteStageCleanup: true,
    desired: false,
  });
  assert.equal(foreign.action, "blocked");
  assert.equal(await readFile(foreignStage, "utf8"), "foreign plugin bytes\n");
});

test("owned update retries a one-shot stage unlink failure and removes its quarantine", async (context) => {
  const root = await temporaryRoot(context);
  const options = pluginOptions(root);
  const location = openCodePluginLocation(options);
  await reconcileOpenCodePlugin({ ...options, desired: true });
  let failed = false;
  const updated = await reconcileOpenCodePlugin({
    ...options,
    nodeExecutable: process.platform === "win32" ? "C:\\different\\node.exe" : "/different/node",
    unlink: async (path) => {
      if (!failed && path.endsWith(".stage")) {
        failed = true;
        const error = new Error("synthetic one-shot stage unlink failure");
        error.code = "EPERM";
        throw error;
      }
      return unlink(path);
    },
    desired: true,
  });
  assert.equal(updated.action, "updated");
  assert.equal(failed, true);
  assert.deepEqual(await readdir(location.directory), [basename(location.path)]);
  assert.equal(
    (await inspectOpenCodePlugin({ ...options, nodeExecutable: "/different/node" })).status,
    "current",
  );
});

test("persistent stage unlink failure reports both exact recovery artifacts", async (context) => {
  const root = await temporaryRoot(context);
  const options = pluginOptions(root);
  const location = openCodePluginLocation(options);
  await reconcileOpenCodePlugin({ ...options, desired: true });
  let caught;
  try {
    await reconcileOpenCodePlugin({
      ...options,
      nodeExecutable: process.platform === "win32" ? "C:\\different\\node.exe" : "/different/node",
      unlink: async (path) => {
        if (path.endsWith(".stage")) {
          const error = new Error("synthetic persistent stage unlink failure");
          error.code = "EPERM";
          throw error;
        }
        return unlink(path);
      },
      desired: true,
    });
  } catch (error) {
    caught = error;
  }
  assert.match(caught?.message ?? "", /persistent stage unlink failure.*preserved at/);
  assert.equal(caught.pluginPath, location.path);
  assert.equal(caught.recoveryPaths.length, 2);
  assert.equal(
    caught.recoveryPaths.some((path) => path.endsWith(".stage")),
    true,
  );
  assert.equal(
    caught.recoveryPaths.some((path) => path.includes(".quarantine-")),
    true,
  );
  for (const path of caught.recoveryPaths) await stat(path);
});

test("atomic publish never overwrites a foreign file raced into the target path", async (context) => {
  const root = await temporaryRoot(context);
  const options = pluginOptions(root);
  const location = openCodePluginLocation(options);
  const foreign = "export const ForeignPlugin = true;\n";
  let raced = false;
  await assert.rejects(
    reconcileOpenCodePlugin({
      ...options,
      desired: true,
      link: async (source, target) => {
        if (!raced && target === location.path) {
          raced = true;
          await writeFile(target, foreign, { mode: 0o600 });
        }
        return link(source, target);
      },
    }),
    /changed during installation \(conflict\)/,
  );
  assert.equal(await readFile(location.path, "utf8"), foreign);
});

test("owned updates fail closed when exclusive hardlink publication is unavailable", async (context) => {
  const root = await temporaryRoot(context);
  const options = pluginOptions(root);
  const location = openCodePluginLocation(options);
  await reconcileOpenCodePlugin({ ...options, desired: true });
  const before = await readFile(location.path, "utf8");
  await assert.rejects(
    reconcileOpenCodePlugin({
      ...options,
      nodeExecutable: process.platform === "win32" ? "C:\\different\\node.exe" : "/different/node",
      link: async () => {
        const error = new Error("hardlinks unavailable");
        error.code = "ENOTSUP";
        throw error;
      },
      desired: true,
    }),
    /hardlinks unavailable/,
  );
  assert.equal(await readFile(location.path, "utf8"), before);
  assert.equal((await inspectOpenCodePlugin(options)).status, "current");
});

test("an interrupted owned update restores the prior plugin bytes", async (context) => {
  const root = await temporaryRoot(context);
  const options = pluginOptions(root);
  const location = openCodePluginLocation(options);
  await reconcileOpenCodePlugin({ ...options, desired: true });
  const before = await readFile(location.path, "utf8");
  let interrupted = false;
  await assert.rejects(
    reconcileOpenCodePlugin({
      ...options,
      nodeExecutable: process.platform === "win32" ? "C:\\different\\node.exe" : "/different/node",
      link: async (source, target) => {
        if (!interrupted && target === location.path) {
          interrupted = true;
          throw new Error("synthetic interrupted owned update");
        }
        return link(source, target);
      },
      desired: true,
    }),
    /synthetic interrupted owned update/,
  );
  assert.equal(await readFile(location.path, "utf8"), before);
  assert.equal((await inspectOpenCodePlugin(options)).status, "current");
});

test("identity-bound removal preserves a foreign file raced into the target path", async (context) => {
  const root = await temporaryRoot(context);
  const options = pluginOptions(root);
  const location = openCodePluginLocation(options);
  const ownedBackup = join(root, "owned-plugin-backup");
  const foreign = "export const ForeignPlugin = true;\n";
  await reconcileOpenCodePlugin({ ...options, desired: true });
  let raced = false;
  await assert.rejects(
    reconcileOpenCodePlugin({
      ...options,
      desired: false,
      rename: async (source, target) => {
        if (!raced && source === location.path) {
          raced = true;
          await rename(source, ownedBackup);
          await writeFile(source, foreign, { mode: 0o600 });
        }
        return rename(source, target);
      },
    }),
    /changed during removal/,
  );
  assert.equal(await readFile(location.path, "utf8"), foreign);
  assert.match(await readFile(ownedBackup, "utf8"), /viberacing-opencode-plugin/);
  assert.equal(
    (await readdir(location.directory)).some((name) => name.includes(".quarantine-")),
    false,
  );
});

test("identity-bound removal preserves a directory raced into the target path", async (context) => {
  const root = await temporaryRoot(context);
  const options = pluginOptions(root);
  const location = openCodePluginLocation(options);
  const ownedBackup = join(root, "owned-plugin-directory-race-backup");
  await reconcileOpenCodePlugin({ ...options, desired: true });
  let raced = false;
  let caught;
  try {
    await reconcileOpenCodePlugin({
      ...options,
      desired: false,
      rename: async (source, target) => {
        if (!raced && source === location.path) {
          raced = true;
          await rename(source, ownedBackup);
          await mkdir(source);
        }
        return rename(source, target);
      },
    });
  } catch (error) {
    caught = error;
  }
  assert.match(caught?.message ?? "", /changed during removal.*preserved at/);
  assert.equal((await stat(caught.recoveryPath)).isDirectory(), true);
  await assert.rejects(stat(location.path), { code: "ENOENT" });
  assert.match(await readFile(ownedBackup, "utf8"), /viberacing-opencode-plugin/);
});

test("removal reports and retries the exact quarantine path after unlink fails", async (context) => {
  const root = await temporaryRoot(context);
  const options = pluginOptions(root);
  const location = openCodePluginLocation(options);
  await reconcileOpenCodePlugin({ ...options, desired: true });
  let caught;
  try {
    await reconcileOpenCodePlugin({
      ...options,
      desired: false,
      unlink: async (target) => {
        if (target.includes(".quarantine-")) throw new Error("synthetic quarantine unlink failure");
        return unlink(target);
      },
    });
  } catch (error) {
    caught = error;
  }
  assert.match(caught?.message ?? "", /synthetic quarantine unlink failure.*preserved at/);
  assert.equal(caught.pluginPath, location.path);
  assert.match(caught.recoveryPath, /\.quarantine-[0-9a-f-]{36}$/);
  await assert.rejects(readFile(location.path, "utf8"), { code: "ENOENT" });
  assert.match(await readFile(caught.recoveryPath, "utf8"), /viberacing-opencode-plugin/);
  await assert.rejects(
    inspectOpenCodePlugin({ ...options, pluginPath: caught.recoveryPath }),
    /does not match the installation id/,
  );

  const retried = await reconcileOpenCodePlugin({
    ...options,
    pluginPath: caught.recoveryPath,
    allowRecoveryPath: true,
    desired: false,
  });
  assert.deepEqual(retried, {
    status: "missing",
    action: "removed",
    changed: true,
    path: caught.recoveryPath,
  });
  await assert.rejects(readFile(caught.recoveryPath, "utf8"), { code: "ENOENT" });
  assert.deepEqual(await readdir(location.directory), []);
});

test("owned update reports the prior quarantine path when its unlink fails", async (context) => {
  const root = await temporaryRoot(context);
  const options = pluginOptions(root);
  const location = openCodePluginLocation(options);
  await reconcileOpenCodePlugin({ ...options, desired: true });
  const updatedOptions = {
    ...options,
    nodeExecutable: process.platform === "win32" ? "C:\\different\\node.exe" : "/different/node",
  };
  let caught;
  try {
    await reconcileOpenCodePlugin({
      ...updatedOptions,
      desired: true,
      unlink: async (target) => {
        if (target.includes(".quarantine-")) throw new Error("synthetic prior unlink failure");
        return unlink(target);
      },
    });
  } catch (error) {
    caught = error;
  }
  assert.equal(caught.pluginPath, location.path);
  assert.match(caught.recoveryPath, /\.quarantine-[0-9a-f-]{36}$/);
  assert.match(await readFile(caught.recoveryPath, "utf8"), /viberacing-opencode-plugin/);
  assert.equal((await inspectOpenCodePlugin(updatedOptions)).status, "current");
});

test("post-removal inspection blocks when a foreign target appears during quarantine unlink", async (context) => {
  const root = await temporaryRoot(context);
  const options = pluginOptions(root);
  const location = openCodePluginLocation(options);
  const foreign = "export const ForeignPlugin = true;\n";
  await reconcileOpenCodePlugin({ ...options, desired: true });
  let raced = false;
  const result = await reconcileOpenCodePlugin({
    ...options,
    desired: false,
    unlink: async (target) => {
      if (!raced && target.includes(".quarantine-")) {
        raced = true;
        await writeFile(location.path, foreign, { mode: 0o600 });
      }
      return unlink(target);
    },
  });
  assert.deepEqual(result, {
    status: "conflict",
    action: "blocked",
    changed: true,
    path: location.path,
  });
  assert.equal(await readFile(location.path, "utf8"), foreign);
});

test("an explicit recorded plugin path survives XDG environment changes", async (context) => {
  const root = await temporaryRoot(context);
  const installed = pluginOptions(root, join(root, "config-a"));
  const laterEnvironment = { ...installed.environment, XDG_CONFIG_HOME: "relative/config-b" };
  const originalPath = openCodePluginLocation(installed).path;
  await reconcileOpenCodePlugin({ ...installed, desired: true });
  const removed = await reconcileOpenCodePlugin({
    ...installed,
    environment: laterEnvironment,
    pluginPath: originalPath,
    desired: false,
  });
  assert.equal(removed.action, "removed");
  assert.equal(
    (
      await inspectOpenCodePlugin({
        ...installed,
        environment: laterEnvironment,
        pluginPath: originalPath,
      })
    ).status,
    "missing",
  );
  await assert.rejects(readFile(originalPath, "utf8"), { code: "ENOENT" });
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

test("inspection remains handle-bounded when the plugin grows after open", async (context) => {
  const root = await temporaryRoot(context);
  const options = pluginOptions(root);
  const location = openCodePluginLocation(options);
  const contents = generateOpenCodePlugin(options);
  await mkdir(location.directory, { recursive: true });
  await writeFile(location.path, contents, { mode: 0o600 });
  const real = await stat(location.path);
  let statCalls = 0;
  let requestedBytes = 0;
  const handle = {
    async stat() {
      statCalls += 1;
      if (statCalls === 1) return real;
      return {
        ...real,
        size: maximumOpenCodePluginBytes + 1,
        mtimeMs: real.mtimeMs + 1,
        isFile: () => true,
        isSymbolicLink: () => false,
      };
    },
    async read(buffer, offset, length, position) {
      requestedBytes += length;
      const bytes = Buffer.from(contents);
      bytes.copy(buffer, offset, position, position + length);
      return { bytesRead: length };
    },
    async close() {},
  };
  const inspected = await inspectOpenCodePlugin({
    ...options,
    open: async () => handle,
  });
  assert.equal(inspected.status, "unreadable");
  assert.equal(requestedBytes, real.size);
  assert.ok(requestedBytes <= maximumOpenCodePluginBytes);
});

test("interrupted atomic publish removes its private stage", async (context) => {
  const root = await temporaryRoot(context);
  const options = pluginOptions(root);
  const location = openCodePluginLocation(options);
  await assert.rejects(
    reconcileOpenCodePlugin({
      ...options,
      desired: true,
      link: async () => {
        throw new Error("synthetic interrupted publish");
      },
    }),
    /synthetic interrupted publish/,
  );
  assert.deepEqual(await readdir(location.directory), []);
  await assert.rejects(readFile(location.path), { code: "ENOENT" });
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
    open: async () => ({
      stat: async () => fakeStats,
      read: async () => assert.fail("unsafe Windows plugin must not be read"),
      close: async () => {},
    }),
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

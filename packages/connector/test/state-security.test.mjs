import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import {
  access,
  chmod,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const connectorPath = fileURLToPath(new URL("../bin/viberacing.mjs", import.meta.url));
const configUrl = new URL("../lib/config.mjs", import.meta.url).href;

test(
  "POSIX state security migrates only recognized legacy state and writes its marker",
  { skip: process.platform === "win32" },
  async (context) => {
    const root = await mkdtemp(join(tmpdir(), "viberacing-state-security-"));
    context.after(() => rm(root, { recursive: true, force: true }));
    const state = join(root, ".viberacing");
    const previousState = process.env.VIBERACING_STATE_DIR;
    context.after(() => {
      if (previousState === undefined) delete process.env.VIBERACING_STATE_DIR;
      else process.env.VIBERACING_STATE_DIR = previousState;
    });
    await mkdir(join(state, "pending"), { recursive: true, mode: 0o777 });
    await mkdir(join(state, "runtime", "0.1.0", "bin"), { recursive: true });
    await writeFile(
      join(state, "installation.json"),
      `${JSON.stringify({
        version: 1,
        id: "12345678-1234-4123-8123-123456789abc",
        secret: "legacy_installation_secret_that_is_long_enough",
      })}\n`,
      { mode: 0o777 },
    );
    await writeFile(join(state, "runtime", "0.1.0", "bin", "viberacing.mjs"), "", {
      mode: 0o755,
    });
    await chmod(state, 0o777);
    const legacyEnvironment = { ...process.env, HOME: root };
    delete legacyEnvironment.VIBERACING_STATE_DIR;
    await execFileAsync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import { ensurePrivateStateDirectory } from ${JSON.stringify(configUrl)}; await ensurePrivateStateDirectory();`,
      ],
      { env: legacyEnvironment },
    );
    assert.equal((await lstat(state)).mode & 0o777, 0o700);
    assert.equal((await lstat(join(state, "pending"))).mode & 0o777, 0o700);
    assert.equal((await lstat(join(state, "installation.json"))).mode & 0o777, 0o600);
    assert.equal(
      (await lstat(join(state, "runtime", "0.1.0", "bin", "viberacing.mjs"))).mode & 0o777,
      0o700,
    );
    assert.deepEqual(JSON.parse(await readFile(join(state, ".viberacing-state"), "utf8")), {
      format: 1,
    });
    assert.equal((await lstat(join(state, ".viberacing-state"))).mode & 0o777, 0o600);

    const linkedState = join(root, "linked-state");
    await symlink(state, linkedState);
    process.env.VIBERACING_STATE_DIR = linkedState;
    const linkedConfig = await import(`../lib/config.mjs?state-link=${encodeURIComponent(root)}`);
    await assert.rejects(linkedConfig.ensurePrivateStateDirectory(), /real directory/);

    const unsafeState = join(root, "unsafe-state");
    await mkdir(unsafeState);
    await symlink(join(state, "installation.json"), join(unsafeState, "installation.json"));
    process.env.VIBERACING_STATE_DIR = unsafeState;
    const unsafeConfig = await import(
      `../lib/config.mjs?state-child-link=${encodeURIComponent(root)}`
    );
    await assert.rejects(unsafeConfig.ensurePrivateStateDirectory(), /unsupported entry/);

    const linkedMarkerState = join(root, "linked-marker-state");
    const markerTarget = join(root, "marker-target.json");
    await mkdir(linkedMarkerState, { mode: 0o777 });
    await chmod(linkedMarkerState, 0o777);
    await writeFile(markerTarget, '{"format":1}\n');
    await symlink(markerTarget, join(linkedMarkerState, ".viberacing-state"));
    process.env.VIBERACING_STATE_DIR = linkedMarkerState;
    const linkedMarkerConfig = await import(
      `../lib/config.mjs?state-marker-link=${encodeURIComponent(root)}`
    );
    await assert.rejects(linkedMarkerConfig.ensurePrivateStateDirectory(), /private regular file/);
    assert.equal((await lstat(linkedMarkerState)).mode & 0o777, 0o777);
  },
);

test(
  "POSIX state security rejects unrelated content before changing modes",
  { skip: process.platform === "win32" },
  async (context) => {
    const root = await mkdtemp(join(tmpdir(), "viberacing-unrelated-state-"));
    context.after(() => rm(root, { recursive: true, force: true }));
    const state = join(root, "state");
    const executable = join(state, "unrelated-tool.sh");
    await mkdir(state, { mode: 0o777 });
    await writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await chmod(state, 0o777);
    await chmod(executable, 0o755);
    const previousState = process.env.VIBERACING_STATE_DIR;
    process.env.VIBERACING_STATE_DIR = state;
    context.after(() => {
      if (previousState === undefined) delete process.env.VIBERACING_STATE_DIR;
      else process.env.VIBERACING_STATE_DIR = previousState;
    });

    const config = await import(`../lib/config.mjs?unrelated-state=${encodeURIComponent(root)}`);
    await assert.rejects(config.ensurePrivateStateDirectory(), /unrelated-tool\.sh/);
    assert.equal((await lstat(state)).mode & 0o777, 0o777);
    assert.equal((await lstat(executable)).mode & 0o777, 0o755);
    assert.equal(await readFile(executable, "utf8"), "#!/bin/sh\nexit 0\n");
    await assert.rejects(access(join(state, ".viberacing-state")), { code: "ENOENT" });

    const runtimeState = join(root, "runtime-state");
    const unexpectedRuntime = join(runtimeState, "runtime", "0.1.0", "bin", "unrelated-tool.mjs");
    await mkdir(join(runtimeState, "runtime", "0.1.0", "bin"), { recursive: true });
    await writeFile(
      join(runtimeState, "runtime", "0.1.0", "bin", "viberacing.mjs"),
      "// connector\n",
      { mode: 0o755 },
    );
    await writeFile(unexpectedRuntime, "// unrelated\n", { mode: 0o755 });
    await chmod(runtimeState, 0o777);
    await chmod(unexpectedRuntime, 0o755);
    process.env.VIBERACING_STATE_DIR = runtimeState;
    const runtimeConfig = await import(
      `../lib/config.mjs?unrelated-runtime=${encodeURIComponent(root)}`
    );
    await assert.rejects(runtimeConfig.ensurePrivateStateDirectory(), /unrelated-tool\.mjs/);
    assert.equal((await lstat(runtimeState)).mode & 0o777, 0o777);
    assert.equal((await lstat(unexpectedRuntime)).mode & 0o777, 0o755);
    await assert.rejects(access(join(runtimeState, ".viberacing-state")), { code: "ENOENT" });
  },
);

test(
  "POSIX state security accepts a new custom directory but rejects a nonempty dot directory",
  { skip: process.platform === "win32" },
  async (context) => {
    const root = await mkdtemp(join(tmpdir(), "viberacing-custom-state-"));
    context.after(() => rm(root, { recursive: true, force: true }));
    const previousState = process.env.VIBERACING_STATE_DIR;
    context.after(() => {
      if (previousState === undefined) delete process.env.VIBERACING_STATE_DIR;
      else process.env.VIBERACING_STATE_DIR = previousState;
    });

    const emptyState = join(root, "empty-state");
    await mkdir(emptyState, { mode: 0o777 });
    await chmod(emptyState, 0o777);
    process.env.VIBERACING_STATE_DIR = emptyState;
    const emptyConfig = await import(`../lib/config.mjs?empty-state=${encodeURIComponent(root)}`);
    await emptyConfig.ensurePrivateStateDirectory();
    assert.equal((await lstat(emptyState)).mode & 0o777, 0o700);
    assert.deepEqual(JSON.parse(await readFile(join(emptyState, ".viberacing-state"), "utf8")), {
      format: 1,
    });

    const workingDirectory = join(root, "project");
    const executable = join(workingDirectory, "build.sh");
    await mkdir(workingDirectory, { mode: 0o775 });
    await writeFile(join(workingDirectory, "package.json"), '{"private":true}\n');
    await writeFile(executable, "#!/bin/sh\n", { mode: 0o755 });
    await chmod(workingDirectory, 0o775);
    await chmod(executable, 0o755);
    process.env.VIBERACING_STATE_DIR = workingDirectory;
    const dotConfig = await import(`../lib/config.mjs?dot-state=${encodeURIComponent(root)}`);
    await assert.rejects(dotConfig.ensurePrivateStateDirectory(), /package\.json|build\.sh/);
    assert.equal((await lstat(workingDirectory)).mode & 0o777, 0o775);
    assert.equal((await lstat(executable)).mode & 0o777, 0o755);
    await assert.rejects(access(join(workingDirectory, ".viberacing-state")), { code: "ENOENT" });
  },
);

test("an unmarked custom directory with a foreign config remains completely unchanged", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-foreign-config-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const state = join(root, "other-tool");
  const configPath = join(state, "config.json");
  const original =
    '{"version":2,"origin":"https://example.com","sources":[],"owner":"other-tool"}\n';
  await mkdir(state, { mode: 0o775 });
  await writeFile(configPath, original, { mode: 0o664 });
  if (process.platform !== "win32") {
    await chmod(state, 0o775);
    await chmod(configPath, 0o664);
  }
  const environment = { ...process.env, NODE_ENV: "test", VIBERACING_STATE_DIR: state };
  const previousState = process.env.VIBERACING_STATE_DIR;
  process.env.VIBERACING_STATE_DIR = state;
  let config;
  try {
    config = await import(`../lib/config.mjs?foreign-config=${encodeURIComponent(root)}`);
    await assert.rejects(config.ensurePrivateStateDirectory(), /custom.*marker/i);
  } finally {
    if (previousState === undefined) delete process.env.VIBERACING_STATE_DIR;
    else process.env.VIBERACING_STATE_DIR = previousState;
  }
  for (const arguments_ of [
    ["source", "add", "--agent", "codex", "--name", "Codex", "--data-dir", root],
    ["connect", "--origin", "https://example.com"],
    ["uninstall"],
  ])
    await assert.rejects(
      execFileAsync(process.execPath, [connectorPath, ...arguments_], { env: environment }),
    );
  assert.equal(await readFile(configPath, "utf8"), original);
  await assert.rejects(access(join(state, ".viberacing-state")), { code: "ENOENT" });
  await assert.rejects(access(join(state, "sources.json")), { code: "ENOENT" });
  await assert.rejects(access(join(state, "runtime")), { code: "ENOENT" });
  if (process.platform !== "win32") {
    assert.equal((await lstat(state)).mode & 0o777, 0o775);
    assert.equal((await lstat(configPath)).mode & 0o777, 0o664);
  }
});

test("legacy migration locks the root before accepting a final unchanged tree", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-migration-race-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const state = join(root, ".viberacing");
  const barrier = join(root, "migration");
  await mkdir(state, { mode: 0o777 });
  await writeFile(
    join(state, "installation.json"),
    `${JSON.stringify({
      version: 1,
      id: "87654321-4321-4321-8321-cba987654321",
      secret: "valid_legacy_installation_secret_for_race_test",
    })}\n`,
  );
  if (process.platform !== "win32") await chmod(state, 0o777);
  const environment = {
    ...process.env,
    HOME: root,
    USERPROFILE: root,
    NODE_ENV: "test",
    VIBERACING_TEST_STATE_MIGRATION_PAUSE: "after_preflight",
    VIBERACING_TEST_STATE_MIGRATION_BARRIER: barrier,
  };
  delete environment.VIBERACING_STATE_DIR;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { ensurePrivateStateDirectory } from ${JSON.stringify(configUrl)}; await ensurePrivateStateDirectory();`,
    ],
    { env: environment, stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
  for (let attempts = 0; attempts < 250; attempts += 1) {
    try {
      await access(`${barrier}.ready`);
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      if (attempts === 249) throw new Error("Migration barrier was not reached");
      await delay(20);
    }
  }
  const injectedRuntime = join(state, "runtime", "0.2.1", "bin", "viberacing.mjs");
  await mkdir(join(state, "runtime", "0.2.1", "bin"), { recursive: true });
  await writeFile(injectedRuntime, "throw new Error('must never run');\n");
  await writeFile(`${barrier}.continue`, "continue\n");
  const [code] = await once(child, "close");
  assert.notEqual(code, 0);
  assert.match(stderr, /state changed during migration/);
  await assert.rejects(access(join(state, ".viberacing-state")), { code: "ENOENT" });
  assert.equal(await readFile(injectedRuntime, "utf8"), "throw new Error('must never run');\n");
  if (process.platform !== "win32") assert.equal((await lstat(state)).mode & 0o777, 0o700);
});

test("stored connector origins fail closed before configuration is returned", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-stored-origin-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const state = join(root, "state");
  await mkdir(state, { recursive: true });
  await writeFile(
    join(state, "config.json"),
    `${JSON.stringify({ version: 2, origin: "https://user:secret@example.com", deviceToken: "bearer", sources: [] })}\n`,
  );
  await writeFile(join(state, "sources.json"), '{"version":1,"sources":[]}\n');
  await writeFile(join(state, ".viberacing-state"), '{"format":1}\n');
  const previousState = process.env.VIBERACING_STATE_DIR;
  process.env.VIBERACING_STATE_DIR = state;
  context.after(() => {
    if (previousState === undefined) delete process.env.VIBERACING_STATE_DIR;
    else process.env.VIBERACING_STATE_DIR = previousState;
  });
  const config = await import(`../lib/config.mjs?stored-origin=${encodeURIComponent(root)}`);
  await assert.rejects(config.readConfig(), /Stored connector origin/);
});

import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import {
  openCodePluginLocation,
  reconcileOpenCodePlugin,
} from "../packages/connector/lib/opencode-plugin.mjs";

const execFileAsync = promisify(execFile);
const installationId = "90909090-9090-4090-8090-909090909090";
const compatibilityTarget = process.env.VIBERACING_TEST_OPENCODE_VERSION;
if (compatibilityTarget !== "1.18.23")
  throw new Error("OpenCode compatibility smoke must target 1.18.23");

const root = await mkdtemp(join(tmpdir(), "viberacing-bun-smoke 雪 "));
try {
  const homeDirectory = join(root, "home with spaces 雪");
  const configDirectory = join(root, "config with spaces 雪");
  const stateRoot = join(root, "state with spaces 雪");
  const launcherPath = join(stateRoot, "bin", "viberacing-hook.mjs");
  const tracePath = join(root, "detached trace 雪.json");
  const runnerPath = join(root, "bun runner 雪.mjs");
  await mkdir(join(stateRoot, "bin"), { recursive: true });
  await writeFile(
    launcherPath,
    [
      'import { writeFile } from "node:fs/promises";',
      'import { setTimeout as delay } from "node:timers/promises";',
      "await delay(2000);",
      "const trace = {",
      "  argv: process.argv.slice(2),",
      "  cwd: process.cwd(),",
      "  environment: Object.fromEntries(Object.entries(process.env).sort()),",
      "};",
      "await writeFile(process.env.VIBERACING_TEST_OPENCODE_SMOKE_TRACE, `${JSON.stringify(trace)}\\n`);",
      "",
    ].join("\n"),
  );
  await writeFile(
    runnerPath,
    [
      'import { pathToFileURL } from "node:url";',
      "const module = await import(pathToFileURL(process.argv[2]).href);",
      "const plugin = await module.VibeRacingPlugin();",
      'const result = plugin.event({ event: { type: "session.status", properties: { status: { type: "idle" } } } });',
      'if (result !== undefined) throw new Error("OpenCode event handler returned a Promise");',
      'process.stdout.write("spawned\\n");',
      "",
    ].join("\n"),
  );
  const environment = {
    ...process.env,
    NODE_ENV: "test",
    HOME: homeDirectory,
    USERPROFILE: homeDirectory,
    XDG_CONFIG_HOME: configDirectory,
    VIBERACING_TEST_OPENCODE_SMOKE_TRACE: tracePath,
    VIBERACING_TEST_OPENCODE_VERSION: compatibilityTarget,
    OPENCODE_PRIVATE_EVENT_DATA: "must-not-cross-boundary",
    PROJECT_SECRET: "must-not-cross-boundary",
    NODE_OPTIONS: "--no-warnings",
    PWD: join(root, "private project cwd"),
  };
  const installed = await reconcileOpenCodePlugin({
    installationId,
    stateRoot,
    launcherPath,
    environment,
    homeDirectory,
    desired: true,
  });
  if (installed.status !== "current" || installed.action !== "created")
    throw new Error(`Unexpected plugin install result: ${JSON.stringify(installed)}`);
  const pluginPath = openCodePluginLocation({
    installationId,
    environment,
    homeDirectory,
  }).path;
  const bunExecutable = process.env.VIBERACING_TEST_BUN_EXECUTABLE ?? "bun";
  const parent = await execFileAsync(bunExecutable, [runnerPath, pluginPath], {
    env: environment,
    timeout: 15_000,
    windowsHide: true,
  });
  if (parent.stdout !== "spawned\n" || parent.stderr !== "")
    throw new Error("Bun plugin runner returned unexpected output");
  try {
    await access(tracePath);
    throw new Error("Detached child kept the parent Bun process alive");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const deadline = Date.now() + 15_000;
  let trace;
  while (Date.now() < deadline) {
    try {
      trace = JSON.parse(await readFile(tracePath, "utf8"));
      break;
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      await delay(50);
    }
  }
  if (!trace) throw new Error("Detached OpenCode plugin launcher did not produce its trace");
  const expectedArguments = [
    "hook",
    "--agent",
    "opencode",
    "--all-sources",
    "--installation",
    installationId,
  ];
  if (JSON.stringify(trace.argv) !== JSON.stringify(expectedArguments))
    throw new Error(`Detached launcher argv mismatch: ${JSON.stringify(trace.argv)}`);
  if ((await realpath(trace.cwd)) !== (await realpath(stateRoot)))
    throw new Error("Detached launcher used the wrong cwd");
  if ((await realpath(trace.environment.VIBERACING_STATE_DIR)) !== (await realpath(stateRoot)))
    throw new Error("Detached launcher used the wrong state root");
  if (trace.environment.VIBERACING_TEST_OPENCODE_SMOKE_TRACE !== tracePath)
    throw new Error("Detached launcher lost its allowlisted test trace");
  for (const name of [
    "OPENCODE_PRIVATE_EVENT_DATA",
    "PROJECT_SECRET",
    "NODE_OPTIONS",
    "PWD",
    "OLDPWD",
    "INIT_CWD",
  ])
    if (Object.hasOwn(trace.environment, name))
      throw new Error(`Detached launcher inherited forbidden environment variable ${name}`);
  process.stdout.write(
    `OpenCode ${compatibilityTarget} plugin smoke passed with Bun on ${process.platform}.\n`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

import { randomBytes, randomUUID } from "node:crypto";
import {
  copyFile,
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
  chmod,
  unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const stateDirectory = join(homedir(), ".viberacing");
const configPath = join(stateDirectory, "config.json");
const installationPath = join(stateDirectory, "installation.json");
export const hookMarker = "--viberacing-hook-id=viberacing-hook-v2";

function claudeRoot() {
  return process.env.CLAUDE_CONFIG_DIR
    ? resolve(process.env.CLAUDE_CONFIG_DIR)
    : join(homedir(), ".claude");
}

function codexRoot() {
  return process.env.CODEX_HOME ? resolve(process.env.CODEX_HOME) : join(homedir(), ".codex");
}

function kimiRoot() {
  return process.env.KIMI_CODE_HOME
    ? resolve(process.env.KIMI_CODE_HOME)
    : join(homedir(), ".kimi-code");
}

function qwenRoot() {
  if (process.env.QWEN_HOME) {
    if (process.env.QWEN_HOME === "~") return homedir();
    if (/^~[\\/]/.test(process.env.QWEN_HOME))
      return join(homedir(), process.env.QWEN_HOME.slice(2));
    return resolve(process.env.QWEN_HOME);
  }
  return join(homedir(), ".qwen");
}

function geminiRoot() {
  const home = process.env.GEMINI_CLI_HOME ? resolve(process.env.GEMINI_CLI_HOME) : homedir();
  return join(home, ".gemini");
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

export async function readConfig() {
  const value = JSON.parse(await readFile(configPath, "utf8"));
  if (value?.version !== 2 || typeof value.origin !== "string" || !Array.isArray(value.sources))
    throw new Error("Connector configuration is unsupported; run `viberacing connect` again");
  return value;
}

export async function writeConfig(config) {
  await atomicJson(configPath, config);
}

export async function readOrCreateInstallation() {
  try {
    const value = JSON.parse(await readFile(installationPath, "utf8"));
    if (
      typeof value.id === "string" &&
      typeof value.secret === "string" &&
      value.secret.length >= 32
    )
      return value;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const value = { version: 1, id: randomUUID(), secret: randomBytes(32).toString("base64url") };
  await atomicJson(installationPath, value);
  return value;
}

function ownsHook(handler) {
  return typeof handler?.command === "string" && handler.command.includes(hookMarker);
}

async function jsonHookStatus(path, event, expectedCommand) {
  try {
    const settings = JSON.parse(await readFile(path, "utf8"));
    const groups = settings?.hooks?.[event];
    if (!Array.isArray(groups)) return "missing";
    const owned = groups.flatMap((group) => (Array.isArray(group?.hooks) ? group.hooks : []));
    if (!owned.some(ownsHook)) return "missing";
    return owned.some((handler) => handler?.command === expectedCommand) ? "current" : "outdated";
  } catch (error) {
    return error?.code === "ENOENT" ? "missing" : "invalid-settings";
  }
}

async function updateHook(path, event, hook, remove = false) {
  let settings = {};
  try {
    settings = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT")
      throw new Error(`Cannot read hook settings at ${path}: ${error.message}`, { cause: error });
    if (remove) return false;
  }
  if (settings === null || typeof settings !== "object" || Array.isArray(settings))
    throw new Error(`Hook settings at ${path} must be a JSON object`);
  settings.hooks ??= {};
  if (
    settings.hooks === null ||
    typeof settings.hooks !== "object" ||
    Array.isArray(settings.hooks)
  )
    throw new Error(`The hooks field at ${path} must be a JSON object`);
  const groups = settings.hooks[event] ?? [];
  if (!Array.isArray(groups))
    throw new Error(`The ${event} hooks field at ${path} must be an array`);
  const retained = groups
    .map((group) =>
      Array.isArray(group?.hooks)
        ? { ...group, hooks: group.hooks.filter((handler) => !ownsHook(handler)) }
        : group,
    )
    .filter((group) => !Array.isArray(group?.hooks) || group.hooks.length > 0);
  if (!remove) retained.push(hook);
  settings.hooks[event] = retained;
  await atomicJson(path, settings);
  return true;
}

async function updateKimiHook(command, remove = false) {
  const path = join(kimiRoot(), "config.toml");
  const start = "# viberacing-hook-v2:start";
  const end = "# viberacing-hook-v2:end";
  let contents = "";
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT")
      throw new Error(`Cannot read hook settings at ${path}: ${error.message}`, { cause: error });
  }
  const pattern = new RegExp(
    `(?:^|\\n)${start.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${end.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\n|$)`,
    "g",
  );
  const retained = contents.replace(pattern, "\n").trimEnd();
  const block = remove
    ? ""
    : `${start}\n[[hooks]]\nevent = \"SessionEnd\"\ncommand = ${JSON.stringify(command)}\ntimeout = 3\n${end}`;
  if (!remove || retained !== contents.trimEnd())
    await atomicText(path, [retained, block].filter(Boolean).join("\n\n"));
  return !remove;
}

async function atomicText(path, contents) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${contents}\n`, { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

async function installRuntime(sourceUrl) {
  const sourceScript = fileURLToPath(sourceUrl);
  const sourceRoot = resolve(dirname(sourceScript), "..");
  const installedScript = join(stateDirectory, "bin", "viberacing.mjs");
  const installedLibrary = join(stateDirectory, "lib");
  await mkdir(dirname(installedScript), { recursive: true, mode: 0o700 });
  await mkdir(installedLibrary, { recursive: true, mode: 0o700 });
  if (resolve(sourceScript) !== resolve(installedScript)) {
    await copyFile(sourceScript, installedScript);
    for (const name of ["browser.mjs", "config.mjs", "readers.mjs", "registry.mjs", "runtime.mjs"])
      await copyFile(join(sourceRoot, "lib", name), join(installedLibrary, name));
    await cp(join(sourceRoot, "lib", "adapters"), join(installedLibrary, "adapters"), {
      recursive: true,
      force: true,
    });
  }
  await chmod(installedScript, 0o700);
  return installedScript;
}

export async function installHooks(sourceUrl, sources) {
  const installedScript = await installRuntime(sourceUrl);
  const command = `\"${process.execPath}\" \"${installedScript}\" hook ${hookMarker}`;
  const ids = new Set(sources.map((source) => source.agentId));
  const result = {};
  if (ids.has("codex"))
    result.codex = await updateHook(join(codexRoot(), "hooks.json"), "SessionEnd", {
      hooks: [{ type: "command", command, timeout: 3 }],
    });
  if (ids.has("claude_code"))
    result.claude_code = await updateHook(join(claudeRoot(), "settings.json"), "Stop", {
      hooks: [{ type: "command", command, timeout: 10, async: true }],
    });
  if (ids.has("gemini_cli"))
    result.gemini_cli = await updateHook(join(geminiRoot(), "settings.json"), "SessionEnd", {
      hooks: [{ type: "command", command, timeout: 10 }],
    });
  if (ids.has("qwen_code"))
    result.qwen_code = await updateHook(join(qwenRoot(), "settings.json"), "SessionEnd", {
      hooks: [{ type: "command", command, timeout: 10 }],
    });
  if (ids.has("kimi_code")) result.kimi_code = await updateKimiHook(command);
  return result;
}

export async function diagnoseHooks(sources) {
  const installedScript = join(stateDirectory, "bin", "viberacing.mjs");
  const command = `\"${process.execPath}\" \"${installedScript}\" hook ${hookMarker}`;
  const ids = new Set(sources.map((source) => source.agentId));
  const result = {};
  if (ids.has("codex"))
    result.codex = await jsonHookStatus(join(codexRoot(), "hooks.json"), "SessionEnd", command);
  if (ids.has("claude_code"))
    result.claude_code = await jsonHookStatus(join(claudeRoot(), "settings.json"), "Stop", command);
  if (ids.has("gemini_cli"))
    result.gemini_cli = await jsonHookStatus(
      join(geminiRoot(), "settings.json"),
      "SessionEnd",
      command,
    );
  if (ids.has("qwen_code"))
    result.qwen_code = await jsonHookStatus(
      join(qwenRoot(), "settings.json"),
      "SessionEnd",
      command,
    );
  if (ids.has("kimi_code")) {
    try {
      const contents = await readFile(join(kimiRoot(), "config.toml"), "utf8");
      result.kimi_code = !contents.includes(hookMarker)
        ? "missing"
        : contents.includes(installedScript) && contents.includes(process.execPath)
          ? "current"
          : "outdated";
    } catch (error) {
      result.kimi_code = error?.code === "ENOENT" ? "missing" : "invalid-settings";
    }
  }
  for (const id of ["opencode", "cursor", "antigravity"])
    if (ids.has(id)) result[id] = id === "opencode" ? "manual-sync" : "capture-wrapper";
  return result;
}

export async function removeHooks() {
  await updateHook(join(codexRoot(), "hooks.json"), "SessionEnd", null, true);
  await updateHook(join(claudeRoot(), "settings.json"), "Stop", null, true);
  await updateHook(join(geminiRoot(), "settings.json"), "SessionEnd", null, true);
  await updateHook(join(qwenRoot(), "settings.json"), "SessionEnd", null, true);
  await updateKimiHook("", true);
}

export async function removeConfig() {
  try {
    await unlink(configPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export async function resetInstallation() {
  await removeConfig();
  for (const path of [installationPath, join(stateDirectory, "state.json")])
    try {
      await unlink(path);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  await rm(join(stateDirectory, "pending"), { recursive: true, force: true });
}

export async function removeLocalState() {
  await rm(stateDirectory, { recursive: true, force: true });
}

import { copyFile, mkdir, readFile, rename, writeFile, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const stateDirectory = join(homedir(), ".viberacing");
const configPath = join(stateDirectory, "config.json");

export async function readConfig() {
  return JSON.parse(await readFile(configPath, "utf8"));
}

export async function writeConfig(config) {
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const temporary = `${configPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, configPath);
  await chmod(configPath, 0o600);
}

async function mergeHook(path, event, hook) {
  let settings = {};
  try {
    settings = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      const detail = error instanceof Error ? error.message : "unknown read error";
      throw new Error(`Cannot read hook settings at ${path}: ${detail}`, { cause: error });
    }
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
  settings.hooks[event] ??= [];
  if (!Array.isArray(settings.hooks[event]))
    throw new Error(`The ${event} hooks field at ${path} must be an array`);
  const replacement = hook.hooks[0];
  let replaced = false;
  for (const group of settings.hooks[event]) {
    if (!Array.isArray(group?.hooks)) continue;
    group.hooks = group.hooks.map((handler) => {
      if (typeof handler?.command !== "string" || !handler.command.includes("viberacing.mjs"))
        return handler;
      replaced = true;
      return replacement;
    });
  }
  if (!replaced) settings.hooks[event].push(hook);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  return true;
}

export async function installHooks(sourceUrl, agents) {
  const sourceScript = fileURLToPath(sourceUrl);
  const sourceRoot = resolve(dirname(sourceScript), "..");
  const installedScript = join(stateDirectory, "bin", "viberacing.mjs");
  const installedLibrary = join(stateDirectory, "lib");
  await mkdir(dirname(installedScript), { recursive: true, mode: 0o700 });
  await mkdir(installedLibrary, { recursive: true, mode: 0o700 });
  await copyFile(sourceScript, installedScript);
  await copyFile(join(sourceRoot, "lib", "browser.mjs"), join(installedLibrary, "browser.mjs"));
  await copyFile(join(sourceRoot, "lib", "config.mjs"), join(installedLibrary, "config.mjs"));
  await copyFile(join(sourceRoot, "lib", "readers.mjs"), join(installedLibrary, "readers.mjs"));
  await chmod(installedScript, 0o700);
  const command = `\"${process.execPath}\" \"${installedScript}\" hook`;
  const codex =
    agents.includes("codex") &&
    (await mergeHook(join(homedir(), ".codex", "hooks.json"), "SessionEnd", {
      hooks: [{ type: "command", command, timeout: 3 }],
    }));
  const claude =
    agents.includes("claude_code") &&
    (await mergeHook(join(homedir(), ".claude", "settings.json"), "Stop", {
      hooks: [{ type: "command", command, timeout: 10, async: true }],
    }));
  return { codex, claude };
}

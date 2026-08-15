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
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalPathKey } from "./adapters/shared.mjs";
import { parseQwenJsonc, setQwenJsoncProperty } from "./adapters/qwen-settings.mjs";

export const stateDirectory = process.env.VIBERACING_STATE_DIR
  ? resolve(process.env.VIBERACING_STATE_DIR)
  : join(homedir(), ".viberacing");
const configPath = join(stateDirectory, "config.json");
const installationPath = join(stateDirectory, "installation.json");
const sourcesPath = join(stateDirectory, "sources.json");
export const legacyHookMarker = "--viberacing-hook-id=viberacing-hook-v2";
const captureAgents = new Set(["antigravity"]);
const sourceIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function hookMarkerForSource(clientSourceId) {
  if (!sourceIdPattern.test(clientSourceId)) throw new Error("Invalid hook source id");
  return `--viberacing-hook-id=viberacing-hook-v3:${clientSourceId}`;
}

function claudeRoot() {
  return process.env.CLAUDE_CONFIG_DIR
    ? resolve(process.env.CLAUDE_CONFIG_DIR)
    : join(homedir(), ".claude");
}

function codexRoot() {
  return process.env.CODEX_HOME ? resolve(process.env.CODEX_HOME) : join(homedir(), ".codex");
}

function kimiRoot() {
  if (process.env.KIMI_CODE_HOME) return resolve(process.env.KIMI_CODE_HOME);
  if (process.env.KIMI_SHARE_DIR) return resolve(process.env.KIMI_SHARE_DIR);
  return join(homedir(), ".kimi-code");
}

function qwenRoot() {
  const configured = process.env.QWEN_HOME?.trim();
  if (configured) {
    if (configured === "~") return homedir();
    if (/^~[\\/]/.test(configured)) return join(homedir(), configured.slice(2));
    if (isAbsolute(configured)) return resolve(configured);
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
  const localById = new Map((await readSources()).map((source) => [source.clientSourceId, source]));
  return {
    ...value,
    sources: value.sources
      .map((mapping) => {
        const local = localById.get(mapping.clientSourceId);
        return local ? { ...local, ...mapping } : null;
      })
      .filter(Boolean),
  };
}

export async function writeConfig(config) {
  await atomicJson(configPath, {
    ...config,
    sources: (config.sources ?? []).map((source) => ({
      clientSourceId: source.clientSourceId,
      sourceId: source.sourceId,
      agentAccountId: source.agentAccountId,
      agentId: source.agentId,
      accountLabel: source.accountLabel,
      collectionMethod: source.collectionMethod,
      lastAcceptedSyncSequence: source.lastAcceptedSyncSequence ?? "0",
    })),
  });
}

function validLocalSource(source) {
  return (
    source &&
    typeof source.clientSourceId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      source.clientSourceId,
    ) &&
    typeof source.agentId === "string" &&
    typeof source.collectionMethod === "string" &&
    typeof source.dataPath === "string" &&
    typeof source.suggestedLabel === "string" &&
    source.suggestedLabel.length >= 1 &&
    source.suggestedLabel.length <= 40 &&
    typeof source.supportedSurface === "string" &&
    (source.executablePath === undefined || typeof source.executablePath === "string") &&
    (source.hookConfigRoot === undefined || typeof source.hookConfigRoot === "string")
  );
}

function normalizedLocalSource(source, clientSourceId = source.clientSourceId ?? randomUUID()) {
  const label = source.suggestedLabel?.trim();
  const dataPath =
    typeof source.dataPath === "string"
      ? source.dataPath
      : captureAgents.has(source.agentId)
        ? join(stateDirectory, "captures", `${clientSourceId}.jsonl`)
        : null;
  if (!label || label.length > 40 || dataPath === null) {
    throw new Error("Local source requires a safe label and data directory");
  }
  return {
    clientSourceId,
    agentId: source.agentId,
    collectionMethod: source.collectionMethod,
    dataPath: resolve(dataPath),
    suggestedLabel: label,
    supportedSurface: source.supportedSurface,
    ...(typeof source.executablePath === "string"
      ? { executablePath: resolve(source.executablePath) }
      : {}),
    ...(typeof source.hookConfigRoot === "string"
      ? { hookConfigRoot: resolve(source.hookConfigRoot) }
      : {}),
  };
}

export async function readSources() {
  try {
    const value = JSON.parse(await readFile(sourcesPath, "utf8"));
    if (
      value?.version !== 1 ||
      !Array.isArray(value.sources) ||
      !value.sources.every(validLocalSource)
    )
      throw new Error("Local source configuration is unsupported");
    return value.sources.map((source) => normalizedLocalSource(source, source.clientSourceId));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export async function writeSources(sources) {
  const normalized = sources.map((source) =>
    normalizedLocalSource(source, source.clientSourceId ?? randomUUID()),
  );
  const roots = new Set();
  for (const source of normalized) {
    const key = `${source.agentId}\0${await canonicalPathKey(source.dataPath)}`;
    if (roots.has(key)) throw new Error("That local source is already configured");
    roots.add(key);
  }
  await atomicJson(sourcesPath, { version: 1, sources: normalized });
  return normalized;
}

export async function addSource(source) {
  const sources = await readSources();
  const normalized = normalizedLocalSource(source);
  const root = await canonicalPathKey(normalized.dataPath);
  let duplicate;
  for (const candidate of sources)
    if (
      candidate.agentId === normalized.agentId &&
      (await canonicalPathKey(candidate.dataPath)) === root
    ) {
      duplicate = candidate;
      break;
    }
  if (duplicate) {
    if (
      normalized.hookConfigRoot !== undefined &&
      duplicate.hookConfigRoot !== normalized.hookConfigRoot
    ) {
      duplicate.hookConfigRoot = normalized.hookConfigRoot;
      await writeSources(sources);
    }
    return { source: duplicate, added: false };
  }
  sources.push(normalized);
  await writeSources(sources);
  return { source: normalized, added: true };
}

export async function rememberSourceExecutable(clientSourceId, executablePath) {
  const sources = await readSources();
  const source = sources.find((candidate) => candidate.clientSourceId === clientSourceId);
  if (!source) return false;
  const resolvedPath = resolve(executablePath);
  if (source.executablePath === resolvedPath) return false;
  source.executablePath = resolvedPath;
  await writeSources(sources);
  return true;
}

export async function reconcileDetectedSources(detected, { persist = true } = {}) {
  let sources = await readSources();
  let changed = false;
  for (const candidate of detected) {
    const superseded = new Set();
    for (const path of candidate.supersedesDataPaths ?? [])
      superseded.add(await canonicalPathKey(path));
    if (superseded.size === 0) continue;
    const retained = [];
    for (const source of sources)
      if (
        source.agentId !== candidate.agentId ||
        !superseded.has(await canonicalPathKey(source.dataPath))
      )
        retained.push(source);
    if (retained.length !== sources.length) {
      sources = retained;
      changed = true;
    }
  }
  for (const candidate of detected) {
    const normalized = normalizedLocalSource(candidate);
    const root = await canonicalPathKey(normalized.dataPath);
    let existing;
    for (const source of sources)
      if (
        source.agentId === normalized.agentId &&
        (await canonicalPathKey(source.dataPath)) === root
      ) {
        existing = source;
        break;
      }
    if (!existing) {
      sources.push(normalized);
      changed = true;
    } else {
      for (const key of ["executablePath", "hookConfigRoot"])
        if (normalized[key] !== undefined && existing[key] !== normalized[key]) {
          existing[key] = normalized[key];
          changed = true;
        }
    }
  }
  if (changed && persist) await writeSources(sources);
  return sources;
}

export async function removeSource(clientSourceId) {
  const sources = await readSources();
  const removed = sources.find((source) => source.clientSourceId === clientSourceId);
  if (!removed) return null;
  await writeSources(sources.filter((source) => source.clientSourceId !== clientSourceId));
  return removed;
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

function ownsHook(handler, marker) {
  return typeof handler?.command === "string" && handler.command.includes(marker);
}

function ownsAnyHook(handler) {
  return (
    typeof handler?.command === "string" &&
    (handler.command.includes(legacyHookMarker) ||
      /--viberacing-hook-id=viberacing-hook-v3:[0-9a-f-]{36}/i.test(handler.command))
  );
}

async function jsonHookStatus(path, event, expectedCommand, marker, options = {}) {
  try {
    const contents = await readFile(path, "utf8");
    const settings = options.jsonc ? parseQwenJsonc(contents) : JSON.parse(contents);
    const groups = settings?.hooks?.[event];
    if (!Array.isArray(groups)) return "missing";
    const owned = groups.flatMap((group) => (Array.isArray(group?.hooks) ? group.hooks : []));
    if (!owned.some((handler) => ownsHook(handler, marker))) return "missing";
    return owned.some(
      (handler) => ownsHook(handler, marker) && handler?.command === expectedCommand,
    )
      ? "current"
      : "outdated";
  } catch (error) {
    return error?.code === "ENOENT" ? "missing" : "invalid-settings";
  }
}

async function updateHook(path, event, hook, options = {}) {
  const { remove = false, markers = [], removeAll = false, jsonc = false } = options;
  let settings = {};
  let contents = "{}";
  try {
    contents = await readFile(path, "utf8");
    settings = jsonc ? parseQwenJsonc(contents) : JSON.parse(contents);
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
        ? {
            ...group,
            hooks: group.hooks.filter(
              (handler) =>
                !(removeAll
                  ? ownsAnyHook(handler)
                  : markers.some((marker) => ownsHook(handler, marker))),
            ),
          }
        : group,
    )
    .filter((group) => !Array.isArray(group?.hooks) || group.hooks.length > 0);
  if (!remove) retained.push(hook);
  settings.hooks[event] = retained;
  if (jsonc)
    await atomicText(path, setQwenJsoncProperty(contents, "hooks", settings.hooks).trimEnd());
  else await atomicJson(path, settings);
  return true;
}

function hookBlockMarker(marker) {
  return marker.slice("--viberacing-hook-id=".length);
}

function stripDelimitedBlock(contents, marker) {
  const block = hookBlockMarker(marker).replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return contents.replace(
    new RegExp(`(?:^|\\n)# ${block}:start[\\s\\S]*?# ${block}:end(?:\\n|$)`, "g"),
    "\n",
  );
}

async function updateKimiHook(root, command, marker, options = {}) {
  const { remove = false, removeLegacy = false, removeAll = false } = options;
  const path = join(root, "config.toml");
  const blockMarker = hookBlockMarker(marker);
  const start = `# ${blockMarker}:start`;
  const end = `# ${blockMarker}:end`;
  let contents = "";
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT")
      throw new Error(`Cannot read hook settings at ${path}: ${error.message}`, { cause: error });
  }
  let retained = stripDelimitedBlock(contents, marker);
  if (removeLegacy || removeAll) retained = stripDelimitedBlock(retained, legacyHookMarker);
  if (removeAll)
    retained = retained.replace(
      /(?:^|\n)# viberacing-hook-v3:[0-9a-f-]{36}:start[\s\S]*?# viberacing-hook-v3:[0-9a-f-]{36}:end(?:\n|$)/gi,
      "\n",
    );
  retained = retained.trimEnd();
  const block = remove
    ? ""
    : `${start}\n[[hooks]]\nevent = \"Stop\"\ncommand = ${JSON.stringify(command)}\ntimeout = 3\n${end}`;
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
    for (const name of [
      "browser.mjs",
      "config.mjs",
      "executables.mjs",
      "readers.mjs",
      "registry.mjs",
      "runtime.mjs",
    ])
      await copyFile(join(sourceRoot, "lib", name), join(installedLibrary, name));
    await cp(join(sourceRoot, "lib", "adapters"), join(installedLibrary, "adapters"), {
      recursive: true,
      force: true,
    });
  }
  await chmod(installedScript, 0o700);
  return installedScript;
}

function sourceHookCommand(installedScript, source) {
  const marker = hookMarkerForSource(source.clientSourceId);
  return `\"${process.execPath}\" \"${installedScript}\" hook --source ${source.clientSourceId} --agent ${source.agentId} ${marker}`;
}

export async function installHookForSource(source, installedScript) {
  const marker = hookMarkerForSource(source.clientSourceId);
  const command = sourceHookCommand(installedScript, source);
  const options = { markers: [legacyHookMarker, marker] };
  if (source.agentId === "codex")
    return updateHook(
      join(hookRoot(source, "codex"), "hooks.json"),
      "SessionEnd",
      { hooks: [{ type: "command", command, timeout: 3 }] },
      options,
    );
  if (source.agentId === "claude_code")
    return updateHook(
      join(hookRoot(source, "claude_code"), "settings.json"),
      "Stop",
      { hooks: [{ type: "command", command, timeout: 10, async: true }] },
      options,
    );
  if (source.agentId === "gemini_cli" || source.agentId === "qwen_code")
    return updateHook(
      join(hookRoot(source, source.agentId), "settings.json"),
      "SessionEnd",
      { hooks: [{ type: "command", command, timeout: 10_000 }] },
      source.agentId === "qwen_code" ? { ...options, jsonc: true } : options,
    );
  if (source.agentId === "kimi_code")
    return updateKimiHook(hookRoot(source, "kimi_code"), command, marker, {
      removeLegacy: true,
    });
  return false;
}

export async function installHooks(sourceUrl, sources) {
  const installedScript = await installRuntime(sourceUrl);
  const result = {};
  for (const source of sources)
    result[source.clientSourceId] = await installHookForSource(source, installedScript);
  return result;
}

function hookRoot(source, agentId) {
  if (agentId === "qwen_code")
    return typeof source?.hookConfigRoot === "string" ? resolve(source.hookConfigRoot) : qwenRoot();
  if (typeof source?.dataPath !== "string") {
    if (agentId === "codex") return codexRoot();
    if (agentId === "claude_code") return claudeRoot();
    if (agentId === "gemini_cli") return geminiRoot();
    return kimiRoot();
  }
  const dataPath = resolve(source.dataPath);
  if (agentId === "codex") return dataPath;
  if (
    (agentId === "claude_code" && basename(dataPath) === "projects") ||
    (agentId === "gemini_cli" && basename(dataPath) === "tmp") ||
    (agentId === "kimi_code" && basename(dataPath) === "sessions")
  )
    return dirname(dataPath);
  return dataPath;
}

export async function diagnoseHookForSource(source) {
  const installedScript = join(stateDirectory, "bin", "viberacing.mjs");
  const marker = hookMarkerForSource(source.clientSourceId);
  const command = sourceHookCommand(installedScript, source);
  if (source.agentId === "codex")
    return jsonHookStatus(
      join(hookRoot(source, "codex"), "hooks.json"),
      "SessionEnd",
      command,
      marker,
    );
  if (source.agentId === "claude_code")
    return jsonHookStatus(
      join(hookRoot(source, "claude_code"), "settings.json"),
      "Stop",
      command,
      marker,
    );
  if (source.agentId === "gemini_cli" || source.agentId === "qwen_code")
    return jsonHookStatus(
      join(hookRoot(source, source.agentId), "settings.json"),
      "SessionEnd",
      command,
      marker,
      { jsonc: source.agentId === "qwen_code" },
    );
  if (source.agentId === "kimi_code") {
    try {
      const contents = await readFile(join(hookRoot(source, "kimi_code"), "config.toml"), "utf8");
      if (!contents.includes(`# ${hookBlockMarker(marker)}:start`)) return "missing";
      return contents.includes(`command = ${JSON.stringify(command)}`) &&
        contents.includes('event = "Stop"') &&
        contents.includes("timeout = 3")
        ? "current"
        : "outdated";
    } catch (error) {
      return error?.code === "ENOENT" ? "missing" : "invalid-settings";
    }
  }
  if (source.agentId === "opencode") return "manual-sync";
  if (captureAgents.has(source.agentId)) return "capture-wrapper";
  return undefined;
}

export async function diagnoseHooks(sources) {
  const result = {};
  for (const source of sources) {
    const status = await diagnoseHookForSource(source);
    if (status) result[source.agentId] = mergeHookStatus(result[source.agentId], status);
  }
  return result;
}

function mergeHookStatus(previous, next) {
  if (!previous || previous === next) return next;
  const priority = ["invalid-settings", "outdated", "missing", "current"];
  return priority.indexOf(previous) <= priority.indexOf(next) ? previous : next;
}

export async function removeHookForSource(source, options = {}) {
  const marker = hookMarkerForSource(source.clientSourceId);
  const markers = options.removeLegacy ? [marker, legacyHookMarker] : [marker];
  const hookOptions = { remove: true, markers, removeAll: options.removeAll === true };
  const root = hookRoot(source, source.agentId);
  if (source.agentId === "codex")
    return updateHook(join(root, "hooks.json"), "SessionEnd", null, hookOptions);
  if (source.agentId === "claude_code")
    return updateHook(join(root, "settings.json"), "Stop", null, hookOptions);
  if (source.agentId === "gemini_cli" || source.agentId === "qwen_code")
    return updateHook(
      join(root, "settings.json"),
      "SessionEnd",
      null,
      source.agentId === "qwen_code" ? { ...hookOptions, jsonc: true } : hookOptions,
    );
  if (source.agentId === "kimi_code")
    return updateKimiHook(root, "", marker, {
      remove: true,
      removeLegacy: options.removeLegacy,
      removeAll: options.removeAll,
    });
  return false;
}

export async function reconcileHooks(sourceUrl, activeSources, knownLocalSources = []) {
  const failures = [];
  let installedScript;
  try {
    installedScript = await installRuntime(sourceUrl);
  } catch (error) {
    failures.push({
      agentId: null,
      clientSourceId: null,
      path: stateDirectory,
      message: error instanceof Error ? error.message : "Connector runtime installation failed",
    });
  }
  const activeIds = new Set(activeSources.map((source) => source.clientSourceId));
  for (const source of knownLocalSources)
    if (!activeIds.has(source.clientSourceId))
      try {
        await removeHookForSource(source, { removeLegacy: true });
      } catch (error) {
        failures.push({
          agentId: source.agentId,
          clientSourceId: source.clientSourceId,
          path: hookRoot(source, source.agentId),
          message: error instanceof Error ? error.message : "Hook cleanup failed",
        });
      }
  const result = {};
  if (installedScript)
    for (const source of activeSources)
      try {
        result[source.clientSourceId] = await installHookForSource(source, installedScript);
      } catch (error) {
        failures.push({
          agentId: source.agentId,
          clientSourceId: source.clientSourceId,
          path: hookRoot(source, source.agentId),
          message: error instanceof Error ? error.message : "Hook installation failed",
        });
      }
  return { hooks: result, failures };
}

export async function removeHooks() {
  let sources = [];
  const failures = [];
  const cleaned = [];
  try {
    sources = await readSources();
  } catch (error) {
    failures.push({
      agentId: null,
      clientSourceId: null,
      path: sourcesPath,
      message: error instanceof Error ? error.message : "Unable to read local sources",
    });
  }
  const candidates = [
    ...sources,
    { agentId: "codex" },
    { agentId: "claude_code" },
    { agentId: "gemini_cli" },
    { agentId: "qwen_code" },
    { agentId: "kimi_code" },
  ];
  const visited = new Set();
  for (const source of candidates) {
    const root = hookRoot(source, source.agentId);
    const key = `${source.agentId}\0${root}`;
    if (visited.has(key)) continue;
    visited.add(key);
    try {
      if (source.clientSourceId)
        await removeHookForSource(source, { removeLegacy: true, removeAll: true });
      else if (source.agentId === "codex")
        await updateHook(join(root, "hooks.json"), "SessionEnd", null, {
          remove: true,
          removeAll: true,
        });
      else if (source.agentId === "claude_code")
        await updateHook(join(root, "settings.json"), "Stop", null, {
          remove: true,
          removeAll: true,
        });
      else if (source.agentId === "gemini_cli" || source.agentId === "qwen_code")
        await updateHook(join(root, "settings.json"), "SessionEnd", null, {
          remove: true,
          removeAll: true,
          jsonc: source.agentId === "qwen_code",
        });
      else if (source.agentId === "kimi_code")
        await updateKimiHook(root, "", legacyHookMarker, { remove: true, removeAll: true });
      cleaned.push({
        agentId: source.agentId,
        clientSourceId: source.clientSourceId ?? null,
        path: root,
      });
    } catch (error) {
      failures.push({
        agentId: source.agentId,
        clientSourceId: source.clientSourceId ?? null,
        path: root,
        message: error instanceof Error ? error.message : "Hook cleanup failed",
      });
    }
  }
  return { cleaned, failures };
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

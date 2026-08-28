import { randomBytes, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
  open,
  unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { canonicalPathKey } from "./adapters/shared.mjs";
import { inspectCodexHookTrust } from "./adapters/codex.mjs";
import { parseQwenJsonc, setQwenJsoncProperty } from "./adapters/qwen-settings.mjs";
import { quoteWindowsCommandArgument } from "./executables.mjs";
import { acquireOwnedLock, releaseOwnedLock } from "./owned-lock.mjs";
import { normalizeOrigin } from "./origin.mjs";
import { mergeStoredSourceMapping } from "./protocol.mjs";
import { hasTerminalControlCharacters } from "./terminal.mjs";
import { connectorVersion } from "./version.mjs";
import { ensurePrivateStateDirectory as secureWindowsStateDirectory } from "./windows-security.mjs";

const defaultStateDirectory = join(homedir(), ".viberacing");
export const stateDirectory = process.env.VIBERACING_STATE_DIR
  ? resolve(process.env.VIBERACING_STATE_DIR)
  : defaultStateDirectory;
const configPath = join(stateDirectory, "config.json");
const installationPath = join(stateDirectory, "installation.json");
const openCodePluginCleanupPath = join(stateDirectory, "opencode-plugin-cleanup.json");
const providerIdentityPath = join(stateDirectory, "provider-identity.json");
const sourcesPath = join(stateDirectory, "sources.json");
const connectionCommitPath = join(stateDirectory, "connection-commit.json");
const connectAttemptPath = join(stateDirectory, "connect-attempt.json");
const browserHandlerPath = join(stateDirectory, "browser-handler.json");
const connectionStateLockPath = join(stateDirectory, "connection-state.lock");
const stateMarkerPath = join(stateDirectory, ".viberacing-state");
const stateMigrationLockPath = join(stateDirectory, ".viberacing-state.lock");
export const legacyHookMarker = "--viberacing-hook-id=viberacing-hook-v2";
const captureAgents = new Set(["antigravity"]);
let stateDirectorySecurity;

const stateFiles = new Set([
  "config.json",
  "installation.json",
  "opencode-plugin-cleanup.json",
  "provider-identity.json",
  "sources.json",
  "connection-commit.json",
  "connect-attempt.json",
  "state.json",
  "dirty.json",
  "browser-handler.json",
]);
const stateDirectories = new Set(["pending", "captures", "runtime", "logs", "bin", "lib"]);
const legacyRuntimeFiles = new Set([
  "browser.mjs",
  "config.mjs",
  "diagnostics.mjs",
  "executables.mjs",
  "opencode-plugin.mjs",
  "opencode-cutover-preflight.mjs",
  "readers.mjs",
  "registry.mjs",
  "runtime.mjs",
]);
const legacyRuntimeAdapterFiles = new Set([
  "antigravity.mjs",
  "claude.mjs",
  "codex.mjs",
  "cursor.mjs",
  "gemini.mjs",
  "kimi.mjs",
  "opencode.mjs",
  "qwen-settings.mjs",
  "qwen.mjs",
  "shared.mjs",
]);
const ownedLockPattern =
  /^(?:\.viberacing-state|connection-state|sync|dirty|scheduler|scheduler-launch|lifecycle|lifecycle-revoking)\.lock(?:\.recovery(?:\.stale\.[0-9a-f-]{36})?|\.stale\.[0-9a-f-]{36})?$/i;
const stateTemporaryPattern =
  /^(?:config|installation|opencode-plugin-cleanup|provider-identity|sources|connection-commit|connect-attempt|state|dirty)\.json\.\d+(?:\.[0-9a-f-]{36})?\.tmp$/i;
const markerTemporaryPattern = /^\.viberacing-state\.\d+\.[0-9a-f-]{36}\.tmp$/i;
const hookLauncherTemporaryPattern = /^viberacing-hook\.mjs\.\d+\.tmp$/i;
const sourceIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const runtimeVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const providerAccountKeyPattern = /^acct1_[A-Za-z0-9_-]{43}$/;
const sourcesSchemaVersion = 2;
const maximumLocalSources = 32;
const maximumOpenCodePluginCleanupTargets = 32;
const maximumCodexAccountsPerProfile = 8;
const legacyCollectionMethods = new Set([
  "antigravity\0antigravity_cli_capture",
  "claude_code\0claude_jsonl",
  "codex\0codex_app_server",
  "gemini_cli\0gemini_session_json",
  "kimi_code\0kimi_wire_jsonl",
  "kimi_code\0kimi_legacy_wire_jsonl",
  "opencode\0opencode_sqlite",
  "qwen_code\0qwen_stats_jsonl",
]);

function isStateMigrationArtifact(relativePath) {
  return (
    /^\.viberacing-state\.lock(?:\.recovery(?:\.stale\.[0-9a-f-]{36})?|\.stale\.[0-9a-f-]{36})?$/i.test(
      relativePath,
    ) || markerTemporaryPattern.test(relativePath)
  );
}

function isInstalledRuntimeExecutable(path) {
  const parts = relative(stateDirectory, path).split(/[\\/]/);
  return (
    (parts.length === 4 &&
      parts[0] === "runtime" &&
      parts[1] !== "" &&
      parts[1] !== "." &&
      parts[1] !== ".." &&
      parts[2] === "bin" &&
      parts[3] === "viberacing.mjs") ||
    (parts.length === 2 && parts[0] === "bin" && parts[1] === "viberacing.mjs")
  );
}

function ownedStatePath(path, info) {
  const parts = relative(stateDirectory, path).split(/[\\/]/);
  const [top] = parts;
  if (parts.length === 1) {
    if (top === ".viberacing-state") return info.isFile();
    if (stateFiles.has(top)) return info.isFile();
    if (stateDirectories.has(top)) return info.isDirectory();
    return (
      (ownedLockPattern.test(top) ||
        stateTemporaryPattern.test(top) ||
        markerTemporaryPattern.test(top)) &&
      info.isFile()
    );
  }
  if (top === "pending") {
    if (parts.length === 2 && parts[1] === "quarantine") return info.isDirectory();
    const pendingName = parts.at(-1);
    const pendingBase = pendingName.replace(/\.\d+\.[0-9a-f-]{36}\.tmp$/i, "");
    if (parts.length === 2)
      return /^(?:[0-9a-f-]{36})(?:\.error)?\.json$/i.test(pendingBase) && info.isFile();
    if (parts.length === 3 && parts[1] === "quarantine")
      return /^(?:[0-9a-f-]{36})\.json$/i.test(pendingBase) && info.isFile();
    return false;
  }
  if (top === "captures" && parts.length === 2) {
    const captureName = parts[1];
    const base = captureName
      .replace(/\.\d+\.[0-9a-f-]{36}\.tmp$/i, "")
      .replace(/\.lock(?:\.recovery(?:\.stale\.[0-9a-f-]{36})?|\.stale\.[0-9a-f-]{36})?$/i, "");
    return (
      sourceIdPattern.test(base.replace(/\.jsonl$/i, "")) && /\.jsonl$/i.test(base) && info.isFile()
    );
  }
  if (top === "runtime") {
    const version = parts[1];
    const stagingPattern = /^\.\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.\d+\.[0-9a-f-]{36}\.tmp$/i;
    if (!runtimeVersionPattern.test(version) && !stagingPattern.test(version)) return false;
    if (parts.length === 2) return info.isDirectory();
    if (parts.length === 3) return (parts[2] === "bin" || parts[2] === "lib") && info.isDirectory();
    if (parts.length === 4 && parts[2] === "bin")
      return parts[3] === "viberacing.mjs" && info.isFile();
    if (parts.length === 4 && parts[2] === "lib")
      return parts[3] === "adapters"
        ? info.isDirectory()
        : installedRuntimeFiles.includes(parts[3]) && info.isFile();
    if (parts.length === 5 && parts[2] === "lib" && parts[3] === "adapters")
      return installedRuntimeAdapterFiles.has(parts[4]) && info.isFile();
    return false;
  }
  if (top === "lib") {
    if (parts.length === 2)
      return parts[1] === "adapters"
        ? info.isDirectory()
        : legacyRuntimeFiles.has(parts[1]) && info.isFile();
    return (
      parts.length === 3 &&
      parts[1] === "adapters" &&
      legacyRuntimeAdapterFiles.has(parts[2]) &&
      info.isFile()
    );
  }
  if (top === "bin")
    return (
      parts.length === 2 &&
      (parts[1] === "viberacing.mjs" ||
        parts[1] === "viberacing-hook.mjs" ||
        hookLauncherTemporaryPattern.test(parts[1])) &&
      info.isFile()
    );
  return top === "logs" && parts.length === 2 && parts[1] === "last-error.log" && info.isFile();
}

function ownedTopLevelName(name) {
  return (
    name === ".viberacing-state" ||
    stateFiles.has(name) ||
    stateDirectories.has(name) ||
    ownedLockPattern.test(name) ||
    stateTemporaryPattern.test(name) ||
    markerTemporaryPattern.test(name)
  );
}

async function inspectOwnedStateTree(path, paths = [stateDirectory]) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    const info = await lstat(child);
    if (
      info.isSymbolicLink() ||
      (!info.isDirectory() && !info.isFile()) ||
      (info.isFile() && info.nlink !== 1)
    )
      throw new Error(
        `Vibe Racing state contains an unsupported entry: ${relative(stateDirectory, child)}`,
      );
    if (!ownedStatePath(child, info))
      throw new Error(
        `Vibe Racing state contains an unrelated entry: ${relative(stateDirectory, child)}`,
      );
    if (
      typeof process.getuid === "function" &&
      typeof info.uid === "number" &&
      info.uid !== process.getuid()
    )
      throw new Error(
        `Vibe Racing state contains an entry owned by another user: ${relative(stateDirectory, child)}`,
      );
    paths.push(child);
    if (info.isDirectory()) await inspectOwnedStateTree(child, paths);
  }
  return paths;
}

async function validLegacyStateEvidence() {
  try {
    const installation = JSON.parse(await readFile(installationPath, "utf8"));
    if (
      installation?.version === 1 &&
      sourceIdPattern.test(installation.id) &&
      typeof installation.secret === "string" &&
      /^[A-Za-z0-9_-]{32,128}$/.test(installation.secret)
    )
      return true;
  } catch {}
  try {
    const sources = JSON.parse(await readFile(sourcesPath, "utf8"));
    if (
      sources?.version === 1 &&
      Array.isArray(sources.sources) &&
      sources.sources.length > 0 &&
      sources.sources.every(
        (source) =>
          validLocalSource(source) &&
          legacyCollectionMethods.has(`${source.agentId}\0${source.collectionMethod}`),
      )
    )
      return true;
  } catch {}
  return false;
}

function migrationSnapshot(paths) {
  return paths
    .slice(1)
    .map((path) => relative(stateDirectory, path))
    .filter((path) => !isStateMigrationArtifact(path))
    .sort();
}

function substantiveStatePaths(paths) {
  return paths.filter(
    (path) => path === stateDirectory || !isStateMigrationArtifact(relative(stateDirectory, path)),
  );
}

async function removeOrphanedStateMigrationArtifacts() {
  for (const entry of await readdir(stateDirectory, { withFileTypes: true })) {
    if (
      !entry.isFile() ||
      entry.name === ".viberacing-state.lock" ||
      !isStateMigrationArtifact(entry.name)
    )
      continue;
    await unlink(join(stateDirectory, entry.name)).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

async function waitForTestStateMigrationBarrier(stage) {
  if (
    process.env.NODE_ENV !== "test" ||
    process.env.VIBERACING_TEST_STATE_MIGRATION_PAUSE !== stage ||
    !process.env.VIBERACING_TEST_STATE_MIGRATION_BARRIER
  )
    return;
  const barrier = resolve(process.env.VIBERACING_TEST_STATE_MIGRATION_BARRIER);
  await writeFile(`${barrier}.ready`, `${process.pid}\n`, { mode: 0o600 });
  const deadline = Date.now() + 5_000;
  for (;;) {
    try {
      await access(`${barrier}.continue`);
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (Date.now() >= deadline) throw new Error("Timed out at state migration test barrier");
    await delay(10);
  }
}

async function stateRoot() {
  let info;
  try {
    info = await lstat(stateDirectory);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
    info = await lstat(stateDirectory);
  }
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Vibe Racing state path must be a real directory");
  if (
    typeof process.getuid === "function" &&
    typeof info.uid === "number" &&
    info.uid !== process.getuid()
  )
    throw new Error("Vibe Racing state path must be owned by the current user");
  return info;
}

async function markedStatePaths() {
  let markerInfo;
  try {
    markerInfo = await lstat(stateMarkerPath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (
    markerInfo.isSymbolicLink() ||
    !markerInfo.isFile() ||
    markerInfo.nlink !== 1 ||
    (typeof process.getuid === "function" &&
      typeof markerInfo.uid === "number" &&
      markerInfo.uid !== process.getuid())
  )
    throw new Error("Vibe Racing state marker is not a private regular file");
  let marker;
  try {
    marker = JSON.parse(await readFile(stateMarkerPath, "utf8"));
  } catch (error) {
    throw new Error("Vibe Racing state marker is invalid", { cause: error });
  }
  if (marker?.format !== 1 || Object.keys(marker).length !== 1)
    throw new Error("Vibe Racing state marker is invalid");
  const paths = [stateDirectory, stateMarkerPath];
  for (const entry of await readdir(stateDirectory, { withFileTypes: true })) {
    if (entry.name === ".viberacing-state") continue;
    const child = join(stateDirectory, entry.name);
    const info = await lstat(child);
    if (!ownedTopLevelName(entry.name)) continue;
    if (
      info.isSymbolicLink() ||
      (info.isFile() && info.nlink !== 1) ||
      !ownedStatePath(child, info)
    )
      throw new Error(`Vibe Racing state contains an unsafe owned entry: ${entry.name}`);
    paths.push(child);
  }
  return paths;
}

async function secureStatePaths(paths) {
  if (process.platform === "win32") return secureWindowsStateDirectory(stateDirectory, { paths });
  for (const path of paths) {
    let handle;
    try {
      handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    } catch (error) {
      if (error?.code === "ENOENT" && path !== stateDirectory) continue;
      if (error?.code === "ELOOP")
        throw new Error(
          `Vibe Racing state contains an unsupported entry: ${relative(stateDirectory, path)}`,
          { cause: error },
        );
      throw error;
    }
    try {
      const info = await handle.stat();
      if ((!info.isDirectory() && !info.isFile()) || (info.isFile() && info.nlink !== 1))
        throw new Error(
          `Vibe Racing state contains an unsupported entry: ${relative(stateDirectory, path)}`,
        );
      if (
        typeof process.getuid === "function" &&
        typeof info.uid === "number" &&
        info.uid !== process.getuid()
      )
        throw new Error(
          `Vibe Racing state contains an entry owned by another user: ${relative(stateDirectory, path)}`,
        );
      await handle.chmod(info.isDirectory() || isInstalledRuntimeExecutable(path) ? 0o700 : 0o600);
      const checked = await handle.stat();
      if ((checked.mode & 0o077) !== 0)
        throw new Error(`Vibe Racing cannot secure state entry: ${relative(stateDirectory, path)}`);
      let current;
      try {
        current = await lstat(path);
      } catch (error) {
        if (error?.code === "ENOENT" && path !== stateDirectory) continue;
        throw error;
      }
      if (current.dev !== checked.dev || current.ino !== checked.ino)
        throw new Error(
          `Vibe Racing state entry changed while securing: ${relative(stateDirectory, path)}`,
        );
    } finally {
      await handle.close();
    }
  }
}

async function writeStateMarker() {
  const temporary = `${stateMarkerPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, '{"format":1}\n', { mode: 0o600 });
    await rename(temporary, stateMarkerPath);
    if (process.platform !== "win32") await chmod(stateMarkerPath, 0o600);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function secureStateDirectory() {
  await stateRoot();
  const marked = await markedStatePaths();
  if (marked) return secureStatePaths(marked);

  const preflightPaths = await inspectOwnedStateTree(stateDirectory);
  const substantivePreflightPaths = substantiveStatePaths(preflightPaths);
  const nonempty = substantivePreflightPaths.length > 1;
  if (nonempty && stateDirectory !== defaultStateDirectory)
    throw new Error("A nonempty custom Vibe Racing state directory requires a valid marker");
  if (nonempty && !(await validLegacyStateEvidence()))
    throw new Error("Unmarked legacy Vibe Racing state has no valid identity or source registry");
  const preflightSnapshot = migrationSnapshot(substantivePreflightPaths);
  await waitForTestStateMigrationBarrier("after_preflight");
  await secureStatePaths([stateDirectory]);
  const migrationLock = await acquireOwnedLock(stateMigrationLockPath, {
    waitMs: process.env.NODE_ENV === "test" ? 5_000 : 60_000,
  });
  if (!migrationLock) throw new Error("Timed out waiting for Vibe Racing state migration");
  try {
    await waitForTestStateMigrationBarrier("after_migration_lock");
    await removeOrphanedStateMigrationArtifacts();
    const alreadyMarked = await markedStatePaths();
    if (alreadyMarked) return secureStatePaths(alreadyMarked);
    const legacyPaths = substantiveStatePaths(await inspectOwnedStateTree(stateDirectory));
    if (JSON.stringify(migrationSnapshot(legacyPaths)) !== JSON.stringify(preflightSnapshot))
      throw new Error("Vibe Racing state changed during migration");
    if (nonempty && !(await validLegacyStateEvidence()))
      throw new Error("Legacy Vibe Racing state changed during migration");
    await secureStatePaths(legacyPaths);
    if (nonempty && !(await validLegacyStateEvidence()))
      throw new Error("Legacy Vibe Racing state changed while being secured");
    await writeStateMarker();
  } finally {
    await releaseOwnedLock(migrationLock);
  }
}

export function ensurePrivateStateDirectory() {
  stateDirectorySecurity ??= secureStateDirectory();
  return stateDirectorySecurity;
}

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

async function atomicJson(path, value, { beforeRename } = {}) {
  await ensurePrivateStateDirectory();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await beforeRename?.(temporary, path);
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function waitForTestConnectionBarrier(stage) {
  if (
    process.env.NODE_ENV !== "test" ||
    process.env.VIBERACING_TEST_CONNECTION_STATE_PAUSE !== stage ||
    !process.env.VIBERACING_TEST_CONNECTION_STATE_BARRIER
  )
    return;
  const barrier = resolve(process.env.VIBERACING_TEST_CONNECTION_STATE_BARRIER);
  const ready = `${barrier}.ready`;
  const continued = `${barrier}.continue`;
  await writeFile(ready, `${process.pid}\n`, { mode: 0o600 });
  const deadline = Date.now() + 5_000;
  for (;;) {
    try {
      await access(continued);
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (Date.now() >= deadline) throw new Error("Timed out at connection-state test barrier");
    await delay(10);
  }
}

function connectionStateLockWaitMs() {
  return process.env.NODE_ENV === "test" ? 5_000 : 60_000;
}

export async function withConnectionStateLock(callback) {
  await ensurePrivateStateDirectory();
  const waitMs = connectionStateLockWaitMs();
  const lock = await acquireOwnedLock(connectionStateLockPath, { waitMs });
  if (!lock) throw new Error("Timed out waiting for connector connection state");
  try {
    return await callback();
  } finally {
    await releaseOwnedLock(lock);
  }
}

export async function withExistingConnectionStateLock(callback) {
  if (!(await connectedStateExists())) return null;
  const waitMs = connectionStateLockWaitMs();
  let lock;
  try {
    lock = await acquireOwnedLock(connectionStateLockPath, { waitMs });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (!lock) throw new Error("Timed out waiting for connector connection state");
  try {
    if (!(await connectedStateExists())) return null;
    return await callback();
  } finally {
    await releaseOwnedLock(lock);
  }
}

function serializedConfig(config) {
  if (config === null || typeof config !== "object" || Array.isArray(config))
    throw new Error("Connector configuration is unsupported; run `viberacing connect` again");
  return {
    ...config,
    origin: normalizeOrigin(config.origin, "Stored connector origin"),
    sources: (config.sources ?? []).map((source) => ({
      clientSourceId: source.clientSourceId,
      sourceId: source.sourceId,
      agentAccountId: source.agentAccountId,
      agentId: source.agentId,
      accountLabel: source.accountLabel,
      collectionMethod: source.collectionMethod,
      lastAcceptedSyncSequence: source.lastAcceptedSyncSequence ?? "0",
      ...(source.profileSourceId === undefined ? {} : { profileSourceId: source.profileSourceId }),
    })),
  };
}

async function normalizedSources(sources) {
  if (!Array.isArray(sources)) throw new Error("Local source configuration is unsupported");
  if (sources.length > maximumLocalSources)
    throw new Error("Local source configuration exceeds the installation limit");
  const normalized = sources.map((source) =>
    normalizedLocalSource(source, source.clientSourceId ?? randomUUID()),
  );
  const byId = new Map(normalized.map((source) => [source.clientSourceId, source]));
  if (byId.size !== normalized.length)
    throw new Error("Local source configuration contains duplicate source identities");
  const primaryRoots = new Set();
  const profileMembers = new Map();
  for (const source of normalized) {
    if (!validLocalSource(source)) throw new Error("Local source configuration is unsupported");
    const root = await canonicalPathKey(source.dataPath);
    if (source.profileClientSourceId === undefined) {
      const key = `${source.agentId}\0${root}`;
      if (primaryRoots.has(key)) throw new Error("That local source is already configured");
      primaryRoots.add(key);
      continue;
    }
    const primary = byId.get(source.profileClientSourceId);
    if (
      source.agentId !== "codex" ||
      primary?.agentId !== "codex" ||
      primary.profileClientSourceId !== undefined ||
      primary.clientSourceId === source.clientSourceId ||
      (await canonicalPathKey(primary.dataPath)) !== root ||
      primary.collectionMethod !== source.collectionMethod ||
      primary.supportedSurface !== source.supportedSurface ||
      primary.executablePath !== source.executablePath ||
      primary.hookConfigRoot !== source.hookConfigRoot ||
      source.providerAccountKey === undefined
    ) {
      throw new Error("Codex logical source configuration is unsupported");
    }
  }
  for (const source of normalized) {
    const primaryId = source.profileClientSourceId ?? source.clientSourceId;
    const members = profileMembers.get(primaryId) ?? [];
    members.push(source);
    profileMembers.set(primaryId, members);
  }
  for (const members of profileMembers.values()) {
    if (members.length > maximumCodexAccountsPerProfile)
      throw new Error("Codex profile exceeds the logical account limit");
    const accountKeys = members
      .map((source) => source.providerAccountKey)
      .filter((value) => value !== undefined);
    if (new Set(accountKeys).size !== accountKeys.length)
      throw new Error("Codex profile contains a duplicate provider account key");
  }
  return normalized;
}

function validateCommittedConfig(config, sources) {
  if (config?.version !== 2 || !Array.isArray(config.sources))
    throw new Error("Interrupted connector connection state is invalid");
  config.origin = normalizeOrigin(config.origin, "Stored connector origin");
  const localById = new Map(sources.map((source) => [source.clientSourceId, source]));
  const mappedIds = new Set();
  if (
    config.sources.some((mapping) => {
      const local = localById.get(mapping?.clientSourceId);
      if (!local || mappedIds.has(mapping.clientSourceId)) return true;
      mappedIds.add(mapping.clientSourceId);
      mergeStoredSourceMapping(local, mapping);
      return false;
    })
  )
    throw new Error("Interrupted connector connection state is invalid");
}

function validConnectAttemptOrigin(value) {
  try {
    return normalizeOrigin(value) === value;
  } catch {
    return false;
  }
}

function validConnectAttempt(value) {
  return (
    value?.version === 1 &&
    sourceIdPattern.test(value.attemptId) &&
    sourceIdPattern.test(value.installationId) &&
    sourceIdPattern.test(value.sourceRegistryRevision) &&
    validConnectAttemptOrigin(value.origin) &&
    typeof value.startedAt === "string" &&
    Number.isFinite(Date.parse(value.startedAt)) &&
    (value.pollToken === undefined ||
      (typeof value.pollToken === "string" &&
        value.pollToken.length >= 32 &&
        value.pollToken.length <= 128 &&
        /^[A-Za-z0-9_-]+$/.test(value.pollToken)))
  );
}

function sameConnectAttempt(current, expected) {
  return (
    validConnectAttempt(current) &&
    validConnectAttempt(expected) &&
    current.attemptId === expected.attemptId &&
    current.installationId === expected.installationId &&
    current.sourceRegistryRevision === expected.sourceRegistryRevision &&
    current.origin === expected.origin &&
    current.pollToken === expected.pollToken
  );
}

async function readConnectAttemptUnlocked() {
  try {
    const value = JSON.parse(await readFile(connectAttemptPath, "utf8"));
    if (!validConnectAttempt(value)) throw new Error("Local connection attempt is invalid");
    return value;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function invalidateConnectAttemptUnlocked() {
  let attempt = null;
  try {
    attempt = await readConnectAttemptUnlocked();
  } catch {
    // Destructive lifecycle operations must still remove a corrupt local capability.
  }
  await unlink(connectAttemptPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  return attempt;
}

async function readInstallationUnlocked() {
  try {
    const value = JSON.parse(await readFile(installationPath, "utf8"));
    if (
      value?.version === 1 &&
      sourceIdPattern.test(value.id) &&
      typeof value.secret === "string" &&
      value.secret.length >= 32 &&
      value.secret.length <= 128 &&
      (value.openCodePluginPath === undefined ||
        (typeof value.openCodePluginPath === "string" &&
          value.openCodePluginPath.length <= 4_096 &&
          isAbsolute(value.openCodePluginPath) &&
          basename(value.openCodePluginPath) === `viberacing-${value.id.toLowerCase()}.js` &&
          !hasTerminalControlCharacters(value.openCodePluginPath)))
    )
      return value;
    throw new Error("Local installation identity is invalid");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function normalizedOpenCodePluginCleanupTarget(value, { requirePath = false } = {}) {
  const keys = Object.keys(value ?? {})
    .sort()
    .join("\0");
  const expectedKeys =
    typeof value?.openCodePluginPath === "string"
      ? ["installationId", "openCodePluginPath"].sort().join("\0")
      : ["installationId"].join("\0");
  if (
    keys !== expectedKeys ||
    !sourceIdPattern.test(value.installationId ?? "") ||
    (requirePath && typeof value.openCodePluginPath !== "string") ||
    (value.openCodePluginPath !== undefined &&
      (typeof value.openCodePluginPath !== "string" ||
        value.openCodePluginPath.length > 4_096 ||
        !isAbsolute(value.openCodePluginPath) ||
        !isOpenCodePluginCleanupBasename(
          basename(value.openCodePluginPath),
          value.installationId.toLowerCase(),
        ) ||
        hasTerminalControlCharacters(value.openCodePluginPath)))
  )
    throw new Error("Local OpenCode plugin cleanup metadata is invalid");
  return {
    installationId: value.installationId.toLowerCase(),
    ...(value.openCodePluginPath === undefined
      ? {}
      : { openCodePluginPath: resolve(value.openCodePluginPath) }),
  };
}

function isOpenCodePluginCleanupBasename(name, installationId) {
  const canonical = `viberacing-${installationId}.js`;
  const [base, ...quarantineSuffixes] = name.split(".quarantine-");
  const probeIndex = base.lastIndexOf(".probe-");
  const probeSuffix = probeIndex < 0 ? null : base.slice(probeIndex + ".probe-".length);
  const stageBase = probeIndex < 0 ? base : base.slice(0, probeIndex);
  const stagePrefix = `${canonical}.`;
  const stageSuffix = ".stage";
  const stageIdentity =
    stageBase.startsWith(stagePrefix) && stageBase.endsWith(stageSuffix)
      ? stageBase.slice(stagePrefix.length, -stageSuffix.length)
      : null;
  const separator = stageIdentity?.indexOf(".") ?? -1;
  const stageValid =
    separator > 0 &&
    /^\d+$/.test(stageIdentity.slice(0, separator)) &&
    sourceIdPattern.test(stageIdentity.slice(separator + 1));
  return (
    (base === canonical ||
      (stageValid && (probeSuffix === null || sourceIdPattern.test(probeSuffix)))) &&
    quarantineSuffixes.every((suffix) => sourceIdPattern.test(suffix))
  );
}

function sameOpenCodePluginCleanupTarget(left, right) {
  if (left.installationId !== right.installationId) return false;
  if (left.openCodePluginPath === undefined || right.openCodePluginPath === undefined)
    return left.openCodePluginPath === right.openCodePluginPath;
  return process.platform === "win32"
    ? left.openCodePluginPath.toLowerCase() === right.openCodePluginPath.toLowerCase()
    : left.openCodePluginPath === right.openCodePluginPath;
}

function normalizedOpenCodePluginCleanups(value) {
  let targets;
  if (value?.version === 1) {
    if (
      Object.keys(value).sort().join("\0") !==
      ["installationId", "openCodePluginPath", "version"].sort().join("\0")
    )
      throw new Error("Local OpenCode plugin cleanup metadata is invalid");
    targets = [
      normalizedOpenCodePluginCleanupTarget(
        {
          installationId: value.installationId,
          openCodePluginPath: value.openCodePluginPath,
        },
        { requirePath: true },
      ),
    ];
  } else if (value?.version === 2) {
    if (
      Object.keys(value).sort().join("\0") !== ["targets", "version"].sort().join("\0") ||
      !Array.isArray(value.targets) ||
      value.targets.length === 0 ||
      value.targets.length > maximumOpenCodePluginCleanupTargets
    )
      throw new Error("Local OpenCode plugin cleanup metadata is invalid");
    targets = value.targets.map((target) => normalizedOpenCodePluginCleanupTarget(target));
  } else throw new Error("Local OpenCode plugin cleanup metadata is invalid");
  if (
    targets.some((target, index) =>
      targets.slice(0, index).some((previous) => sameOpenCodePluginCleanupTarget(previous, target)),
    )
  )
    throw new Error("Local OpenCode plugin cleanup metadata is invalid");
  return targets;
}

function serializedOpenCodePluginCleanups(targets) {
  if (targets.length === 1 && targets[0].openCodePluginPath !== undefined)
    return { version: 1, ...targets[0] };
  return { version: 2, targets };
}

async function readOpenCodePluginCleanupsUnlocked() {
  try {
    return normalizedOpenCodePluginCleanups(
      JSON.parse(await readFile(openCodePluginCleanupPath, "utf8")),
    );
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function writeOpenCodePluginCleanupsUnlocked(targets, options = {}) {
  if (targets.length === 0) {
    await unlink(openCodePluginCleanupPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
    return;
  }
  await atomicJson(openCodePluginCleanupPath, serializedOpenCodePluginCleanups(targets), options);
}

async function readProviderIdentitySaltUnlocked() {
  try {
    const value = JSON.parse(await readFile(providerIdentityPath, "utf8"));
    if (
      value?.version === 1 &&
      Object.keys(value).length === 2 &&
      typeof value.salt === "string" &&
      /^[A-Za-z0-9_-]{43}$/.test(value.salt)
    )
      return value.salt;
    throw new Error("Local provider identity salt is invalid");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function assertCurrentConnectAttemptUnlocked(expected) {
  const current = await readConnectAttemptUnlocked();
  const installation = await readInstallationUnlocked();
  if (!sameConnectAttempt(current, expected) || installation?.id !== expected.installationId) {
    const error = new Error("Connection attempt was superseded by a local lifecycle change");
    error.code = "connect_attempt_stale";
    throw error;
  }
  return current;
}

async function recoverConnectionCommitUnlocked() {
  let commit;
  try {
    commit = JSON.parse(await readFile(connectionCommitPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw new Error("Interrupted connector connection state is unreadable", { cause: error });
  }
  await waitForTestConnectionBarrier("recovery_after_read");
  if (
    commit?.version !== 1 ||
    ![1, sourcesSchemaVersion].includes(commit.sources?.version) ||
    !Array.isArray(commit.sources.sources)
  )
    throw new Error("Interrupted connector connection state is invalid");
  const sources = await normalizedSources(commit.sources.sources);
  const config = serializedConfig(commit.config);
  validateCommittedConfig(config, sources);
  if (commit.connectAttempt !== undefined) {
    try {
      await assertCurrentConnectAttemptUnlocked(commit.connectAttempt);
    } catch (error) {
      await unlink(connectionCommitPath).catch(() => {});
      await unlink(configPath).catch(() => {});
      throw error;
    }
  }
  await atomicJson(configPath, config);
  await atomicJson(sourcesPath, { version: sourcesSchemaVersion, sources });
  await unlink(connectionCommitPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  if (commit.connectAttempt !== undefined) await invalidateConnectAttemptUnlocked();
  return true;
}

async function readSourcesUnlocked() {
  try {
    const value = JSON.parse(await readFile(sourcesPath, "utf8"));
    if (![1, sourcesSchemaVersion].includes(value?.version) || !Array.isArray(value.sources))
      throw new Error("Local source configuration is unsupported");
    return normalizedSources(value.sources);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function readConfigUnlocked() {
  const value = JSON.parse(await readFile(configPath, "utf8"));
  if (value?.version !== 2 || !Array.isArray(value.sources))
    throw new Error("Connector configuration is unsupported; run `viberacing connect` again");
  value.origin = normalizeOrigin(value.origin, "Stored connector origin");
  const localById = new Map(
    (await readSourcesUnlocked()).map((source) => [source.clientSourceId, source]),
  );
  return {
    ...value,
    sources: value.sources
      .map((mapping) => {
        const local = localById.get(mapping.clientSourceId);
        return local ? mergeStoredSourceMapping(local, mapping) : null;
      })
      .filter(Boolean),
  };
}

export async function withConnectionConfig(callback, options = {}) {
  return withConnectionStateLock(async () => {
    await options.beforeRecovery?.();
    await recoverConnectionCommitUnlocked();
    return callback(await readConfigUnlocked());
  });
}

export async function readConfig(options = {}) {
  return withConnectionConfig((config) => config, options);
}

export function inspectConfig() {
  return readConfigUnlocked();
}

export async function connectedStateExists() {
  try {
    const [rootInfo, markerInfo, configInfo] = await Promise.all([
      lstat(stateDirectory),
      lstat(stateMarkerPath),
      lstat(configPath),
    ]);
    if (
      !rootInfo.isDirectory() ||
      rootInfo.isSymbolicLink() ||
      !markerInfo.isFile() ||
      markerInfo.isSymbolicLink() ||
      markerInfo.nlink !== 1 ||
      !configInfo.isFile() ||
      configInfo.isSymbolicLink() ||
      configInfo.nlink !== 1
    )
      return false;
    const marker = JSON.parse(await readFile(stateMarkerPath, "utf8"));
    return marker?.format === 1 && Object.keys(marker).length === 1;
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return false;
    throw error;
  }
}

export async function localInstallationStateExists() {
  for (const path of [
    installationPath,
    openCodePluginCleanupPath,
    configPath,
    sourcesPath,
    connectAttemptPath,
    connectionCommitPath,
    browserHandlerPath,
    join(stateDirectory, "bin", "viberacing.mjs"),
  ])
    try {
      await lstat(path);
      return true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

  let runtimeVersions;
  try {
    runtimeVersions = await readdir(join(stateDirectory, "runtime"), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  for (const entry of runtimeVersions) {
    if (!entry.isDirectory() || !runtimeVersionPattern.test(entry.name)) continue;
    try {
      await lstat(join(stateDirectory, "runtime", entry.name, "bin", "viberacing.mjs"));
      return true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return false;
}

export async function localSourceRegistryContains(clientSourceId) {
  try {
    const value = JSON.parse(await readFile(sourcesPath, "utf8"));
    return (
      [1, sourcesSchemaVersion].includes(value?.version) &&
      Array.isArray(value.sources) &&
      value.sources.some((source) => source?.clientSourceId === clientSourceId)
    );
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return false;
    throw error;
  }
}

export async function connectedSourceMappingExists(clientSourceId) {
  try {
    const value = JSON.parse(await readFile(configPath, "utf8"));
    return (
      value?.version === 2 &&
      Array.isArray(value.sources) &&
      value.sources.some((source) => source?.clientSourceId === clientSourceId)
    );
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return false;
    throw error;
  }
}

export async function connectedSourceMappingMatches(clientSourceId, agentId) {
  try {
    const config = await readConfigUnlocked();
    return config.sources.some(
      (source) =>
        source.clientSourceId === clientSourceId &&
        source.agentId === agentId &&
        typeof source.sourceId === "string",
    );
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return false;
    throw error;
  }
}

export async function connectedAgentSourceIdsIfInstallationMatches(installationId, agentId) {
  if (!sourceIdPattern.test(installationId ?? "") || typeof agentId !== "string" || !agentId)
    throw new Error("Invalid connected agent source query");
  if (!(await connectedStateExists())) return [];
  try {
    const [installation, config] = await Promise.all([
      readInstallationUnlocked(),
      readConfigUnlocked(),
    ]);
    if (
      installation?.id !== installationId ||
      config.installationId !== installationId ||
      !(await connectedStateExists())
    )
      return [];
    return config.sources
      .filter((source) => source.agentId === agentId && sourceIdPattern.test(source.sourceId ?? ""))
      .map((source) => source.clientSourceId);
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return [];
    throw error;
  }
}

export async function writeConfig(config, options) {
  return withConnectionStateLock(async () => {
    await recoverConnectionCommitUnlocked();
    await invalidateConnectAttemptUnlocked();
    await atomicJson(configPath, serializedConfig(config), options);
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
    !hasTerminalControlCharacters(source.suggestedLabel) &&
    typeof source.supportedSurface === "string" &&
    (source.executablePath === undefined || typeof source.executablePath === "string") &&
    (source.hookConfigRoot === undefined || typeof source.hookConfigRoot === "string") &&
    (source.profileClientSourceId === undefined ||
      (source.agentId === "codex" && sourceIdPattern.test(source.profileClientSourceId))) &&
    (source.providerAccountKey === undefined ||
      (source.agentId === "codex" && providerAccountKeyPattern.test(source.providerAccountKey)))
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
  if (!label || label.length > 40 || hasTerminalControlCharacters(label) || dataPath === null) {
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
    ...(typeof source.profileClientSourceId === "string"
      ? { profileClientSourceId: source.profileClientSourceId }
      : {}),
    ...(typeof source.providerAccountKey === "string"
      ? { providerAccountKey: source.providerAccountKey }
      : {}),
  };
}

export async function readSources() {
  return withConnectionStateLock(async () => {
    await recoverConnectionCommitUnlocked();
    return readSourcesUnlocked();
  });
}

export function inspectSources() {
  return readSourcesUnlocked();
}

export async function migrateSourcesSchema() {
  return withConnectionStateLock(async () => {
    await recoverConnectionCommitUnlocked();
    let stored;
    try {
      stored = JSON.parse(await readFile(sourcesPath, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
    if (stored?.version === sourcesSchemaVersion) return false;
    if (stored?.version !== 1 || !Array.isArray(stored.sources))
      throw new Error("Local source configuration is unsupported");
    const sources = await normalizedSources(stored.sources);
    await atomicJson(sourcesPath, { version: sourcesSchemaVersion, sources });
    return true;
  });
}

export async function writeSources(sources) {
  return withConnectionStateLock(async () => {
    await recoverConnectionCommitUnlocked();
    return writeSourcesUnlocked(sources);
  });
}

async function writeSourcesUnlocked(sources) {
  const normalized = await normalizedSources(sources);
  await invalidateConnectAttemptUnlocked();
  await atomicJson(sourcesPath, { version: sourcesSchemaVersion, sources: normalized });
  return normalized;
}

export async function beginConnectAttempt({ installationId, origin, expectedSources }) {
  return withConnectionStateLock(async () => {
    await recoverConnectionCommitUnlocked();
    const installation = await readInstallationUnlocked();
    if (installation?.id !== installationId) {
      const error = new Error("Installation identity changed while preparing the connection");
      error.code = "connect_attempt_stale";
      throw error;
    }
    const currentSources = await readSourcesUnlocked();
    const expected = await normalizedSources(expectedSources);
    if (JSON.stringify(currentSources) !== JSON.stringify(expected)) {
      const error = new Error("Local source registry changed while preparing the connection");
      error.code = "connect_attempt_stale";
      throw error;
    }
    const attempt = {
      version: 1,
      attemptId: randomUUID(),
      installationId,
      sourceRegistryRevision: randomUUID(),
      origin: normalizeOrigin(origin),
      startedAt: new Date().toISOString(),
    };
    await atomicJson(connectAttemptPath, attempt);
    return attempt;
  });
}

export async function recordConnectAttemptPairing(attempt, pollToken) {
  return withConnectionStateLock(async () => {
    const current = await assertCurrentConnectAttemptUnlocked(attempt);
    const next = { ...current, pollToken };
    if (!validConnectAttempt(next)) throw new Error("Pairing returned an invalid poll token");
    await atomicJson(connectAttemptPath, next);
    return next;
  });
}

export async function readConnectAttempt() {
  return withConnectionStateLock(() => readConnectAttemptUnlocked());
}

export async function invalidateConnectAttempt() {
  return withConnectionStateLock(() => invalidateConnectAttemptUnlocked());
}

export async function clearConnectAttempt(attempt) {
  try {
    await access(connectAttemptPath);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  return withConnectionStateLock(async () => {
    const current = await readConnectAttemptUnlocked();
    if (!sameConnectAttempt(current, attempt)) return false;
    await unlink(connectAttemptPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
    return true;
  });
}

export async function commitConnectionState(config, sources, options = {}) {
  return withConnectionStateLock(async () => {
    await recoverConnectionCommitUnlocked();
    const connectAttempt =
      options.connectAttempt === undefined
        ? undefined
        : await assertCurrentConnectAttemptUnlocked(options.connectAttempt);
    const normalized = await normalizedSources(sources);
    const storedConfig = serializedConfig(config);
    validateCommittedConfig(storedConfig, normalized);
    await options.beforeCommit?.();
    await atomicJson(connectionCommitPath, {
      version: 1,
      ...(connectAttempt === undefined ? {} : { connectAttempt }),
      config: storedConfig,
      sources: { version: sourcesSchemaVersion, sources: normalized },
    });
    await atomicJson(configPath, storedConfig);
    await options.afterConfigCommit?.();
    await atomicJson(sourcesPath, { version: sourcesSchemaVersion, sources: normalized });
    await unlink(connectionCommitPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
    if (connectAttempt !== undefined) await invalidateConnectAttemptUnlocked();
    return normalized;
  });
}

export async function addSource(source) {
  return withConnectionStateLock(async () => {
    await recoverConnectionCommitUnlocked();
    const sources = await readSourcesUnlocked();
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
        await writeSourcesUnlocked(sources);
      }
      return { source: duplicate, added: false };
    }
    sources.push(normalized);
    await writeSourcesUnlocked(sources);
    return { source: normalized, added: true };
  });
}

export function codexPrimaryClientSourceId(source) {
  return source?.agentId === "codex"
    ? (source.profileClientSourceId ?? source.clientSourceId)
    : source?.clientSourceId;
}

export async function bindCodexProviderAccount(clientSourceId, providerAccountKey) {
  if (!sourceIdPattern.test(clientSourceId) || !providerAccountKeyPattern.test(providerAccountKey))
    throw new Error("Invalid Codex provider account binding");
  return withConnectionStateLock(async () => {
    await recoverConnectionCommitUnlocked();
    const sources = await readSourcesUnlocked();
    const selected = sources.find((source) => source.clientSourceId === clientSourceId);
    if (selected?.agentId !== "codex") throw new Error("Codex profile source is unavailable");
    const primaryId = selected.profileClientSourceId ?? selected.clientSourceId;
    const primary = sources.find((source) => source.clientSourceId === primaryId);
    if (primary?.agentId !== "codex" || primary.profileClientSourceId !== undefined)
      throw new Error("Codex profile source is invalid");
    const members = sources.filter(
      (source) =>
        source.agentId === "codex" &&
        (source.profileClientSourceId ?? source.clientSourceId) === primary.clientSourceId,
    );
    const existing = members.find((source) => source.providerAccountKey === providerAccountKey);
    if (existing) return { source: existing, primary, added: false, boundPrimary: false };
    if (primary.providerAccountKey === undefined) {
      primary.providerAccountKey = providerAccountKey;
      const normalized = await writeSourcesUnlocked(sources);
      return {
        source: normalized.find((source) => source.clientSourceId === primary.clientSourceId),
        primary: normalized.find((source) => source.clientSourceId === primary.clientSourceId),
        added: false,
        boundPrimary: true,
      };
    }
    if (members.length >= maximumCodexAccountsPerProfile) {
      const error = new Error("Codex profile has reached the logical account limit");
      error.diagnosticCode = "provider_account_limit_reached";
      throw error;
    }
    const secondary = normalizedLocalSource(
      {
        ...primary,
        clientSourceId: undefined,
        suggestedLabel: "Codex account",
        profileClientSourceId: primary.clientSourceId,
        providerAccountKey,
      },
      randomUUID(),
    );
    const normalized = await writeSourcesUnlocked([...sources, secondary]);
    return {
      source: normalized.find((source) => source.clientSourceId === secondary.clientSourceId),
      primary: normalized.find((source) => source.clientSourceId === primary.clientSourceId),
      added: true,
      boundPrimary: false,
    };
  });
}

export async function rememberSourceExecutable(clientSourceId, executablePath) {
  return withConnectionStateLock(async () => {
    await recoverConnectionCommitUnlocked();
    const sources = await readSourcesUnlocked();
    const source = sources.find((candidate) => candidate.clientSourceId === clientSourceId);
    if (!source) return false;
    const resolvedPath = resolve(executablePath);
    if (source.executablePath === resolvedPath) return false;
    source.executablePath = resolvedPath;
    await writeSourcesUnlocked(sources);
    return true;
  });
}

export async function reconcileDetectedSources(detected, { persist = true } = {}) {
  return withConnectionStateLock(async () => {
    await recoverConnectionCommitUnlocked();
    let sources = await readSourcesUnlocked();
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
        if (
          typeof candidate.legacyAutoSuggestedLabel === "string" &&
          existing.suggestedLabel === candidate.legacyAutoSuggestedLabel &&
          existing.suggestedLabel !== normalized.suggestedLabel
        ) {
          existing.suggestedLabel = normalized.suggestedLabel;
          changed = true;
        }
        for (const key of ["executablePath", "hookConfigRoot"])
          if (normalized[key] !== undefined && existing[key] !== normalized[key]) {
            existing[key] = normalized[key];
            changed = true;
          }
      }
    }
    if (changed && persist) await writeSourcesUnlocked(sources);
    return sources;
  });
}

export async function removeSource(clientSourceId) {
  return withConnectionStateLock(async () => {
    await recoverConnectionCommitUnlocked();
    const sources = await readSourcesUnlocked();
    const removed = sources.find((source) => source.clientSourceId === clientSourceId);
    if (!removed) return null;
    if (
      removed.agentId === "codex" &&
      removed.profileClientSourceId === undefined &&
      sources.some((source) => source.profileClientSourceId === removed.clientSourceId)
    )
      throw new Error("Remove the logical Codex accounts before removing their physical profile");
    await writeSourcesUnlocked(
      sources.filter((source) => source.clientSourceId !== clientSourceId),
    );
    return removed;
  });
}

export async function readOrCreateInstallation() {
  return withConnectionStateLock(async () => {
    const current = await readInstallationUnlocked();
    if (current !== null) return current;
    const value = { version: 1, id: randomUUID(), secret: randomBytes(32).toString("base64url") };
    await atomicJson(installationPath, value);
    return value;
  });
}

export async function readInstallation() {
  return withConnectionStateLock(async () => {
    const installation = await readInstallationUnlocked();
    if (installation === null) throw new Error("Local installation identity is unavailable");
    return installation;
  });
}

export function readExistingInstallation() {
  return readInstallationUnlocked();
}

export async function readOpenCodePluginCleanup() {
  const targets = await readOpenCodePluginCleanupsUnlocked();
  if (targets.length === 0) return null;
  return targets[0].openCodePluginPath === undefined
    ? { version: 2, targets: [targets[0]] }
    : { version: 1, ...targets[0] };
}

export function readOpenCodePluginCleanups() {
  return readOpenCodePluginCleanupsUnlocked();
}

export async function rememberOpenCodePluginCleanup(installationId, pluginPath, options = {}) {
  const cleanup = normalizedOpenCodePluginCleanupTarget({
    installationId,
    ...(pluginPath === undefined ? {} : { openCodePluginPath: pluginPath }),
  });
  return withConnectionStateLock(async () => {
    const current = await readOpenCodePluginCleanupsUnlocked();
    if (current.some((target) => sameOpenCodePluginCleanupTarget(target, cleanup))) return false;
    const next = [...current, cleanup];
    if (next.length > maximumOpenCodePluginCleanupTargets)
      throw new Error("Local OpenCode plugin cleanup target limit was reached");
    await writeOpenCodePluginCleanupsUnlocked(next, options);
    return true;
  });
}

export async function clearOpenCodePluginCleanup() {
  await withConnectionStateLock(() => writeOpenCodePluginCleanupsUnlocked([]));
}

export async function clearOpenCodePluginCleanupTarget(installationId, pluginPath) {
  const cleanup = normalizedOpenCodePluginCleanupTarget({
    installationId,
    ...(pluginPath === undefined ? {} : { openCodePluginPath: pluginPath }),
  });
  return withConnectionStateLock(async () => {
    const current = await readOpenCodePluginCleanupsUnlocked();
    const next = current.filter((target) => !sameOpenCodePluginCleanupTarget(target, cleanup));
    if (next.length === current.length) return false;
    await writeOpenCodePluginCleanupsUnlocked(next);
    return true;
  });
}

export async function rememberOpenCodePluginPath(installationId, pluginPath, options = {}) {
  if (
    !sourceIdPattern.test(installationId ?? "") ||
    typeof pluginPath !== "string" ||
    pluginPath.length > 4_096 ||
    !isAbsolute(pluginPath) ||
    basename(pluginPath) !== `viberacing-${installationId.toLowerCase()}.js` ||
    hasTerminalControlCharacters(pluginPath)
  )
    throw new Error("Invalid OpenCode plugin path");
  return withConnectionStateLock(async () => {
    const installation = await readInstallationUnlocked();
    if (installation?.id !== installationId)
      throw new Error("Installation identity changed while recording the OpenCode plugin path");
    const normalizedPath = resolve(pluginPath);
    if (installation.openCodePluginPath === normalizedPath) return false;
    await atomicJson(
      installationPath,
      { ...installation, openCodePluginPath: normalizedPath },
      options,
    );
    return true;
  });
}

export async function readOrCreateProviderIdentitySalt() {
  return withConnectionStateLock(async () => {
    const current = await readProviderIdentitySaltUnlocked();
    if (current !== null) return current;
    const salt = randomBytes(32).toString("base64url");
    await atomicJson(providerIdentityPath, { version: 1, salt });
    return salt;
  });
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

function swapUtf16ByteOrder(value) {
  if (value.length % 2 !== 0) throw new Error("Hook settings contain truncated UTF-16 data");
  const swapped = Buffer.allocUnsafe(value.length);
  for (let index = 0; index < value.length; index += 2) {
    swapped[index] = value[index + 1];
    swapped[index + 1] = value[index];
  }
  return swapped;
}

function decodeHookSettings(value) {
  if (value.length >= 2 && value[0] === 0xff && value[1] === 0xfe) {
    const contents = value.subarray(2);
    if (contents.length % 2 !== 0) throw new Error("Hook settings contain truncated UTF-16 data");
    return { contents: contents.toString("utf16le"), encoding: "utf16le" };
  }
  if (value.length >= 2 && value[0] === 0xfe && value[1] === 0xff)
    return {
      contents: swapUtf16ByteOrder(value.subarray(2)).toString("utf16le"),
      encoding: "utf16be",
    };
  if (value.length >= 3 && value[0] === 0xef && value[1] === 0xbb && value[2] === 0xbf)
    return { contents: value.subarray(3).toString("utf8"), encoding: "utf8-bom" };
  return { contents: value.toString("utf8"), encoding: "utf8" };
}

function encodeHookSettings(contents, encoding) {
  if (encoding === "utf16le")
    return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(contents, "utf16le")]);
  if (encoding === "utf16be")
    return Buffer.concat([
      Buffer.from([0xfe, 0xff]),
      swapUtf16ByteOrder(Buffer.from(contents, "utf16le")),
    ]);
  if (encoding === "utf8-bom")
    return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(contents, "utf8")]);
  return Buffer.from(contents, "utf8");
}

async function readHookSettings(path) {
  return decodeHookSettings(await readFile(path));
}

async function jsonHookStatus(path, event, expectedCommand, marker, options = {}) {
  try {
    const { contents } = await readHookSettings(path);
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
  let encoding = "utf8";
  try {
    ({ contents, encoding } = await readHookSettings(path));
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
  if (!remove) {
    const ownedHandlers = groups.flatMap((group) =>
      Array.isArray(group?.hooks)
        ? group.hooks.filter((handler) => markers.some((marker) => ownsHook(handler, marker)))
        : [],
    );
    if (
      ownedHandlers.length === 1 &&
      groups.some((group) => JSON.stringify(group) === JSON.stringify(hook))
    )
      return false;
  }
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
  if (remove && JSON.stringify(retained) === JSON.stringify(groups)) return false;
  if (!remove) retained.push(hook);
  settings.hooks[event] = retained;
  await ensurePrivateStateDirectory();
  if (jsonc)
    await atomicText(path, setQwenJsoncProperty(contents, "hooks", settings.hooks).trimEnd(), {
      encoding,
    });
  else await atomicText(path, JSON.stringify(settings, null, 2), { encoding });
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

async function atomicText(path, contents, { encoding = "utf8" } = {}) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, encodeHookSettings(`${contents}\n`, encoding), { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

const installedRuntimeFiles = [
  "browser-integration.mjs",
  "browser.mjs",
  "connection-lifecycle.mjs",
  "config.mjs",
  "diagnostics.mjs",
  "executables.mjs",
  "owned-lock.mjs",
  "opencode-cleanup.mjs",
  "opencode-plugin.mjs",
  "opencode-cutover-preflight.mjs",
  "origin.mjs",
  "readers.mjs",
  "registry.mjs",
  "runtime.mjs",
  "protocol.mjs",
  "terminal.mjs",
  "version.mjs",
  "windows-security.mjs",
];
const installedRuntimeAdapterFiles = new Set([
  "antigravity.mjs",
  "claude.mjs",
  "codex.mjs",
  "gemini.mjs",
  "kimi.mjs",
  "opencode.mjs",
  "qwen-settings.mjs",
  "qwen.mjs",
  "shared.mjs",
]);

function installedRuntimeScript() {
  return join(stateDirectory, "runtime", connectorVersion, "bin", "viberacing.mjs");
}

function installedHookLauncherScript() {
  return join(stateDirectory, "bin", "viberacing-hook.mjs");
}

function hookLauncherContents(version = connectorVersion) {
  return [
    'import { join, resolve } from "node:path";',
    'import { fileURLToPath, pathToFileURL } from "node:url";',
    "",
    'const stateDirectory = resolve(fileURLToPath(new URL("..", import.meta.url)));',
    "process.env.VIBERACING_STATE_DIR = stateDirectory;",
    `const runtime = join(stateDirectory, "runtime", ${JSON.stringify(version)}, "bin", "viberacing.mjs");`,
    "await import(pathToFileURL(runtime).href);",
  ].join("\n");
}

async function installHookLauncher() {
  const path = installedHookLauncherScript();
  await atomicText(path, hookLauncherContents());
  return path;
}

async function verifyInstalledRuntime(directory) {
  const expectedFiles = [
    join(directory, "bin", "viberacing.mjs"),
    ...installedRuntimeFiles.map((name) => join(directory, "lib", name)),
    ...[...installedRuntimeAdapterFiles].map((name) => join(directory, "lib", "adapters", name)),
  ];
  await Promise.all(
    expectedFiles.map(async (path) => {
      const info = await lstat(path);
      if (!info.isFile() || info.size === 0) throw new Error("Installed runtime is incomplete");
    }),
  );
}

async function installRuntime(sourceUrl, { force = false } = {}) {
  await ensurePrivateStateDirectory();
  const sourceScript = fileURLToPath(sourceUrl);
  const sourceRoot = resolve(dirname(sourceScript), "..");
  const installedScript = installedRuntimeScript();
  const installedDirectory = resolve(dirname(installedScript), "..");
  if (resolve(sourceScript) === resolve(installedScript)) {
    if (force) {
      throw new Error("Runtime repair must be run from the connector package");
    }
    await verifyInstalledRuntime(installedDirectory);
    await installHookLauncher();
    return installedScript;
  }
  if (!force)
    try {
      await verifyInstalledRuntime(installedDirectory);
      await installHookLauncher();
      return installedScript;
    } catch {}

  const runtimesDirectory = dirname(installedDirectory);
  const stagingDirectory = join(
    runtimesDirectory,
    `.${connectorVersion}.${process.pid}.${randomUUID()}.tmp`,
  );
  const stagingScript = join(stagingDirectory, "bin", "viberacing.mjs");
  const stagingLibrary = join(stagingDirectory, "lib");
  const backupDirectory = join(
    runtimesDirectory,
    `.${connectorVersion}.${process.pid}.${randomUUID()}.tmp`,
  );
  let installedMoved = false;
  await mkdir(dirname(stagingScript), { recursive: true, mode: 0o700 });
  await mkdir(stagingLibrary, { recursive: true, mode: 0o700 });
  try {
    for (const name of installedRuntimeFiles) {
      await copyFile(join(sourceRoot, "lib", name), join(stagingLibrary, name));
    }
    await cp(join(sourceRoot, "lib", "adapters"), join(stagingLibrary, "adapters"), {
      recursive: true,
      force: true,
    });
    await copyFile(sourceScript, stagingScript);
    await chmod(stagingScript, 0o700);
    await verifyInstalledRuntime(stagingDirectory);
    if (force)
      try {
        await rename(installedDirectory, backupDirectory);
        installedMoved = true;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    try {
      await rename(stagingDirectory, installedDirectory);
    } catch (error) {
      if (installedMoved) await rename(backupDirectory, installedDirectory);
      throw error;
    }
    if (installedMoved) await rm(backupDirectory, { recursive: true, force: true });
  } catch (error) {
    if (!force)
      try {
        await verifyInstalledRuntime(installedDirectory);
        await installHookLauncher();
        return installedScript;
      } catch {}
    throw error;
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
  await installHookLauncher();
  return installedScript;
}

export function prepareRuntime(sourceUrl, options) {
  return installRuntime(sourceUrl, options);
}

export function hookCommandForPlatform(installedScript, source, platform = process.platform) {
  const marker = hookMarkerForSource(source.clientSourceId);
  const values = [
    process.execPath,
    installedScript,
    "hook",
    "--source",
    source.clientSourceId,
    "--agent",
    source.agentId,
    marker,
  ];
  const command = values.map((value) => quoteHookArgument(value, platform)).join(" ");
  return platform === "win32" ? `"${command}"` : command;
}

function sourceHookCommand(installedScript, source) {
  return hookCommandForPlatform(installedScript, source);
}

export function quoteHookArgument(value, platform = process.platform) {
  if (typeof value !== "string" || /[\0\r\n]/.test(value))
    throw new Error("Hook arguments cannot contain NUL or newlines");
  if (platform === "win32") return quoteWindowsCommandArgument(value);
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export async function installHookForSource(source, installedScript) {
  if (source.agentId === "codex" && source.profileClientSourceId !== undefined) return false;
  const marker = hookMarkerForSource(source.clientSourceId);
  const command = sourceHookCommand(
    source.agentId === "codex" ? installedHookLauncherScript() : installedScript,
    source,
  );
  const options = { markers: [legacyHookMarker, marker] };
  if (source.agentId === "codex") {
    const path = join(hookRoot(source, "codex"), "hooks.json");
    const installedStop = await updateHook(
      path,
      "Stop",
      { hooks: [{ type: "command", command, timeout: 3 }] },
      options,
    );
    const removedSessionEnd = await updateHook(path, "SessionEnd", null, {
      ...options,
      remove: true,
    });
    return installedStop || removedSessionEnd;
  }
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
  for (const source of physicalHookSources(sources))
    result[source.clientSourceId] = await installHookForSource(source, installedScript);
  return result;
}

function physicalHookSource(source) {
  if (source.agentId !== "codex" || source.profileClientSourceId === undefined) return source;
  const { profileClientSourceId, providerAccountKey: _providerAccountKey, ...rest } = source;
  return { ...rest, clientSourceId: profileClientSourceId };
}

function physicalHookSources(sources, knownLocalSources = sources) {
  const knownById = new Map(knownLocalSources.map((source) => [source.clientSourceId, source]));
  const result = [];
  const seen = new Set();
  for (const source of sources) {
    const hookSource =
      source.agentId === "codex" && source.profileClientSourceId !== undefined
        ? (knownById.get(source.profileClientSourceId) ?? physicalHookSource(source))
        : source;
    const key = `${hookSource.agentId}\0${hookSource.clientSourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(hookSource);
  }
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

export async function diagnoseHookForSource(source, options = {}) {
  const installedScript =
    source.agentId === "codex" ? installedHookLauncherScript() : installedRuntimeScript();
  const marker = hookMarkerForSource(source.clientSourceId);
  const command = sourceHookCommand(installedScript, source);
  if (source.agentId === "codex") {
    const path = join(hookRoot(source, "codex"), "hooks.json");
    const fileStatus = await jsonHookStatus(path, "Stop", command, marker);
    if (fileStatus !== "current") return fileStatus;
    try {
      const inspect = options.inspectCodexHookTrust ?? inspectCodexHookTrust;
      return await inspect(source, { sourcePath: path, command });
    } catch {
      return "trust-unknown";
    }
  }
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
  if (source.agentId === "opencode") return undefined;
  if (captureAgents.has(source.agentId)) return "capture-wrapper";
  return undefined;
}

export async function diagnoseHooks(sources, options = {}) {
  const result = {};
  for (const source of physicalHookSources(sources)) {
    const status = await diagnoseHookForSource(source, options);
    if (status) result[source.agentId] = mergeHookStatus(result[source.agentId], status);
  }
  return result;
}

function mergeHookStatus(previous, next) {
  if (!previous || previous === next) return next;
  const priority = [
    "invalid-settings",
    "disabled",
    "modified",
    "untrusted",
    "outdated",
    "missing",
    "trust-unknown",
    "current",
  ];
  return priority.indexOf(previous) <= priority.indexOf(next) ? previous : next;
}

export async function removeHookForSource(source, options = {}) {
  if (source.agentId === "codex" && source.profileClientSourceId !== undefined) return false;
  const marker = hookMarkerForSource(source.clientSourceId);
  const markers = options.removeLegacy ? [marker, legacyHookMarker] : [marker];
  const hookOptions = { remove: true, markers, removeAll: options.removeAll === true };
  const root = hookRoot(source, source.agentId);
  if (source.agentId === "codex") {
    const path = join(root, "hooks.json");
    const removedStop = await updateHook(path, "Stop", null, hookOptions);
    const removedSessionEnd = await updateHook(path, "SessionEnd", null, hookOptions);
    return removedStop || removedSessionEnd;
  }
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

export async function reconcileHooks(
  sourceUrl,
  activeSources,
  knownLocalSources = [],
  { installedScript: preparedScript } = {},
) {
  const failures = [];
  let installedScript = preparedScript;
  if (!installedScript) {
    try {
      installedScript = await prepareRuntime(sourceUrl);
    } catch (error) {
      failures.push({
        agentId: null,
        clientSourceId: null,
        path: stateDirectory,
        message: error instanceof Error ? error.message : "Connector runtime installation failed",
      });
    }
  }
  const hookSources = physicalHookSources(activeSources, knownLocalSources);
  const activeIds = new Set(hookSources.map((source) => source.clientSourceId));
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
    for (const source of hookSources)
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
      else if (source.agentId === "codex") {
        await updateHook(join(root, "hooks.json"), "SessionEnd", null, {
          remove: true,
          removeAll: true,
        });
        await updateHook(join(root, "hooks.json"), "Stop", null, {
          remove: true,
          removeAll: true,
        });
      } else if (source.agentId === "claude_code")
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

async function removeConfigUnlocked() {
  const attempt = await invalidateConnectAttemptUnlocked();
  await waitForTestConnectionBarrier("remove_after_lock");
  if (process.env.NODE_ENV === "test" && process.env.VIBERACING_TEST_FAIL_CONFIG_REMOVAL === "1")
    throw new Error("Synthetic local token removal failure");
  for (const path of [configPath, connectionCommitPath])
    try {
      await unlink(path);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  return attempt;
}

export async function removeConfig() {
  return withConnectionStateLock(() => removeConfigUnlocked());
}

export async function removeInstallationIdentity() {
  return withConnectionStateLock(async () => {
    try {
      await unlink(installationPath);
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  });
}

export async function resetInstallation() {
  await withConnectionStateLock(async () => {
    await removeConfigUnlocked();
    for (const path of [installationPath, join(stateDirectory, "state.json")])
      try {
        await unlink(path);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
  });
  await rm(join(stateDirectory, "pending"), { recursive: true, force: true });
}

export async function removeLocalState() {
  await rm(stateDirectory, { recursive: true, force: true });
}

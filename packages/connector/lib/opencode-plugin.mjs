import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { ensureOwnerOnlyWindowsFile, inspectOwnerOnlyWindowsFile } from "./windows-security.mjs";

export const openCodePluginMarkerSchema = 1;
export const maximumOpenCodePluginBytes = 64 * 1024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeEnvironmentNames = new Set([
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "NODE_EXTRA_CA_CERTS",
  "NODE_USE_ENV_PROXY",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
]);

function pathApi(platform) {
  return platform === "win32" ? win32 : posix;
}

function normalizedInstallationId(installationId) {
  if (!uuidPattern.test(installationId ?? "")) throw new Error("Invalid installation id");
  return installationId.toLowerCase();
}

function safeAbsolutePath(value, label, platform) {
  const paths = pathApi(platform);
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    /[\u0001-\u001f\u007f]/.test(value) ||
    !paths.isAbsolute(value)
  )
    throw new Error(`${label} must be an absolute safe path`);
  return paths.resolve(value);
}

export function canonicalOpenCodeStateRoot(stateRoot, platform = process.platform) {
  const resolved = safeAbsolutePath(stateRoot, "Vibe Racing state directory", platform);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function openCodeStateRootHash(stateRoot, platform = process.platform) {
  return createHash("sha256")
    .update(canonicalOpenCodeStateRoot(stateRoot, platform), "utf8")
    .digest("hex");
}

export function openCodePluginLocation({
  installationId,
  environment = process.env,
  homeDirectory = homedir(),
  platform = process.platform,
} = {}) {
  const id = normalizedInstallationId(installationId);
  const paths = pathApi(platform);
  const configured = environment.XDG_CONFIG_HOME;
  const base =
    typeof configured === "string" && configured.length > 0
      ? safeAbsolutePath(configured, "XDG_CONFIG_HOME", platform)
      : paths.join(safeAbsolutePath(homeDirectory, "Home directory", platform), ".config");
  const directory = paths.join(base, "opencode", "plugins");
  return {
    directory,
    path: paths.join(directory, `viberacing-${id}.js`),
  };
}

function environmentNameKey(name, platform) {
  return platform === "win32" ? name.toUpperCase() : name;
}

export function openCodePluginEnvironment(
  stateRoot,
  environment = process.env,
  platform = process.platform,
) {
  const entries = Object.entries(environment).filter(([, value]) => typeof value === "string");
  const testMode = entries.some(
    ([name, value]) => environmentNameKey(name, platform) === "NODE_ENV" && value === "test",
  );
  const result = {};
  const retained = new Set();
  for (const [name, value] of entries) {
    const key = environmentNameKey(name, platform);
    const allowed =
      safeEnvironmentNames.has(key) ||
      (testMode && (key === "NODE_ENV" || key.startsWith("VIBERACING_TEST_")));
    if (!allowed || retained.has(key)) continue;
    retained.add(key);
    result[name] = value;
  }
  result.VIBERACING_STATE_DIR = safeAbsolutePath(
    stateRoot,
    "Vibe Racing state directory",
    platform,
  );
  return result;
}

export function generateOpenCodePlugin({
  installationId,
  stateRoot,
  nodeExecutable = process.execPath,
  launcherPath,
  environment = process.env,
  platform = process.platform,
} = {}) {
  const id = normalizedInstallationId(installationId);
  const root = safeAbsolutePath(stateRoot, "Vibe Racing state directory", platform);
  const node = safeAbsolutePath(nodeExecutable, "Node executable", platform);
  const launcher = safeAbsolutePath(launcherPath, "Vibe Racing launcher", platform);
  const marker = {
    schema: openCodePluginMarkerSchema,
    installationId: id,
    stateRootHash: openCodeStateRootHash(root, platform),
  };
  const allowTestEnvironment = Object.entries(environment).some(
    ([name, value]) => environmentNameKey(name, platform) === "NODE_ENV" && value === "test",
  );
  const debounceSymbol = `viberacing.opencode.idle.${id}`;
  const command = [
    node,
    launcher,
    "hook",
    "--agent",
    "opencode",
    "--all-sources",
    "--installation",
    id,
  ];
  return [
    `// viberacing-opencode-plugin ${JSON.stringify(marker)}`,
    `const debounceKey = Symbol.for(${JSON.stringify(debounceSymbol)});`,
    `const command = ${JSON.stringify(command)};`,
    `const stateDirectory = ${JSON.stringify(root)};`,
    `const environmentNames = new Set(${JSON.stringify([...safeEnvironmentNames])});`,
    `const windowsEnvironment = ${platform === "win32"};`,
    `const allowTestEnvironment = ${allowTestEnvironment};`,
    'const environmentEntries = Object.entries(process.env).filter(([, value]) => typeof value === "string");',
    "const environmentKey = (name) => windowsEnvironment ? name.toUpperCase() : name;",
    'const testEnvironment = allowTestEnvironment && environmentEntries.some(([name, value]) => environmentKey(name) === "NODE_ENV" && value === "test");',
    "const childEnvironment = {};",
    "const retainedEnvironmentNames = new Set();",
    "for (const [name, value] of environmentEntries) {",
    "  const key = environmentKey(name);",
    '  const allowed = environmentNames.has(key) || (testEnvironment && (key === "NODE_ENV" || key.startsWith("VIBERACING_TEST_")));',
    "  if (!allowed || retainedEnvironmentNames.has(key)) continue;",
    "  retainedEnvironmentNames.add(key);",
    "  childEnvironment[name] = value;",
    "}",
    "childEnvironment.VIBERACING_STATE_DIR = stateDirectory;",
    "",
    "export const VibeRacingPlugin = async () => ({",
    "  event({ event }) {",
    "    try {",
    "      const type = event?.type;",
    '      const idle = type === "session.idle" ||',
    '        (type === "session.status" && event?.properties?.status?.type === "idle");',
    "      if (!idle) return;",
    "      const now = globalThis.performance.now();",
    "      const previous = globalThis[debounceKey];",
    '      if (typeof previous === "number" && now - previous < 2000) return;',
    "      const child = Bun.spawn(command, {",
    "        cwd: stateDirectory,",
    "        env: childEnvironment,",
    "        detached: true,",
    '        stdio: ["ignore", "ignore", "ignore"],',
    "        windowsHide: true,",
    "      });",
    "      globalThis[debounceKey] = now;",
    "      child.unref();",
    "    } catch {}",
    "  },",
    "});",
    "",
  ].join("\n");
}

function parseMarker(contents) {
  const firstLine = contents.slice(
    0,
    contents.indexOf("\n") < 0 ? undefined : contents.indexOf("\n"),
  );
  const prefix = "// viberacing-opencode-plugin ";
  if (!firstLine.startsWith(prefix)) return null;
  try {
    const marker = JSON.parse(firstLine.slice(prefix.length));
    if (
      marker === null ||
      typeof marker !== "object" ||
      Array.isArray(marker) ||
      JSON.stringify(Object.keys(marker).sort()) !==
        JSON.stringify(["installationId", "schema", "stateRootHash"]) ||
      !Number.isSafeInteger(marker.schema) ||
      !uuidPattern.test(marker.installationId ?? "") ||
      !/^[0-9a-f]{64}$/.test(marker.stateRootHash ?? "")
    )
      return null;
    return { ...marker, installationId: marker.installationId.toLowerCase() };
  } catch {
    return null;
  }
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function inspectPluginFile(
  path,
  expected,
  { platform, getuid, statFile, read, inspectWindowsFile },
) {
  let info;
  try {
    info = await statFile(path);
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "missing", path, owned: false };
    return { status: "unreadable", path, owned: false };
  }
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    info.size > maximumOpenCodePluginBytes
  )
    return { status: "unsafe", path, owned: false };
  if (platform === "win32") {
    if (!(await inspectWindowsFile(path))) return { status: "unsafe", path, owned: false };
  } else {
    const uid = getuid?.();
    if ((uid !== undefined && info.uid !== uid) || (info.mode & 0o777) !== 0o600)
      return { status: "unsafe", path, owned: false };
  }
  let contents;
  try {
    contents = await read(path, "utf8");
  } catch {
    return { status: "unreadable", path, owned: false };
  }
  const marker = parseMarker(contents);
  if (marker === null) return { status: "conflict", path, owned: false };
  if (marker.schema > openCodePluginMarkerSchema)
    return { status: "unsupported-newer", path, owned: false, marker };
  if (
    marker.schema !== openCodePluginMarkerSchema ||
    marker.installationId !== expected.installationId ||
    marker.stateRootHash !== expected.stateRootHash
  )
    return { status: "conflict", path, owned: false, marker };
  return {
    status: contents === expected.contents ? "current" : "outdated",
    path,
    owned: true,
    marker,
    info,
  };
}

function inspectionDependencies(options) {
  return {
    platform: options.platform ?? process.platform,
    getuid:
      options.getuid ?? (typeof process.getuid === "function" ? () => process.getuid() : null),
    statFile: options.lstat ?? lstat,
    read: options.readFile ?? readFile,
    inspectWindowsFile:
      options.inspectWindowsFile ??
      ((path) => inspectOwnerOnlyWindowsFile(path, { platform: options.platform })),
  };
}

function expectedPlugin(options) {
  const platform = options.platform ?? process.platform;
  const installationId = normalizedInstallationId(options.installationId);
  const stateRoot = safeAbsolutePath(options.stateRoot, "Vibe Racing state directory", platform);
  const launcherPath =
    options.launcherPath ?? pathApi(platform).join(stateRoot, "bin", "viberacing-hook.mjs");
  return {
    installationId,
    stateRoot,
    stateRootHash: openCodeStateRootHash(stateRoot, platform),
    contents: generateOpenCodePlugin({
      ...options,
      installationId,
      stateRoot,
      launcherPath,
      platform,
    }),
    location: openCodePluginLocation({ ...options, installationId, platform }),
  };
}

export async function inspectOpenCodePlugin(options = {}) {
  const expected = expectedPlugin(options);
  return inspectPluginFile(expected.location.path, expected, inspectionDependencies(options));
}

async function ensurePluginDirectory(directory, options) {
  const statFile = options.lstat ?? lstat;
  const makeDirectory = options.mkdir ?? mkdir;
  let created = false;
  try {
    const info = await statFile(directory);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error("OpenCode plugin directory is unsafe");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await makeDirectory(directory, { recursive: true, mode: 0o700 });
    created = true;
    const info = await statFile(directory);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error("OpenCode plugin directory is unsafe");
  }
  return created;
}

async function syncDirectory(directory, options) {
  if ((options.platform ?? process.platform) === "win32") return;
  const openFile = options.open ?? open;
  let handle;
  try {
    handle = await openFile(directory, fsConstants.O_RDONLY);
    await handle.sync();
  } catch {
    // Directory fsync is not supported by every filesystem.
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function installPlugin(expected, previous, options) {
  const openFile = options.open ?? open;
  const move = options.rename ?? rename;
  const remove = options.unlink ?? unlink;
  const setMode = options.chmod ?? chmod;
  const secureWindowsFile =
    options.secureWindowsFile ??
    ((path) => ensureOwnerOnlyWindowsFile(path, { platform: options.platform }));
  const temporary = `${expected.location.path}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await openFile(temporary, "wx", 0o600);
    await handle.writeFile(expected.contents, "utf8");
    if ((options.platform ?? process.platform) !== "win32") await handle.chmod(0o600);
    await handle.sync();
    await handle.close();
    handle = null;
    if ((options.platform ?? process.platform) === "win32") await secureWindowsFile(temporary);
    const current = await inspectPluginFile(
      expected.location.path,
      expected,
      inspectionDependencies(options),
    );
    if (
      current.status !== previous.status &&
      !(previous.status === "missing" && current.status === "missing") &&
      !(previous.owned && current.owned)
    )
      throw new Error(`OpenCode plugin changed during installation (${current.status})`);
    if (
      !["missing", "current", "outdated"].includes(current.status) ||
      (!current.owned && current.status !== "missing")
    )
      throw new Error(`OpenCode plugin cannot be replaced (${current.status})`);
    if (current.status === "current") return false;
    await move(temporary, expected.location.path);
    if ((options.platform ?? process.platform) === "win32")
      await secureWindowsFile(expected.location.path);
    else await setMode(expected.location.path, 0o600);
    await syncDirectory(expected.location.directory, options);
    const installed = await inspectPluginFile(
      expected.location.path,
      expected,
      inspectionDependencies(options),
    );
    if (installed.status !== "current")
      throw new Error(`OpenCode plugin installation verification failed (${installed.status})`);
    return true;
  } finally {
    await handle?.close().catch(() => {});
    await remove(temporary).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

async function removePlugin(expected, previous, options) {
  if (!previous.owned) return false;
  const remove = options.unlink ?? unlink;
  const current = await inspectPluginFile(
    expected.location.path,
    expected,
    inspectionDependencies(options),
  );
  if (!current.owned || !sameFile(previous.info, current.info))
    throw new Error(`OpenCode plugin changed during removal (${current.status})`);
  await remove(expected.location.path);
  await syncDirectory(expected.location.directory, options);
  return true;
}

export async function reconcileOpenCodePlugin(options = {}) {
  const expected = expectedPlugin(options);
  let inspection = await inspectPluginFile(
    expected.location.path,
    expected,
    inspectionDependencies(options),
  );
  if (options.desired === false) {
    if (inspection.status === "missing")
      return { status: "missing", action: "none", changed: false, path: expected.location.path };
    if (!inspection.owned)
      return {
        status: inspection.status,
        action: "blocked",
        changed: false,
        path: expected.location.path,
      };
    const changed = await removePlugin(expected, inspection, options);
    return {
      status: "missing",
      action: changed ? "removed" : "none",
      changed,
      path: expected.location.path,
    };
  }
  if (inspection.status === "current")
    return { status: "current", action: "none", changed: false, path: expected.location.path };
  if (!["missing", "outdated"].includes(inspection.status))
    return {
      status: inspection.status,
      action: "blocked",
      changed: false,
      path: expected.location.path,
    };
  await ensurePluginDirectory(expected.location.directory, options);
  inspection = await inspectPluginFile(
    expected.location.path,
    expected,
    inspectionDependencies(options),
  );
  if (inspection.status === "current")
    return { status: "current", action: "none", changed: false, path: expected.location.path };
  if (!["missing", "outdated"].includes(inspection.status))
    return {
      status: inspection.status,
      action: "blocked",
      changed: false,
      path: expected.location.path,
    };
  const changed = await installPlugin(expected, inspection, options);
  return {
    status: "current",
    action: changed ? (inspection.status === "missing" ? "created" : "updated") : "none",
    changed,
    path: expected.location.path,
  };
}

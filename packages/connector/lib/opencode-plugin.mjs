import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { link, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
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

function isExpectedPluginBasename(name, installationId, allowRecoveryPath = false) {
  const canonical = `viberacing-${installationId}.js`;
  if (name === canonical) return true;
  if (!allowRecoveryPath) return false;
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
    uuidPattern.test(stageIdentity.slice(separator + 1));
  return (
    (base === canonical
      ? quarantineSuffixes.length > 0
      : stageValid && (probeSuffix === null || uuidPattern.test(probeSuffix))) &&
    quarantineSuffixes.every((suffix) => uuidPattern.test(suffix))
  );
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
  const names = Object.keys(environment);
  const nodeEnvironmentName = names.find(
    (name) => environmentNameKey(name, platform) === "NODE_ENV",
  );
  const testMode = nodeEnvironmentName !== undefined && environment[nodeEnvironmentName] === "test";
  const result = {};
  const retained = new Set();
  for (const name of names) {
    const key = environmentNameKey(name, platform);
    const allowed =
      safeEnvironmentNames.has(key) ||
      (testMode && (key === "NODE_ENV" || key.startsWith("VIBERACING_TEST_")));
    if (!allowed || retained.has(key)) continue;
    const value = environment[name];
    if (typeof value !== "string") continue;
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
  const nodeEnvironmentName = Object.keys(environment).find(
    (name) => environmentNameKey(name, platform) === "NODE_ENV",
  );
  const allowTestEnvironment =
    nodeEnvironmentName !== undefined && environment[nodeEnvironmentName] === "test";
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
    `const allowlistedEnvironmentNames = new Set(${JSON.stringify([...safeEnvironmentNames])});`,
    `const windowsEnvironment = ${platform === "win32"};`,
    `const allowTestEnvironment = ${allowTestEnvironment};`,
    "const environmentKey = (name) => windowsEnvironment ? name.toUpperCase() : name;",
    "const processEnvironmentNames = Object.keys(process.env);",
    'const nodeEnvironmentName = processEnvironmentNames.find((name) => environmentKey(name) === "NODE_ENV");',
    'const testEnvironment = allowTestEnvironment && nodeEnvironmentName !== undefined && process.env[nodeEnvironmentName] === "test";',
    "const childEnvironment = {};",
    "const retainedEnvironmentNames = new Set();",
    "for (const name of processEnvironmentNames) {",
    "  const key = environmentKey(name);",
    '  const allowed = allowlistedEnvironmentNames.has(key) || (testEnvironment && (key === "NODE_ENV" || key.startsWith("VIBERACING_TEST_")));',
    "  if (!allowed || retainedEnvironmentNames.has(key)) continue;",
    "  const value = process.env[name];",
    '  if (typeof value !== "string") continue;',
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

function safePluginInfo(info, platform, getuid) {
  if (
    !info.isFile() ||
    info.isSymbolicLink?.() ||
    info.nlink !== 1 ||
    info.size > maximumOpenCodePluginBytes
  )
    return false;
  if (platform === "win32") return true;
  const uid = getuid?.();
  return (uid === undefined || info.uid === uid) && (info.mode & 0o777) === 0o600;
}

function samePluginSnapshot(left, right) {
  return (
    sameFile(left, right) &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.uid === right.uid &&
    left.mode === right.mode &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

async function inspectPluginFile(
  path,
  expected,
  { platform, getuid, statFile, openFile, inspectWindowsFile },
) {
  let pathInfo;
  try {
    pathInfo = await statFile(path);
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "missing", path, owned: false };
    return { status: "unreadable", path, owned: false };
  }
  if (!safePluginInfo(pathInfo, platform, getuid)) return { status: "unsafe", path, owned: false };
  let handle;
  try {
    handle = await openFile(
      path,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0),
    );
    const opened = await handle.stat();
    if (!sameFile(pathInfo, opened) || !safePluginInfo(opened, platform, getuid))
      return { status: "unsafe", path, owned: false };
    if (platform === "win32") {
      if (!(await inspectWindowsFile(path))) return { status: "unsafe", path, owned: false };
      const checkedPath = await statFile(path);
      if (!sameFile(opened, checkedPath) || !safePluginInfo(checkedPath, platform, getuid))
        return { status: "unsafe", path, owned: false };
    }
    const contents = await readFileHandleContents(handle, opened.size, "inspection");
    const afterRead = await handle.stat();
    if (!samePluginSnapshot(opened, afterRead) || !safePluginInfo(afterRead, platform, getuid))
      return { status: "unreadable", path, owned: false };
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
      info: afterRead,
      contents,
    };
  } catch {
    return { status: "unreadable", path, owned: false };
  } finally {
    await handle?.close().catch(() => {});
  }
}

function inspectionDependencies(options) {
  return {
    platform: options.platform ?? process.platform,
    getuid:
      options.getuid ?? (typeof process.getuid === "function" ? () => process.getuid() : null),
    statFile: options.lstat ?? lstat,
    openFile: options.open ?? open,
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
  const location =
    options.pluginPath === undefined
      ? openCodePluginLocation({ ...options, installationId, platform })
      : (() => {
          const paths = pathApi(platform);
          const pluginPath = safeAbsolutePath(options.pluginPath, "OpenCode plugin path", platform);
          if (
            !isExpectedPluginBasename(
              paths.basename(pluginPath),
              installationId,
              options.allowRecoveryPath === true,
            )
          )
            throw new Error("OpenCode plugin path does not match the installation id");
          return { directory: paths.dirname(pluginPath), path: pluginPath };
        })();
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
    location,
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

async function readFileHandleContents(handle, size, operation) {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < bytes.length) {
    const result = await handle.read(bytes, offset, bytes.length - offset, offset);
    if (result.bytesRead <= 0) throw new Error(`OpenCode plugin changed during ${operation}`);
    offset += result.bytesRead;
  }
  return bytes.toString("utf8");
}

function pluginMutationError(message, expected, recoveryPath = null) {
  const error = new Error(message);
  error.pluginPath = expected.location.path;
  if (recoveryPath) {
    error.recoveryPath = recoveryPath;
    error.recoveryPaths = [recoveryPath];
  }
  return error;
}

function interruptPluginMutationForTest(point) {
  if (
    process.env.NODE_ENV === "test" &&
    process.env.VIBERACING_TEST_INTERRUPT_OPENCODE_PLUGIN === point
  )
    process.exit(86);
}

async function retainRecoveryPath(expected, recoveryPath, options) {
  if (!options.retainRecoveryPath) return;
  try {
    await options.retainRecoveryPath(recoveryPath);
  } catch (error) {
    throw pluginMutationError(
      `OpenCode plugin recovery path could not be recorded: ${error.message}`,
      expected,
      recoveryPath,
    );
  }
}

async function releaseRecoveryPath(expected, recoveryPath, options) {
  if (!options.releaseRecoveryPath) return;
  try {
    await options.releaseRecoveryPath(recoveryPath);
  } catch (error) {
    throw pluginMutationError(
      `OpenCode plugin recovery path could not be cleared: ${error.message}`,
      expected,
      recoveryPath,
    );
  }
}

async function verifyQuarantinedPlugin(expected, previous, quarantinePath, options, operation) {
  const openFile = options.open ?? open;
  let handle;
  try {
    handle = await openFile(quarantinePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    const platform = options.platform ?? process.platform;
    const getuid =
      options.getuid ?? (typeof process.getuid === "function" ? () => process.getuid() : null);
    const uid = getuid?.();
    if (
      !sameFile(previous.info, opened) ||
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.size > maximumOpenCodePluginBytes ||
      (platform !== "win32" &&
        ((uid !== undefined && opened.uid !== uid) || (opened.mode & 0o777) !== 0o600)) ||
      (await readFileHandleContents(handle, opened.size, operation)) !== previous.contents
    )
      throw pluginMutationError(
        `OpenCode plugin changed during ${operation}`,
        expected,
        quarantinePath,
      );
    if (
      platform === "win32" &&
      !(await inspectionDependencies(options).inspectWindowsFile(quarantinePath))
    )
      throw pluginMutationError(
        `OpenCode plugin security changed during ${operation}`,
        expected,
        quarantinePath,
      );
    return opened;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function pathInfo(filePath, options) {
  try {
    return await (options.lstat ?? lstat)(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function restoreQuarantinedRegularFile(expected, quarantinePath, options) {
  const info = await pathInfo(quarantinePath, options);
  if (!info?.isFile() || info.isSymbolicLink()) return false;
  try {
    await (options.link ?? link)(quarantinePath, expected.location.path);
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  }
  await (options.unlink ?? unlink)(quarantinePath);
  await syncDirectory(expected.location.directory, options);
  await releaseRecoveryPath(expected, quarantinePath, options);
  return true;
}

async function quarantineOwnedPlugin(expected, previous, options, operation) {
  const quarantinePath = `${expected.location.path}.quarantine-${randomUUID()}`;
  await retainRecoveryPath(expected, quarantinePath, options);
  await (options.rename ?? rename)(expected.location.path, quarantinePath);
  interruptPluginMutationForTest("after-quarantine-rename");
  try {
    const info = await verifyQuarantinedPlugin(
      expected,
      previous,
      quarantinePath,
      options,
      operation,
    );
    return { path: quarantinePath, info };
  } catch (error) {
    let restored;
    try {
      restored = await restoreQuarantinedRegularFile(expected, quarantinePath, options);
    } catch {
      throw pluginMutationError(
        `${error.message}; the raced file was preserved at ${quarantinePath}`,
        expected,
        quarantinePath,
      );
    }
    if (restored) throw error;
    throw pluginMutationError(
      `${error.message}; the raced file was preserved at ${quarantinePath}`,
      expected,
      quarantinePath,
    );
  }
}

async function unlinkVerifiedPrivateFile(filePath, expectedInfo, options) {
  const current = await pathInfo(filePath, options);
  if (!current || !sameFile(current, expectedInfo))
    throw new Error(`OpenCode plugin quarantine changed; preserved at ${filePath}`);
  await (options.unlink ?? unlink)(filePath);
}

async function unlinkQuarantinedPlugin(expected, quarantine, options) {
  try {
    await unlinkVerifiedPrivateFile(quarantine.path, quarantine.info, options);
    await releaseRecoveryPath(expected, quarantine.path, options);
  } catch (error) {
    throw pluginMutationError(
      `${error.message}; the owned plugin was preserved at ${quarantine.path}`,
      expected,
      quarantine.path,
    );
  }
}

async function verifyHardlinkSupport(expected, stagePath, options) {
  const probePath = `${stagePath}.probe-${randomUUID()}`;
  await retainRecoveryPath(expected, probePath, options);
  try {
    try {
      await (options.link ?? link)(stagePath, probePath);
    } catch (error) {
      await releaseRecoveryPath(expected, probePath, options);
      throw error;
    }
    interruptPluginMutationForTest("after-hardlink-probe");
    await (options.unlink ?? unlink)(probePath);
    await releaseRecoveryPath(expected, probePath, options);
  } catch (error) {
    if (error?.code === "ENOENT") await releaseRecoveryPath(expected, probePath, options);
    throw error;
  }
}

async function installPlugin(expected, previous, options) {
  const openFile = options.open ?? open;
  const publish = options.link ?? link;
  const remove = options.unlink ?? unlink;
  const secureWindowsFile =
    options.secureWindowsFile ??
    ((path) => ensureOwnerOnlyWindowsFile(path, { platform: options.platform }));
  const stage = `${expected.location.path}.${process.pid}.${randomUUID()}.stage`;
  let handle;
  let stagePresent = false;
  let quarantine = null;
  let operationError = null;
  let canonicalRecoveryRetained = false;
  try {
    await retainRecoveryPath(expected, stage, options);
    try {
      handle = await openFile(stage, "wx", 0o600);
    } catch (error) {
      await releaseRecoveryPath(expected, stage, options);
      throw error;
    }
    stagePresent = true;
    interruptPluginMutationForTest("after-stage-create");
    await handle.writeFile(expected.contents, "utf8");
    if ((options.platform ?? process.platform) !== "win32") await handle.chmod(0o600);
    await handle.sync();
    await handle.close();
    handle = null;
    if ((options.platform ?? process.platform) === "win32") await secureWindowsFile(stage);
    const staged = await inspectPluginFile(stage, expected, inspectionDependencies(options));
    if (staged.status !== "current")
      throw new Error(`OpenCode plugin staging verification failed (${staged.status})`);
    if (previous.owned) {
      await verifyHardlinkSupport(expected, stage, options);
      quarantine = await quarantineOwnedPlugin(expected, previous, options, "installation");
    }
    try {
      await publish(stage, expected.location.path);
      interruptPluginMutationForTest("after-publish");
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const raced = await inspectPluginFile(
        expected.location.path,
        expected,
        inspectionDependencies(options),
      );
      if (raced.status === "current") {
        if (options.deferCanonicalRecoveryRelease) {
          await retainRecoveryPath(expected, expected.location.path, options);
          canonicalRecoveryRetained = true;
        }
        if (quarantine) {
          await unlinkQuarantinedPlugin(expected, quarantine, options);
          quarantine = null;
          await syncDirectory(expected.location.directory, options);
        }
        return {
          changed: false,
          recoveryPathsToRelease: canonicalRecoveryRetained ? [expected.location.path] : [],
        };
      }
      throw pluginMutationError(
        `OpenCode plugin changed during installation (${raced.status})`,
        expected,
        quarantine?.path ?? null,
      );
    }
    if (options.deferCanonicalRecoveryRelease) {
      await retainRecoveryPath(expected, expected.location.path, options);
      canonicalRecoveryRetained = true;
    }
    let stageRemovalError;
    for (let attempt = 0; attempt < 2; attempt += 1)
      try {
        await remove(stage);
        stagePresent = false;
        stageRemovalError = null;
        break;
      } catch (error) {
        if (error?.code === "ENOENT") {
          stagePresent = false;
          stageRemovalError = null;
          break;
        }
        stageRemovalError = error;
      }
    if (stageRemovalError)
      throw pluginMutationError(
        `${stageRemovalError.message}; the installation stage was preserved at ${stage}`,
        expected,
        stage,
      );
    await releaseRecoveryPath(expected, stage, options);
    interruptPluginMutationForTest("after-stage-journal-release");
    await syncDirectory(expected.location.directory, options);
    const installed = await inspectPluginFile(
      expected.location.path,
      expected,
      inspectionDependencies(options),
    );
    if (installed.status !== "current")
      throw new Error(`OpenCode plugin installation verification failed (${installed.status})`);
    if (quarantine) {
      await unlinkQuarantinedPlugin(expected, quarantine, options);
      quarantine = null;
      await syncDirectory(expected.location.directory, options);
    }
    return {
      changed: true,
      recoveryPathsToRelease: canonicalRecoveryRetained ? [expected.location.path] : [],
    };
  } catch (error) {
    operationError = error;
    if (quarantine && !(await pathInfo(expected.location.path, options))) {
      try {
        const restored = await restoreQuarantinedRegularFile(expected, quarantine.path, options);
        if (restored) quarantine = null;
      } catch {
        throw pluginMutationError(
          `${error.message}; the prior plugin was preserved at ${quarantine.path}`,
          expected,
          quarantine.path,
        );
      }
    }
    if (quarantine) {
      error.recoveryPath ??= quarantine.path;
      error.recoveryPaths = [...new Set([...(error.recoveryPaths ?? []), quarantine.path])];
    }
    throw error;
  } finally {
    await handle?.close().catch(() => {});
    if (stagePresent) {
      try {
        await remove(stage);
        stagePresent = false;
        await releaseRecoveryPath(expected, stage, options);
      } catch (error) {
        if (error?.code === "ENOENT") {
          stagePresent = false;
          await releaseRecoveryPath(expected, stage, options);
        } else if (operationError) {
          operationError.recoveryPath ??= stage;
          operationError.recoveryPaths = [
            ...new Set([...(operationError.recoveryPaths ?? []), stage]),
          ];
        } else {
          throw pluginMutationError(
            `${error.message}; the installation stage was preserved at ${stage}`,
            expected,
            stage,
          );
        }
      }
    }
  }
}

async function removePlugin(expected, previous, options) {
  if (!previous.owned) return false;
  const quarantine = await quarantineOwnedPlugin(expected, previous, options, "removal");
  await unlinkQuarantinedPlugin(expected, quarantine, options);
  await syncDirectory(expected.location.directory, options);
  return inspectPluginFile(expected.location.path, expected, inspectionDependencies(options));
}

function publishedStageCanonicalPath(expected, options) {
  const paths = pathApi(options.platform ?? process.platform);
  const name = paths.basename(expected.location.path);
  const canonical = `viberacing-${expected.installationId}.js`;
  const prefix = `${canonical}.`;
  const suffix = ".stage";
  if (!name.startsWith(prefix) || !name.endsWith(suffix) || name.includes(".quarantine-"))
    return null;
  const identity = name.slice(prefix.length, -suffix.length);
  const separator = identity.indexOf(".");
  if (
    separator <= 0 ||
    !/^\d+$/.test(identity.slice(0, separator)) ||
    !uuidPattern.test(identity.slice(separator + 1))
  )
    return null;
  return paths.join(paths.dirname(expected.location.path), canonical);
}

function safePublishedLinkInfo(info, platform, getuid) {
  if (
    !info?.isFile() ||
    info.isSymbolicLink?.() ||
    info.nlink !== 2 ||
    info.size > maximumOpenCodePluginBytes
  )
    return false;
  if (platform === "win32") return true;
  const uid = getuid?.();
  return (uid === undefined || info.uid === uid) && (info.mode & 0o777) === 0o600;
}

async function removePublishedStageLink(expected, options) {
  const canonicalPath = publishedStageCanonicalPath(expected, options);
  const stageRemoved = await removeVerifiedRecoveryHardlink(expected, canonicalPath, options, {
    retainSurvivor: true,
  });
  if (!stageRemoved) return false;
  const canonical = await reconcileOpenCodePlugin({
    ...options,
    pluginPath: canonicalPath,
    allowRecoveryPath: true,
    allowIncompleteStageCleanup: false,
    journaledRecoveryPeerPaths: [],
    desired: false,
  });
  if (canonical.action === "blocked")
    throw pluginMutationError(
      `Published OpenCode plugin recovery was blocked (${canonical.status})`,
      expected,
      canonicalPath,
    );
  await releaseRecoveryPath(expected, canonicalPath, options);
  return true;
}

function restoredQuarantineTargetPath(expected, options) {
  const paths = pathApi(options.platform ?? process.platform);
  const name = paths.basename(expected.location.path);
  const separator = name.lastIndexOf(".quarantine-");
  if (separator < 0 || !uuidPattern.test(name.slice(separator + ".quarantine-".length)))
    return null;
  const targetName = name.slice(0, separator);
  if (!isExpectedPluginBasename(targetName, expected.installationId, true)) return null;
  return paths.join(paths.dirname(expected.location.path), targetName);
}

async function removeVerifiedRecoveryHardlink(
  expected,
  survivorPath,
  options,
  { retainSurvivor = false } = {},
) {
  if (!survivorPath || survivorPath === expected.location.path) return false;
  const dependencies = inspectionDependencies(options);
  const { platform, getuid, statFile, openFile, inspectWindowsFile } = dependencies;
  let recoveryInfo;
  let survivorInfo;
  try {
    [recoveryInfo, survivorInfo] = await Promise.all([
      statFile(expected.location.path),
      statFile(survivorPath),
    ]);
  } catch {
    return false;
  }
  if (
    !safePublishedLinkInfo(recoveryInfo, platform, getuid) ||
    !safePublishedLinkInfo(survivorInfo, platform, getuid) ||
    !samePluginSnapshot(recoveryInfo, survivorInfo)
  )
    return false;
  let handle;
  try {
    handle = await openFile(
      expected.location.path,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0),
    );
    const opened = await handle.stat();
    if (
      !safePublishedLinkInfo(opened, platform, getuid) ||
      !samePluginSnapshot(recoveryInfo, opened)
    )
      return false;
    if (
      platform === "win32" &&
      (!(await inspectWindowsFile(expected.location.path)) ||
        !(await inspectWindowsFile(survivorPath)))
    )
      return false;
    const contents = await readFileHandleContents(handle, opened.size, "stage recovery");
    const marker = parseMarker(contents);
    if (
      marker?.schema !== openCodePluginMarkerSchema ||
      marker.installationId !== expected.installationId ||
      marker.stateRootHash !== expected.stateRootHash
    )
      return false;
    const [finalRecovery, finalSurvivor] = await Promise.all([
      statFile(expected.location.path),
      statFile(survivorPath),
    ]);
    if (!samePluginSnapshot(opened, finalRecovery) || !samePluginSnapshot(opened, finalSurvivor))
      return false;
    if (retainSurvivor) await retainRecoveryPath(expected, survivorPath, options);
    await (options.unlink ?? unlink)(expected.location.path);
    await syncDirectory(expected.location.directory, options);
    await releaseRecoveryPath(expected, expected.location.path, options);
    return true;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function removeJournaledRecoveryPeerLink(expected, options) {
  for (const peerPath of options.journaledRecoveryPeerPaths ?? []) {
    let peerExpected;
    try {
      peerExpected = expectedPlugin({
        ...options,
        pluginPath: peerPath,
        allowRecoveryPath: true,
      });
    } catch {
      continue;
    }
    if (
      peerExpected.installationId === expected.installationId &&
      (await removeVerifiedRecoveryHardlink(expected, peerExpected.location.path, options))
    )
      return true;
  }
  return false;
}

async function removeIncompleteJournaledStage(expected, options) {
  if (!options.allowIncompleteStageCleanup || !publishedStageCanonicalPath(expected, options))
    return false;
  const dependencies = inspectionDependencies(options);
  const { platform, getuid, statFile, openFile, inspectWindowsFile } = dependencies;
  let before;
  try {
    before = await statFile(expected.location.path);
  } catch {
    return false;
  }
  if (!safePluginInfo(before, platform, getuid)) return false;
  let handle;
  try {
    handle = await openFile(
      expected.location.path,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0),
    );
    const opened = await handle.stat();
    if (!samePluginSnapshot(before, opened) || !safePluginInfo(opened, platform, getuid))
      return false;
    if (platform === "win32" && !(await inspectWindowsFile(expected.location.path))) return false;
    const contents = await readFileHandleContents(handle, opened.size, "stage recovery");
    if (!expected.contents.startsWith(contents)) return false;
    const finalInfo = await statFile(expected.location.path);
    if (!samePluginSnapshot(opened, finalInfo)) return false;
    await (options.unlink ?? unlink)(expected.location.path);
    await syncDirectory(expected.location.directory, options);
    await releaseRecoveryPath(expected, expected.location.path, options);
    return true;
  } finally {
    await handle?.close().catch(() => {});
  }
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
    if (!inspection.owned && (await removePublishedStageLink(expected, options)))
      return {
        status: "missing",
        action: "removed",
        changed: true,
        path: expected.location.path,
      };
    if (
      !inspection.owned &&
      (await removeVerifiedRecoveryHardlink(
        expected,
        restoredQuarantineTargetPath(expected, options),
        options,
      ))
    )
      return {
        status: "missing",
        action: "removed",
        changed: true,
        path: expected.location.path,
      };
    if (!inspection.owned && (await removeJournaledRecoveryPeerLink(expected, options)))
      return {
        status: "missing",
        action: "removed",
        changed: true,
        path: expected.location.path,
      };
    if (!inspection.owned && (await removeIncompleteJournaledStage(expected, options)))
      return {
        status: "missing",
        action: "removed",
        changed: true,
        path: expected.location.path,
      };
    if (!inspection.owned)
      return {
        status: inspection.status,
        action: "blocked",
        changed: false,
        path: expected.location.path,
      };
    const finalInspection = await removePlugin(expected, inspection, options);
    return finalInspection.status === "missing"
      ? {
          status: "missing",
          action: "removed",
          changed: true,
          path: expected.location.path,
        }
      : {
          status: finalInspection.status,
          action: "blocked",
          changed: true,
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
  const installation = await installPlugin(expected, inspection, options);
  return {
    status: "current",
    action: installation.changed
      ? inspection.status === "missing"
        ? "created"
        : "updated"
      : "none",
    changed: installation.changed,
    path: expected.location.path,
    ...(installation.recoveryPathsToRelease.length > 0
      ? { recoveryPathsToRelease: installation.recoveryPathsToRelease }
      : {}),
  };
}

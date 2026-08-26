import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { access, chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, win32 } from "node:path";
import { stateDirectory } from "./config.mjs";
import { connectorVersion } from "./version.mjs";

const run = promisify(execFile);
export const browserSyncProtocolVersion = 2;
const ownershipMarker = "viberacing-browser-handler-v1";
const handlerMarker = `${ownershipMarker};runtime=${connectorVersion};protocol=${browserSyncProtocolVersion}`;
const handlerMarkerPattern = new RegExp(
  `${ownershipMarker.replaceAll("-", "\\-")};runtime=(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?);protocol=([0-2])`,
);

function appleScriptString(value) {
  if (typeof value !== "string" || /[\0\r\n]/.test(value))
    throw new Error("Invalid macOS URL handler path");
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function xmlEscape(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function desktopQuote(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("`", "\\`").replaceAll("$", "\\$")}"`;
}

function windowsCommandQuote(value) {
  if (typeof value !== "string" || /[\0\r\n]/.test(value))
    throw new Error("Invalid Windows URL handler argument");
  const escaped = value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, "$1$1");
  return `"${escaped}"`;
}

async function existingOwned(path) {
  try {
    return (await readFile(path, "utf8")).includes(ownershipMarker);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function markerAttestation(value) {
  if (!value.includes(ownershipMarker)) return null;
  const match = value.match(handlerMarkerPattern);
  if (match === null) return { runtimeVersion: null, protocol: 1 };
  return { runtimeVersion: match[1], protocol: Number(match[2]) };
}

function ownedHandlerDetails(value) {
  const attestation = markerAttestation(value);
  if (attestation === null) return { protocol: 0, runtimeVersion: null, status: "foreign" };
  return {
    ...attestation,
    status:
      attestation.runtimeVersion === connectorVersion &&
      attestation.protocol === browserSyncProtocolVersion
        ? "current"
        : "outdated",
  };
}

function macHandlerOptions(options = {}) {
  const appName = options.macAppName ?? "Vibe Racing";
  const bundleIdentifier = options.macBundleIdentifier ?? "com.viberacing.connector";
  const urlScheme = options.urlScheme ?? "viberacing";
  if (!/^[A-Za-z0-9._ -]{1,80}$/.test(appName)) throw new Error("Invalid macOS app name");
  if (!/^[A-Za-z0-9.-]{3,160}$/.test(bundleIdentifier))
    throw new Error("Invalid macOS bundle identifier");
  if (!/^[A-Za-z][A-Za-z0-9+.-]{0,63}$/.test(urlScheme))
    throw new Error("Invalid macOS URL scheme");
  return { appName, bundleIdentifier, urlScheme };
}

async function macRegistrationStatus(homeDirectory, options = {}) {
  const { appName } = macHandlerOptions(options);
  const app = join(homeDirectory, "Applications", `${appName}.app`);
  const markerPath = join(app, "Contents", "Resources", "viberacing-owned");
  const owned = await existingOwned(markerPath);
  if (owned === true) return "current";
  try {
    await access(app);
    return "foreign";
  } catch (error) {
    if (error?.code === "ENOENT") return "missing";
    throw error;
  }
}

async function macRegistrationDetails(homeDirectory, options = {}) {
  const { appName } = macHandlerOptions(options);
  const app = join(homeDirectory, "Applications", `${appName}.app`);
  try {
    return ownedHandlerDetails(
      await readFile(join(app, "Contents", "Resources", "viberacing-owned"), "utf8"),
    );
  } catch (error) {
    if (error?.code === "ENOENT") {
      try {
        await access(app);
        return { protocol: 0, runtimeVersion: null, status: "foreign" };
      } catch (accessError) {
        if (accessError?.code === "ENOENT")
          return { protocol: 0, runtimeVersion: null, status: "missing" };
        throw accessError;
      }
    }
    throw error;
  }
}

async function registerMac(installedScript, execute, homeDirectory, runtimeExecutable, options) {
  const { appName, bundleIdentifier, urlScheme } = macHandlerOptions(options);
  const applications = join(homeDirectory, "Applications");
  const app = join(applications, `${appName}.app`);
  const status = await macRegistrationStatus(homeDirectory, options);
  if (status === "foreign") return false;
  await mkdir(applications, { recursive: true, mode: 0o700 });
  const stagingRoot = await mkdtemp(join(applications, ".viberacing-browser-handler-"));
  const stagedApp = join(stagingRoot, `${appName}.app`);
  const backupApp = join(applications, `.${appName}.${process.pid}.${randomUUID()}.backup.app`);
  const registrar =
    "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
  let previousMoved = false;
  let stagedInstalled = false;
  try {
    const script = [
      "on open location incomingURL",
      `set commandText to "/usr/bin/nohup " & quoted form of ${appleScriptString(runtimeExecutable)} & " " & quoted form of ${appleScriptString(installedScript)} & " handle-url " & quoted form of incomingURL & " --quiet >/dev/null 2>&1 &"`,
      "do shell script commandText",
      "end open location",
    ].join("\n");
    await execute("/usr/bin/osacompile", ["-o", stagedApp, "-e", script]);
    const contents = join(stagedApp, "Contents");
    const resources = join(contents, "Resources");
    const markerPath = join(resources, "viberacing-owned");
    await access(join(contents, "MacOS", "applet"));
    await mkdir(resources, { recursive: true, mode: 0o700 });
    await writeFile(
      join(contents, "Info.plist"),
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleDevelopmentRegion</key><string>en</string>
<key>CFBundleExecutable</key><string>applet</string>
<key>CFBundleIconFile</key><string>applet</string>
<key>CFBundleIdentifier</key><string>${xmlEscape(bundleIdentifier)}</string>
<key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
<key>CFBundleName</key><string>${xmlEscape(appName)}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${connectorVersion}</string>
<key>CFBundleSignature</key><string>aplt</string>
<key>CFBundleVersion</key><string>${connectorVersion}</string>
<key>CFBundleURLTypes</key><array><dict>
<key>CFBundleTypeRole</key><string>Viewer</string>
<key>CFBundleURLName</key><string>${xmlEscape(bundleIdentifier)}</string>
<key>CFBundleURLSchemes</key><array><string>${xmlEscape(urlScheme)}</string></array>
</dict></array>
<key>LSUIElement</key><true/>
<key>OSAAppletShowStartupScreen</key><false/>
</dict></plist>
`,
      { mode: 0o600 },
    );
    await writeFile(markerPath, `${handlerMarker}\n`, { mode: 0o600 });
    await chmod(stagedApp, 0o700);
    await chmod(contents, 0o700);
    await chmod(join(contents, "MacOS"), 0o700);
    await chmod(resources, 0o700);
    await chmod(join(contents, "MacOS", "applet"), 0o700);
    await execute("/usr/bin/plutil", ["-lint", join(contents, "Info.plist")]);
    await execute("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", stagedApp]);
    await execute("/usr/bin/codesign", ["--verify", "--deep", "--strict", stagedApp]);
    if (status === "current") {
      await rename(app, backupApp);
      previousMoved = true;
    }
    await rename(stagedApp, app);
    stagedInstalled = true;
    await execute(registrar, ["-f", app]);
    if (previousMoved) {
      await execute(registrar, ["-u", backupApp]).catch(() => {});
      await rm(backupApp, { recursive: true, force: true });
      previousMoved = false;
    }
    return true;
  } catch (error) {
    if (stagedInstalled) await rm(app, { recursive: true, force: true }).catch(() => {});
    if (previousMoved) {
      try {
        await rename(backupApp, app);
        previousMoved = false;
        await execute(registrar, ["-f", app]).catch(() => {});
      } catch {}
    }
    throw error;
  } finally {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function registerWindows(installedScript, execute, environment, runtimeExecutable) {
  const systemRoot = environment.SystemRoot?.trim();
  if (!systemRoot || !win32.isAbsolute(systemRoot)) return false;
  const registry = win32.join(systemRoot, "System32", "reg.exe");
  const key = "HKCU\\Software\\Classes\\viberacing";
  let existing = true;
  try {
    await execute(registry, ["QUERY", key]);
  } catch (error) {
    if (error?.code !== 1) throw error;
    existing = false;
  }
  if (existing) {
    try {
      const result = await execute(registry, ["QUERY", key, "/v", "VibeRacingOwned"]);
      if (!result.stdout.includes(ownershipMarker)) return false;
    } catch (error) {
      if (error?.code === 1) return false;
      throw error;
    }
  }
  const command = `${windowsCommandQuote(runtimeExecutable)} ${windowsCommandQuote(installedScript)} handle-url "%1"`;
  try {
    await execute(registry, ["ADD", key, "/ve", "/d", "URL:Vibe Racing", "/f"]);
    await execute(registry, ["ADD", key, "/v", "URL Protocol", "/d", "", "/f"]);
    await execute(registry, ["ADD", key, "/v", "VibeRacingOwned", "/d", handlerMarker, "/f"]);
    await execute(registry, ["ADD", `${key}\\shell\\open\\command`, "/ve", "/d", command, "/f"]);
  } catch (error) {
    if (!existing) await execute(registry, ["DELETE", key, "/f"]).catch(() => {});
    throw error;
  }
  return true;
}

async function registerLinux(installedScript, execute, environment, stateRoot, homeDirectory) {
  const dataHome = environment.XDG_DATA_HOME?.trim() || join(homeDirectory, ".local", "share");
  const desktop = resolve(dataHome, "applications", "viberacing-url.desktop");
  const owned = await existingOwned(desktop);
  if (owned === false) return false;
  const previousPath = join(stateRoot, "browser-handler.json");
  const current = (
    await execute("xdg-mime", ["query", "default", "x-scheme-handler/viberacing"])
  ).stdout.trim();
  if (current !== "" && !/^[A-Za-z0-9._-]+\.desktop$/.test(current)) return false;
  if (owned === true && current !== "" && current !== "viberacing-url.desktop") return false;
  if (owned === null && current !== "" && current !== "viberacing-url.desktop") {
    await mkdir(stateRoot, { recursive: true, mode: 0o700 });
    await writeFile(previousPath, `${JSON.stringify({ previous: current })}\n`, { mode: 0o600 });
  }
  await mkdir(dirname(desktop), { recursive: true, mode: 0o700 });
  await writeFile(
    desktop,
    `[Desktop Entry]\n# ${handlerMarker}\nType=Application\nName=Vibe Racing\nNoDisplay=true\nExec=${desktopQuote(process.execPath)} ${desktopQuote(installedScript)} handle-url %u\nMimeType=x-scheme-handler/viberacing;\n`,
    { mode: 0o600 },
  );
  await execute("xdg-mime", ["default", "viberacing-url.desktop", "x-scheme-handler/viberacing"]);
  return true;
}

export async function registerBrowserSync(installedScript, options = {}) {
  const stateRoot = options.stateDirectory ?? stateDirectory;
  if (!options.allowCustomState && resolve(stateRoot) !== resolve(join(homedir(), ".viberacing")))
    return false;
  const execute = options.execute ?? run;
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const homeDirectory = options.homeDirectory ?? homedir();
  const runtimeExecutable = options.runtimeExecutable ?? process.execPath;
  try {
    if (platform === "darwin")
      return await registerMac(installedScript, execute, homeDirectory, runtimeExecutable, options);
    if (platform === "win32")
      return await registerWindows(installedScript, execute, environment, runtimeExecutable);
    return await registerLinux(installedScript, execute, environment, stateRoot, homeDirectory);
  } catch {
    return false;
  }
}

export async function unregisterBrowserSync(options = {}) {
  const execute = options.execute ?? run;
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const stateRoot = options.stateDirectory ?? stateDirectory;
  const homeDirectory = options.homeDirectory ?? homedir();
  if (!options.allowCustomState && resolve(stateRoot) !== resolve(join(homedir(), ".viberacing")))
    return;
  if (platform === "darwin") {
    const { appName } = macHandlerOptions(options);
    const app = join(homeDirectory, "Applications", `${appName}.app`);
    if ((await existingOwned(join(app, "Contents", "Resources", "viberacing-owned"))) === true) {
      const registrar =
        "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
      await execute(registrar, ["-u", app]).catch(() => {});
      await rm(app, { recursive: true, force: true });
    }
    return;
  }
  if (platform === "win32") {
    const systemRoot = environment.SystemRoot?.trim();
    if (!systemRoot || !win32.isAbsolute(systemRoot)) return;
    const registry = win32.join(systemRoot, "System32", "reg.exe");
    const key = "HKCU\\Software\\Classes\\viberacing";
    try {
      const result = await execute(registry, ["QUERY", key, "/v", "VibeRacingOwned"]);
      if (result.stdout.includes(ownershipMarker)) await execute(registry, ["DELETE", key, "/f"]);
    } catch (error) {
      if (error?.code !== 1) throw error;
    }
    return;
  }
  const dataHome = environment.XDG_DATA_HOME?.trim() || join(homeDirectory, ".local", "share");
  const desktop = resolve(dataHome, "applications", "viberacing-url.desktop");
  if ((await existingOwned(desktop)) === true) {
    let current = null;
    try {
      current = (
        await execute("xdg-mime", ["query", "default", "x-scheme-handler/viberacing"])
      ).stdout.trim();
    } catch {}
    try {
      const record = JSON.parse(await readFile(join(stateRoot, "browser-handler.json"), "utf8"));
      if (
        current === "viberacing-url.desktop" &&
        /^[A-Za-z0-9._-]+\.desktop$/.test(record?.previous)
      ) {
        await execute("xdg-mime", ["default", record.previous, "x-scheme-handler/viberacing"]);
      }
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    await rm(desktop, { force: true });
    await rm(join(stateRoot, "browser-handler.json"), { force: true });
  }
}

export async function browserSyncRegistrationStatus(options = {}) {
  return (await browserSyncHandlerAttestation(options)).status;
}

export async function browserSyncHandlerAttestation(options = {}) {
  const execute = options.execute ?? run;
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const homeDirectory = options.homeDirectory ?? homedir();
  if (environment.NODE_ENV === "test") {
    const synthetic = environment.VIBERACING_TEST_BROWSER_HANDLER_INSPECTION;
    if (synthetic === "current")
      return {
        protocol: browserSyncProtocolVersion,
        runtimeVersion: connectorVersion,
        status: "current",
      };
    if (synthetic === "legacy") return { protocol: 1, runtimeVersion: null, status: "outdated" };
    if (synthetic === "missing" || synthetic === "foreign")
      return { protocol: 0, runtimeVersion: null, status: synthetic };
    if (synthetic === "error_eacces") {
      const error = new Error("Synthetic browser handler inspection failure");
      error.code = "EACCES";
      throw error;
    }
  }
  if (platform === "darwin") {
    return macRegistrationDetails(homeDirectory, options);
  }
  if (platform === "linux") {
    const dataHome = environment.XDG_DATA_HOME?.trim() || join(homeDirectory, ".local", "share");
    const desktop = resolve(dataHome, "applications", "viberacing-url.desktop");
    let contents;
    try {
      contents = await readFile(desktop, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return { protocol: 0, runtimeVersion: null, status: "missing" };
      throw error;
    }
    const details = ownedHandlerDetails(contents);
    if (details.status === "foreign") return details;
    try {
      const current = await execute("xdg-mime", [
        "query",
        "default",
        "x-scheme-handler/viberacing",
      ]);
      const value = current.stdout.trim();
      return value === "viberacing-url.desktop"
        ? details
        : { protocol: 0, runtimeVersion: null, status: value === "" ? "missing" : "foreign" };
    } catch (error) {
      throw error;
    }
  }
  const systemRoot = environment.SystemRoot?.trim();
  if (!systemRoot || !win32.isAbsolute(systemRoot))
    return { protocol: 0, runtimeVersion: null, status: "missing" };
  const registry = win32.join(systemRoot, "System32", "reg.exe");
  const key = "HKCU\\Software\\Classes\\viberacing";
  try {
    await execute(registry, ["QUERY", key]);
  } catch (error) {
    if (error?.code === 1) return { protocol: 0, runtimeVersion: null, status: "missing" };
    throw error;
  }
  try {
    const result = await execute(registry, ["QUERY", key, "/v", "VibeRacingOwned"]);
    return ownedHandlerDetails(result.stdout);
  } catch (error) {
    if (error?.code === 1) return { protocol: 0, runtimeVersion: null, status: "foreign" };
    throw error;
  }
}

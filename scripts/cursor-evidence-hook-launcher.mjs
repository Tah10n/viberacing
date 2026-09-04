#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const maximumStateBytes = 65_536;
const maximumRuntimeBytes = 2_000_000;
const launcherPath = fileURLToPath(import.meta.url);
const scriptsDirectory = dirname(launcherPath);
const bundleRoot = resolve(scriptsDirectory, "..");
const statePath = join(scriptsDirectory, "viberacing-cursor-evidence-probe-state.json");
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256Pattern = /^[0-9a-f]{64}$/;
const eventNames = new Set(["afterAgentResponse", "stop", "sessionEnd"]);
const surfaces = new Set(["desktop", "cli-interactive", "cli-headless"]);
const scenarios = new Set([
  "desktop-one-turn",
  "cli-interactive-one-turn",
  "cli-headless-one-turn",
  "desktop-cli-same-account",
  "desktop-cli-different-accounts",
  "cli-a-b-a",
  "desktop-a-b-a",
  "subagent",
  "aborted-error",
  "utc-midnight",
]);
const stepPattern = /^(?:single|a1|b|a2|desktop|cli|parent|subagent|before|after)$/;
const hookBundlePrefix = "viberacing-cursor-evidence-";
const ownerOnlyFileEnvironmentVariable = "VIBERACING_CURSOR_EVIDENCE_OWNER_ONLY_FILE";
const ownerOnlyFileVerification = [
  "$ErrorActionPreference='Stop'",
  `$path=$env:${ownerOnlyFileEnvironmentVariable}`,
  "if ([string]::IsNullOrWhiteSpace($path)) { throw 'Missing owner-only file path' }",
  "$entry=Get-Item -LiteralPath $path -Force -ErrorAction Stop",
  "if ($entry.PSIsContainer) { throw 'Owner-only file target is a directory' }",
  "if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Owner-only file is a reparse point' }",
  "$identity=[Security.Principal.WindowsIdentity]::GetCurrent()",
  "$verified=[IO.File]::GetAccessControl($entry.FullName)",
  "$rules=@($verified.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier]))",
  "if (-not $verified.AreAccessRulesProtected) { throw 'Owner-only file ACL inherits access rules' }",
  "if ($verified.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $identity.User.Value) { throw 'Owner-only file ACL owner mismatch' }",
  "if ($rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $identity.User.Value -or $rules[0].AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or (($rules[0].FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -ne [Security.AccessControl.FileSystemRights]::FullControl)) { throw 'Owner-only file ACL is not owner-only' }",
].join("; ");
const encodedOwnerOnlyFileVerification = Buffer.from(ownerOnlyFileVerification, "utf16le").toString(
  "base64",
);
let loadedProbeModule = null;
let loadedConfiguration = null;

function pathInside(parent, candidate) {
  const child = relative(parent, candidate);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

function deterministicInstallationId(value) {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = "8";
  const canonical = hex.join("");
  return `${canonical.slice(0, 8)}-${canonical.slice(8, 12)}-${canonical.slice(12, 16)}-${canonical.slice(16, 20)}-${canonical.slice(20)}`;
}

function inspectOwnerOnlyWindowsFile(path) {
  const systemRoot = process.env.SystemRoot?.trim();
  if (!systemRoot || !win32.isAbsolute(systemRoot) || !win32.isAbsolute(path)) return false;
  const powershell = win32.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  try {
    execFileSync(
      powershell,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        encodedOwnerOnlyFileVerification,
      ],
      {
        env: { ...process.env, [ownerOnlyFileEnvironmentVariable]: win32.resolve(path) },
        stdio: "ignore",
        windowsHide: true,
        timeout: 15_000,
      },
    );
    return true;
  } catch {
    return false;
  }
}

async function readPrivateArtifact(path, maximumBytes) {
  const before = await lstat(path);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.size > maximumBytes ||
    (typeof process.getuid === "function" && before.uid !== process.getuid())
  )
    throw new Error("Cursor evidence launcher artifact is unsafe");
  if (process.platform === "win32") {
    if (!inspectOwnerOnlyWindowsFile(path))
      throw new Error("Cursor evidence launcher artifact has an unsafe Windows ACL");
  } else if ((before.mode & 0o077) !== 0) {
    throw new Error("Cursor evidence launcher artifact is not owner-only");
  }
  const contents = await readFile(path);
  const after = await lstat(path);
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs
  )
    throw new Error("Cursor evidence launcher artifact changed while it was read");
  return contents;
}

async function main() {
  const stateBytes = await readPrivateArtifact(statePath, maximumStateBytes);
  const configuration = JSON.parse(stateBytes.toString("utf8"));
  if (
    configuration?.schemaVersion !== 2 ||
    !uuidPattern.test(configuration.probeId ?? "") ||
    !uuidPattern.test(configuration.installationId ?? "") ||
    typeof configuration.outputDirectory !== "string" ||
    !isAbsolute(configuration.outputDirectory) ||
    typeof configuration.probeScriptPath !== "string" ||
    !surfaces.has(configuration.declaredSurface) ||
    !scenarios.has(configuration.declaredScenario) ||
    !uuidPattern.test(configuration.declaredRunId ?? "") ||
    !stepPattern.test(configuration.declaredStep ?? "") ||
    !eventNames.has(configuration.declaredEvent) ||
    !(
      configuration.expectedEventIdentity === null ||
      (["event_id", "request_id", "generation_id"].includes(
        configuration.expectedEventIdentity?.kind,
      ) &&
        typeof configuration.expectedEventIdentity?.path === "string" &&
        /^evt1_[A-Za-z0-9_-]{43}$/.test(configuration.expectedEventIdentity?.hash ?? ""))
    ) ||
    !(
      configuration.versionPath === null ||
      /^\$\.[A-Za-z_][A-Za-z0-9_]*$/.test(configuration.versionPath ?? "")
    ) ||
    !Array.isArray(configuration.runtimeArtifacts) ||
    configuration.runtimeArtifacts.length < 3 ||
    configuration.runtimeArtifacts.length > 8
  )
    throw new Error("Cursor evidence launcher state is invalid");
  const expectedInstallationId = deterministicInstallationId(
    [
      configuration.probeId,
      configuration.outputDirectory,
      configuration.declaredSurface,
      configuration.declaredScenario,
      configuration.declaredRunId,
      configuration.declaredStep,
      configuration.declaredEvent,
      JSON.stringify(configuration.expectedEventIdentity),
      configuration.versionPath ?? "",
    ].join("\0"),
  );
  if (
    configuration.installationId !== expectedInstallationId ||
    basename(bundleRoot) !==
      `${hookBundlePrefix}${configuration.probeId}-${configuration.installationId}`
  )
    throw new Error("Cursor evidence launcher state is not bound to this runtime bundle");
  const verified = new Map();
  const actualBundleRoot = await realpath(bundleRoot);
  for (const artifact of configuration.runtimeArtifacts) {
    const actualPath =
      typeof artifact?.path === "string" && isAbsolute(artifact.path)
        ? await realpath(artifact.path)
        : null;
    if (
      actualPath === null ||
      !pathInside(actualBundleRoot, actualPath) ||
      !sha256Pattern.test(artifact.sha256 ?? "") ||
      verified.has(actualPath)
    )
      throw new Error("Cursor evidence runtime manifest is invalid");
    const contents = await readPrivateArtifact(actualPath, maximumRuntimeBytes);
    const digest = createHash("sha256").update(contents).digest("hex");
    if (digest !== artifact.sha256)
      throw new Error("Cursor evidence runtime integrity check failed");
    verified.set(actualPath, digest);
  }
  const [actualLauncherPath, actualProbeScriptPath] = await Promise.all([
    realpath(launcherPath),
    realpath(configuration.probeScriptPath),
  ]);
  if (!verified.has(actualLauncherPath) || !verified.has(actualProbeScriptPath))
    throw new Error("Cursor evidence runtime manifest is incomplete");
  const module = await import(pathToFileURL(actualProbeScriptPath).href);
  loadedProbeModule = module;
  loadedConfiguration = configuration;
  await module.captureCursorHook(configuration);
}

main().catch(async (error) => {
  try {
    if (typeof loadedProbeModule?.markHookInvocationFailure === "function")
      await loadedProbeModule.markHookInvocationFailure(loadedConfiguration);
  } catch {
    // Cursor remains fail-open even if the durable failure marker cannot be written.
  }
  if (process.env.VIBERACING_CURSOR_EVIDENCE_DEBUG === "1")
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.stdout.write("{}\n");
  process.exitCode = 0;
});

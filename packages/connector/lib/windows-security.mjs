import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { win32 } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const stateRootEnvironmentVariable = "VIBERACING_WINDOWS_STATE_ACL_ROOT";
const statePathsEnvironmentVariable = "VIBERACING_WINDOWS_STATE_ACL_PATHS";
const ownerOnlyFileEnvironmentVariable = "VIBERACING_WINDOWS_OWNER_ONLY_FILE";
const secureDirectoryScript = [
  "$ErrorActionPreference='Stop'",
  `$root=$env:${stateRootEnvironmentVariable}`,
  `$pathValues=$env:${statePathsEnvironmentVariable}`,
  "if ([string]::IsNullOrWhiteSpace($root)) { throw 'Missing state root' }",
  "if ([string]::IsNullOrWhiteSpace($pathValues)) { throw 'Missing state paths' }",
  "$decodedPaths=ConvertFrom-Json -InputObject $pathValues",
  "$paths=@()",
  "foreach ($value in $decodedPaths) { $paths += [string]$value }",
  "if ($paths.Count -eq 0) { throw 'Missing state paths' }",
  "if ($paths[0] -ne $root) { throw 'State paths do not start with the state root' }",
  "if ([IO.Directory]::Exists($root) -and ((Get-Item -LiteralPath $root -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'State directory is a reparse point' }",
  "if ([IO.File]::Exists($root)) { throw 'State directory target is a file' }",
  "[IO.Directory]::CreateDirectory($root) | Out-Null",
  "$items=@(Get-Item -LiteralPath $root -Force)",
  "for ($index=1; $index -lt $paths.Count; $index++) { $item=Get-Item -LiteralPath $paths[$index] -Force -ErrorAction SilentlyContinue; if ($null -ne $item) { $items += $item } }",
  "if (-not $items[0].PSIsContainer) { throw 'State directory is not a real directory' }",
  "if (@($items | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count -ne 0) { throw 'State paths contain a reparse point' }",
  "$identity=[Security.Principal.WindowsIdentity]::GetCurrent()",
  "foreach ($entry in $items) {",
  "  if ($entry.PSIsContainer) { $acl=New-Object Security.AccessControl.DirectorySecurity; $rule=New-Object Security.AccessControl.FileSystemAccessRule($identity.User,'FullControl','ContainerInherit,ObjectInherit','None','Allow') } else { $acl=New-Object Security.AccessControl.FileSecurity; $rule=New-Object Security.AccessControl.FileSystemAccessRule($identity.User,'FullControl','None','None','Allow') }",
  "  $acl.SetOwner($identity.User)",
  "  $acl.SetAccessRuleProtection($true,$false)",
  "  [void]$acl.AddAccessRule($rule)",
  "  try { if ($entry.PSIsContainer) { [IO.Directory]::SetAccessControl($entry.FullName,$acl) } else { [IO.File]::SetAccessControl($entry.FullName,$acl) } } catch { if (-not (Test-Path -LiteralPath $entry.FullName)) { continue }; throw }",
  "}",
  "foreach ($originalEntry in $items) {",
  "  $entry=Get-Item -LiteralPath $originalEntry.FullName -Force -ErrorAction SilentlyContinue",
  "  if ($null -eq $entry) { continue }",
  "  if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'State entry changed into a reparse point' }",
  "  if ($entry.PSIsContainer) { $verified=[IO.Directory]::GetAccessControl($entry.FullName) } else { $verified=[IO.File]::GetAccessControl($entry.FullName) }",
  "  $rules=@($verified.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier]))",
  "  if (-not $verified.AreAccessRulesProtected) { throw 'State ACL still inherits access rules' }",
  "  if ($verified.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $identity.User.Value) { throw 'State ACL owner mismatch' }",
  "  if ($rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $identity.User.Value -or $rules[0].AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or (($rules[0].FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -ne [Security.AccessControl.FileSystemRights]::FullControl)) { throw 'State ACL is not owner-only' }",
  "}",
].join("; ");
const encodedSecureDirectoryScript = Buffer.from(secureDirectoryScript, "utf16le").toString(
  "base64",
);
const ownerOnlyFileVerification = [
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
];
const inspectOwnerOnlyFileScript = [
  "$ErrorActionPreference='Stop'",
  ...ownerOnlyFileVerification,
].join("; ");
const secureOwnerOnlyFileScript = [
  "$ErrorActionPreference='Stop'",
  `$path=$env:${ownerOnlyFileEnvironmentVariable}`,
  "if ([string]::IsNullOrWhiteSpace($path)) { throw 'Missing owner-only file path' }",
  "$entry=Get-Item -LiteralPath $path -Force -ErrorAction Stop",
  "if ($entry.PSIsContainer) { throw 'Owner-only file target is a directory' }",
  "if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Owner-only file is a reparse point' }",
  "$identity=[Security.Principal.WindowsIdentity]::GetCurrent()",
  "$acl=New-Object Security.AccessControl.FileSecurity",
  "$rule=New-Object Security.AccessControl.FileSystemAccessRule($identity.User,'FullControl','None','None','Allow')",
  "$acl.SetOwner($identity.User)",
  "$acl.SetAccessRuleProtection($true,$false)",
  "[void]$acl.AddAccessRule($rule)",
  "[IO.File]::SetAccessControl($entry.FullName,$acl)",
  ...ownerOnlyFileVerification,
].join("; ");
const encodedInspectOwnerOnlyFileScript = Buffer.from(
  inspectOwnerOnlyFileScript,
  "utf16le",
).toString("base64");
const encodedSecureOwnerOnlyFileScript = Buffer.from(secureOwnerOnlyFileScript, "utf16le").toString(
  "base64",
);

function timedOutWindowsProcess(error) {
  return error?.killed === true && error?.signal === "SIGTERM";
}

async function runWindowsSecurityScript(
  path,
  encodedScript,
  { platform = process.platform, run = execFileAsync, environment = process.env } = {},
) {
  if (platform !== "win32") return;
  const systemRoot = environment.SystemRoot?.trim();
  if (!systemRoot || !win32.isAbsolute(systemRoot))
    throw new Error("SystemRoot is unavailable or is not absolute");
  if (typeof path !== "string" || !win32.isAbsolute(path))
    throw new Error("The Windows owner-only file path must be absolute");
  const powershell = win32.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const arguments_ = ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodedScript];
  const options = {
    env: {
      ...environment,
      [ownerOnlyFileEnvironmentVariable]: win32.resolve(path),
    },
    windowsHide: true,
    timeout: 15_000,
  };
  try {
    await run(powershell, arguments_, options);
  } catch (error) {
    if (!timedOutWindowsProcess(error)) throw error;
    await run(powershell, arguments_, options);
  }
}

export async function inspectOwnerOnlyWindowsFile(path, options = {}) {
  if ((options.platform ?? process.platform) !== "win32") return true;
  try {
    await runWindowsSecurityScript(path, encodedInspectOwnerOnlyFileScript, options);
    return true;
  } catch {
    return false;
  }
}

export async function ensureOwnerOnlyWindowsFile(path, options = {}) {
  if ((options.platform ?? process.platform) !== "win32") return;
  try {
    await runWindowsSecurityScript(path, encodedSecureOwnerOnlyFileScript, options);
  } catch (error) {
    throw new Error("Vibe Racing cannot enforce an owner-only Windows ACL on its OpenCode plugin", {
      cause: error,
    });
  }
}

export async function ensurePrivateStateDirectory(
  directory,
  {
    platform = process.platform,
    run = execFileAsync,
    environment = process.env,
    paths = [directory],
  } = {},
) {
  if (platform !== "win32") {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    return;
  }
  try {
    const systemRoot = environment.SystemRoot?.trim();
    if (!systemRoot || !win32.isAbsolute(systemRoot)) {
      throw new Error("SystemRoot is unavailable or is not absolute");
    }
    if (typeof directory !== "string" || !win32.isAbsolute(directory)) {
      throw new Error("The Windows state directory must be absolute");
    }
    const normalizedDirectory = win32.resolve(directory);
    const normalizedPaths = [...new Set(paths.map((path) => win32.resolve(path)))];
    if (
      normalizedPaths.length === 0 ||
      normalizedPaths[0] !== normalizedDirectory ||
      normalizedPaths.some(
        (path) =>
          path !== normalizedDirectory &&
          !win32.relative(normalizedDirectory, path).match(/^(?!\.\.(?:\\|$))(?![A-Za-z]:)/),
      )
    ) {
      throw new Error("Windows state ACL paths must stay within the state directory");
    }
    const powershell = win32.join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const arguments_ = [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      encodedSecureDirectoryScript,
    ];
    const options = {
      env: {
        ...environment,
        [stateRootEnvironmentVariable]: normalizedDirectory,
        [statePathsEnvironmentVariable]: JSON.stringify(normalizedPaths),
      },
      windowsHide: true,
      timeout: 15_000,
    };
    try {
      await run(powershell, arguments_, options);
    } catch (error) {
      if (!timedOutWindowsProcess(error)) throw error;
      await run(powershell, arguments_, options);
    }
  } catch (error) {
    throw new Error(
      "Vibe Racing cannot enforce an owner-only Windows ACL on its state directory; choose a private VIBERACING_STATE_DIR",
      { cause: error },
    );
  }
}

import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { win32 } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const stateDirectoryEnvironmentVariable = "VIBERACING_WINDOWS_STATE_ACL_TARGET";
const secureDirectoryScript = [
  "$ErrorActionPreference='Stop'",
  `$path=$env:${stateDirectoryEnvironmentVariable}`,
  "if ([string]::IsNullOrWhiteSpace($path)) { throw 'Missing state directory target' }",
  "[IO.Directory]::CreateDirectory($path) | Out-Null",
  "$identity=[Security.Principal.WindowsIdentity]::GetCurrent()",
  "$acl=New-Object Security.AccessControl.DirectorySecurity",
  "$acl.SetOwner($identity.User)",
  "$rule=New-Object Security.AccessControl.FileSystemAccessRule($identity.User,'FullControl','ContainerInherit,ObjectInherit','None','Allow')",
  "$acl.SetAccessRuleProtection($true,$false)",
  "[void]$acl.AddAccessRule($rule)",
  "[IO.Directory]::SetAccessControl($path,$acl)",
  "$verified=[IO.Directory]::GetAccessControl($path)",
  "$rules=@($verified.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier]))",
  "if (-not $verified.AreAccessRulesProtected) { throw 'State ACL still inherits access rules' }",
  "if ($verified.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $identity.User.Value) { throw 'State ACL owner mismatch' }",
  "if ($rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $identity.User.Value -or $rules[0].AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or (($rules[0].FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -ne [Security.AccessControl.FileSystemRights]::FullControl)) { throw 'State ACL is not owner-only' }",
].join("; ");
const encodedSecureDirectoryScript = Buffer.from(secureDirectoryScript, "utf16le").toString(
  "base64",
);

function timedOutWindowsProcess(error) {
  return error?.killed === true && error?.signal === "SIGTERM";
}

export async function ensurePrivateStateDirectory(
  directory,
  { platform = process.platform, run = execFileAsync, environment = process.env } = {},
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
      env: { ...environment, [stateDirectoryEnvironmentVariable]: directory },
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

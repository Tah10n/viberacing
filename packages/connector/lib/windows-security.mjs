import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { win32 } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const secureDirectoryScript = [
  "$ErrorActionPreference='Stop'",
  "$path=$args[0]",
  "[IO.Directory]::CreateDirectory($path) | Out-Null",
  "$identity=[Security.Principal.WindowsIdentity]::GetCurrent()",
  "$acl=New-Object Security.AccessControl.DirectorySecurity",
  "$acl.SetOwner($identity.User)",
  "$rule=New-Object Security.AccessControl.FileSystemAccessRule($identity.User,'FullControl','ContainerInherit,ObjectInherit','None','Allow')",
  "$acl.SetAccessRuleProtection($true,$false)",
  "[void]$acl.AddAccessRule($rule)",
  "[IO.Directory]::SetAccessControl($path,$acl)",
].join("; ");

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
    const powershell = win32.join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    await run(
      powershell,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", secureDirectoryScript, directory],
      { windowsHide: true, timeout: 15_000 },
    );
  } catch (error) {
    throw new Error(
      "Vibe Racing cannot enforce an owner-only Windows ACL on its state directory; choose a private VIBERACING_STATE_DIR",
      { cause: error },
    );
  }
}

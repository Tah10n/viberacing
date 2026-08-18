import { spawn } from "node:child_process";
import { win32 } from "node:path";

export function openBrowser(
  url,
  { platform = process.platform, environment = process.env, spawnImplementation = spawn } = {},
) {
  const parsed = new URL(url);
  if (!["https:", "http:"].includes(parsed.protocol))
    throw new Error("Browser URL must use HTTP(S)");
  let program;
  if (platform === "darwin") program = "open";
  else if (platform === "win32") {
    const systemRoot = environment.SystemRoot?.trim();
    if (!systemRoot || !win32.isAbsolute(systemRoot))
      throw new Error("SystemRoot is unavailable or is not absolute");
    program = win32.join(systemRoot, "explorer.exe");
  } else program = "xdg-open";
  const arguments_ = [parsed.href];
  const child = spawnImplementation(program, arguments_, {
    detached: true,
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  });
  child.on("error", () => {});
  child.unref();
  return child;
}

import { spawn } from "node:child_process";

export function openBrowser(url) {
  const parsed = new URL(url);
  if (!["https:", "http:"].includes(parsed.protocol))
    throw new Error("Browser URL must use HTTP(S)");
  const program =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? `${process.env.SystemRoot ?? "C:\\Windows"}\\explorer.exe`
        : "xdg-open";
  const arguments_ = [parsed.href];
  const child = spawn(program, arguments_, { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => {});
  child.unref();
  return child;
}

import { spawn } from "node:child_process";

export function openBrowser(url) {
  const program =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const arguments_ = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(program, arguments_, { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => {});
  child.unref();
  return child;
}

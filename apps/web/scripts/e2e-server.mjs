import { execFileSync, spawn } from "node:child_process";
import { cp } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const next = resolve(root, "node_modules/next/dist/bin/next");
execFileSync(process.execPath, [resolve(root, "scripts/package-connector.mjs")], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});
execFileSync(process.execPath, [next, "build"], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});
const standaloneRoot = resolve(root, ".next/standalone/apps/web");
await cp(resolve(root, ".next/static"), resolve(standaloneRoot, ".next/static"), {
  recursive: true,
  force: true,
});
await cp(resolve(root, "public"), resolve(standaloneRoot, "public"), {
  recursive: true,
  force: true,
});
const child = spawn(process.execPath, [resolve(standaloneRoot, "server.js")], {
  cwd: standaloneRoot,
  env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: "3015" },
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}
child.once("error", (error) => {
  throw error;
});
child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});

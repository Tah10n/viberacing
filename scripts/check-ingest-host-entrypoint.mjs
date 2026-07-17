import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const entrypoint = resolve(root, "apps", "ingest-host", "dist", "main.js");
const result = spawnSync(process.execPath, [entrypoint], {
  cwd: root,
  encoding: "utf8",
  env: Object.freeze({ NODE_ENV: "invalid" }),
  timeout: 5_000,
  windowsHide: true,
});

if (
  result.error !== undefined ||
  result.status !== 1 ||
  result.signal !== null ||
  result.stdout !== "" ||
  result.stderr !== ""
) {
  console.error("Built Ingest host entry point did not fail closed and silent.");
  process.exit(1);
}

console.log("Built Ingest host entry point failed closed without reflective output.");

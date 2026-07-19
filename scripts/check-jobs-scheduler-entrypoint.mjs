import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const entrypoint = resolve(root, "apps", "jobs-scheduler", "dist", "main.js");
for (const testCase of [
  Object.freeze({ argumentsValue: [], enabled: "false" }),
  Object.freeze({ argumentsValue: ["unexpected"], enabled: "true" }),
]) {
  const result = spawnSync(process.execPath, [entrypoint, ...testCase.argumentsValue], {
    cwd: root,
    encoding: "utf8",
    env: Object.freeze({ VIBERACING_JOBS_SCHEDULER_ENABLED: testCase.enabled }),
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
    console.error("Built Jobs scheduler entry point did not fail closed and silent.");
    process.exit(1);
  }
}

console.log("Built Jobs scheduler entry point rejected disabled and argument-bearing startup.");

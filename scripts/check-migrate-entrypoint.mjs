import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const entryPoint = resolve(root, "apps", "migrate", "dist", "main.js");

function run(arguments_, environment) {
  const result = spawnSync(process.execPath, [entryPoint, ...arguments_], {
    cwd: root,
    encoding: "utf8",
    env: environment,
    maxBuffer: 4 * 1024,
    timeout: 5_000,
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(
      "Built migration entry point did not settle within its closed startup boundary.",
    );
  }
  return result;
}

const disabled = run([], { NODE_ENV: "production" });
if (
  disabled.status !== 1 ||
  disabled.signal !== null ||
  disabled.stdout !== "" ||
  disabled.stderr !== "Vibe Racing migrations are disabled.\n"
) {
  throw new Error(
    "Built migration entry point did not fail closed before protected configuration.",
  );
}

const enabledWithoutConfiguration = run([], {
  NODE_ENV: "production",
  VIBERACING_MIGRATIONS_ENABLED: "true",
});
if (
  enabledWithoutConfiguration.status !== 1 ||
  enabledWithoutConfiguration.signal !== null ||
  enabledWithoutConfiguration.stdout !== "" ||
  enabledWithoutConfiguration.stderr !== "Vibe Racing migrations failed.\n"
) {
  throw new Error(
    "Built migration entry point reflected or bypassed missing protected configuration.",
  );
}

const widenedArguments = run(["--force"], {
  NODE_ENV: "production",
  VIBERACING_MIGRATIONS_ENABLED: "true",
});
if (
  widenedArguments.status !== 1 ||
  widenedArguments.signal !== null ||
  widenedArguments.stdout !== "" ||
  widenedArguments.stderr !== "Vibe Racing migrations failed.\n"
) {
  throw new Error("Built migration entry point accepted a widened command surface.");
}

console.log("Built migration entry point fails closed across disabled and invalid startup paths.");

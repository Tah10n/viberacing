#!/usr/bin/env node

import { lstat, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const maximumStateBytes = 65_536;
const statePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "viberacing-cursor-evidence-probe-state.json",
);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function main() {
  const info = await lstat(statePath);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > maximumStateBytes)
    throw new Error("Cursor evidence launcher state is unsafe");
  if (typeof process.getuid === "function" && info.uid !== process.getuid())
    throw new Error("Cursor evidence launcher state has another owner");
  if (process.platform !== "win32" && (info.mode & 0o077) !== 0)
    throw new Error("Cursor evidence launcher state is not owner-only");
  const configuration = JSON.parse(await readFile(statePath, "utf8"));
  if (
    configuration?.schemaVersion !== 1 ||
    !uuidPattern.test(configuration.probeId ?? "") ||
    typeof configuration.outputDirectory !== "string" ||
    typeof configuration.probeScriptPath !== "string" ||
    typeof configuration.declaredSurface !== "string" ||
    typeof configuration.declaredScenario !== "string" ||
    !uuidPattern.test(configuration.declaredRunId ?? "") ||
    typeof configuration.declaredStep !== "string"
  )
    throw new Error("Cursor evidence launcher state is invalid");
  const module = await import(pathToFileURL(configuration.probeScriptPath).href);
  await module.captureCursorHook(configuration);
}

main().catch(() => {
  process.stdout.write("{}\n");
  process.exitCode = 0;
});

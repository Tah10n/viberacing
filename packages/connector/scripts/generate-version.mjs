import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
const outputPath = resolve(packageRoot, "lib/version.mjs");
const contents =
  "// Generated from packages/connector/package.json; do not edit by hand.\n" +
  `export const connectorVersion = ${JSON.stringify(packageJson.version)};\n`;

if (process.argv.includes("--check")) {
  if ((await readFile(outputPath, "utf8")) !== contents) {
    throw new Error("Generated connector version does not match package.json");
  }
} else {
  await writeFile(outputPath, contents);
}

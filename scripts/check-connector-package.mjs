import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = "packages/connector";
const repositoryLicense = readFileSync(resolve(root, "LICENSE"));
const packageLicense = readFileSync(resolve(root, packageRoot, "LICENSE"));
if (!repositoryLicense.equals(packageLicense)) {
  throw new Error("Connector LICENSE must exactly match the repository LICENSE");
}

const cache = mkdtempSync(join(tmpdir(), "viberacing-npm-cache-"));
let output;
try {
  output = execFileSync("npm", ["pack", "--dry-run", "--json", `./${packageRoot}`], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, npm_config_cache: cache },
  });
} finally {
  rmSync(cache, { force: true, recursive: true });
}
const results = JSON.parse(output);

if (results.length !== 1 || !Array.isArray(results[0]?.files)) {
  throw new Error("npm pack returned an unexpected package manifest");
}

const paths = results[0].files.map(({ path }) => path.replaceAll("\\", "/"));
const files = new Set(paths);
const requiredFiles = ["LICENSE", "README.md", "package.json", "bin/viberacing.mjs"];

for (const required of requiredFiles) {
  if (!files.has(required)) {
    throw new Error(`Connector package is missing required file: ${required}`);
  }
}

const forbiddenDirectoryNames = new Set([
  ".nyc_output",
  "coverage",
  "diagnostics",
  "temp",
  "test",
  "tests",
  "tmp",
]);
const forbiddenExactNames = new Set([".ds_store", ".npmrc", ".pnpmrc", ".yarnrc"]);

for (const path of paths) {
  const segments = path.split("/");
  const name = segments.at(-1) ?? "";
  const lowerName = name.toLowerCase();
  const isLocalConfig =
    lowerName.includes(".local.") ||
    lowerName.endsWith(".local") ||
    lowerName.startsWith("local-config.");
  const isTemporaryOrDiagnostic =
    lowerName.endsWith(".log") ||
    lowerName.endsWith(".swp") ||
    lowerName.endsWith(".swo") ||
    lowerName.endsWith(".temp") ||
    lowerName.endsWith(".tmp") ||
    lowerName.startsWith("diagnostic");

  if (
    segments.some((segment) => forbiddenDirectoryNames.has(segment.toLowerCase())) ||
    segments.some((segment) => segment.toLowerCase().startsWith(".env")) ||
    forbiddenExactNames.has(lowerName) ||
    isLocalConfig ||
    isTemporaryOrDiagnostic
  ) {
    throw new Error(`Connector package contains forbidden file: ${path}`);
  }
}

process.stdout.write(
  `Connector package manifest passed: ${paths.length} files checked from ${packageRoot}.\n`,
);

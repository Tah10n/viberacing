import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = "packages/connector";
const packageJson = JSON.parse(readFileSync(resolve(root, packageRoot, "package.json"), "utf8"));
if (packageJson.name !== "@viberacing/connector") {
  throw new Error("Connector package name must be @viberacing/connector");
}
if (packageJson.private === true) {
  throw new Error("Connector package must not be private");
}
if (
  packageJson.publishConfig?.access !== "public" ||
  packageJson.publishConfig?.registry !== "https://registry.npmjs.org"
) {
  throw new Error("Connector publishConfig must use the public npm registry");
}
if (
  packageJson.repository?.type !== "git" ||
  packageJson.repository?.url !== "git+https://github.com/Tah10n/viberacing.git" ||
  packageJson.repository?.directory !== packageRoot
) {
  throw new Error("Connector repository metadata must point to Tah10n/viberacing");
}
if (
  Object.keys(packageJson.bin ?? {}).length !== 1 ||
  packageJson.bin?.viberacing !== "bin/viberacing.mjs"
) {
  throw new Error("Connector package must expose only the viberacing binary");
}
if (JSON.stringify(packageJson.files) !== JSON.stringify(["bin", "lib", "scripts", "README.md"])) {
  throw new Error("Connector package files allowlist changed unexpectedly");
}
if (Object.keys(packageJson.dependencies ?? {}).length > 0) {
  throw new Error("Connector package must not add runtime dependencies without review");
}
const protocolPattern = /export const connectorProtocolVersion = ([1-9]\d*);/;
const connectorProtocol = readFileSync(
  resolve(root, packageRoot, "lib/protocol.mjs"),
  "utf8",
).match(protocolPattern)?.[1];
const serverProtocol = readFileSync(resolve(root, "apps/web/lib/config.ts"), "utf8").match(
  protocolPattern,
)?.[1];
if (connectorProtocol === undefined || connectorProtocol !== serverProtocol) {
  throw new Error("Connector and server current protocol versions do not match");
}
execFileSync(
  process.execPath,
  [resolve(root, packageRoot, "scripts/generate-version.mjs"), "--check"],
  {
    cwd: root,
  },
);
const cliVersion = execFileSync(
  process.execPath,
  [resolve(root, packageRoot, "bin/viberacing.mjs"), "--version"],
  { cwd: root, encoding: "utf8" },
).trim();
if (cliVersion !== packageJson.version) {
  throw new Error("Connector CLI version does not match package.json");
}
for (const relativePath of ["bin/viberacing.mjs", "lib/adapters/codex.mjs"]) {
  const source = readFileSync(resolve(root, packageRoot, relativePath), "utf8");
  if (
    !source.includes("connectorVersion") ||
    /[\"'](?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?[\"']/.test(source)
  ) {
    throw new Error(`${relativePath} must use the generated connector version`);
  }
}
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
const manifest = JSON.parse(output);
const results = Array.isArray(manifest) ? manifest : Object.values(manifest);

if (results.length !== 1 || !Array.isArray(results[0]?.files)) {
  throw new Error("npm pack returned an unexpected package manifest");
}

const paths = results[0].files.map(({ path }) => path.replaceAll("\\", "/"));
const files = new Set(paths);
const requiredFiles = [
  "LICENSE",
  "README.md",
  "package.json",
  "bin/viberacing.mjs",
  "lib/diagnostics.mjs",
  "lib/protocol.mjs",
  "lib/terminal.mjs",
  "lib/version.mjs",
  "scripts/generate-version.mjs",
];

const expectedTarball = `${packageJson.name.replace(/^@/, "").replaceAll("/", "-")}-${packageJson.version}.tgz`;
if (results[0].filename !== expectedTarball) {
  throw new Error(`Connector tarball name does not match package version: ${results[0].filename}`);
}

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
    (lowerName.startsWith("diagnostic") && path !== "lib/diagnostics.mjs");

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

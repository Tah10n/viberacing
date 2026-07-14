import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { format as formatWithPrettier, resolveConfig as resolvePrettierConfig } from "prettier";
import { parse as parseYaml } from "yaml";

const args = process.argv.slice(2);
let root = resolve(import.meta.dirname, "..");
let write = false;
while (args.length > 0) {
  const argument = args.shift();
  if (argument === "--write") {
    write = true;
  } else if (argument === "--root" && args[0]) {
    root = resolve(args.shift());
  } else {
    console.error("Usage: node scripts/check-licenses.mjs [--write] [--root <directory>]");
    process.exit(2);
  }
}

const findings = [];
function report(scope, message) {
  findings.push(`${scope} — ${message}`);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(resolve(root, path), "utf8"));
  } catch (error) {
    report(path, `could not parse JSON: ${error.message}`);
    return null;
  }
}

function packageKey(name, version) {
  return `${name}@${version}`;
}

function lockPackageKey(rawKey) {
  const withoutPeers = rawKey.replace(/\(.+$/, "");
  const separator = withoutPeers.lastIndexOf("@");
  if (separator <= 0 || separator === withoutPeers.length - 1) {
    return null;
  }
  return packageKey(withoutPeers.slice(0, separator), withoutPeers.slice(separator + 1));
}

function discoverInstalledNpmPackages() {
  const virtualStore = resolve(root, "node_modules/.pnpm");
  const packages = new Map();
  if (!existsSync(virtualStore)) {
    report(
      "node_modules/.pnpm",
      "installed dependency manifests are missing; run the locked install",
    );
    return packages;
  }

  function inspectManifest(path) {
    if (!existsSync(path)) {
      return;
    }
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      report(
        path.slice(root.length + 1).replaceAll("\\", "/"),
        `invalid package manifest: ${error.message}`,
      );
      return;
    }
    if (typeof manifest.name !== "string" || typeof manifest.version !== "string") {
      return;
    }
    const key = packageKey(manifest.name, manifest.version);
    const license = typeof manifest.license === "string" ? manifest.license.trim() : "";
    if (!license) {
      report(key, "installed npm manifest has no string license declaration");
      return;
    }
    const existing = packages.get(key);
    if (existing && existing.license !== license) {
      report(key, `installed manifests disagree on license: ${existing.license} versus ${license}`);
      return;
    }
    packages.set(key, { license, name: manifest.name, version: manifest.version });
  }

  for (const entry of readdirSync(virtualStore, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "node_modules") {
      continue;
    }
    const modules = join(virtualStore, entry.name, "node_modules");
    if (!existsSync(modules) || !statSync(modules).isDirectory()) {
      continue;
    }
    for (const child of readdirSync(modules, { withFileTypes: true })) {
      if (child.name.startsWith("@") && child.isDirectory()) {
        const scope = join(modules, child.name);
        for (const scopedPackage of readdirSync(scope, { withFileTypes: true })) {
          if (scopedPackage.isDirectory() || scopedPackage.isSymbolicLink()) {
            inspectManifest(join(scope, scopedPackage.name, "package.json"));
          }
        }
      } else if (child.isDirectory() || child.isSymbolicLink()) {
        inspectManifest(join(modules, child.name, "package.json"));
      }
    }
  }
  return packages;
}

const policy = readJson("config/license-policy.json");
if (policy === null) {
  process.exit(1);
}
if (
  policy.schemaVersion !== 1 ||
  !Array.isArray(policy.approvedNpmLicenseExpressions) ||
  !Array.isArray(policy.approvedCargoLicenseExpressions) ||
  !Array.isArray(policy.externalArtifacts)
) {
  report("config/license-policy.json", "expected schemaVersion 1 and all policy arrays");
}

for (const field of ["approvedNpmLicenseExpressions", "approvedCargoLicenseExpressions"]) {
  const values = policy[field] ?? [];
  if (
    values.some((value) => typeof value !== "string" || !value.trim()) ||
    new Set(values).size !== values.length ||
    [...values].sort((left, right) => left.localeCompare(right)).join("\n") !== values.join("\n")
  ) {
    report("config/license-policy.json", `${field} must contain unique sorted non-empty strings`);
  }
}

const packageManifest = readJson("package.json") ?? {};
const declaredDirectScopes = new Map();
for (const [scope, dependencies] of [
  ["runtime", packageManifest.dependencies],
  ["development", packageManifest.devDependencies],
]) {
  for (const name of Object.keys(dependencies ?? {})) {
    if (declaredDirectScopes.has(name)) {
      report("package.json", `direct dependency is declared in multiple scopes: ${name}`);
    }
    declaredDirectScopes.set(name, scope);
  }
}

let lock;
try {
  lock = parseYaml(readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8"));
} catch (error) {
  report("pnpm-lock.yaml", `could not parse lockfile: ${error.message}`);
  lock = {};
}
const lockedNpmKeys = new Set();
for (const rawKey of Object.keys(lock.packages ?? {})) {
  const key = lockPackageKey(rawKey);
  if (key === null) {
    report("pnpm-lock.yaml", `unsupported package key: ${rawKey}`);
  } else if (lockedNpmKeys.has(key)) {
    report("pnpm-lock.yaml", `duplicate normalized package key: ${key}`);
  } else {
    lockedNpmKeys.add(key);
  }
}

const directPackageKeys = new Map();
for (const [lockField, scope] of [
  ["dependencies", "runtime"],
  ["devDependencies", "development"],
]) {
  for (const [name, lockEntry] of Object.entries(lock.importers?.["."]?.[lockField] ?? {})) {
    const rawVersion = typeof lockEntry === "string" ? lockEntry : lockEntry.version;
    const version = rawVersion?.replace(/\(.+$/, "");
    if (!version) {
      report("pnpm-lock.yaml", `direct dependency has no resolved version: ${name}`);
      continue;
    }
    directPackageKeys.set(packageKey(name, version), scope);
  }
}
for (const [name, scope] of declaredDirectScopes) {
  if (
    ![...directPackageKeys].some(([key, value]) => key.startsWith(`${name}@`) && value === scope)
  ) {
    report(
      "pnpm-lock.yaml",
      `direct ${scope} dependency is missing from the root importer: ${name}`,
    );
  }
}

const installedPackages = discoverInstalledNpmPackages();
for (const key of lockedNpmKeys) {
  if (!installedPackages.has(key)) {
    report(key, "locked npm package has no installed manifest for license verification");
  }
}
for (const key of installedPackages.keys()) {
  if (!lockedNpmKeys.has(key)) {
    report(key, "installed npm package is absent from pnpm-lock.yaml");
  }
}

const approvedNpm = new Set(policy.approvedNpmLicenseExpressions ?? []);
const npmPackages = [...lockedNpmKeys]
  .map((key) => installedPackages.get(key))
  .filter(Boolean)
  .map((entry) => ({
    name: entry.name,
    version: entry.version,
    license: entry.license,
    direct: directPackageKeys.get(packageKey(entry.name, entry.version)) ?? null,
  }))
  .sort((left, right) =>
    left.name === right.name
      ? left.version.localeCompare(right.version)
      : left.name.localeCompare(right.name),
  );
for (const entry of npmPackages) {
  if (!approvedNpm.has(entry.license)) {
    report(packageKey(entry.name, entry.version), `npm license is not approved: ${entry.license}`);
  }
}

let cargoMetadata = { packages: [], workspace_members: [] };
const cargoLockText = readFileSync(resolve(root, "Cargo.lock"), "utf8");
if (/^\[\[package\]\]\s*$/m.test(cargoLockText)) {
  try {
    cargoMetadata = JSON.parse(
      execFileSync("cargo", ["metadata", "--locked", "--offline", "--format-version", "1"], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  } catch (error) {
    report("Cargo.lock", `cargo metadata failed: ${error.stderr?.trim() || error.message}`);
  }
}
const workspaceMembers = new Set(cargoMetadata.workspace_members ?? []);
const approvedCargo = new Set(policy.approvedCargoLicenseExpressions ?? []);
const cargoPackages = (cargoMetadata.packages ?? [])
  .filter((entry) => !workspaceMembers.has(entry.id))
  .map((entry) => ({
    name: entry.name,
    version: entry.version,
    license: entry.license ?? "",
    source: entry.source ?? "",
  }))
  .sort((left, right) =>
    left.name === right.name
      ? left.version.localeCompare(right.version)
      : left.name.localeCompare(right.name),
  );
for (const entry of cargoPackages) {
  if (!entry.license || !approvedCargo.has(entry.license)) {
    report(
      packageKey(entry.name, entry.version),
      `Cargo license is not approved: ${entry.license || "missing"}`,
    );
  }
}

const observedExternal = new Set();
try {
  const compose = parseYaml(readFileSync(resolve(root, "compose.yaml"), "utf8"));
  for (const service of Object.values(compose.services ?? {})) {
    if (typeof service.image === "string") {
      observedExternal.add(service.image);
    }
  }
} catch (error) {
  report("compose.yaml", `could not inventory images: ${error.message}`);
}
try {
  const workflow = parseYaml(readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8"));
  for (const job of Object.values(workflow.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      if (typeof step.uses === "string") {
        observedExternal.add(step.uses);
      }
    }
  }
} catch (error) {
  report(".github/workflows/ci.yml", `could not inventory actions: ${error.message}`);
}

const externalIdentifiers = new Set();
for (const [index, entry] of (policy.externalArtifacts ?? []).entries()) {
  const scope = `config/license-policy.json externalArtifacts[${index}]`;
  if (
    entry === null ||
    typeof entry !== "object" ||
    Object.keys(entry).sort().join(",") !== "declaredLicense,identifier,kind,purpose,redistributed"
  ) {
    report(scope, "entry shape is invalid");
    continue;
  }
  if (
    !new Set(["container-image", "github-action"]).has(entry.kind) ||
    typeof entry.identifier !== "string" ||
    typeof entry.declaredLicense !== "string" ||
    typeof entry.purpose !== "string" ||
    typeof entry.redistributed !== "boolean" ||
    entry.purpose.length < 20
  ) {
    report(scope, "entry values are invalid");
  }
  if (externalIdentifiers.has(entry.identifier)) {
    report(scope, `duplicate external artifact: ${entry.identifier}`);
  }
  externalIdentifiers.add(entry.identifier);
}
for (const identifier of observedExternal) {
  if (!externalIdentifiers.has(identifier)) {
    report(identifier, "referenced external artifact is missing from the license policy");
  }
}
for (const identifier of externalIdentifiers) {
  if (!observedExternal.has(identifier)) {
    report(identifier, "license policy contains an unused external artifact");
  }
}

const notices = readFileSync(resolve(root, "THIRD_PARTY_NOTICES.md"), "utf8");
const noticeLines = notices.split(/\r?\n/);
for (const [key] of directPackageKeys) {
  const entry = npmPackages.find(
    (candidate) => packageKey(candidate.name, candidate.version) === key,
  );
  if (!entry) {
    report("package.json", `direct dependency is missing from the inventory: ${key}`);
    continue;
  }
  const row = noticeLines.find((line) =>
    line.toLowerCase().includes(`[${entry.name.toLowerCase()}](`),
  );
  if (!row || !row.toLowerCase().includes(`| ${entry.license.toLowerCase()} `)) {
    report("THIRD_PARTY_NOTICES.md", `direct dependency notice is missing or stale: ${entry.name}`);
  }
}

const inventory = {
  schemaVersion: 1,
  generatedFrom: ["pnpm-lock.yaml", "Cargo.lock", "compose.yaml", ".github/workflows/ci.yml"],
  npmPackages,
  cargoPackages,
  externalArtifacts: policy.externalArtifacts ?? [],
};
const inventoryPath = resolve(root, "docs/reference/dependency-inventory.json");
const prettierConfig = (await resolvePrettierConfig(inventoryPath)) ?? {};
const serialized = await formatWithPrettier(JSON.stringify(inventory), {
  ...prettierConfig,
  parser: "json",
});

if (findings.length === 0 && write) {
  writeFileSync(inventoryPath, serialized, "utf8");
  console.log(
    `Dependency inventory written (${npmPackages.length} npm package(s), ${cargoPackages.length} Cargo package(s), ${externalIdentifiers.size} external artifact(s)).`,
  );
  process.exit(0);
}

if (!write) {
  if (!existsSync(inventoryPath)) {
    report("docs/reference/dependency-inventory.json", "generated inventory is missing");
  } else if (readFileSync(inventoryPath, "utf8") !== serialized) {
    report(
      "docs/reference/dependency-inventory.json",
      "inventory does not match locks, installed manifests, or external-artifact policy; review and regenerate",
    );
  }
}

if (findings.length > 0) {
  console.error(`License check failed with ${findings.length} finding(s):`);
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log(
  `License check passed (${npmPackages.length} npm package(s), ${cargoPackages.length} Cargo package(s), ${externalIdentifiers.size} external artifact(s)).`,
);

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { format as formatWithPrettier, resolveConfig as resolvePrettierConfig } from "prettier";
import { parse as parseYaml } from "yaml";

const args = process.argv.slice(2);
let root = resolve(import.meta.dirname, "..");
let write = false;
let refreshNpmMetadata = false;
while (args.length > 0) {
  const argument = args.shift();
  if (argument === "--write") {
    write = true;
  } else if (argument === "--refresh-npm-metadata") {
    refreshNpmMetadata = true;
  } else if (argument === "--root" && args[0]) {
    root = resolve(args.shift());
  } else {
    console.error(
      "Usage: node scripts/check-licenses.mjs [--write] [--refresh-npm-metadata] [--root <directory>]",
    );
    process.exit(2);
  }
}

if (refreshNpmMetadata && process.argv.includes("--root")) {
  console.error("--refresh-npm-metadata is available only for the repository root");
  process.exit(2);
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

const dependencyFields = [
  ["dependencies", "runtime"],
  ["devDependencies", "development"],
  ["optionalDependencies", "optional"],
];

function importerManifestPath(importer) {
  if (importer === ".") {
    return "package.json";
  }
  if (!/^(?:apps|packages)\/[A-Za-z0-9._-]+$/.test(importer)) {
    report("pnpm-lock.yaml", `importer is outside the bounded workspace: ${importer}`);
    return null;
  }
  return `${importer}/package.json`;
}

function discoverWorkspaceImporters() {
  const importers = [];
  for (const parent of ["apps", "packages"]) {
    const parentPath = resolve(root, parent);
    if (!existsSync(parentPath)) {
      continue;
    }
    for (const entry of readdirSync(parentPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const importer = `${parent}/${entry.name}`;
      if (existsSync(resolve(root, importer, "package.json"))) {
        importers.push(importer);
      }
    }
  }
  return importers.sort((left, right) => left.localeCompare(right));
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

const npmRegistry = "https://registry.npmjs.org";
const npmMetadataRelativePath = "config/npm-package-metadata.json";

function parseNpmMetadataCache() {
  if (!existsSync(resolve(root, npmMetadataRelativePath))) {
    report(npmMetadataRelativePath, "integrity-bound npm license metadata cache is missing");
    return new Map();
  }
  const cache = readJson(npmMetadataRelativePath);
  if (
    cache?.schemaVersion !== 1 ||
    cache?.registry !== npmRegistry ||
    !Array.isArray(cache?.packages)
  ) {
    report(
      npmMetadataRelativePath,
      `expected schemaVersion 1, registry ${npmRegistry}, and a packages array`,
    );
    return new Map();
  }
  const packages = new Map();
  let previousEntry = null;
  for (const [index, entry] of cache.packages.entries()) {
    const scope = `${npmMetadataRelativePath} packages[${index}]`;
    if (
      entry === null ||
      typeof entry !== "object" ||
      Object.keys(entry).sort().join(",") !== "integrity,license,name,version" ||
      typeof entry.name !== "string" ||
      typeof entry.version !== "string" ||
      typeof entry.license !== "string" ||
      !entry.license.trim() ||
      typeof entry.integrity !== "string" ||
      !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(entry.integrity)
    ) {
      report(scope, "entry shape or value is invalid");
      continue;
    }
    const key = packageKey(entry.name, entry.version);
    const order =
      previousEntry === null
        ? -1
        : previousEntry.name === entry.name
          ? previousEntry.version.localeCompare(entry.version)
          : previousEntry.name.localeCompare(entry.name);
    if (packages.has(key) || order >= 0) {
      report(scope, "entries must be uniquely sorted by package name and version");
    }
    previousEntry = entry;
    packages.set(key, entry);
  }
  return packages;
}

async function fetchRegistryLicense(name, version, integrity) {
  const encodedName = encodeURIComponent(name).replace("%40", "@");
  const url = `${npmRegistry}/${encodedName}/${encodeURIComponent(version)}`;
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "viberacing-license-metadata/1",
    },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`registry returned HTTP ${response.status}`);
  }
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > 1_048_576) {
    throw new Error(`registry response exceeds 1 MiB (${declaredLength} bytes)`);
  }
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > 1_048_576) {
    throw new Error("registry response exceeds 1 MiB");
  }
  const manifest = JSON.parse(body);
  if (manifest?.name !== name || manifest?.version !== version) {
    throw new Error("registry response identity does not match the requested package");
  }
  if (manifest?.dist?.integrity !== integrity) {
    throw new Error("registry integrity does not match pnpm-lock.yaml");
  }
  if (typeof manifest.license !== "string" || !manifest.license.trim()) {
    throw new Error("registry manifest has no string license declaration");
  }
  return { name, version, license: manifest.license.trim(), integrity };
}

async function refreshMetadata(lockedPackages, installedPackages) {
  const entries = [];
  const missing = [];
  for (const [key, locked] of lockedPackages) {
    const installed = installedPackages.get(key);
    if (installed) {
      entries.push({
        name: installed.name,
        version: installed.version,
        license: installed.license,
        integrity: locked.integrity,
      });
    } else {
      missing.push({ key, ...locked });
    }
  }

  for (let index = 0; index < missing.length; index += 8) {
    const batch = missing.slice(index, index + 8);
    const results = await Promise.allSettled(
      batch.map((entry) => fetchRegistryLicense(entry.name, entry.version, entry.integrity)),
    );
    for (const [resultIndex, result] of results.entries()) {
      const entry = batch[resultIndex];
      if (result.status === "fulfilled") {
        entries.push(result.value);
      } else {
        report(entry.key, `could not refresh npm license metadata: ${result.reason.message}`);
      }
    }
  }

  return entries.sort((left, right) =>
    left.name === right.name
      ? left.version.localeCompare(right.version)
      : left.name.localeCompare(right.name),
  );
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

let lock;
try {
  lock = parseYaml(readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8"));
} catch (error) {
  report("pnpm-lock.yaml", `could not parse lockfile: ${error.message}`);
  lock = {};
}
const lockedNpmPackages = new Map();
for (const [rawKey, lockEntry] of Object.entries(lock.packages ?? {})) {
  const key = lockPackageKey(rawKey);
  if (key === null) {
    report("pnpm-lock.yaml", `unsupported package key: ${rawKey}`);
    continue;
  }
  const integrity = lockEntry?.resolution?.integrity;
  if (typeof integrity !== "string" || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity)) {
    report("pnpm-lock.yaml", `package has no sha512 registry integrity: ${rawKey}`);
    continue;
  }
  const separator = key.lastIndexOf("@");
  const entry = {
    name: key.slice(0, separator),
    version: key.slice(separator + 1),
    integrity,
  };
  const existing = lockedNpmPackages.get(key);
  if (existing && existing.integrity !== integrity) {
    report("pnpm-lock.yaml", `peer variants disagree on integrity: ${key}`);
  } else {
    lockedNpmPackages.set(key, entry);
  }
}

const lockImporters = lock.importers ?? {};
const expectedImporters = [".", ...discoverWorkspaceImporters()];
for (const importer of expectedImporters) {
  if (!Object.hasOwn(lockImporters, importer)) {
    report("pnpm-lock.yaml", `workspace manifest is missing an importer: ${importer}`);
  }
}
for (const importer of Object.keys(lockImporters)) {
  if (!expectedImporters.includes(importer)) {
    report("pnpm-lock.yaml", `importer has no workspace manifest: ${importer}`);
  }
}

const directPackageReferences = new Map();
const manifestPaths = [];
for (const importer of Object.keys(lockImporters).sort((left, right) =>
  left.localeCompare(right),
)) {
  const manifestPath = importerManifestPath(importer);
  if (manifestPath === null) {
    continue;
  }
  manifestPaths.push(manifestPath);
  const manifest = readJson(manifestPath);
  if (manifest === null) {
    continue;
  }

  const declaredScopes = new Map();
  for (const [field, scope] of dependencyFields) {
    const dependencies = manifest[field] ?? {};
    for (const [name, specifier] of Object.entries(dependencies)) {
      if (declaredScopes.has(name)) {
        report(manifestPath, `direct dependency is declared in multiple scopes: ${name}`);
      }
      declaredScopes.set(name, { field, scope, specifier });
    }

    for (const [name, lockEntry] of Object.entries(lockImporters[importer]?.[field] ?? {})) {
      const declaration = declaredScopes.get(name);
      if (declaration?.field !== field) {
        report(
          "pnpm-lock.yaml",
          `importer ${importer} contains undeclared ${scope} dependency: ${name}`,
        );
        continue;
      }
      const lockSpecifier =
        lockEntry !== null && typeof lockEntry === "object" ? lockEntry.specifier : undefined;
      if (lockSpecifier !== undefined && lockSpecifier !== declaration.specifier) {
        report(
          "pnpm-lock.yaml",
          `importer ${importer} specifier differs from ${manifestPath}: ${name}`,
        );
      }
      const rawVersion = typeof lockEntry === "string" ? lockEntry : lockEntry?.version;
      if (
        typeof declaration.specifier === "string" &&
        (declaration.specifier.startsWith("workspace:") || rawVersion?.startsWith("link:"))
      ) {
        continue;
      }
      const version = rawVersion?.replace(/\(.+$/, "");
      if (!version) {
        report(
          "pnpm-lock.yaml",
          `direct dependency has no resolved version in importer ${importer}: ${name}`,
        );
        continue;
      }
      const key = packageKey(name, version);
      const references = directPackageReferences.get(key) ?? [];
      references.push({ workspace: importer, scope });
      directPackageReferences.set(key, references);
    }
  }

  for (const [name, declaration] of declaredScopes) {
    if (!Object.hasOwn(lockImporters[importer]?.[declaration.field] ?? {}, name)) {
      report(
        "pnpm-lock.yaml",
        `direct ${declaration.scope} dependency is missing from importer ${importer}: ${name}`,
      );
    }
  }
}

for (const references of directPackageReferences.values()) {
  references.sort((left, right) =>
    left.workspace === right.workspace
      ? left.scope.localeCompare(right.scope)
      : left.workspace.localeCompare(right.workspace),
  );
}

const installedPackages = discoverInstalledNpmPackages();

const metadataStartFindingCount = findings.length;
let npmMetadata;
if (refreshNpmMetadata) {
  const refreshedEntries = await refreshMetadata(lockedNpmPackages, installedPackages);
  npmMetadata = new Map(
    refreshedEntries.map((entry) => [packageKey(entry.name, entry.version), entry]),
  );
  if (
    findings.length === metadataStartFindingCount &&
    npmMetadata.size === lockedNpmPackages.size
  ) {
    const metadataPath = resolve(root, npmMetadataRelativePath);
    const prettierConfig = (await resolvePrettierConfig(metadataPath)) ?? {};
    const serializedMetadata = await formatWithPrettier(
      JSON.stringify({ schemaVersion: 1, registry: npmRegistry, packages: refreshedEntries }),
      { ...prettierConfig, parser: "json" },
    );
    writeFileSync(metadataPath, serializedMetadata, "utf8");
    console.log(
      `npm license metadata refreshed (${refreshedEntries.length} integrity-bound package release(s)).`,
    );
  }
} else {
  npmMetadata = parseNpmMetadataCache();
}

for (const [key, locked] of lockedNpmPackages) {
  const metadata = npmMetadata.get(key);
  if (!metadata) {
    report(key, "locked package is missing from the npm license metadata cache");
  } else if (metadata.integrity !== locked.integrity) {
    report(key, "cached npm license metadata integrity differs from pnpm-lock.yaml");
  }
  const installed = installedPackages.get(key);
  if (metadata && installed && metadata.license !== installed.license) {
    report(key, "installed manifest license differs from the integrity-bound metadata cache");
  }
}
for (const key of npmMetadata.keys()) {
  if (!lockedNpmPackages.has(key)) {
    report(npmMetadataRelativePath, `metadata contains an unlocked package release: ${key}`);
  }
}
for (const key of installedPackages.keys()) {
  if (!lockedNpmPackages.has(key)) {
    report(key, "installed npm package is absent from pnpm-lock.yaml");
  }
}

const approvedNpm = new Set(policy.approvedNpmLicenseExpressions ?? []);
const npmPackages = [...lockedNpmPackages.keys()]
  .map((key) => npmMetadata.get(key))
  .filter(Boolean)
  .map((entry) => ({
    name: entry.name,
    version: entry.version,
    license: entry.license,
    direct: directPackageReferences.get(packageKey(entry.name, entry.version)) ?? [],
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
for (const [key, references] of directPackageReferences) {
  const entry = npmPackages.find(
    (candidate) => packageKey(candidate.name, candidate.version) === key,
  );
  if (!entry) {
    report(
      references.map((reference) => reference.workspace).join(", "),
      `direct dependency is missing from the inventory: ${key}`,
    );
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
  schemaVersion: 2,
  generatedFrom: [
    ...manifestPaths,
    "pnpm-lock.yaml",
    npmMetadataRelativePath,
    "Cargo.lock",
    "compose.yaml",
    ".github/workflows/ci.yml",
  ],
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
      "inventory does not match locks, integrity-bound metadata, installed manifests, or external-artifact policy; review and regenerate",
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

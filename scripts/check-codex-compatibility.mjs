import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, posix, relative, resolve, sep } from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
if (!(args.length === 0 || (args.length === 2 && args[0] === "--root" && args[1]))) {
  console.error("Usage: node scripts/check-codex-compatibility.mjs [--root <directory>]");
  process.exit(2);
}

const root = args.length === 0 ? resolve(import.meta.dirname, "..") : resolve(args[1]);
const compatibilityRoot = resolve(root, "compat", "codex");
const matrixPath = resolve(root, "docs", "reference", "codex-compatibility.md");
const findings = [];
const seenManifestVersions = new Map();

function report(path, message) {
  findings.push(`${path} — ${message}`);
}

function repositoryPath(path) {
  return relative(root, path).replaceAll("\\", "/");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return (
    isRecord(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
  );
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function validDigest(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function validPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function readCanonicalJson(path, compact = false) {
  const label = repositoryPath(path);
  if (!existsSync(path) || !lstatSync(path).isFile()) {
    report(label, "required compatibility file is missing");
    return null;
  }

  const bytes = readFileSync(path);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    report(label, "file is not valid UTF-8");
    return null;
  }

  let value;
  try {
    value = JSON.parse(text);
  } catch {
    report(label, "file is not valid JSON");
    return null;
  }

  const canonical = compact ? `${JSON.stringify(value)}\n` : `${JSON.stringify(value, null, 2)}\n`;
  if (text !== canonical) {
    report(label, "JSON must be canonical and duplicate-key free");
  }
  return { bytes, value };
}

function safeVersionPath(versionRoot, path) {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.includes("\\") ||
    posix.isAbsolute(path) ||
    posix.normalize(path) !== path ||
    path.split("/").includes("..")
  ) {
    return null;
  }
  const absolutePath = resolve(versionRoot, ...path.split("/"));
  if (!(absolutePath === versionRoot || absolutePath.startsWith(`${versionRoot}${sep}`))) {
    return null;
  }
  return absolutePath;
}

function validateRecordedFile(versionRoot, entry, kind, expectedFiles) {
  const expectedKeys =
    kind === "extract"
      ? ["path", "sourcePath", "sourceBytes", "sourceSha256", "checkedInBytes", "checkedInSha256"]
      : ["path", "kind", "expected", "bytes", "sha256"];
  if (!exactKeys(entry, expectedKeys)) {
    report(repositoryPath(versionRoot), `${kind} entry has an invalid shape`);
    return null;
  }

  const absolutePath = safeVersionPath(versionRoot, entry.path);
  if (absolutePath === null) {
    report(repositoryPath(versionRoot), `${kind} path is not a safe relative path`);
    return null;
  }
  if (expectedFiles.has(entry.path)) {
    report(repositoryPath(versionRoot), `${kind} path is duplicated: ${entry.path}`);
  }
  expectedFiles.add(entry.path);

  const parsed = readCanonicalJson(absolutePath, kind === "fixture");
  if (parsed === null) {
    return null;
  }
  const byteField = kind === "extract" ? "checkedInBytes" : "bytes";
  const digestField = kind === "extract" ? "checkedInSha256" : "sha256";
  if (entry[byteField] !== parsed.bytes.length) {
    report(repositoryPath(absolutePath), `${kind} byte count does not match its manifest`);
  }
  if (!validDigest(entry[digestField]) || entry[digestField] !== digest(parsed.bytes)) {
    report(repositoryPath(absolutePath), `${kind} digest does not match its manifest`);
  }
  return parsed.value;
}

function walkFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    } else {
      report(repositoryPath(path), "non-regular compatibility artifact is forbidden");
    }
  }
  return files;
}

function validateManifest(version, versionRoot, matrixVersions) {
  const manifestPath = resolve(versionRoot, "manifest.json");
  const parsed = readCanonicalJson(manifestPath);
  if (parsed === null || !isRecord(parsed.value)) {
    return;
  }
  const manifest = parsed.value;
  if (
    !exactKeys(manifest, [
      "manifestVersion",
      "codexVersion",
      "status",
      "release",
      "generation",
      "extracts",
      "stableMethods",
      "fixtures",
      "generatedAdversarialCases",
      "supportBlockers",
    ])
  ) {
    report(repositoryPath(manifestPath), "manifest has an invalid top-level shape");
    return;
  }

  if (manifest.manifestVersion !== 1 || manifest.codexVersion !== version) {
    report(repositoryPath(manifestPath), "manifest version fields do not match the directory");
  }
  if (!(manifest.status === "candidate" || manifest.status === "supported")) {
    report(repositoryPath(manifestPath), "status must be candidate or supported");
  }
  seenManifestVersions.set(version, manifest.status);
  if (manifest.status === "candidate" && matrixVersions.has(version)) {
    report(repositoryPath(manifestPath), "candidate version must not appear in the support matrix");
  }
  if (manifest.status === "supported" && !matrixVersions.has(version)) {
    report(repositoryPath(manifestPath), "supported manifest requires a matching matrix row");
  }

  if (
    !exactKeys(manifest.release, ["repository", "tag", "commit", "publishedAt", "url", "artifact"])
  ) {
    report(repositoryPath(manifestPath), "release provenance has an invalid shape");
  } else {
    const release = manifest.release;
    const publishedAt =
      typeof release.publishedAt === "string" ? new Date(release.publishedAt) : null;
    if (
      release.repository !== "https://github.com/openai/codex" ||
      release.tag !== `rust-v${version}` ||
      release.url !== `https://github.com/openai/codex/releases/tag/rust-v${version}` ||
      !/^[a-f0-9]{40}$/.test(release.commit ?? "") ||
      !/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(release.publishedAt ?? "") ||
      publishedAt === null ||
      Number.isNaN(publishedAt.getTime()) ||
      publishedAt.toISOString().replace(".000Z", "Z") !== release.publishedAt
    ) {
      report(repositoryPath(manifestPath), "release provenance is not exact and immutable");
    }
    if (
      !exactKeys(release.artifact, ["name", "bytes", "sha256", "verificationStatus"]) ||
      typeof release.artifact.name !== "string" ||
      !/^codex-(?:aarch64|x86_64)-(?:apple-darwin|pc-windows-msvc|unknown-linux-musl)(?:\.exe)?(?:\.(?:dmg|tar\.gz|tar\.zst|zip|zst))?$/.test(
        release.artifact.name,
      ) ||
      !validPositiveInteger(release.artifact.bytes) ||
      !validDigest(release.artifact.sha256) ||
      release.artifact.verificationStatus !== "release-metadata-recorded"
    ) {
      report(repositoryPath(manifestPath), "release artifact metadata is invalid");
    }
  }

  if (
    !exactKeys(manifest.generation, [
      "command",
      "experimentalApi",
      "reportedVersion",
      "fullStableBundle",
      "clientRequestSchema",
    ])
  ) {
    report(repositoryPath(manifestPath), "schema generation evidence has an invalid shape");
  } else {
    const generation = manifest.generation;
    if (
      generation.command !== "codex app-server generate-json-schema --out <output-directory>" ||
      generation.experimentalApi !== false ||
      generation.reportedVersion !== version ||
      generation.command.includes("--experimental")
    ) {
      report(repositoryPath(manifestPath), "stable schema generation command is invalid");
    }
    for (const [label, value] of [
      ["full stable bundle", generation.fullStableBundle],
      ["client request schema", generation.clientRequestSchema],
    ]) {
      if (
        !exactKeys(value, ["sourcePath", "bytes", "sha256"]) ||
        typeof value.sourcePath !== "string" ||
        value.sourcePath.includes("/") ||
        value.sourcePath.includes("\\") ||
        !validPositiveInteger(value.bytes) ||
        !validDigest(value.sha256)
      ) {
        report(repositoryPath(manifestPath), `${label} evidence is invalid`);
      }
    }
  }

  const expectedFiles = new Set(["manifest.json"]);
  const expectedExtracts = new Map([
    ["schemas/GetAccountParams.json", "GetAccountParams"],
    ["schemas/GetAccountResponse.json", "GetAccountResponse"],
    ["schemas/GetAccountTokenUsageResponse.json", "GetAccountTokenUsageResponse"],
  ]);
  if (!Array.isArray(manifest.extracts) || manifest.extracts.length !== expectedExtracts.size) {
    report(
      repositoryPath(manifestPath),
      "manifest must contain the three reviewed schema extracts",
    );
  } else {
    for (const entry of manifest.extracts) {
      const schema = validateRecordedFile(versionRoot, entry, "extract", expectedFiles);
      const expectedTitle = expectedExtracts.get(entry?.path);
      if (expectedTitle === undefined) {
        report(repositoryPath(manifestPath), `unexpected schema extract: ${entry?.path}`);
      }
      if (
        !validPositiveInteger(entry?.sourceBytes) ||
        !validDigest(entry?.sourceSha256) ||
        typeof entry?.sourcePath !== "string" ||
        !entry.sourcePath.startsWith("v2/") ||
        entry.sourcePath.includes("\\") ||
        posix.normalize(entry.sourcePath) !== entry.sourcePath ||
        entry.sourcePath.split("/").includes("..") ||
        basename(entry.sourcePath) !== basename(entry.path ?? "")
      ) {
        report(repositoryPath(manifestPath), `source evidence is invalid for ${entry?.path}`);
      }
      if (
        !isRecord(schema) ||
        schema.$schema !== "http://json-schema.org/draft-07/schema#" ||
        schema.title !== expectedTitle
      ) {
        report(
          repositoryPath(manifestPath),
          `schema extract identity is invalid for ${entry?.path}`,
        );
      }
      const absolutePath = safeVersionPath(versionRoot, entry?.path);
      if (absolutePath !== null && existsSync(absolutePath) && lstatSync(absolutePath).isFile()) {
        const bytes = readFileSync(absolutePath);
        if (
          entry.sourceBytes + 1 !== entry.checkedInBytes ||
          bytes.at(-1) !== 0x0a ||
          digest(bytes.subarray(0, -1)) !== entry.sourceSha256
        ) {
          report(
            repositoryPath(absolutePath),
            "source digest must match the checked-in extract without its final LF",
          );
        }
      }
    }
  }

  const expectedMethods = [
    {
      method: "account/read",
      requestId: 1,
      params: { refreshToken: false },
      responseSchema: "schemas/GetAccountResponse.json",
    },
    {
      method: "account/usage/read",
      requestId: 2,
      params: null,
      responseSchema: "schemas/GetAccountTokenUsageResponse.json",
    },
  ];
  if (JSON.stringify(manifest.stableMethods) !== JSON.stringify(expectedMethods)) {
    report(repositoryPath(manifestPath), "stable method allowlist or fixed parameters drifted");
  }

  const expectedFixtureKinds = new Map([
    ["account-positive", "accept"],
    ["account-nullable", "accept"],
    ["account-unsupported", "reject-unsupported"],
    ["account-unknown-field", "reject-invalid"],
    ["usage-positive", "accept"],
    ["usage-nullable", "accept-empty"],
    ["usage-missing-field", "reject-invalid"],
    ["usage-malformed-date", "reject-invalid"],
    ["usage-unknown-field", "reject-invalid"],
  ]);
  const seenFixtureKinds = new Set();
  if (!Array.isArray(manifest.fixtures) || manifest.fixtures.length !== expectedFixtureKinds.size) {
    report(repositoryPath(manifestPath), "fixture inventory is incomplete");
  } else {
    for (const entry of manifest.fixtures) {
      validateRecordedFile(versionRoot, entry, "fixture", expectedFiles);
      if (
        typeof entry?.kind !== "string" ||
        seenFixtureKinds.has(entry.kind) ||
        expectedFixtureKinds.get(entry.kind) !== entry.expected
      ) {
        report(repositoryPath(manifestPath), `fixture classification is invalid: ${entry?.kind}`);
      }
      seenFixtureKinds.add(entry?.kind);
      if (typeof entry?.path !== "string" || !entry.path.startsWith("fixtures/")) {
        report(repositoryPath(manifestPath), "fixture path must stay under fixtures/");
      }
    }
  }

  const requiredGeneratedCases = [
    "duplicate-json-key",
    "duplicate-reported-date",
    "frame-too-large",
    "invalid-envelope-id",
    "invalid-utf8",
    "more-than-31-daily-buckets",
    "unsafe-integer",
  ];
  if (
    !Array.isArray(manifest.generatedAdversarialCases) ||
    JSON.stringify([...manifest.generatedAdversarialCases].sort()) !==
      JSON.stringify(requiredGeneratedCases)
  ) {
    report(repositoryPath(manifestPath), "generated adversarial-case inventory is incomplete");
  }

  if (!Array.isArray(manifest.supportBlockers)) {
    report(repositoryPath(manifestPath), "support blockers must be an array");
  } else if (
    manifest.status === "candidate" &&
    (manifest.supportBlockers.length < 3 ||
      manifest.supportBlockers.some(
        (value) => typeof value !== "string" || value.length < 20 || value.length > 256,
      ))
  ) {
    report(repositoryPath(manifestPath), "candidate must retain explicit bounded support blockers");
  } else if (manifest.status === "supported" && manifest.supportBlockers.length !== 0) {
    report(repositoryPath(manifestPath), "supported manifest cannot retain unresolved blockers");
  }

  const actualFiles = walkFiles(versionRoot).map((path) => repositoryPath(path));
  const expectedRepositoryFiles = new Set(
    [...expectedFiles].map((path) => repositoryPath(resolve(versionRoot, ...path.split("/")))),
  );
  for (const path of actualFiles) {
    if (!expectedRepositoryFiles.has(path)) {
      report(path, "unmanifested compatibility artifact is forbidden");
    }
  }
}

if (!existsSync(compatibilityRoot) || !existsSync(resolve(compatibilityRoot, "README.md"))) {
  report("compat/codex", "compatibility evidence directory or README is missing");
}
if (!existsSync(matrixPath)) {
  report("docs/reference/codex-compatibility.md", "compatibility matrix is missing");
}

let matrixVersions = new Set();
if (existsSync(matrixPath)) {
  const matrix = readFileSync(matrixPath, "utf8");
  matrixVersions = new Set(
    [...matrix.matchAll(/^\|\s*(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\s*\|/gm)].map(
      (match) => match[1],
    ),
  );
}

if (existsSync(compatibilityRoot)) {
  for (const entry of readdirSync(compatibilityRoot, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === "README.md") {
      continue;
    }
    if (!entry.isDirectory() || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(entry.name)) {
      report(
        repositoryPath(resolve(compatibilityRoot, entry.name)),
        "unexpected compatibility entry",
      );
      continue;
    }
    validateManifest(entry.name, resolve(compatibilityRoot, entry.name), matrixVersions);
  }
}

if (seenManifestVersions.size === 0) {
  report("compat/codex", "at least one exact-version compatibility manifest is required");
}

for (const version of matrixVersions) {
  if (seenManifestVersions.get(version) !== "supported") {
    report(
      "docs/reference/codex-compatibility.md",
      `matrix version ${version} lacks a supported compatibility manifest`,
    );
  }
}

if (findings.length > 0) {
  console.error(`Codex compatibility check failed with ${findings.length} finding(s):`);
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log(
  `Codex compatibility check passed (${seenManifestVersions.size} version manifest(s), ${matrixVersions.size} supported matrix entry/entries).`,
);

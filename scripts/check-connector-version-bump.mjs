import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = "packages/connector";
const packageManifest = `${packageRoot}/package.json`;
const publishedExactPaths = new Set([
  `${packageRoot}/LICENSE`,
  `${packageRoot}/README.md`,
  packageManifest,
]);
const publishedPrefixes = [`${packageRoot}/bin/`, `${packageRoot}/lib/`, `${packageRoot}/scripts/`];

export function isPublishedConnectorPath(path) {
  return (
    publishedExactPaths.has(path) || publishedPrefixes.some((prefix) => path.startsWith(prefix))
  );
}

function parseStableVersion(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  return match === null ? null : match.slice(1).map(BigInt);
}

export function validateConnectorVersionBump({ baseVersion, changedPaths, headVersion }) {
  const publishedChanges = changedPaths.filter(isPublishedConnectorPath);
  if (publishedChanges.length === 0) return { publishedChanges: [] };
  const base = parseStableVersion(baseVersion);
  const head = parseStableVersion(headVersion);
  if (base === null || head === null) {
    throw new Error("Connector package versions must be stable canonical semantic versions");
  }
  for (let index = 0; index < 3; index += 1) {
    if (head[index] > base[index]) return { publishedChanges };
    if (head[index] < base[index]) break;
  }
  throw new Error(
    `Published connector files changed without a version increase (${baseVersion} -> ${headVersion})`,
  );
}

function git(arguments_, options = {}) {
  return execFileSync("git", arguments_, { encoding: "utf8", ...options });
}

function packageVersionAt(reference) {
  const manifest = JSON.parse(git(["show", `${reference}:${packageManifest}`]));
  if (typeof manifest.version !== "string")
    throw new Error(`${reference} has no connector version`);
  return manifest.version;
}

export function checkConnectorVersionBump(baseReference, headReference = "HEAD") {
  const changedPaths = git([
    "diff",
    "--name-only",
    "-z",
    baseReference,
    headReference,
    "--",
    packageRoot,
  ])
    .split("\0")
    .filter(Boolean);
  const result = validateConnectorVersionBump({
    baseVersion: packageVersionAt(baseReference),
    changedPaths,
    headVersion: packageVersionAt(headReference),
  });
  process.stdout.write(
    result.publishedChanges.length === 0
      ? "Connector version gate passed: no published package files changed.\n"
      : `Connector version gate passed: ${result.publishedChanges.length} published file change(s) have a newer package version.\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const baseReference = process.argv[2];
  const headReference = process.argv[3] ?? "HEAD";
  if (!baseReference) throw new Error("Usage: check-connector-version-bump.mjs <base> [head]");
  checkConnectorVersionBump(baseReference, headReference);
}

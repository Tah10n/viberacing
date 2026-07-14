import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { basename, resolve } from "node:path";
import process from "node:process";
import {
  inspectPublicBuffer,
  inspectPublicPath,
  maxReviewBytes,
} from "./lib/public-content-policy.mjs";

const root = resolve(import.meta.dirname, "..");
const mode = process.argv[2] ?? "--all";

if (!new Set(["--all", "--staged"]).has(mode)) {
  console.error("Usage: node scripts/check-public-files.mjs [--all|--staged]");
  process.exit(2);
}

function git(args, encoding = "utf8") {
  return execFileSync("git", args, {
    cwd: root,
    encoding,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function nulPaths(buffer) {
  return buffer
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function candidatePaths() {
  if (mode === "--staged") {
    return nulPaths(git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], "buffer"));
  }

  return nulPaths(git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"], "buffer"));
}

function trackedFileModes() {
  const modes = new Map();
  const records = git(["ls-files", "--stage", "-z"], "buffer")
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  for (const record of records) {
    const separator = record.indexOf("\t");
    if (separator === -1) {
      continue;
    }
    const [fileMode, , stage] = record.slice(0, separator).split(" ");
    if (stage === "0") {
      modes.set(record.slice(separator + 1), fileMode);
    }
  }
  return modes;
}

function readCandidate(path) {
  if (mode === "--staged") {
    return git(["show", `:${path}`], "buffer");
  }

  const absolutePath = resolve(root, path);
  if (!existsSync(absolutePath)) {
    return null;
  }

  const stats = lstatSync(absolutePath);
  if (stats.isSymbolicLink()) {
    return Buffer.from(readlinkSync(absolutePath), "utf8");
  }
  return stats.isFile() ? readFileSync(absolutePath) : null;
}

const findings = [];
const indexModes = trackedFileModes();
let scannedTextFiles = 0;
let skippedBinaryFiles = 0;

function report(path, line, kind) {
  const safePath = JSON.stringify(path).slice(1, -1);
  findings.push(`${safePath}${line ? `:${line}` : ""} — ${kind}`);
}

for (const path of candidatePaths()) {
  const name = basename(path).toLowerCase();
  const absolutePath = resolve(root, path);
  const indexMode = indexModes.get(path);
  const symbolicLink =
    indexMode === "120000" ||
    (mode === "--all" && existsSync(absolutePath) && lstatSync(absolutePath).isSymbolicLink());

  if (symbolicLink) {
    report(path, null, "symbolic links are not publishable");
    continue;
  }
  if (indexMode === "160000" || name === ".gitmodules") {
    report(path, null, "Git submodules are not publishable");
    continue;
  }

  for (const kind of inspectPublicPath(path)) {
    report(path, null, kind);
  }

  const buffer = readCandidate(path);
  if (buffer === null) {
    continue;
  }
  if (buffer.length > maxReviewBytes) {
    report(path, null, `file exceeds the ${maxReviewBytes}-byte review limit`);
    continue;
  }
  const inspection = inspectPublicBuffer(buffer);
  if (inspection.binary) {
    skippedBinaryFiles += 1;
  } else {
    scannedTextFiles += 1;
  }
  for (const finding of inspection.findings) {
    report(path, finding.line, finding.kind);
  }
}

if (findings.length > 0) {
  console.error(`Public-file check failed with ${findings.length} finding(s):`);
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  console.error("Replace real values with reserved examples; do not add an ignore for live data.");
  process.exit(1);
}

console.log(
  `Public-file check passed (${scannedTextFiles} text file(s), ${skippedBinaryFiles} binary file(s)).`,
);

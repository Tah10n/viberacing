import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";
import {
  inspectPublicBuffer,
  inspectPublicPath,
  maxReviewBytes,
} from "./lib/public-content-policy.mjs";

const args = process.argv.slice(2);
if (!(args.length === 0 || (args.length === 2 && args[0] === "--root" && args[1]))) {
  console.error("Usage: node scripts/check-git-history.mjs [--root <directory>]");
  process.exit(2);
}

const root = args.length === 0 ? resolve(import.meta.dirname, "..") : resolve(args[1]);
const findings = new Set();

function git(arguments_, encoding = "utf8") {
  return execFileSync("git", arguments_, {
    cwd: root,
    encoding,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function report(scope, line, kind) {
  findings.add(`${scope}${line ? `:${line}` : ""} — ${kind}`);
}

function inspectBuffer(scope, buffer) {
  if (buffer.length > maxReviewBytes) {
    report(scope, null, `object exceeds the ${maxReviewBytes}-byte review limit`);
    return { binary: false };
  }
  const inspection = inspectPublicBuffer(buffer);
  for (const finding of inspection.findings) {
    report(scope, finding.line, finding.kind);
  }
  return inspection;
}

try {
  git(["rev-parse", "--git-dir"]);
} catch {
  console.error("Git history check requires a Git repository.");
  process.exit(2);
}

if (git(["rev-parse", "--is-shallow-repository"]).trim() === "true") {
  report(
    "repository",
    null,
    "history is shallow; fetch the complete reachable history before scanning",
  );
}

const refs = git(["for-each-ref", "--format=%(refname)\t%(objectname)\t%(objecttype)"])
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => line.split("\t"));

for (const [refName] of refs) {
  inspectBuffer(`ref ${refName}`, Buffer.from(refName, "utf8"));
}

const commits = git(["rev-list", "--all"]).split(/\r?\n/).filter(Boolean);
const blobLocations = new Map();
const tagObjects = new Set(refs.filter(([, , type]) => type === "tag").map(([, oid]) => oid));
let uniqueHistoricalPaths = 0;

for (const commit of commits) {
  inspectBuffer(`commit ${commit.slice(0, 12)}`, git(["cat-file", "commit", commit], "buffer"));

  const records = git(["ls-tree", "-r", "-z", "--full-tree", commit], "buffer")
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  for (const record of records) {
    const separator = record.indexOf("\t");
    if (separator === -1) {
      report(`commit ${commit.slice(0, 12)}`, null, "malformed tree entry");
      continue;
    }
    const [mode, type, oid] = record.slice(0, separator).split(" ");
    const path = record.slice(separator + 1);
    const scope = `${path} @ ${commit.slice(0, 12)}`;

    for (const kind of inspectPublicPath(path)) {
      report(scope, null, kind);
    }
    if (mode === "120000") {
      report(scope, null, "symbolic links are not publishable");
    }
    if (mode === "160000" || type === "commit") {
      report(scope, null, "Git submodules are not publishable");
    }
    if (type !== "blob") {
      continue;
    }

    if (!blobLocations.has(oid)) {
      blobLocations.set(oid, new Map());
    }
    const locations = blobLocations.get(oid);
    if (!locations.has(path)) {
      locations.set(path, commit);
      uniqueHistoricalPaths += 1;
    }
  }
}

let binaryBlobs = 0;
for (const [oid, locations] of blobLocations) {
  const buffer = git(["cat-file", "blob", oid], "buffer");
  const representative = [...locations.entries()]
    .map(([path, commit]) => `${path} @ ${commit.slice(0, 12)}`)
    .sort((left, right) => left.localeCompare(right));

  if (buffer.length > maxReviewBytes) {
    for (const scope of representative) {
      report(scope, null, `object exceeds the ${maxReviewBytes}-byte review limit`);
    }
    continue;
  }
  const inspection = inspectPublicBuffer(buffer);
  if (inspection.binary) {
    binaryBlobs += 1;
  }
  for (const finding of inspection.findings) {
    for (const scope of representative) {
      report(scope, finding.line, finding.kind);
    }
  }
}

for (const oid of tagObjects) {
  inspectBuffer(`tag ${oid.slice(0, 12)}`, git(["cat-file", "tag", oid], "buffer"));
}

if (findings.size > 0) {
  console.error(`Git history check failed with ${findings.size} finding(s):`);
  for (const finding of [...findings].sort((left, right) => left.localeCompare(right))) {
    console.error(`- ${finding}`);
  }
  console.error("Rotate any real credential before rewriting or publishing affected history.");
  process.exit(1);
}

console.log(
  `Git history check passed (${refs.length} ref(s), ${commits.length} commit(s), ${blobLocations.size} unique blob(s), ${uniqueHistoricalPaths} historical path(s), ${binaryBlobs} binary blob(s), ${tagObjects.size} annotated tag(s)).`,
);

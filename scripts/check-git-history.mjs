import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";
import {
  inspectPublicBuffer,
  inspectPublicPath,
  maxReviewBytes,
} from "./lib/public-content-policy.mjs";

const args = process.argv.slice(2);
let root = resolve(import.meta.dirname, "..");
let rootSupplied = false;
let revision = null;
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  const value = args[index + 1];
  if (argument === "--root" && value && !rootSupplied) {
    root = resolve(value);
    rootSupplied = true;
    index += 1;
  } else if (argument === "--ref" && value && revision === null) {
    revision = value;
    index += 1;
  } else {
    console.error(
      "Usage: node scripts/check-git-history.mjs [--root <directory>] [--ref <revision>]",
    );
    process.exit(2);
  }
}
const findings = new Set();
const identityEmailPattern = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const signedOffByPrefix = "Signed-off-by:";
let verifiedDcoCommits = 0;

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

function isPlaceholderIdentityEmail(email) {
  const domain = email.toLowerCase().split("@").at(-1);
  return (
    domain === "example.com" ||
    domain === "example.net" ||
    domain === "example.org" ||
    domain === "localhost" ||
    domain?.endsWith(".invalid")
  );
}

function parseIdentity(scope, kind, value) {
  const match = /^(.*) <([^<>\s]+)> ([0-9]+) ([+-][0-9]{4})$/.exec(value);
  if (match === null || match[1].trim() !== match[1] || match[1].length === 0) {
    report(scope, null, `malformed ${kind} identity`);
    return null;
  }

  const [, name, email] = match;
  if (!identityEmailPattern.test(email)) {
    report(scope, null, `malformed ${kind} email`);
    return null;
  }
  if (isPlaceholderIdentityEmail(email)) {
    report(scope, null, `placeholder ${kind} email is not publishable Git identity`);
  }
  inspectBuffer(`${scope} ${kind} name`, Buffer.from(name, "utf8"));
  return { email, name };
}

function splitCommitObject(scope, buffer) {
  const separator = buffer.indexOf(Buffer.from("\n\n", "utf8"));
  if (separator === -1) {
    report(scope, null, "malformed commit object");
    return null;
  }

  const headerLines = buffer.subarray(0, separator).toString("utf8").split("\n");
  const headers = [];
  for (const line of headerLines) {
    if (line.startsWith(" ")) {
      if (headers.length === 0) {
        report(scope, null, "malformed continued commit header");
        return null;
      }
      headers.at(-1).value += `\n${line}`;
      continue;
    }

    const space = line.indexOf(" ");
    if (space <= 0) {
      report(scope, null, "malformed commit header");
      return null;
    }
    headers.push({ name: line.slice(0, space), value: line.slice(space + 1) });
  }

  return { headers, message: buffer.subarray(separator + 2).toString("utf8") };
}

function inspectCommit(scope, buffer) {
  const parsed = splitCommitObject(scope, buffer);
  if (parsed === null) {
    inspectBuffer(scope, buffer);
    return;
  }

  const authors = parsed.headers.filter((header) => header.name === "author");
  const committers = parsed.headers.filter((header) => header.name === "committer");
  if (authors.length !== 1) {
    report(scope, null, "commit must contain exactly one author header");
  }
  if (committers.length !== 1) {
    report(scope, null, "commit must contain exactly one committer header");
  }

  const author = authors.length === 1 ? parseIdentity(scope, "author", authors[0].value) : null;
  if (committers.length === 1) {
    parseIdentity(scope, "committer", committers[0].value);
  }
  for (const header of parsed.headers) {
    if (header.name !== "author" && header.name !== "committer") {
      inspectBuffer(`${scope} ${header.name} header`, Buffer.from(header.value, "utf8"));
    }
  }

  const lines = parsed.message.replace(/\r\n/g, "\n").split("\n");
  while (lines.at(-1) === "") {
    lines.pop();
  }
  const signoffIndexes = [];
  for (const [index, line] of lines.entries()) {
    if (line.toLowerCase().startsWith(signedOffByPrefix.toLowerCase())) {
      signoffIndexes.push(index);
    }
  }

  if (signoffIndexes.length === 0) {
    report(scope, null, "missing exact author DCO sign-off");
  } else if (signoffIndexes.length !== 1) {
    report(scope, null, "commit must contain exactly one Signed-off-by trailer");
  }

  let validDco = false;
  if (signoffIndexes.length === 1) {
    const index = signoffIndexes[0];
    if (index !== lines.length - 1) {
      report(scope, null, "Signed-off-by must be the final commit trailer");
    } else {
      const match = /^Signed-off-by: ([^<>\r\n]+) <([^<>\s]+)>$/.exec(lines[index]);
      if (match === null || !identityEmailPattern.test(match[2])) {
        report(scope, null, "malformed Signed-off-by trailer");
      } else if (author === null || match[1] !== author.name || match[2] !== author.email) {
        report(scope, null, "DCO sign-off does not match commit author");
      } else {
        validDco = true;
        lines[index] = "Signed-off-by: Public Contributor <contributor@example.invalid>";
        inspectBuffer(`${scope} DCO name`, Buffer.from(match[1], "utf8"));
      }
    }
  }

  inspectBuffer(`${scope} message`, Buffer.from(`${lines.join("\n")}\n`, "utf8"));
  if (validDco) {
    verifiedDcoCommits += 1;
  }
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

let refs;
let commits;
if (revision === null) {
  refs = git(["for-each-ref", "--format=%(refname)\t%(objectname)\t%(objecttype)"])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.split("\t"));
  commits = git(["rev-list", "--all"]).split(/\r?\n/).filter(Boolean);
} else {
  inspectBuffer("requested history revision", Buffer.from(revision, "utf8"));
  try {
    const object = git(["rev-parse", "--verify", "--end-of-options", revision]).trim();
    const commit = git([
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${revision}^{commit}`,
    ]).trim();
    const type = git(["cat-file", "-t", object]).trim();
    refs = [[`revision ${revision}`, object, type]];
    commits = git(["rev-list", commit]).split(/\r?\n/).filter(Boolean);
  } catch {
    console.error(`Git history revision does not resolve to a commit: ${revision}`);
    process.exit(2);
  }
}

for (const [refName] of refs) {
  inspectBuffer(`ref ${refName}`, Buffer.from(refName, "utf8"));
}

const blobLocations = new Map();
const tagObjects = new Set(refs.filter(([, , type]) => type === "tag").map(([, oid]) => oid));
let uniqueHistoricalPaths = 0;

for (const commit of commits) {
  inspectCommit(`commit ${commit.slice(0, 12)}`, git(["cat-file", "commit", commit], "buffer"));

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
  `Git history check passed (${refs.length} ref(s), ${commits.length} commit(s), ${verifiedDcoCommits} author-matched DCO sign-off(s), ${blobLocations.size} unique blob(s), ${uniqueHistoricalPaths} historical path(s), ${binaryBlobs} binary blob(s), ${tagObjects.size} annotated tag(s)).`,
);

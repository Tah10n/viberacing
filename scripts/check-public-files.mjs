import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const mode = process.argv[2] ?? "--all";
const maxTextBytes = 2 * 1024 * 1024;

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

function isBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8_192));
  if (sample.includes(0)) {
    return true;
  }

  let controlBytes = 0;
  for (const byte of sample) {
    const allowedControl = byte === 9 || byte === 10 || byte === 13;
    if (byte < 32 && !allowedControl) {
      controlBytes += 1;
    }
  }

  return sample.length > 0 && controlBytes / sample.length > 0.05;
}

function lineNumber(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

function isAllowedExampleEmail(email) {
  const domain = email.toLowerCase().split("@").at(-1);
  return (
    domain === "example.com" ||
    domain === "example.net" ||
    domain === "example.org" ||
    domain === "localhost" ||
    domain?.endsWith(".invalid")
  );
}

function isAllowedIpv4(address) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => octet < 0 || octet > 255)) {
    return true;
  }

  const [first, second, third] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113)
  );
}

const literalDetectors = [
  ["private key material", /-----BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+)?PRIVATE KEY-----/g],
  ["GitHub token", /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/g],
  ["OpenAI-style secret key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["Google API key", /\bAIza[A-Za-z0-9_-]{30,}\b/g],
  ["npm access token", /\bnpm_[A-Za-z0-9]{30,}\b/g],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
  ["Stripe secret", /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g],
  ["JSON Web Token", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g],
  [
    "credential-bearing connection URL",
    /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:/]+:[^\s@/]+@/gi,
  ],
  ["bearer credential", /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/-]{12,}/gi],
  ["Windows user-home path", /\b[A-Za-z]:\\(?:Users|Documents and Settings)\\[^\s\\/]+/g],
  ["macOS user-home path", /\/(?:Users)\/[^\s/]+/g],
  ["Linux user-home path", /\/home\/[^\s/]+/g],
];

const forbiddenKeyExtensions = new Set([".key", ".keystore", ".p12", ".pem", ".pfx"]);
const forbiddenKeyNames = new Set(["id_dsa", "id_ecdsa", "id_ed25519", "id_rsa"]);
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
  const extension = extname(name);
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

  if (/^\.env(?:\..+)?$/.test(name) && name !== ".env.example") {
    report(path, null, "environment file is not publishable");
  }
  if (name === ".npmrc") {
    report(path, null, "project npm authentication or registry configuration is not publishable");
  }
  if (forbiddenKeyExtensions.has(extension) || forbiddenKeyNames.has(name)) {
    report(path, null, "private-key-shaped filename is not publishable");
  }

  const buffer = readCandidate(path);
  if (buffer === null) {
    continue;
  }
  if (buffer.length > maxTextBytes) {
    report(path, null, `file exceeds the ${maxTextBytes}-byte review limit`);
    continue;
  }
  if (isBinary(buffer)) {
    skippedBinaryFiles += 1;
    continue;
  }

  scannedTextFiles += 1;
  const text = buffer.toString("utf8");

  for (const [kind, pattern] of literalDetectors) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      report(path, lineNumber(text, match.index), kind);
    }
  }

  const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  for (const match of text.matchAll(emailPattern)) {
    if (!isAllowedExampleEmail(match[0])) {
      report(path, lineNumber(text, match.index), "non-example email address");
    }
  }

  const ipv4Pattern = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g;
  for (const match of text.matchAll(ipv4Pattern)) {
    if (!isAllowedIpv4(match[0])) {
      report(path, lineNumber(text, match.index), "non-reserved public IPv4 address");
    }
  }

  const assignedSecretPattern =
    /\b(?:password|secret|token|api[_-]?key|client[_-]?secret)\s*[:=]\s*["']([^"'${}<>{}\s][^"'\s]{7,})["']/gi;
  for (const match of text.matchAll(assignedSecretPattern)) {
    const value = match[1].toLowerCase();
    const isPlaceholder = /^(?:example|placeholder|replace|test|dummy|fake|redacted|changeme)/.test(
      value,
    );
    if (!isPlaceholder) {
      report(path, lineNumber(text, match.index), "assigned secret-like value");
    }
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

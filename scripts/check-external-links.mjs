import { execFileSync } from "node:child_process";
import { lookup } from "node:dns/promises";
import { readFileSync } from "node:fs";
import { BlockList, isIP } from "node:net";
import { request } from "node:https";
import { resolve } from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
let root = resolve(import.meta.dirname, "..");
let online = false;
while (args.length > 0) {
  const argument = args.shift();
  if (argument === "--online") {
    online = true;
  } else if (argument === "--root" && args[0]) {
    root = resolve(args.shift());
  } else {
    console.error("Usage: node scripts/check-external-links.mjs [--online] [--root <directory>]");
    process.exit(2);
  }
}

function git(arguments_, encoding = "utf8") {
  return execFileSync("git", arguments_, {
    cwd: root,
    encoding,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const findings = new Set();
function report(path, line, message) {
  findings.add(`${path}${line ? `:${line}` : ""} — ${message}`);
}

let policy;
try {
  policy = JSON.parse(readFileSync(resolve(root, "config/external-links.json"), "utf8"));
} catch (error) {
  console.error(`External-link policy could not be read: ${error.message}`);
  process.exit(2);
}

if (policy.schemaVersion !== 1 || !Array.isArray(policy.hosts)) {
  report("config/external-links.json", null, "expected schemaVersion 1 and a hosts array");
}

const allowedHosts = new Set();
for (const [index, entry] of (policy.hosts ?? []).entries()) {
  const scope = `config/external-links.json hosts[${index}]`;
  if (
    entry === null ||
    typeof entry !== "object" ||
    Object.keys(entry).sort().join(",") !== "hostname,purpose"
  ) {
    report(scope, null, "entry must contain only hostname and purpose");
    continue;
  }
  if (
    typeof entry.hostname !== "string" ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))+$/.test(
      entry.hostname,
    )
  ) {
    report(scope, null, "hostname must be a lowercase DNS name");
    continue;
  }
  if (
    typeof entry.purpose !== "string" ||
    entry.purpose.length < 20 ||
    /(?:TBD|TODO|CHANGE.?ME)/i.test(entry.purpose)
  ) {
    report(scope, null, "purpose must be a specific reviewed explanation");
  }
  if (allowedHosts.has(entry.hostname)) {
    report(scope, null, `duplicate hostname ${entry.hostname}`);
  }
  allowedHosts.add(entry.hostname);
}

const sortedHosts = [...allowedHosts].sort((left, right) => left.localeCompare(right));
if (sortedHosts.join("\n") !== [...allowedHosts].join("\n")) {
  report("config/external-links.json", null, "hosts must be sorted by hostname");
}

const markdownPaths = git(
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "*.md"],
  "buffer",
)
  .toString("utf8")
  .split("\0")
  .filter(Boolean)
  .sort((left, right) => left.localeCompare(right));

const seenHosts = new Set();
const externalUrls = new Map();
const absoluteSchemePattern = /^[a-z][a-z0-9+.-]*:/i;

function cleanRawUrl(candidate) {
  let value = candidate;
  while (/[.,;:!?\]]$/.test(value)) {
    value = value.slice(0, -1);
  }
  while (value.endsWith(")")) {
    const opens = (value.match(/\(/g) ?? []).length;
    const closes = (value.match(/\)/g) ?? []).length;
    if (closes <= opens) {
      break;
    }
    value = value.slice(0, -1);
  }
  return value;
}

function validateTarget(path, line, rawTarget) {
  if (!absoluteSchemePattern.test(rawTarget)) {
    return;
  }
  let url;
  try {
    url = new URL(rawTarget);
  } catch {
    report(path, line, `malformed absolute link ${JSON.stringify(rawTarget)}`);
    return;
  }
  if (url.protocol !== "https:") {
    report(path, line, `absolute links must use HTTPS, found ${url.protocol}`);
    return;
  }
  if (url.username || url.password) {
    report(path, line, "link must not contain URL credentials");
  }
  if (url.port) {
    report(path, line, "external link must not use a custom port");
  }
  if (isIP(url.hostname) !== 0 || url.hostname === "localhost") {
    report(
      path,
      line,
      "external link must use a reviewed DNS hostname, not a literal/local address",
    );
  }
  if (!allowedHosts.has(url.hostname)) {
    report(path, line, `external hostname is not reviewed: ${url.hostname}`);
  } else {
    seenHosts.add(url.hostname);
  }
  for (const key of url.searchParams.keys()) {
    if (/(?:auth|credential|key|password|secret|signature|token)/i.test(key)) {
      report(path, line, `sensitive query parameter name is forbidden: ${key}`);
    }
  }
  if (!externalUrls.has(url.href)) {
    externalUrls.set(url.href, { path, line, url });
  }
}

for (const path of markdownPaths) {
  const text = readFileSync(resolve(root, path), "utf8");
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const markdownTargetPattern = /\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))/g;
    for (const match of line.matchAll(markdownTargetPattern)) {
      validateTarget(path, lineNumber, (match[1] ?? match[2]).trim());
    }
    const autoLinkPattern = /<([a-z][a-z0-9+.-]*:[^>\s]+)>/gi;
    for (const match of line.matchAll(autoLinkPattern)) {
      validateTarget(path, lineNumber, match[1]);
    }
    const rawUrlPattern = /\bhttps?:\/\/[^\s<>"'`]+/gi;
    for (const match of line.matchAll(rawUrlPattern)) {
      validateTarget(path, lineNumber, cleanRawUrl(match[0]));
    }
  }
}

for (const hostname of allowedHosts) {
  if (!seenHosts.has(hostname)) {
    report("config/external-links.json", null, `unused allowlisted hostname: ${hostname}`);
  }
}

const blockedAddresses = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
]) {
  blockedAddresses.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["100::", 64],
  ["2001:2::", 48],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
]) {
  blockedAddresses.addSubnet(address, prefix, "ipv6");
}

async function checkOnline(entry) {
  const addresses = await lookup(entry.url.hostname, { all: true, verbatim: true });
  if (
    addresses.length === 0 ||
    addresses.some(({ address, family }) =>
      blockedAddresses.check(address, family === 4 ? "ipv4" : "ipv6"),
    )
  ) {
    throw new Error("DNS returned a non-public address");
  }
  const selected = addresses[0];

  await new Promise((resolvePromise, reject) => {
    const request_ = request(
      entry.url,
      {
        headers: { "User-Agent": "Vibe-Racing-link-check/0.0 (no credentials)" },
        lookup(_hostname, options, callback) {
          if (options.all) {
            callback(null, [selected]);
          } else {
            callback(null, selected.address, selected.family);
          }
        },
        method: "HEAD",
      },
      (response) => {
        response.resume();
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolvePromise();
        } else if (response.statusCode >= 300 && response.statusCode < 400) {
          reject(new Error(`redirect ${response.statusCode}; use the canonical destination URL`));
        } else {
          reject(new Error(`HTTP ${response.statusCode}`));
        }
      },
    );
    request_.setTimeout(10_000, () => request_.destroy(new Error("request timed out")));
    request_.on("error", reject);
    request_.end();
  });
}

if (online && findings.size === 0) {
  if (externalUrls.size > 100) {
    report("repository", null, "online link check is limited to 100 unique URLs");
  } else {
    for (const entry of [...externalUrls.values()].sort((left, right) =>
      left.url.href.localeCompare(right.url.href),
    )) {
      try {
        await checkOnline(entry);
      } catch (error) {
        report(
          entry.path,
          entry.line,
          `${entry.url.href} failed online validation: ${error.message}`,
        );
      }
    }
  }
}

if (findings.size > 0) {
  console.error(`External-link check failed with ${findings.size} finding(s):`);
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log(
  `External-link check passed (${markdownPaths.length} Markdown file(s), ${externalUrls.size} unique HTTPS URL(s), ${seenHosts.size} reviewed host(s)${online ? ", online validation enabled" : ""}).`,
);

import { basename, extname } from "node:path";

export const maxReviewBytes = 2 * 1024 * 1024;

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
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113)
  );
}

export function isBinaryBuffer(buffer) {
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

function printableMetadata(buffer) {
  let text = "";
  for (const byte of buffer) {
    const printable = byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126);
    text += printable ? String.fromCharCode(byte) : "\n";
  }
  return text;
}

export function inspectPublicPath(path) {
  const findings = [];
  const name = basename(path).toLowerCase();
  const extension = extname(name);

  if (/^\.env(?:\..+)?$/.test(name) && name !== ".env.example") {
    findings.push("environment file is not publishable");
  }
  if (name === ".npmrc") {
    findings.push("project npm authentication or registry configuration is not publishable");
  }
  if (forbiddenKeyExtensions.has(extension) || forbiddenKeyNames.has(name)) {
    findings.push("private-key-shaped filename is not publishable");
  }

  return findings;
}

export function inspectPublicBuffer(buffer) {
  const binary = isBinaryBuffer(buffer);
  const text = binary ? printableMetadata(buffer) : buffer.toString("utf8");
  const findings = [];

  function add(offset, kind) {
    findings.push({ kind, line: binary ? null : lineNumber(text, offset) });
  }

  for (const [kind, pattern] of literalDetectors) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      add(match.index, kind);
    }
  }

  const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  for (const match of text.matchAll(emailPattern)) {
    if (!isAllowedExampleEmail(match[0])) {
      add(match.index, "non-example email address");
    }
  }

  const ipv4Pattern = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g;
  for (const match of text.matchAll(ipv4Pattern)) {
    if (!isAllowedIpv4(match[0])) {
      add(match.index, "non-reserved public IPv4 address");
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
      add(match.index, "assigned secret-like value");
    }
  }

  return { binary, findings };
}

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
if (!(args.length === 0 || (args.length === 2 && args[0] === "--root" && args[1]))) {
  console.error("Usage: node scripts/check-architecture.mjs [--root <directory>]");
  process.exit(2);
}

const root = args.length === 0 ? resolve(import.meta.dirname, "..") : resolve(args[1]);
const findings = [];

function report(path, message) {
  findings.push(`${path} — ${message}`);
}

function readRequired(path) {
  const absolutePath = resolve(root, path);
  if (!existsSync(absolutePath)) {
    report(path, "required architecture document is missing");
    return null;
  }
  return readFileSync(absolutePath, "utf8");
}

const requiredFiles = [
  "ROADMAP.md",
  "docs/architecture/COMPATIBILITY_POLICY.md",
  "docs/architecture/DATA_FLOW.md",
  "docs/architecture/SECURITY_INVARIANTS.md",
  "docs/architecture/SYSTEM_CONTEXT.md",
  "docs/PROJECT_PLAN.md",
  "docs/decisions/0000-template.md",
  "docs/decisions/0001-community-trust-tier.md",
  "docs/decisions/0002-opaque-multi-source-aggregation.md",
  "docs/decisions/0003-identity-step-up-and-device-authority.md",
  "docs/decisions/0004-edge-service-and-database-isolation.md",
  "docs/decisions/0005-enum-only-car-recipe.md",
  "docs/decisions/0006-public-repository-boundary.md",
  "docs/decisions/0007-restricted-recovery-authority.md",
  "docs/decisions/0068-multi-agent-token-leaderboard-and-mcp.md",
  "docs/decisions/0069-thin-client-and-low-friction-onboarding.md",
  "docs/decisions/0076-clean-agent-account-provider-reported-token-ranking.md",
  "docs/decisions/README.md",
  "docs/reference/agent-provider-compatibility.md",
  "docs/reference/codex-compatibility.md",
  "docs/security/ABUSE_CASES.md",
  "docs/security/PRIVACY_DATA_MAP.md",
  "docs/security/THREAT_MODEL.md",
];
const texts = new Map(requiredFiles.map((path) => [path, readRequired(path)]));

const requiredContent = new Map([
  [
    "docs/security/THREAT_MODEL.md",
    [
      "## Overview",
      "## Threat Model, Trust Boundaries, and Assumptions",
      "## Attack Surface, Mitigations, and Attacker Stories",
      "## Severity Calibration (Critical, High, Medium, Low)",
      "The current tree contains",
      "Implementation status",
      "security invariants",
    ],
  ],
  [
    "docs/security/PRIVACY_DATA_MAP.md",
    [
      "## Classification",
      "## Planned field inventory",
      "## Prohibited data",
      "## User controls and deletion",
      "Pairing poll token, HMAC keys/verifiers, challenge, user code, transaction",
      "launch decision required",
    ],
  ],
  [
    "docs/architecture/COMPATIBILITY_POLICY.md",
    [
      "## Version axes",
      "## Provider reader contracts",
      "## Contract and API rules",
      "## Date and time semantics",
      "## Deprecation and emergency block",
    ],
  ],
  [
    "docs/reference/agent-provider-compatibility.md",
    [
      "Compatibility status:",
      "## Admission requirements",
      "## Current support declaration",
      "`codex`",
      "`claude_code`",
      "`opencode`",
    ],
  ],
  [
    "docs/reference/codex-compatibility.md",
    ["Compatibility status:", "## Admission requirements", "## Planned stable surface"],
  ],
  [
    "docs/architecture/SYSTEM_CONTEXT.md",
    [
      "## Status",
      "## External actors and systems",
      "## Container view",
      "## Component responsibilities",
    ],
  ],
  [
    "docs/architecture/DATA_FLOW.md",
    [
      "## GitHub enrollment and primary passkey",
      "## Batch discovery and pairing approval",
      "keyed poll/code verifiers",
      "one fresh passkey assertion",
      "## Local collection and signed synchronization",
      "## Snapshot refresh and public read",
      "## Hide and deletion",
      "## Trusted release",
    ],
  ],
  [
    "docs/decisions/0003-identity-step-up-and-device-authority.md",
    ["persist only a keyed token verifier", "an Ed25519 proof over the bound"],
  ],
]);

for (const [path, fragments] of requiredContent) {
  const text = texts.get(path);
  if (text === null) {
    continue;
  }
  for (const fragment of fragments) {
    if (!text.includes(fragment)) {
      report(path, `required architecture content is missing: ${JSON.stringify(fragment)}`);
    }
  }
}

const compatibilityPath = "docs/reference/codex-compatibility.md";
const compatibility = texts.get(compatibilityPath);
if (compatibility !== null) {
  const statusMatches = [
    ...compatibility.matchAll(
      /^Compatibility status:\s*(no supported versions|supported entries present)\.\s*$/gm,
    ),
  ];
  if (statusMatches.length !== 1) {
    report(compatibilityPath, "expected exactly one valid compatibility status declaration");
  }

  const currentSupportHeading = compatibility.match(/^## Current support\s*$/m);
  let currentSupport;
  if (currentSupportHeading !== null) {
    const sectionStart = currentSupportHeading.index + currentSupportHeading[0].length;
    const remaining = compatibility.slice(sectionStart);
    const nextHeading = remaining.search(/^## /m);
    currentSupport = nextHeading === -1 ? remaining : remaining.slice(0, nextHeading);
  }
  let rows = [];
  if (currentSupport === undefined) {
    report(compatibilityPath, "Current support section is missing");
  } else {
    const lines = currentSupport.split(/\r?\n/);
    const headerIndex = lines.findIndex((line) =>
      /^\|\s*Codex version\s*\|\s*Stable schema digest\s*\|\s*Compatible connector\s*\|\s*Platforms tested\s*\|\s*Status and evidence\s*\|$/.test(
        line,
      ),
    );
    if (headerIndex === -1 || !/^\|(?:\s*:?-{3,}:?\s*\|){5}$/.test(lines[headerIndex + 1] ?? "")) {
      report(compatibilityPath, "Current support table header or separator is invalid");
    } else {
      rows = [];
      for (const line of lines.slice(headerIndex + 2)) {
        if (!line.trimStart().startsWith("|")) {
          break;
        }
        rows.push(line);
      }
      rows = rows.map((line) =>
        line
          .split("|")
          .slice(1, -1)
          .map((cell) => cell.trim()),
      );
      for (const cells of rows) {
        if (cells.length !== 5 || cells.some((cell) => cell.length === 0)) {
          report(compatibilityPath, "every compatibility row must contain five non-empty cells");
        }
      }
    }
  }

  const status = statusMatches[0]?.[1];
  if (status === "no supported versions") {
    if (
      !compatibility.includes("No Codex version and no Vibe Racing connector version is supported.")
    ) {
      report(
        compatibilityPath,
        "empty compatibility state must state that no version is supported",
      );
    }
    if (
      rows.length !== 1 ||
      rows[0]?.[0] !== "None" ||
      rows[0]?.[1] !== "Not available" ||
      rows[0]?.[2] !== "Not released" ||
      rows[0]?.[3] !== "None" ||
      !rows[0]?.[4].startsWith("Unsupported")
    ) {
      report(compatibilityPath, "empty compatibility state must contain only the sentinel row");
    }
  }

  if (status === "supported entries present") {
    if (
      compatibility.includes("No Codex version and no Vibe Racing connector version is supported.")
    ) {
      report(
        compatibilityPath,
        "supported compatibility state contradicts the no-support statement",
      );
    }
    if (rows.length === 0 || rows.some((cells) => cells[0] === "None")) {
      report(compatibilityPath, "supported compatibility state requires at least one real row");
    }
    for (const [codexVersion, digest, connectorRange, platforms, evidence] of rows) {
      if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(codexVersion ?? "")) {
        report(
          compatibilityPath,
          `Codex version is not an exact semantic version: ${codexVersion}`,
        );
      }
      if (!/^sha256:[a-f0-9]{64}$/.test(digest ?? "")) {
        report(compatibilityPath, `stable schema digest is invalid for Codex ${codexVersion}`);
      }
      if (
        !/\d+\.\d+\.\d+/.test(connectorRange ?? "") ||
        /(?:^|\s)(?:latest|\*)(?:\s|$)/i.test(connectorRange ?? "")
      ) {
        report(compatibilityPath, `connector range is not bounded for Codex ${codexVersion}`);
      }
      if (/^(?:None|Not available|Not tested)$/i.test(platforms ?? "")) {
        report(compatibilityPath, `tested platforms are missing for Codex ${codexVersion}`);
      }
      if (!/^Supported\b/.test(evidence ?? "") || !/\[[^\]]+\]\([^)]+\)/.test(evidence ?? "")) {
        report(compatibilityPath, `immutable evidence link is missing for Codex ${codexVersion}`);
      }
    }
  }
}

const invariants = texts.get("docs/architecture/SECURITY_INVARIANTS.md");
if (invariants !== null) {
  const ids = [...invariants.matchAll(/\|\s*(VR-[A-Z]+(?:-[A-Z]+)*-\d{3})\s*\|/g)].map(
    (match) => match[1],
  );
  if (ids.length < 15 || new Set(ids).size !== ids.length) {
    report(
      "docs/architecture/SECURITY_INVARIANTS.md",
      "expected at least 15 unique security invariant IDs",
    );
  }
}

const privacy = texts.get("docs/security/PRIVACY_DATA_MAP.md");
if (privacy !== null) {
  for (const classification of [
    "Public",
    "Account",
    "Security",
    "Usage",
    "Operational",
    "Prohibited",
  ]) {
    if (!new RegExp(`\\|\\s*${classification}\\s*\\|`).test(privacy)) {
      report(
        "docs/security/PRIVACY_DATA_MAP.md",
        `privacy classification is missing: ${classification}`,
      );
    }
  }
  for (const prohibited of ["prompts", "repository contents", "account email", "API keys"]) {
    if (!privacy.toLowerCase().includes(prohibited.toLowerCase())) {
      report(
        "docs/security/PRIVACY_DATA_MAP.md",
        `prohibited data category is missing: ${prohibited}`,
      );
    }
  }
}

const cleanAgentAccountContracts = new Map([
  [
    "ROADMAP.md",
    [
      "## Stage 1 — Clean database bootstrap",
      "## Stage 3 — Atomic usage accounting",
      "## Stage 6 — Thin multi-agent connector",
      "## Stage 9 — Final evidence and review",
    ],
  ],
  [
    "docs/PROJECT_PLAN.md",
    [
      "one `AgentAccount` is one logical account",
      "POST /v1/usage",
      "Public Web has no live ranking capability",
      "Delivery sequence and commit boundaries",
      "Explicit non-goals for this replacement",
    ],
  ],
  [
    "docs/decisions/0076-clean-agent-account-provider-reported-token-ranking.md",
    [
      "- Status: Accepted",
      "Clean-slate pre-release replacement",
      "`AgentAccount` is one logical account",
      "provider_reported_tokens_v1",
      "one database transaction",
      "Public requests never aggregate raw ranking tables",
      "no anonymous profile",
      "POST /v1/usage",
      "GET /v1/leaderboards/current",
    ],
  ],
  [
    "docs/architecture/SECURITY_INVARIANTS.md",
    [
      "VR-IDENTITY-001",
      "VR-ACCOUNT-001",
      "VR-COUNT-001",
      "VR-DEDUP-001",
      "VR-DATE-001",
      "VR-INGEST-ATOMIC-001",
      "VR-PRIVACY-001",
      "VR-SNAPSHOT-001",
      "VR-SCOPE-001",
      "One immutable GitHub numeric user ID has at most one profile",
      "device or installation count never changes tokens or rank",
      "PostgreSQL clock rejects future dates",
      "equal totals share rank",
      "provider_reported_tokens_v1",
    ],
  ],
  [
    "docs/security/THREAT_MODEL.md",
    [
      "TB-04",
      "Agent local storage to built-in reader",
      "Multi-device double counting",
      "Snapshot poisoning or partial publication",
      "Community-to-Verified promotion",
    ],
  ],
  [
    "docs/security/PRIVACY_DATA_MAP.md",
    [
      "AgentAccount provider, accounting revision, trust, scope",
      "Account-scoped device private key",
      "Canonical cumulative token-total decimal string",
      "One counted cumulative total per logical account",
      "There is no anonymous identity bootstrap key",
    ],
  ],
  [
    "docs/security/ABUSE_CASES.md",
    [
      "VR-ABUSE-DEVICE-MULTIPLICATION",
      "VR-ABUSE-ACCOUNT-OVERLAP",
      "VR-ABUSE-INGEST-ZERO-WRITE",
      "VR-ABUSE-SNAPSHOT-PARTIAL",
      "VR-ABUSE-TRUST-PROMOTION",
    ],
  ],
]);

function normalizeContractText(value) {
  return value.replace(/\s+/gu, " ").trim();
}

for (const [path, fragments] of cleanAgentAccountContracts) {
  const document = texts.get(path);
  if (document === null) {
    continue;
  }
  const normalizedDocument = normalizeContractText(document);
  for (const fragment of fragments) {
    if (!normalizedDocument.includes(normalizeContractText(fragment))) {
      report(path, `required clean-agent-account contract is missing: ${JSON.stringify(fragment)}`);
    }
  }
}

const forbiddenCurrentArchitectureText = new Map([
  [
    "docs/architecture/SECURITY_INVARIANTS.md",
    ["## Proposed invariant amendments", "A CodexSource is", "`community_tokens_v1` season"],
  ],
  [
    "docs/security/THREAT_MODEL.md",
    ["TB-15 | Low-friction enrollment", "anonymous ownership lease"],
  ],
  [
    "docs/security/PRIVACY_DATA_MAP.md",
    ["Anonymous identity bootstrap key —", "`codex_sources`", "`community_tokens_v1` public"],
  ],
  ["docs/security/ABUSE_CASES.md", ["VR-ABUSE-ENROLL-CREDENTIAL", "opaque CodexSource"]],
]);

for (const [path, fragments] of forbiddenCurrentArchitectureText) {
  const document = texts.get(path);
  if (document === null) {
    continue;
  }
  const normalizedDocument = normalizeContractText(document);
  for (const fragment of fragments) {
    if (normalizedDocument.includes(normalizeContractText(fragment))) {
      report(path, `forbidden current-architecture text is present: ${JSON.stringify(fragment)}`);
    }
  }
}

const abusePath = "docs/security/ABUSE_CASES.md";
const abuse = texts.get(abusePath);
if (abuse !== null) {
  const cases = [...abuse.matchAll(/^### (VR-ABUSE-[A-Z0-9-]+) — .+$/gm)];
  const ids = cases.map((match) => match[1]);
  if (cases.length < 15) {
    report(abusePath, "expected at least 15 structured abuse cases");
  }
  if (new Set(ids).size !== ids.length) {
    report(abusePath, "abuse-case IDs must be unique");
  }
  const requiredFields = [
    "Attacker",
    "Preconditions",
    "Abuse",
    "Impact",
    "Controls",
    "Detection",
    "Recovery",
    "Residual risk",
  ];
  for (const [index, match] of cases.entries()) {
    const end = cases[index + 1]?.index ?? abuse.length;
    const section = abuse.slice(match.index, end);
    for (const field of requiredFields) {
      if (!new RegExp(`^- \\*\\*${field}:\\*\\*`, "m").test(section)) {
        report(abusePath, `${match[1]} is missing the ${field} field`);
      }
    }
  }
}

const decisionsDirectory = resolve(root, "docs/decisions");
if (existsSync(decisionsDirectory)) {
  const decisionFiles = readdirSync(decisionsDirectory)
    .filter((name) => /^\d{4}-[a-z0-9-]+\.md$/.test(name))
    .sort();
  const decisionIndex = texts.get("docs/decisions/README.md") ?? "";
  const indexHeading = decisionIndex.match(/^## Index\s*$/m);
  let decisionIndexSection = "";
  if (indexHeading === null) {
    report("docs/decisions/README.md", "decision index section is missing");
  } else {
    const sectionStart = indexHeading.index + indexHeading[0].length;
    const remaining = decisionIndex.slice(sectionStart);
    const nextHeading = remaining.search(/^## /m);
    decisionIndexSection = nextHeading === -1 ? remaining : remaining.slice(0, nextHeading);
  }
  const numbers = new Set();
  let acceptedDecisions = 0;

  for (const file of decisionFiles) {
    if (!decisionIndexSection.includes(`(${file})`)) {
      report("docs/decisions/README.md", `decision index does not link ${file}`);
    }
    if (file === "0000-template.md") {
      continue;
    }
    const path = `docs/decisions/${file}`;
    const text = readRequired(path);
    if (text === null) {
      continue;
    }
    const fileNumber = file.slice(0, 4);
    const titleNumber = text.match(/^# ADR (\d{4}):\s+\S/m)?.[1];
    if (titleNumber !== fileNumber) {
      report(path, "ADR title number must match its filename");
    }
    if (numbers.has(fileNumber)) {
      report(path, `ADR number is duplicated: ${fileNumber}`);
    }
    numbers.add(fileNumber);

    const status = text.match(/^- Status:\s*(.+?)\s*$/m)?.[1] ?? "";
    if (!/^(?:Accepted|Deprecated|Proposed|Rejected|Superseded)(?: \(.+\))?$/.test(status)) {
      report(path, `ADR status is invalid: ${JSON.stringify(status)}`);
    }
    if (status.startsWith("Accepted")) {
      acceptedDecisions += 1;
    }
    const date = text.match(/^- Date:\s*(.+?)\s*$/m)?.[1] ?? "";
    const parsedDate = new Date(`${date}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== date
    ) {
      report(path, "ADR date must be a valid ISO calendar date");
    }
    for (const metadata of ["Decision owners", "Supersedes", "Superseded by"]) {
      if (!new RegExp(`^- ${metadata}:\\s*\\S`, "m").test(text)) {
        report(path, `ADR metadata is missing: ${metadata}`);
      }
    }
    for (const heading of [
      "## Context",
      "## Decision",
      "## Security and privacy consequences",
      "## Alternatives considered",
      "## Migration and rollback",
      "## Verification",
      "## References",
    ]) {
      if (!text.includes(heading)) {
        report(path, `ADR section is missing: ${heading}`);
      }
    }
    if (/\b(?:CHANGE[ _-]?ME|TBD|TODO|YOUR[ _-](?:EMAIL|HANDLE|NAME))\b/i.test(text)) {
      report(path, "accepted/proposed ADR contains an unresolved placeholder");
    }
  }

  if (acceptedDecisions < 6) {
    report("docs/decisions/README.md", "expected at least six accepted initial decisions");
  }

  const indexedFiles = [...decisionIndexSection.matchAll(/\((\d{4}-[a-z0-9-]+\.md)\)/g)].map(
    (match) => match[1],
  );
  if (new Set(indexedFiles).size !== indexedFiles.length) {
    report("docs/decisions/README.md", "decision index must not contain duplicate links");
  }
  for (const file of indexedFiles) {
    if (!decisionFiles.includes(file)) {
      report("docs/decisions/README.md", `decision index links a missing file: ${file}`);
    }
  }
}

const ignoredMarkdownDirectories = new Set([
  ".cache",
  ".codex",
  ".codex-log",
  ".git",
  ".idea",
  ".next",
  ".pnpm-store",
  ".turbo",
  "build",
  "coverage",
  "credentials",
  "data",
  "dist",
  "logs",
  "node_modules",
  "playwright-report",
  "secrets",
  "target",
  "temp",
  "test-results",
  "tmp",
]);

function fallbackMarkdownFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && !ignoredMarkdownDirectories.has(entry.name)) {
      files.push(...fallbackMarkdownFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(path);
    }
  }
  return files;
}

function gitMarkdownFiles() {
  if (!existsSync(resolve(root, ".git"))) {
    return null;
  }

  const result = spawnSync(
    "git",
    ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "*.md"],
    {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0) {
    report("repository", "Git Markdown inventory could not be derived");
    return [];
  }

  return result.stdout
    .split("\0")
    .filter(Boolean)
    .map((path) => resolve(root, path))
    .filter((path) => existsSync(path))
    .sort();
}

const repositoryMarkdownFiles = gitMarkdownFiles() ?? fallbackMarkdownFiles(root).sort();
const docsDirectory = resolve(root, "docs");
let mermaidBlocks = 0;
const removedProductScopePatterns = [
  /\btyping(?:-|\s)+(?:race|game)\b/i,
  /\bkeyboard(?:-|\s)+rac(?:e|ing)\b/i,
  /\bVR-(?:GAME|ABUSE-GAME)-[A-Z0-9-]+\b/,
];
for (const absolutePath of repositoryMarkdownFiles) {
  const path = relative(root, absolutePath).replaceAll("\\", "/");
  const text = readFileSync(absolutePath, "utf8");
  for (const pattern of removedProductScopePatterns) {
    if (pattern.test(text)) {
      report(path, `removed product scope is still documented: ${pattern}`);
    }
  }
}

if (existsSync(docsDirectory)) {
  for (const absolutePath of repositoryMarkdownFiles.filter((path) =>
    relative(root, path).replaceAll("\\", "/").startsWith("docs/"),
  )) {
    const path = relative(root, absolutePath).replaceAll("\\", "/");
    const text = readFileSync(absolutePath, "utf8");
    const starts = [...text.matchAll(/```mermaid[ \t]*\r?\n/g)];
    const blocks = [...text.matchAll(/```mermaid[ \t]*\r?\n([\s\S]*?)\r?\n```/g)];
    if (starts.length !== blocks.length) {
      report(path, "Mermaid code fence is not closed correctly");
    }
    mermaidBlocks += blocks.length;
    for (const block of blocks) {
      const firstLine = block[1]
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      if (!/^(?:flowchart|sequenceDiagram|stateDiagram-v2|erDiagram)\b/.test(firstLine ?? "")) {
        report(path, `unsupported Mermaid diagram declaration: ${JSON.stringify(firstLine)}`);
      }
    }
  }
}
if (mermaidBlocks < 8) {
  report("docs", "expected at least eight closed architecture Mermaid diagrams");
}

if (findings.length > 0) {
  console.error(`Architecture check failed with ${findings.length} finding(s):`);
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log(
  `Architecture check passed (${requiredFiles.length} required document(s), ${mermaidBlocks} Mermaid diagram(s)).`,
);

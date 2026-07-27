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
  "docs/decisions/README.md",
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
      "implementation status",
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
      "## Codex App Server contract",
      "## Date and time semantics",
      "## Deprecation and emergency block",
    ],
  ],
  [
    "docs/reference/codex-compatibility.md",
    ["Compatibility status:", "## Admission requirements", "## Planned stable surface"],
  ],
  [
    "docs/architecture/SYSTEM_CONTEXT.md",
    ["## Status", "## System context", "## Container view", "## Component responsibilities"],
  ],
  [
    "docs/architecture/DATA_FLOW.md",
    [
      "## Enrollment and passkey bootstrap",
      "## Device pairing and source choice",
      "keyed poll verifier",
      "Ed25519 proof over bound challenge",
      "## Local collection and signed synchronization",
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
  const ids = [...invariants.matchAll(/\|\s*(VR-[A-Z]+-\d{3})\s*\|/g)].map((match) => match[1]);
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

const proposedArchitectureContracts = new Map([
  [
    "ROADMAP.md",
    [
      "## Phase 6 — Proposed multi-agent thin client, hybrid onboarding, and canonical accounting",
      "## Phase 7 — Direct token-total leaderboard (local Codex slice implemented)",
      "## Phase 8 — Thin MVP staging and invite beta",
      "## Phase 9 — Proposed optional MCP submission",
      "## Phase 10 — Proposed per-provider Verified tier",
      "community_tokens_v1",
      "MCP only as an optional",
      "provider/model/cost multiplier",
      "all users of any coding agent",
      "server-clock 90-day lease",
      "Jobs-only system-expiry cleanup",
      "Do not claim hardware-backed non-exportability",
    ],
  ],
  [
    "docs/architecture/SECURITY_INVARIANTS.md",
    [
      "## Proposed invariant amendments (non-authoritative)",
      "They do not",
      "amend the active table above",
      "Implementations must continue to satisfy the active table until an ADR is Accepted",
      "server-clock 90-day ownership lease",
      "separate bounded Jobs-only system-expiry cleanup",
      "does not claim hardware-backed non-exportability",
    ],
  ],
  [
    "docs/decisions/0068-multi-agent-token-leaderboard-and-mcp.md",
    [
      "- Status: Proposed",
      "VR-TRUST-002 would be amended",
      "Proposed new invariants (non-authoritative",
      "The weekly token leaderboard remains the sole public ranking surface",
      "community_tokens_v1",
      "weeklyTokenTotal",
      "No logarithm, active-day bonus",
      "nested cache/reasoning/thought breakdown twice",
      "provider/model/cost",
      "revision cannot change mid-season",
      "MCP compatibility alone never",
      "provider is not client-writable",
      "server derives it from the immutable AgentSource",
      "provider field in the body is rejected as unknown",
      "VR-TOKEN-001",
      "VR-MCP-001",
      "VR-PROVIDER-001",
    ],
  ],
  [
    "docs/decisions/0069-thin-client-and-low-friction-onboarding.md",
    [
      "- Status: Proposed",
      "register exactly the first passkey",
      "NOT enter the restricted-recovery flow",
      "marks the identity bootstrap credential retired",
      "unique reservation rule makes concurrent use",
      "rejected before challenge issuance",
      "proof is locally consumed and cannot be rolled back or reused",
      "Sequential all-source submit",
      "Minimal payload by construction",
      "never automatically merged",
      "GitHub first-passkey authority",
      "`first-passkey-complete`",
      "multiple independently revocable device keys",
      "GitHub is not required",
      "single-source/single-season",
      "Wednesday 00:00 UTC",
      "cannot be quarantined by the older dates",
      "profiles.github_user_id NOT NULL UNIQUE",
      "90-day anonymous ownership lease",
      "ordinary sync never renews it",
      "30-day terminal promotion grace",
      "separate Jobs-only system-expiry capability",
      "profile remains hidden and its sources remain paused",
      "does not fabricate a user deletion request",
      "No partial daily total or signed request is emitted for that source/day",
      "explicitly recognized non-usage record type",
      "does not claim hardware-backed non-exportability",
    ],
  ],
  [
    "docs/PROJECT_PLAN.md",
    [
      "registration of exactly the first passkey",
      "proof-class-specific semantics",
      "one-way local consumption record before challenge issuance",
      "fail generically with zero mutation",
      "sequential, independently bounded and signed single-source",
      "direct `weeklyTokenTotal`",
      "MCP compatibility alone",
      "payload rejects model names",
      "whether anonymous or GitHub-linked",
      "UsageSyncV1 rejects a provider field",
      "`first-passkey-complete`",
      "single-source/single-season",
      "### Phase 8 — Thin MVP staging and invite beta",
      "90-day anonymous ownership lease",
      "ordinary sync cannot",
      "Jobs-only system-expiry capability",
      "no partial daily total or signed request is emitted",
      "does not claim hardware-backed non-exportability",
    ],
  ],
  [
    "docs/security/PRIVACY_DATA_MAP.md",
    [
      "Canonical source/day token total",
      "Public weekly token total",
      "raw provider components are discarded locally",
      "One key per device authority",
      "not client-writable in UsageSyncV1",
      "arbitrary MCP request/response data outside the exact",
      "GitHub first-passkey authority",
      "Anonymous ownership lease and terminal-expiry state",
      "ordinary sync never renews it",
      "does not claim hardware-backed non-exportability",
    ],
  ],
  [
    "docs/security/ABUSE_CASES.md",
    [
      "VR-ABUSE-MCP-FORGERY",
      "VR-ABUSE-TOKEN-ACCOUNTING",
      "VR-ABUSE-BACKFILL-SEASON-RACE",
      "VR-ABUSE-PROVIDER-OAUTH",
      "indefinite retained/public orphan state",
      "system-expiry cleanup",
      "compromised process running with the user's authority may extract or use key material",
      "emits no partial daily total or signed request",
    ],
  ],
  [
    "docs/security/THREAT_MODEL.md",
    [
      "sync cannot renew it",
      "separate Jobs-only cleanup prevents an indefinite lost-key orphan",
      "promotion-only grace without automatic reactivation",
    ],
  ],
]);

function normalizeContractText(value) {
  return value.replace(/\s+/gu, " ").trim();
}

for (const [path, fragments] of proposedArchitectureContracts) {
  const document = texts.get(path);
  if (document === null) {
    continue;
  }
  const normalizedDocument = normalizeContractText(document);
  for (const fragment of fragments) {
    if (!normalizedDocument.includes(normalizeContractText(fragment))) {
      report(
        path,
        `required proposed-architecture contract is missing: ${JSON.stringify(fragment)}`,
      );
    }
  }
}

const forbiddenProposedArchitectureText = new Map([
  ["ROADMAP.md", ["Generate one non-exportable sync key", "skip the record or the file"]],
  [
    "docs/architecture/SECURITY_INVARIANTS.md",
    ["Amended by ADR 0068", "Amended by ADR 0069", "one non-exportable key"],
  ],
  [
    "docs/decisions/0068-multi-agent-token-leaderboard-and-mcp.md",
    [
      "VR-TRUST-002 is amended",
      "explicit provider identifier",
      "sync contract gains a provider field",
      "primary universal connection path",
      "scoring gains per-provider normalization",
      "public per-provider contribution breakdown",
    ],
  ],
  [
    "docs/decisions/0069-thin-client-and-low-friction-onboarding.md",
    [
      "first and subsequent passkey registration",
      "identity credential remains as a second factor",
      "Turnstile token is validated and locked",
      "The envelope aggregates independently signed",
      "causes the next submit",
      "Granular per-field privacy toggles",
      "generated per source",
      "one key per source",
      "current open season and its grace window",
      "ordinary sync renews it",
      "profile and sources resume automatically",
      "user deletion job performs system expiry",
      "skip the record or the file",
      "generated independently, non-exportable",
    ],
  ],
  [
    "docs/PROJECT_PLAN.md",
    [
      "all-source aggregation",
      "reviewed, versioned per-provider normalization",
      "MCP server as the universal Community ingest path",
      "bounded per-provider contribution breakdown",
      "requires a current GitHub session and passkey",
      "generates its own non-exportable key",
      "skip the record or the file",
    ],
  ],
  [
    "docs/security/PRIVACY_DATA_MAP.md",
    [
      "tool calls, and MCP data;",
      "one key per source",
      "Private key client-only and non-exportable",
    ],
  ],
  [
    "docs/security/ABUSE_CASES.md",
    [
      "revocable non-exportable key",
      "generated, non-exportable",
      "skip the record or file",
      "skip the record or the file",
    ],
  ],
]);

for (const [path, fragments] of forbiddenProposedArchitectureText) {
  const document = texts.get(path);
  if (document === null) {
    continue;
  }
  const normalizedDocument = normalizeContractText(document);
  for (const fragment of fragments) {
    if (normalizedDocument.includes(normalizeContractText(fragment))) {
      report(path, `forbidden proposed-architecture text is present: ${JSON.stringify(fragment)}`);
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

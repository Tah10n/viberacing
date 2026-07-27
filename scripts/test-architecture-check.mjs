import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const checker = resolve(import.meta.dirname, "check-architecture.mjs");
const fixtureRoot = mkdtempSync(join(tmpdir(), "viberacing-architecture-check-"));

function makeFixture(name) {
  const directory = join(fixtureRoot, name);
  mkdirSync(directory, { recursive: true });
  cpSync(resolve(root, "docs"), resolve(directory, "docs"), { recursive: true });
  cpSync(resolve(root, "README.md"), resolve(directory, "README.md"));
  cpSync(resolve(root, "ROADMAP.md"), resolve(directory, "ROADMAP.md"));
  return directory;
}

function mutate(directory, path, transform) {
  const absolutePath = resolve(directory, path);
  writeFileSync(absolutePath, transform(readFileSync(absolutePath, "utf8")));
}

function replaceContract(text, contract, replacement) {
  const pattern = contract
    .trim()
    .split(/\s+/u)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    .join("\\s+");
  return text.replace(new RegExp(pattern, "gu"), replacement);
}

function run(directory) {
  return spawnSync(process.execPath, [checker, "--root", directory], {
    cwd: root,
    encoding: "utf8",
  });
}

function runGit(directory, args) {
  const result = spawnSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed\n${result.stdout}${result.stderr}`);
  }
}

function initializeGitInventory(directory, ignoreText = "") {
  writeFileSync(resolve(directory, ".gitignore"), ignoreText);
  runGit(directory, ["init", "--quiet"]);
  runGit(directory, ["add", "--all"]);
}

const cases = [
  {
    name: "accepts the repository architecture baseline",
    mutate() {},
    expectedStatus: 0,
  },
  {
    name: "rejects a missing threat model",
    mutate(directory) {
      rmSync(resolve(directory, "docs/security/THREAT_MODEL.md"));
    },
    expectedStatus: 1,
    expectedText: "required architecture document is missing",
  },
  {
    name: "rejects a missing threat-model contract section",
    mutate(directory) {
      mutate(directory, "docs/security/THREAT_MODEL.md", (text) =>
        text.replace("## Severity Calibration (Critical, High, Medium, Low)", "## Severity"),
      );
    },
    expectedStatus: 1,
    expectedText: "Severity Calibration",
  },
  {
    name: "rejects duplicate abuse-case identifiers",
    mutate(directory) {
      mutate(directory, "docs/security/ABUSE_CASES.md", (text) =>
        text.replace("VR-ABUSE-SEASON-RACE", "VR-ABUSE-USAGE-FORGERY"),
      );
    },
    expectedStatus: 1,
    expectedText: "abuse-case IDs must be unique",
  },
  {
    name: "rejects an incomplete abuse case",
    mutate(directory) {
      mutate(directory, "docs/security/ABUSE_CASES.md", (text) =>
        text.replace("- **Recovery:** Pause enrollment", "- **Response:** Pause enrollment"),
      );
    },
    expectedStatus: 1,
    expectedText: "is missing the Recovery field",
  },
  {
    name: "rejects an invalid ADR status",
    mutate(directory) {
      mutate(directory, "docs/decisions/0001-community-trust-tier.md", (text) =>
        text.replace(/^- Status:.*$/m, "- Status: Implemented someday"),
      );
    },
    expectedStatus: 1,
    expectedText: "ADR status is invalid",
  },
  {
    name: "rejects an ADR filename and title mismatch",
    mutate(directory) {
      mutate(directory, "docs/decisions/0002-opaque-multi-source-aggregation.md", (text) =>
        text.replace("# ADR 0002:", "# ADR 0099:"),
      );
    },
    expectedStatus: 1,
    expectedText: "ADR title number must match",
  },
  {
    name: "rejects an ADR omitted from the index",
    mutate(directory) {
      const source = resolve(directory, "docs/decisions/0006-public-repository-boundary.md");
      const target = resolve(directory, "docs/decisions/0007-unindexed.md");
      writeFileSync(target, readFileSync(source, "utf8").replace("# ADR 0006:", "# ADR 0007:"));
    },
    expectedStatus: 1,
    expectedText: "decision index does not link 0007-unindexed.md",
  },
  {
    name: "rejects an unclosed Mermaid diagram",
    mutate(directory) {
      mutate(
        directory,
        "docs/architecture/DATA_FLOW.md",
        (text) => `${text}\n\`\`\`mermaid\nflowchart LR\n  A --> B\n`,
      );
    },
    expectedStatus: 1,
    expectedText: "Mermaid code fence is not closed",
  },
  {
    name: "rejects regression to a plaintext pairing secret design",
    mutate(directory) {
      mutate(directory, "docs/architecture/DATA_FLOW.md", (text) =>
        text.replaceAll("keyed poll verifier", "plaintext device secret"),
      );
    },
    expectedStatus: 1,
    expectedText: "keyed poll verifier",
  },
  {
    name: "rejects a privacy map without a required classification",
    mutate(directory) {
      mutate(directory, "docs/security/PRIVACY_DATA_MAP.md", (text) =>
        text.replace(/\|\s*Prohibited\s*\|/, "| Forbidden |"),
      );
    },
    expectedStatus: 1,
    expectedText: "privacy classification is missing: Prohibited",
  },
  {
    name: "rejects a Codex matrix that loses the fail-closed statement",
    mutate(directory) {
      mutate(directory, "docs/reference/codex-compatibility.md", (text) =>
        text.replace(
          "No Codex version and no Vibe Racing connector version is supported.",
          "A recent Codex version should probably work.",
        ),
      );
    },
    expectedStatus: 1,
    expectedText: "empty compatibility state must state",
  },
  {
    name: "rejects a supported compatibility status with only the sentinel row",
    mutate(directory) {
      mutate(directory, "docs/reference/codex-compatibility.md", (text) =>
        text.replace(
          "Compatibility status: no supported versions.",
          "Compatibility status: supported entries present.",
        ),
      );
    },
    expectedStatus: 1,
    expectedText: "supported compatibility state",
  },
  {
    name: "accepts a structurally evidenced supported compatibility row",
    mutate(directory) {
      mutate(directory, "docs/reference/codex-compatibility.md", (text) =>
        text
          .replace(
            "Compatibility status: no supported versions.",
            "Compatibility status: supported entries present.",
          )
          .replace(
            /No Codex version and no Vibe Racing connector version is supported\.[\s\S]*?arbitrary local version\./,
            "The following exact compatibility entry passed the admission process.",
          )
          .replace(
            "| None          | Not available        | Not released         | None             | Unsupported until the full admission process passes |",
            `| 1.2.3         | sha256:${"a".repeat(64)} | >=0.4.0 <0.5.0      | Windows, macOS, Linux | Supported: [evidence](evidence.md) |`,
          ),
      );
    },
    expectedStatus: 0,
  },
  {
    name: "rejects duplicate ADR index links",
    mutate(directory) {
      mutate(directory, "docs/decisions/README.md", (text) =>
        text.replace(
          "| [0006](0006-public-repository-boundary.md)",
          "| [0001 duplicate](0001-community-trust-tier.md) | Duplicate | Accepted |\n| [0006](0006-public-repository-boundary.md)",
        ),
      );
    },
    expectedStatus: 1,
    expectedText: "decision index must not contain duplicate links",
  },
  {
    name: "rejects an unresolved placeholder in an accepted ADR",
    mutate(directory) {
      mutate(directory, "docs/decisions/0001-community-trust-tier.md", (text) =>
        text.replace(
          "- Decision owners: Product, Web, Ingest, and Scoring",
          "- Decision owners: YOUR_HANDLE",
        ),
      );
    },
    expectedStatus: 1,
    expectedText: "contains an unresolved placeholder",
  },
  {
    name: "rejects a proposed ADR that claims to amend the active trust invariant",
    mutate(directory) {
      mutate(directory, "docs/decisions/0068-multi-agent-token-leaderboard-and-mcp.md", (text) =>
        text.replace("VR-TRUST-002 would be amended", "VR-TRUST-002 is amended"),
      );
    },
    expectedStatus: 1,
    expectedText: "VR-TRUST-002 is amended",
  },
  {
    name: "rejects a proposed ADR marker inside the active invariant table",
    mutate(directory) {
      mutate(directory, "docs/architecture/SECURITY_INVARIANTS.md", (text) =>
        text.replace(
          /\| VR-TRUST-002\s+\| Verified league/,
          "| VR-TRUST-002   | Amended by ADR 0068. Verified league",
        ),
      );
    },
    expectedStatus: 1,
    expectedText: "Amended by ADR 0068",
  },
  {
    name: "rejects restoring bootstrap authority for later passkeys",
    mutate(directory) {
      mutate(directory, "docs/decisions/0069-thin-client-and-low-friction-onboarding.md", (text) =>
        replaceContract(
          text,
          "register exactly the first passkey",
          "register first and subsequent passkeys",
        ),
      );
    },
    expectedStatus: 1,
    expectedText: "register exactly the first passkey",
  },
  {
    name: "rejects removing the bootstrap-free GitHub first-passkey path",
    mutate(directory) {
      mutate(directory, "docs/decisions/0069-thin-client-and-low-friction-onboarding.md", (text) =>
        replaceContract(text, "GitHub first-passkey authority", "GitHub basic session"),
      );
    },
    expectedStatus: 1,
    expectedText: "GitHub first-passkey authority",
  },
  {
    name: "rejects removing monotonic first-passkey completion",
    mutate(directory) {
      mutate(directory, "docs/decisions/0069-thin-client-and-low-friction-onboarding.md", (text) =>
        replaceContract(text, "`first-passkey-complete`", "`passkey-currently-active`"),
      );
    },
    expectedStatus: 1,
    expectedText: "`first-passkey-complete`",
  },
  {
    name: "rejects renewing anonymous ownership through ordinary sync",
    mutate(directory) {
      mutate(directory, "docs/decisions/0069-thin-client-and-low-friction-onboarding.md", (text) =>
        replaceContract(text, "ordinary sync never renews it", "ordinary sync renews it"),
      );
    },
    expectedStatus: 1,
    expectedText: "ordinary sync never renews it",
  },
  {
    name: "rejects automatic reactivation after terminal-grace promotion",
    mutate(directory) {
      mutate(directory, "docs/decisions/0069-thin-client-and-low-friction-onboarding.md", (text) =>
        replaceContract(
          text,
          "profile remains hidden and its sources remain paused",
          "profile and sources resume automatically",
        ),
      );
    },
    expectedStatus: 1,
    expectedText: "profile remains hidden and its sources remain paused",
  },
  {
    name: "rejects removing bounded system-expiry cleanup",
    mutate(directory) {
      mutate(directory, "docs/decisions/0069-thin-client-and-low-friction-onboarding.md", (text) =>
        replaceContract(
          text,
          "separate Jobs-only system-expiry capability",
          "indefinitely retained anonymous profile",
        ),
      );
    },
    expectedStatus: 1,
    expectedText: "separate Jobs-only system-expiry capability",
  },
  {
    name: "rejects collapsing independently revocable device keys into one source key",
    mutate(directory) {
      mutate(directory, "docs/decisions/0069-thin-client-and-low-friction-onboarding.md", (text) =>
        replaceContract(
          text,
          "multiple independently revocable device keys",
          "one shared private key for every device",
        ),
      );
    },
    expectedStatus: 1,
    expectedText: "multiple independently revocable device keys",
  },
  {
    name: "rejects restoring a GitHub prerequisite for anonymous source actions",
    mutate(directory) {
      mutate(directory, "docs/PROJECT_PLAN.md", (text) =>
        replaceContract(text, "whether anonymous or GitHub-linked", "only when GitHub-linked"),
      );
    },
    expectedStatus: 1,
    expectedText: "whether anonymous or GitHub-linked",
  },
  {
    name: "rejects rollback or reuse of a consumed external admission proof",
    mutate(directory) {
      mutate(directory, "docs/decisions/0069-thin-client-and-low-friction-onboarding.md", (text) =>
        replaceContract(
          text,
          "proof is locally consumed and cannot be rolled back or reused",
          "proof may be rolled back and reused after failure",
        ),
      );
    },
    expectedStatus: 1,
    expectedText: "proof is locally consumed and cannot be rolled back or reused",
  },
  {
    name: "rejects invite validation without a unique pre-challenge reservation",
    mutate(directory) {
      mutate(directory, "docs/decisions/0069-thin-client-and-low-friction-onboarding.md", (text) =>
        replaceContract(
          text,
          "A unique reservation rule makes concurrent use",
          "Non-atomic validation lets concurrent use",
        ),
      );
    },
    expectedStatus: 1,
    expectedText: "unique reservation rule makes concurrent use",
  },
  {
    name: "rejects replacing sequential source requests with a shared envelope",
    mutate(directory) {
      mutate(directory, "docs/decisions/0069-thin-client-and-low-friction-onboarding.md", (text) =>
        replaceContract(text, "Sequential all-source submit", "Multi-source envelope submit"),
      );
    },
    expectedStatus: 1,
    expectedText: "Sequential all-source submit",
  },
  {
    name: "rejects losing the canonical direct token-total contract",
    mutate(directory) {
      mutate(directory, "docs/decisions/0068-multi-agent-token-leaderboard-and-mcp.md", (text) =>
        replaceContract(text, "weeklyTokenTotal", "weeklyScore"),
      );
    },
    expectedStatus: 1,
    expectedText: "weeklyTokenTotal",
  },
  {
    name: "rejects roadmap drift back to an engagement score",
    mutate(directory) {
      mutate(directory, "ROADMAP.md", (text) =>
        replaceContract(
          text,
          "## Phase 7 — Direct token-total leaderboard (local Codex slice implemented)",
          "## Phase 7 — Engagement-points leaderboard",
        ),
      );
    },
    expectedStatus: 1,
    expectedText: "Phase 7 — Direct token-total leaderboard (local Codex slice implemented)",
  },
  {
    name: "rejects restoring an engagement-shaped token score",
    mutate(directory) {
      mutate(directory, "docs/decisions/0068-multi-agent-token-leaderboard-and-mcp.md", (text) =>
        replaceContract(text, "No logarithm, active-day bonus", "A logarithm and active-day bonus"),
      );
    },
    expectedStatus: 1,
    expectedText: "No logarithm, active-day bonus",
  },
  {
    name: "rejects double counting nested token details",
    mutate(directory) {
      mutate(directory, "docs/decisions/0068-multi-agent-token-leaderboard-and-mcp.md", (text) =>
        replaceContract(
          text,
          "nested cache/reasoning/thought breakdown twice",
          "nested cache/reasoning/thought breakdown again",
        ),
      );
    },
    expectedStatus: 1,
    expectedText: "nested cache/reasoning/thought breakdown twice",
  },
  {
    name: "rejects changing a reader mapping during a season",
    mutate(directory) {
      mutate(directory, "docs/decisions/0068-multi-agent-token-leaderboard-and-mcp.md", (text) =>
        replaceContract(
          text,
          "revision cannot change mid-season",
          "revision may change mid-season",
        ),
      );
    },
    expectedStatus: 1,
    expectedText: "revision cannot change mid-season",
  },
  {
    name: "rejects provider model or cost weighting",
    mutate(directory) {
      mutate(directory, "docs/decisions/0068-multi-agent-token-leaderboard-and-mcp.md", (text) =>
        replaceContract(text, "provider/model/cost", "provider-weighted"),
      );
    },
    expectedStatus: 1,
    expectedText: "provider/model/cost",
  },
  {
    name: "rejects treating MCP compatibility as universal token metering",
    mutate(directory) {
      mutate(directory, "docs/decisions/0068-multi-agent-token-leaderboard-and-mcp.md", (text) =>
        replaceContract(text, "MCP compatibility alone never", "MCP compatibility always"),
      );
    },
    expectedStatus: 1,
    expectedText: "MCP compatibility alone never",
  },
  {
    name: "rejects a client-writable provider in UsageSyncV1",
    mutate(directory) {
      mutate(directory, "docs/decisions/0068-multi-agent-token-leaderboard-and-mcp.md", (text) =>
        replaceContract(text, "provider is not client-writable", "provider is client-writable"),
      );
    },
    expectedStatus: 1,
    expectedText: "provider is not client-writable",
  },
  {
    name: "rejects a blanket MCP-data prohibition that also bans UsageSyncV1",
    mutate(directory) {
      mutate(directory, "docs/security/PRIVACY_DATA_MAP.md", (text) =>
        replaceContract(
          text,
          "arbitrary MCP request/response data outside the exact",
          "all MCP data including the exact",
        ),
      );
    },
    expectedStatus: 1,
    expectedText: "arbitrary MCP request/response data outside the exact",
  },
  {
    name: "rejects combining backfill seasons into one atomic request",
    mutate(directory) {
      mutate(directory, "docs/decisions/0069-thin-client-and-low-friction-onboarding.md", (text) =>
        replaceContract(text, "single-source/single-season", "single-source multi-season"),
      );
    },
    expectedStatus: 1,
    expectedText: "single-source/single-season",
  },
  {
    name: "rejects a partial daily total after malformed usage input",
    mutate(directory) {
      mutate(directory, "docs/decisions/0069-thin-client-and-low-friction-onboarding.md", (text) =>
        replaceContract(
          text,
          "No partial daily total or signed request is emitted for that source/day",
          "Remaining records are submitted as a partial daily total for that source/day",
        ),
      );
    },
    expectedStatus: 1,
    expectedText: "No partial daily total or signed request is emitted for that source/day",
  },
  {
    name: "rejects record-level skipping in the reader abuse control",
    mutate(directory) {
      mutate(directory, "docs/security/ABUSE_CASES.md", (text) =>
        replaceContract(
          text,
          "emits no partial daily total or signed request",
          "skip the record or file and submit the remainder",
        ),
      );
    },
    expectedStatus: 1,
    expectedText: "skip the record or file",
  },
  {
    name: "rejects an unsupported hardware non-exportability claim",
    mutate(directory) {
      mutate(directory, "docs/decisions/0069-thin-client-and-low-friction-onboarding.md", (text) =>
        replaceContract(
          text,
          "does not claim hardware-backed non-exportability",
          "guarantees hardware-backed non-exportability",
        ),
      );
    },
    expectedStatus: 1,
    expectedText: "does not claim hardware-backed non-exportability",
  },
  {
    name: "rejects moving the public beta ahead of the thin MVP",
    mutate(directory) {
      mutate(directory, "ROADMAP.md", (text) =>
        replaceContract(
          text,
          "## Phase 8 — Thin MVP staging and invite beta",
          "## Phase 5 — Staging and public beta",
        ),
      );
    },
    expectedStatus: 1,
    expectedText: "Phase 8 — Thin MVP staging and invite beta",
  },
  {
    name: "ignores agent-local Markdown outside a Git worktree",
    mutate(directory) {
      const localDirectory = resolve(directory, ".codex");
      mkdirSync(localDirectory, { recursive: true });
      writeFileSync(
        resolve(localDirectory, "private-note.md"),
        "A private note about a typing-race mini-game.\n",
      );
    },
    expectedStatus: 0,
  },
  {
    name: "uses Git ignore rules for repository Markdown inventory",
    mutate(directory) {
      initializeGitInventory(directory, "private-state/\n");
      const privateDirectory = resolve(directory, "private-state");
      mkdirSync(privateDirectory, { recursive: true });
      writeFileSync(
        resolve(privateDirectory, "ignored.md"),
        "An ignored note about a typing-race mini-game.\n",
      );
    },
    expectedStatus: 0,
  },
  {
    name: "still scans non-ignored untracked Markdown",
    mutate(directory) {
      initializeGitInventory(directory);
      const notesDirectory = resolve(directory, "notes");
      mkdirSync(notesDirectory, { recursive: true });
      writeFileSync(
        resolve(notesDirectory, "untracked.md"),
        "An untracked public note about a typing-race mini-game.\n",
      );
    },
    expectedStatus: 1,
    expectedText: "removed product scope is still documented",
  },
  {
    name: "rejects restoring the removed secondary product surface outside docs",
    mutate(directory) {
      mutate(
        directory,
        "README.md",
        (text) => `${text}\n\nA separate real-time typing-race mini-game is planned.\n`,
      );
    },
    expectedStatus: 1,
    expectedText: "removed product scope is still documented",
  },
  {
    name: "rejects automatic GitHub profile merging on identity collision",
    mutate(directory) {
      mutate(directory, "docs/decisions/0069-thin-client-and-low-friction-onboarding.md", (text) =>
        text.replace("never automatically merged", "automatically merged after collision"),
      );
    },
    expectedStatus: 1,
    expectedText: "never automatically merged",
  },
];

try {
  for (const [index, testCase] of cases.entries()) {
    const directory = makeFixture(`case-${index}`);
    testCase.mutate(directory);
    const result = run(directory);
    const output = `${result.stdout}${result.stderr}`;
    if (result.status !== testCase.expectedStatus) {
      throw new Error(
        `${testCase.name}: expected exit ${testCase.expectedStatus}, got ${result.status}\n${output}`,
      );
    }
    if (testCase.expectedText && !output.includes(testCase.expectedText)) {
      throw new Error(
        `${testCase.name}: missing ${JSON.stringify(testCase.expectedText)}\n${output}`,
      );
    }
  }
  console.log(`Architecture checker tests passed (${cases.length} cases).`);
} finally {
  rmSync(fixtureRoot, { force: true, recursive: true });
}

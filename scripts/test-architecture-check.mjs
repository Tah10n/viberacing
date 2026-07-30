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
  const original = readFileSync(absolutePath, "utf8");
  const mutated = transform(original);
  if (mutated === original) {
    throw new Error(`architecture checker mutation did not change ${path}`);
  }
  writeFileSync(absolutePath, mutated);
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
        text.replace("VR-ABUSE-DEVICE-MULTIPLICATION", "VR-ABUSE-USAGE-FORGERY"),
      );
    },
    expectedStatus: 1,
    expectedText: "abuse-case IDs must be unique",
  },
  {
    name: "rejects an incomplete abuse case",
    mutate(directory) {
      mutate(directory, "docs/security/ABUSE_CASES.md", (text) =>
        text.replace(
          "- **Recovery:** Keep the single committed profile",
          "- **Response:** Keep the single committed profile",
        ),
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
        text.replaceAll("keyed poll/code verifiers", "plaintext device secret"),
      );
    },
    expectedStatus: 1,
    expectedText: "keyed poll/code verifiers",
  },
  {
    name: "rejects a privacy map without a required classification",
    mutate(directory) {
      mutate(directory, "docs/security/PRIVACY_DATA_MAP.md", (text) =>
        text.replace(/\|\s*Prohibited\s*\|/gu, "| Forbidden |"),
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
    name: "rejects demoting the accepted clean replacement ADR",
    mutate(directory) {
      mutate(
        directory,
        "docs/decisions/0076-clean-agent-account-provider-reported-token-ranking.md",
        (text) => text.replace("- Status: Accepted", "- Status: Proposed"),
      );
    },
    expectedStatus: 1,
    expectedText: 'required clean-agent-account contract is missing: "- Status: Accepted"',
  },
  {
    name: "rejects a proposed ADR marker inside the active invariant table",
    mutate(directory) {
      mutate(
        directory,
        "docs/architecture/SECURITY_INVARIANTS.md",
        (text) => `${text}\n## Proposed invariant amendments\n`,
      );
    },
    expectedStatus: 1,
    expectedText:
      'forbidden current-architecture text is present: "## Proposed invariant amendments"',
  },
  {
    name: "rejects treating a device as the logical ranking account",
    mutate(directory) {
      mutate(directory, "docs/PROJECT_PLAN.md", (text) =>
        replaceContract(
          text,
          "one `AgentAccount` is one logical account",
          "one device is one logical account",
        ),
      );
    },
    expectedStatus: 1,
    expectedText: "one `AgentAccount` is one logical account",
  },
  {
    name: "rejects restoring a legacy usage route",
    mutate(directory) {
      mutate(directory, "docs/PROJECT_PLAN.md", (text) =>
        text.replaceAll("POST /v1/usage", "POST /v1/community/sync"),
      );
    },
    expectedStatus: 1,
    expectedText: "POST /v1/usage",
  },
  {
    name: "rejects public live ranking aggregation",
    mutate(directory) {
      mutate(directory, "docs/PROJECT_PLAN.md", (text) =>
        replaceContract(
          text,
          "Public Web has no live ranking capability",
          "Public Web performs live ranking aggregation",
        ),
      );
    },
    expectedStatus: 1,
    expectedText: "Public Web has no live ranking capability",
  },
  {
    name: "rejects downgrading the replacement to an incremental migration",
    mutate(directory) {
      mutate(
        directory,
        "docs/decisions/0076-clean-agent-account-provider-reported-token-ranking.md",
        (text) =>
          replaceContract(
            text,
            "Clean-slate pre-release replacement",
            "Incremental compatibility migration",
          ),
      );
    },
    expectedStatus: 1,
    expectedText: "Clean-slate pre-release replacement",
  },
  {
    name: "rejects a different ranking metric",
    mutate(directory) {
      mutate(
        directory,
        "docs/decisions/0076-clean-agent-account-provider-reported-token-ranking.md",
        (text) => text.replaceAll("provider_reported_tokens_v1", "community_v1"),
      );
    },
    expectedStatus: 1,
    expectedText: "provider_reported_tokens_v1",
  },
  {
    name: "rejects allowing anonymous profiles",
    mutate(directory) {
      mutate(
        directory,
        "docs/decisions/0076-clean-agent-account-provider-reported-token-ranking.md",
        (text) => text.replaceAll("no anonymous profile", "anonymous profiles are allowed"),
      );
    },
    expectedStatus: 1,
    expectedText: "no anonymous profile",
  },
  {
    name: "rejects splitting atomic usage settlement",
    mutate(directory) {
      mutate(
        directory,
        "docs/decisions/0076-clean-agent-account-provider-reported-token-ranking.md",
        (text) => text.replaceAll("one database transaction", "separate database transactions"),
      );
    },
    expectedStatus: 1,
    expectedText: "one database transaction",
  },
  {
    name: "rejects public aggregation over raw ranking tables",
    mutate(directory) {
      mutate(
        directory,
        "docs/decisions/0076-clean-agent-account-provider-reported-token-ranking.md",
        (text) =>
          replaceContract(
            text,
            "Public requests never aggregate raw ranking tables",
            "Public requests aggregate raw ranking tables",
          ),
      );
    },
    expectedStatus: 1,
    expectedText: "Public requests never aggregate raw ranking tables",
  },
  {
    name: "rejects restoring the legacy public ranking endpoint",
    mutate(directory) {
      mutate(
        directory,
        "docs/decisions/0076-clean-agent-account-provider-reported-token-ranking.md",
        (text) => text.replaceAll("GET /v1/leaderboards/current", "GET /v1/community/tokens"),
      );
    },
    expectedStatus: 1,
    expectedText: "GET /v1/leaderboards/current",
  },
  {
    name: "rejects removing the GitHub identity invariant",
    mutate(directory) {
      mutate(directory, "docs/architecture/SECURITY_INVARIANTS.md", (text) =>
        text.replace("VR-IDENTITY-001", "VR-IDENTITY-REMOVED"),
      );
    },
    expectedStatus: 1,
    expectedText: "VR-IDENTITY-001",
  },
  {
    name: "rejects removing the multi-device deduplication invariant",
    mutate(directory) {
      mutate(directory, "docs/architecture/SECURITY_INVARIANTS.md", (text) =>
        text.replace("VR-DEDUP-001", "VR-DEDUP-REMOVED"),
      );
    },
    expectedStatus: 1,
    expectedText: "VR-DEDUP-001",
  },
  {
    name: "rejects removing atomic replay and usage settlement",
    mutate(directory) {
      mutate(directory, "docs/architecture/SECURITY_INVARIANTS.md", (text) =>
        text.replace("VR-INGEST-ATOMIC-001", "VR-INGEST-ATOMIC-REMOVED"),
      );
    },
    expectedStatus: 1,
    expectedText: "VR-INGEST-ATOMIC-001",
  },
  {
    name: "rejects removing snapshot-only public reads",
    mutate(directory) {
      mutate(directory, "docs/architecture/SECURITY_INVARIANTS.md", (text) =>
        text.replace("VR-SNAPSHOT-001", "VR-SNAPSHOT-REMOVED"),
      );
    },
    expectedStatus: 1,
    expectedText: "VR-SNAPSHOT-001",
  },
  {
    name: "rejects removing the reader privacy invariant",
    mutate(directory) {
      mutate(directory, "docs/architecture/SECURITY_INVARIANTS.md", (text) =>
        text.replace("VR-PRIVACY-001", "VR-PRIVACY-REMOVED"),
      );
    },
    expectedStatus: 1,
    expectedText: "VR-PRIVACY-001",
  },
  {
    name: "rejects losing the multi-device threat",
    mutate(directory) {
      mutate(directory, "docs/security/THREAT_MODEL.md", (text) =>
        replaceContract(text, "Multi-device double counting", "Independent device totals"),
      );
    },
    expectedStatus: 1,
    expectedText: "Multi-device double counting",
  },
  {
    name: "rejects losing the partial snapshot threat",
    mutate(directory) {
      mutate(directory, "docs/security/THREAT_MODEL.md", (text) =>
        replaceContract(text, "Snapshot poisoning or partial publication", "Mutable public result"),
      );
    },
    expectedStatus: 1,
    expectedText: "Snapshot poisoning or partial publication",
  },
  {
    name: "rejects removing account-scoped key privacy",
    mutate(directory) {
      mutate(directory, "docs/security/PRIVACY_DATA_MAP.md", (text) =>
        replaceContract(
          text,
          "Account-scoped device private key",
          "Installation-wide shared private key",
        ),
      );
    },
    expectedStatus: 1,
    expectedText: "Account-scoped device private key",
  },
  {
    name: "rejects removing exact cumulative token strings",
    mutate(directory) {
      mutate(directory, "docs/security/PRIVACY_DATA_MAP.md", (text) =>
        replaceContract(
          text,
          "Canonical cumulative token-total decimal string",
          "Floating point token total",
        ),
      );
    },
    expectedStatus: 1,
    expectedText: "Canonical cumulative token-total decimal string",
  },
  {
    name: "rejects restoring an anonymous bootstrap key",
    mutate(directory) {
      mutate(directory, "docs/security/PRIVACY_DATA_MAP.md", (text) =>
        replaceContract(
          text,
          "There is no anonymous identity bootstrap key",
          "An anonymous identity bootstrap key is retained",
        ),
      );
    },
    expectedStatus: 1,
    expectedText: "There is no anonymous identity bootstrap key",
  },
  {
    name: "rejects losing the overlap abuse case",
    mutate(directory) {
      mutate(directory, "docs/security/ABUSE_CASES.md", (text) =>
        text.replaceAll("VR-ABUSE-ACCOUNT-OVERLAP", "VR-ABUSE-OVERLAP-REMOVED"),
      );
    },
    expectedStatus: 1,
    expectedText: "VR-ABUSE-ACCOUNT-OVERLAP",
  },
  {
    name: "rejects roadmap drift back to engagement points",
    mutate(directory) {
      mutate(directory, "ROADMAP.md", (text) =>
        replaceContract(
          text,
          "## Stage 6 — Thin multi-agent connector",
          "## Stage 6 — Engagement-points client",
        ),
      );
    },
    expectedStatus: 1,
    expectedText: "## Stage 6 — Thin multi-agent connector",
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
      mutate(directory, "docs/architecture/SECURITY_INVARIANTS.md", (text) =>
        replaceContract(
          text,
          "One immutable GitHub numeric user ID has at most one profile",
          "One GitHub identity collision automatically merges profiles",
        ),
      );
    },
    expectedStatus: 1,
    expectedText: "One immutable GitHub numeric user ID has at most one profile",
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

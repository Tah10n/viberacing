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
  return directory;
}

function mutate(directory, path, transform) {
  const absolutePath = resolve(directory, path);
  writeFileSync(absolutePath, transform(readFileSync(absolutePath, "utf8")));
}

function run(directory) {
  return spawnSync(process.execPath, [checker, "--root", directory], {
    cwd: root,
    encoding: "utf8",
  });
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
        text.replace("keyed poll verifier", "plaintext device secret"),
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

import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { tmpdir } from "node:os";

const root = resolve(import.meta.dirname, "..");
const checker = resolve(import.meta.dirname, "check-community.mjs");
const fixtureRoot = mkdtempSync(join(tmpdir(), "viberacing-community-check-"));
const requiredRootFiles = [
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "DCO.txt",
  "GOVERNANCE.md",
  "MAINTAINERS.md",
  "RELEASE.md",
  "ROADMAP.md",
  "SECURITY.md",
  "SUPPORT.md",
  "THIRD_PARTY_NOTICES.md",
  "TRADEMARKS.md",
];

function makeFixture(name) {
  const directory = join(fixtureRoot, name);
  mkdirSync(directory, { recursive: true });
  for (const path of requiredRootFiles) {
    cpSync(resolve(root, path), resolve(directory, path));
  }
  cpSync(resolve(root, ".github"), resolve(directory, ".github"), { recursive: true });
  return directory;
}

function run(directory) {
  return spawnSync(process.execPath, [checker, "--root", directory], {
    encoding: "utf8",
    cwd: root,
  });
}

function mutate(directory, path, transform) {
  const absolutePath = resolve(directory, path);
  const original = readFileSync(absolutePath, "utf8");
  const mutated = transform(original);
  if (mutated === original) {
    throw new Error(`community checker mutation did not change ${path}`);
  }
  writeFileSync(absolutePath, mutated);
}

const cases = [
  {
    name: "accepts the repository community-health baseline",
    mutate() {},
    expectedStatus: 0,
  },
  {
    name: "accepts a coherent configured community state",
    mutate(directory) {
      mutate(directory, "CODE_OF_CONDUCT.md", (text) =>
        text
          .replace(/^External participation status:.*$/m, "External participation status: open.")
          .replace(
            /^GitHub public interaction status:.*$/m,
            "GitHub public interaction status: enabled for open participation.",
          )
          .replace(
            "Conduct reporting channel: not configured.",
            "Conduct reporting channel: https://reports.example.org/conduct",
          ),
      );
      mutate(
        directory,
        "MAINTAINERS.md",
        (text) =>
          `${text.replace("Public maintainer registry: not configured.", "Public maintainer registry: configured.")}\n- https://github.com/viberacing-ci-fixture\n`,
      );
    },
    expectedStatus: 0,
  },
  {
    name: "rejects open participation without configured safeguards",
    mutate(directory) {
      mutate(directory, "CODE_OF_CONDUCT.md", (text) =>
        text
          .replace(/^External participation status:.*$/m, "External participation status: open.")
          .replace(
            /^GitHub public interaction status:.*$/m,
            "GitHub public interaction status: enabled for open participation.",
          ),
      );
    },
    expectedStatus: 1,
    expectedText: "open participation requires a configured private conduct channel",
  },
  {
    name: "rejects closed participation with public interactions enabled",
    mutate(directory) {
      mutate(directory, "CODE_OF_CONDUCT.md", (text) =>
        text.replace(
          /^GitHub public interaction status:.*$/m,
          "GitHub public interaction status: enabled for open participation.",
        ),
      );
    },
    expectedStatus: 1,
    expectedText: "closed participation cannot claim",
  },
  {
    name: "rejects a missing required policy",
    mutate(directory) {
      rmSync(resolve(directory, "GOVERNANCE.md"));
    },
    expectedStatus: 1,
    expectedText: "required community-health file is missing",
  },
  {
    name: "rejects duplicate issue-form identifiers",
    mutate(directory) {
      mutate(directory, ".github/ISSUE_TEMPLATE/bug.yml", (text) =>
        text.replace("id: reproduction", "id: summary"),
      );
    },
    expectedStatus: 1,
    expectedText: "duplicates",
  },
  {
    name: "rejects automatic issue assignment",
    mutate(directory) {
      mutate(directory, ".github/ISSUE_TEMPLATE/feature.yml", (text) =>
        text.replace("assignees: []", "assignees:\n  - viberacing-ci-fixture"),
      );
    },
    expectedStatus: 1,
    expectedText: "assignees must remain empty",
  },
  {
    name: "rejects blank public issues",
    mutate(directory) {
      mutate(directory, ".github/ISSUE_TEMPLATE/config.yml", (text) =>
        text.replace("blank_issues_enabled: false", "blank_issues_enabled: true"),
      );
    },
    expectedStatus: 1,
    expectedText: "blank issues must remain disabled",
  },
  {
    name: "rejects unresolved policy placeholders",
    mutate(directory) {
      mutate(directory, "GOVERNANCE.md", (text) => `${text}\nTODO\n`);
    },
    expectedStatus: 1,
    expectedText: "unresolved owner or policy placeholder",
  },
  {
    name: "rejects a roadmap that restores the engagement-points client",
    mutate(directory) {
      mutate(directory, "ROADMAP.md", (text) =>
        text.replace(
          "## Stage 6 — Thin multi-agent connector",
          "## Stage 6 — Engagement-points client",
        ),
      );
    },
    expectedStatus: 1,
    expectedText: "## Stage 6 — Thin multi-agent connector",
  },
  {
    name: "rejects an issue form without the sensitive-data warning",
    mutate(directory) {
      mutate(directory, ".github/ISSUE_TEMPLATE/documentation.yml", (text) =>
        text.replaceAll("SECURITY.md", "the private reporting policy"),
      );
    },
    expectedStatus: 1,
    expectedText: "direct sensitive security details to SECURITY.md",
  },
  {
    name: "rejects a modified DCO version",
    mutate(directory) {
      mutate(directory, "DCO.txt", (text) => text.replace("Version 1.1", "Version 1.0"));
    },
    expectedStatus: 1,
    expectedText: "Version 1.1",
  },
  {
    name: "rejects modified DCO wording",
    mutate(directory) {
      mutate(directory, "DCO.txt", (text) =>
        text.replace(
          "The contribution was created in whole or in part by me",
          "The contribution was authored in whole or in part by me",
        ),
      );
    },
    expectedStatus: 1,
    expectedText: "official DCO 1.1 text does not match",
  },
  {
    name: "rejects an issue form that solicits contact data",
    mutate(directory) {
      mutate(directory, ".github/ISSUE_TEMPLATE/bug.yml", (text) =>
        text.replace("label: Public environment details", "label: Contact email"),
      );
    },
    expectedStatus: 1,
    expectedText: "must not solicit contact",
  },
  {
    name: "rejects duplicate YAML keys",
    mutate(directory) {
      mutate(directory, ".github/ISSUE_TEMPLATE/feature.yml", (text) =>
        text.replace("labels: []", "labels: []\nlabels: []"),
      );
    },
    expectedStatus: 1,
    expectedText: "invalid YAML",
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
  console.log(`Community-health checker tests passed (${cases.length} cases).`);
} finally {
  rmSync(fixtureRoot, { force: true, recursive: true });
}

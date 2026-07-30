import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { tmpdir } from "node:os";

const root = resolve(import.meta.dirname, "..");
const checker = resolve(import.meta.dirname, "check-documentation-currentness.mjs");
const fixtureRoot = mkdtempSync(resolve(tmpdir(), "viberacing-documentation-currentness-"));

function makeFixture(name) {
  const directory = resolve(fixtureRoot, name);
  for (const path of [
    "contracts/v1",
    "contracts/generated",
    "database/migrations",
    "docs/decisions",
    "docs/getting-started",
    "docs/operations",
    "docs/security",
    "scripts",
  ]) {
    mkdirSync(resolve(directory, path), { recursive: true });
  }
  for (const path of [
    "README.md",
    "README.ru.md",
    "ROADMAP.md",
    "CONTRIBUTING.md",
    "GOVERNANCE.md",
    "MAINTAINERS.md",
    "SECURITY.md",
    "contracts/v1/manifest.json",
    "contracts/generated/openapi.v1.json",
    "database/README.md",
    "database/migrations/manifest.json",
    "docs/IMPLEMENTATION_STATUS.md",
    "docs/decisions/README.md",
    "docs/getting-started/LOCAL_DEVELOPMENT.md",
    "docs/operations/MIGRATION_RUNBOOK.md",
    "docs/security/THREAT_MODEL.md",
  ]) {
    cpSync(resolve(root, path), resolve(directory, path));
  }
  return directory;
}

function run(directory) {
  return spawnSync(process.execPath, [checker, "--root", directory], {
    cwd: root,
    encoding: "utf8",
  });
}

function mutateJson(directory, path, mutate) {
  const absolutePath = resolve(directory, path);
  const value = JSON.parse(readFileSync(absolutePath, "utf8"));
  mutate(value);
  writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function replace(directory, path, before, after) {
  const absolutePath = resolve(directory, path);
  const text = readFileSync(absolutePath, "utf8");
  if (!text.includes(before)) {
    throw new Error(`${path} fixture is missing ${JSON.stringify(before)}`);
  }
  writeFileSync(absolutePath, text.replace(before, after), "utf8");
}

const cases = [
  {
    name: "accepts the current canonical inventories and compact onboarding",
    expectedStatus: 0,
    expectedText: "Documentation currentness check passed",
  },
  {
    name: "rejects contract schema inventory drift",
    mutate(directory) {
      mutateJson(directory, "contracts/v1/manifest.json", (manifest) => {
        manifest.schemas.push({ file: "future.schema.json" });
      });
    },
    expectedStatus: 1,
    expectedText: "current contract/database inventory differs",
  },
  {
    name: "rejects OpenAPI path inventory drift",
    mutate(directory) {
      mutateJson(directory, "contracts/generated/openapi.v1.json", (openApi) => {
        openApi.paths["/v1/future"] = {};
      });
    },
    expectedStatus: 1,
    expectedText: "OpenAPI path inventory differs",
  },
  {
    name: "rejects operation implementation-status drift",
    mutate(directory) {
      mutateJson(directory, "contracts/v1/manifest.json", (manifest) => {
        manifest.operations[0].implementationStatus = "implemented-local";
      });
    },
    expectedStatus: 1,
    expectedText: "OpenAPI path inventory differs",
  },
  {
    name: "rejects migration inventory drift",
    mutate(directory) {
      mutateJson(directory, "database/migrations/manifest.json", (manifest) => {
        manifest.migrations.push({ revision: 44 });
      });
    },
    expectedStatus: 1,
    expectedText: "migration inventory differs",
  },
  {
    name: "rejects an oversized root README",
    mutate(directory) {
      const path = resolve(directory, "README.md");
      writeFileSync(
        path,
        `${readFileSync(path, "utf8")}${"\nAdditional onboarding noise.".repeat(80)}\n`,
        "utf8",
      );
    },
    expectedStatus: 1,
    expectedText: "onboarding exceeds 220 lines",
  },
  {
    name: "rejects a missing early quick start",
    mutate(directory) {
      replace(directory, "README.md", "## Quick start", "## Delayed start");
    },
    expectedStatus: 1,
    expectedText: "must begin within the first 40 lines",
  },
  {
    name: "rejects a missing architecture thumbnail",
    mutate(directory) {
      replace(directory, "README.ru.md", "```mermaid", "```text");
    },
    expectedStatus: 1,
    expectedText: "must contain one Mermaid thumbnail",
  },
  {
    name: "rejects stale pre-replacement threat-model status",
    mutate(directory) {
      replace(
        directory,
        "docs/security/THREAT_MODEL.md",
        "The former Codex-specific source/score runtime is absent from the current tree",
        "The current tree contains older local Codex-specific implementation",
      );
    },
    expectedStatus: 1,
    expectedText: "clean replacement status is stale",
  },
  {
    name: "rejects a stale clean-replacement ADR index",
    mutate(directory) {
      replace(
        directory,
        "docs/decisions/README.md",
        "Accepted; implemented locally; external pending",
        "Accepted; clean-slate target; implementation pending",
      );
    },
    expectedStatus: 1,
    expectedText: "ADR index status is stale",
  },
  {
    name: "rejects a roadmap that reopens the completed local review",
    mutate(directory) {
      replace(
        directory,
        "ROADMAP.md",
        "Status: local clean-replacement matrix complete; registry-backed advisory refresh and external\n" +
          "evidence remain pending.",
        "Status: implementation still pending.",
      );
    },
    expectedStatus: 1,
    expectedText: "final local review status is stale",
  },
  {
    name: "rejects an ADR index that presents historical implementation as current",
    mutate(directory) {
      replace(
        directory,
        "docs/decisions/README.md",
        "they are not\ncurrent runtime evidence",
        "they are\ncurrent runtime evidence",
      );
    },
    expectedStatus: 1,
    expectedText: "historical ADR status boundary is stale",
  },
  {
    name: "rejects a false green registry advisory boundary",
    mutate(directory) {
      replace(
        directory,
        "docs/IMPLEMENTATION_STATUS.md",
        "was not refreshed and is explicitly not counted as\ngreen evidence",
        "was refreshed and is counted as\ngreen evidence",
      );
    },
    expectedStatus: 1,
    expectedText: "registry advisory evidence boundary is stale",
  },
  {
    name: "rejects stale migration evidence status",
    mutate(directory) {
      replace(
        directory,
        "docs/operations/MIGRATION_RUNBOOK.md",
        "have landed as\nlocal synthetic evidence",
        "remain pending as\nlocal synthetic evidence",
      );
    },
    expectedStatus: 1,
    expectedText: "migration evidence status is stale",
  },
  {
    name: "rejects stale publication governance status",
    mutate(directory) {
      replace(
        directory,
        "GOVERNANCE.md",
        "maintainer-led public source-only pre-release project",
        "maintainer-led project in unpublished source-only preparation",
      );
    },
    expectedStatus: 1,
    expectedText: "publication governance status is stale",
  },
];

try {
  for (const [index, testCase] of cases.entries()) {
    const directory = makeFixture(`case-${index}`);
    testCase.mutate?.(directory);
    const result = run(directory);
    const output = `${result.stdout}${result.stderr}`;
    if (result.status !== testCase.expectedStatus) {
      throw new Error(
        `${testCase.name}: expected exit ${testCase.expectedStatus}, got ${result.status}\n${output}`,
      );
    }
    if (!output.includes(testCase.expectedText)) {
      throw new Error(
        `${testCase.name}: missing ${JSON.stringify(testCase.expectedText)}\n${output}`,
      );
    }
  }
  console.log(`Documentation currentness checker tests passed (${cases.length} cases).`);
} finally {
  rmSync(fixtureRoot, { force: true, recursive: true });
}

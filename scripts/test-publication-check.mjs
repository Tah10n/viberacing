import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { tmpdir } from "node:os";

const root = resolve(import.meta.dirname, "..");
const checker = resolve(import.meta.dirname, "check-publication-readiness.mjs");
const fixtureRoot = mkdtempSync(join(tmpdir(), "viberacing-publication-check-"));

function git(directory, args) {
  const result = spawnSync("git", ["-C", directory, ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

function makeFixture(name, mode = "pre-public") {
  const directory = join(fixtureRoot, name);
  mkdirSync(resolve(directory, ".github"), { recursive: true });
  for (const path of ["CODE_OF_CONDUCT.md", "MAINTAINERS.md", "SECURITY.md"]) {
    cpSync(resolve(root, path), resolve(directory, path));
  }
  git(directory, ["init", "--quiet"]);
  if (mode !== "pre-public") {
    git(directory, [
      "remote",
      "add",
      "origin",
      "https://github.com/viberacing-ci-fixture/project.git",
    ]);
    writeFileSync(
      resolve(directory, ".github/CODEOWNERS"),
      "* @viberacing-ci-fixture\n/.github/ @viberacing-ci-fixture\n/CODE_OF_CONDUCT.md @viberacing-ci-fixture\n/SECURITY.md @viberacing-ci-fixture\n",
    );
    writeFileSync(
      resolve(directory, "MAINTAINERS.md"),
      "# Maintainers\n\nPublic maintainer registry: configured.\n\n- https://github.com/viberacing-ci-fixture\n",
    );
    let conduct = readFileSync(resolve(directory, "CODE_OF_CONDUCT.md"), "utf8");
    if (mode === "source-only") {
      conduct = conduct.replace(
        "GitHub public interaction status: not restricted or verified.",
        "GitHub public interaction status: restricted and verified.",
      );
    } else if (mode === "open-participation") {
      conduct = conduct
        .replace("External participation status: closed", "External participation status: open")
        .replace(
          "GitHub public interaction status: not restricted or verified.",
          "GitHub public interaction status: enabled for open participation.",
        )
        .replace(
          "Conduct reporting channel: not configured.",
          "Conduct reporting channel: https://reports.example.org/conduct",
        );
    } else {
      throw new Error(`unknown fixture mode: ${mode}`);
    }
    writeFileSync(resolve(directory, "CODE_OF_CONDUCT.md"), conduct);
    const security = readFileSync(resolve(directory, "SECURITY.md"), "utf8").replace(
      "Private vulnerability reporting status: not enabled or verified.",
      "Private vulnerability reporting status: enabled and verified.",
    );
    writeFileSync(resolve(directory, "SECURITY.md"), security);
  }
  return directory;
}

function run(directory) {
  return spawnSync(process.execPath, [checker, "--root", directory], {
    encoding: "utf8",
    cwd: root,
  });
}

const cases = [
  {
    name: "rejects the honest pre-public state",
    mode: "pre-public",
    expectedStatus: 1,
    expectedText: "Do not publish source yet",
  },
  {
    name: "accepts a complete open-participation publication fixture",
    mode: "open-participation",
    expectedStatus: 0,
    expectedText: "Static publication-readiness checks passed (open-participation)",
  },
  {
    name: "accepts a verified source-only publication fixture",
    mode: "source-only",
    expectedStatus: 0,
    expectedText: "Static publication-readiness checks passed (source-only)",
  },
  {
    name: "rejects CODEOWNERS and maintainer drift",
    mode: "open-participation",
    mutate(directory) {
      writeFileSync(
        resolve(directory, ".github/CODEOWNERS"),
        "* @different-fixture\n/.github/ @different-fixture\n/CODE_OF_CONDUCT.md @different-fixture\n/SECURITY.md @different-fixture\n",
      );
    },
    expectedStatus: 1,
    expectedText: "must include a listed public maintainer directly",
  },
  {
    name: "rejects a trailing global CODEOWNERS override",
    mode: "open-participation",
    mutate(directory) {
      const path = resolve(directory, ".github/CODEOWNERS");
      writeFileSync(path, `${readFileSync(path, "utf8")}* @different-fixture\n`);
    },
    expectedStatus: 1,
    expectedText: "exactly one global * rule",
  },
  {
    name: "rejects unreviewed CODEOWNERS wildcard syntax",
    mode: "open-participation",
    mutate(directory) {
      const path = resolve(directory, ".github/CODEOWNERS");
      writeFileSync(path, `${readFileSync(path, "utf8")}/docs/** @viberacing-ci-fixture\n`);
    },
    expectedStatus: 1,
    expectedText: "outside the reviewed literal-path subset",
  },
  {
    name: "rejects a public issue page as a conduct channel",
    mode: "open-participation",
    mutate(directory) {
      const path = resolve(directory, "CODE_OF_CONDUCT.md");
      writeFileSync(
        path,
        readFileSync(path, "utf8").replace(
          "https://reports.example.org/conduct",
          "https://github.com/viberacing-ci-fixture/project/issues",
        ),
      );
    },
    expectedStatus: 1,
    expectedText: "not a public issue page",
  },
  {
    name: "rejects query data in the conduct channel",
    mode: "open-participation",
    mutate(directory) {
      const path = resolve(directory, "CODE_OF_CONDUCT.md");
      writeFileSync(
        path,
        readFileSync(path, "utf8").replace(
          "https://reports.example.org/conduct",
          "https://reports.example.org/conduct?case=fixture",
        ),
      );
    },
    expectedStatus: 1,
    expectedText: "credential-free HTTPS endpoint without query data",
  },
  {
    name: "rejects closed participation while public interactions remain enabled",
    mode: "open-participation",
    mutate(directory) {
      const path = resolve(directory, "CODE_OF_CONDUCT.md");
      writeFileSync(
        path,
        readFileSync(path, "utf8").replace(
          "External participation status: open",
          "External participation status: closed",
        ),
      );
    },
    expectedStatus: 1,
    expectedText: "source-only publication requires GitHub Issues",
  },
  {
    name: "rejects unverified source-only interaction controls",
    mode: "source-only",
    mutate(directory) {
      const path = resolve(directory, "CODE_OF_CONDUCT.md");
      writeFileSync(
        path,
        readFileSync(path, "utf8").replace(
          "GitHub public interaction status: restricted and verified.",
          "GitHub public interaction status: not restricted or verified.",
        ),
      );
    },
    expectedStatus: 1,
    expectedText: "source-only publication requires GitHub Issues",
  },
  {
    name: "rejects a missing conduct-channel status in source-only mode",
    mode: "source-only",
    mutate(directory) {
      const path = resolve(directory, "CODE_OF_CONDUCT.md");
      writeFileSync(
        path,
        readFileSync(path, "utf8").replace("Conduct reporting channel: not configured.\n", ""),
      );
    },
    expectedStatus: 1,
    expectedText: "conduct-reporting channel status is missing",
  },
];

try {
  for (const [index, testCase] of cases.entries()) {
    const directory = makeFixture(`case-${index}`, testCase.mode);
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
  console.log(`Publication-readiness checker tests passed (${cases.length} cases).`);
} finally {
  rmSync(fixtureRoot, { force: true, recursive: true });
}

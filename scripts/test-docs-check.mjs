import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import process from "node:process";
import { tmpdir } from "node:os";

const sourceRoot = resolve(import.meta.dirname, "..");
const temporaryRoot = mkdtempSync(join(tmpdir(), "viberacing-docs-check-"));
const outsidePath = `${temporaryRoot}-outside.md`;

function scan() {
  return spawnSync(process.execPath, [join(temporaryRoot, "scripts", "check-docs.mjs")], {
    cwd: temporaryRoot,
    encoding: "utf8",
  });
}

function expectPass(label, result) {
  if (result.status !== 0) {
    throw new Error(`${label} unexpectedly failed:\n${result.stderr}`);
  }
}

function expectFailure(label, result, expectedFinding) {
  if (result.status === 0) {
    throw new Error(`${label} unexpectedly passed`);
  }
  if (!result.stderr.includes(expectedFinding)) {
    throw new Error(`${label} did not report ${expectedFinding}:\n${result.stderr}`);
  }
}

try {
  mkdirSync(join(temporaryRoot, "scripts"));
  mkdirSync(join(temporaryRoot, "docs"));
  copyFileSync(
    join(sourceRoot, "scripts", "check-docs.mjs"),
    join(temporaryRoot, "scripts", "check-docs.mjs"),
  );
  execFileSync("git", ["init", "--quiet", "--initial-branch=main", "--template="], {
    cwd: temporaryRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const readmePath = join(temporaryRoot, "README.md");
  const guidePath = join(temporaryRoot, "docs", "guide.md");
  writeFileSync(guidePath, "# Guide\n\n## Safe anchor\n", "utf8");
  writeFileSync(readmePath, "# Project\n\n[Guide](docs/guide.md#safe-anchor)\n", "utf8");
  expectPass("valid relative link and anchor", scan());

  writeFileSync(readmePath, "# Project\n\n[Missing](docs/missing.md)\n", "utf8");
  expectFailure("missing file", scan(), "missing relative link target");

  writeFileSync(readmePath, "# Project\n\n[Missing](docs/guide.md#absent)\n", "utf8");
  expectFailure("missing anchor", scan(), "missing Markdown anchor");

  writeFileSync(readmePath, "# Project\n\n## Same\n\n## Same\n", "utf8");
  expectFailure("duplicate anchor", scan(), "duplicate heading anchor");

  writeFileSync(outsidePath, "# Private local document\n", "utf8");
  const escapedTarget = `../${basename(outsidePath)}`;
  writeFileSync(readmePath, `# Project\n\n[Outside](${escapedTarget})\n`, "utf8");
  expectFailure("repository escape", scan(), "relative link escapes repository root");

  console.log("Documentation checker tests passed (5 cases).");
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
  rmSync(outsidePath, { force: true });
}

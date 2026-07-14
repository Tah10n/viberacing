import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const checker = resolve(import.meta.dirname, "check-spelling.mjs");
const fixtureRoot = mkdtempSync(join(tmpdir(), "viberacing-spelling-check-"));
const misspelling = String.fromCharCode(100, 101, 108, 105, 98, 101, 114, 97, 116, 108, 121);

function run(directory) {
  return spawnSync(process.execPath, [checker, "--root", directory], {
    cwd: directory,
    encoding: "utf8",
  });
}

function writeConfig(directory) {
  writeFileSync(
    join(directory, "cspell.json"),
    `${JSON.stringify(
      {
        version: "0.2",
        language: "en",
        files: ["docs/**/*.md"],
        useGitignore: false,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

try {
  mkdirSync(join(fixtureRoot, "docs"), { recursive: true });
  writeConfig(fixtureRoot);
  writeFileSync(
    join(fixtureRoot, "docs", "safe.md"),
    "# Safe fixture\n\nThis sentence is intentionally spelled correctly.\n",
    "utf8",
  );
  const safe = run(fixtureRoot);
  if (safe.status !== 0) {
    throw new Error(`safe spelling fixture failed:\n${safe.stdout}${safe.stderr}`);
  }

  writeFileSync(
    join(fixtureRoot, "docs", "unsafe.md"),
    `# Unsafe fixture\n\nThis sentence is ${misspelling} misspelled.\n`,
    "utf8",
  );
  const unsafe = run(fixtureRoot);
  if (unsafe.status === 0 || !`${unsafe.stdout}${unsafe.stderr}`.includes(misspelling)) {
    throw new Error(`misspelled fixture was not rejected:\n${unsafe.stdout}${unsafe.stderr}`);
  }

  console.log("Spelling checker tests passed (2 cases).");
} finally {
  rmSync(fixtureRoot, { force: true, recursive: true });
}

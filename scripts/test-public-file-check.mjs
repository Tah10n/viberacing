import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { tmpdir } from "node:os";

const sourceRoot = resolve(import.meta.dirname, "..");
const temporaryRoot = mkdtempSync(join(tmpdir(), "viberacing-public-check-"));

function git(...args) {
  execFileSync("git", args, {
    cwd: temporaryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function scan(mode) {
  return spawnSync(process.execPath, [join(temporaryRoot, "scripts", "check-public-files.mjs"), mode], {
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
  copyFileSync(
    join(sourceRoot, "scripts", "check-public-files.mjs"),
    join(temporaryRoot, "scripts", "check-public-files.mjs"),
  );
  git("init", "--quiet", "--initial-branch=main", "--template=");

  const safePath = join(temporaryRoot, "safe.txt");
  writeFileSync(safePath, "safe@example.com\n192.0.2.10\n", "utf8");
  expectPass("reserved example data", scan("--all"));

  const candidatePath = join(temporaryRoot, "candidate.txt");
  const fakeKey = ["sk", "-", "proj", "-", "A".repeat(24)].join("");
  writeFileSync(candidatePath, `${fakeKey}\n`, "utf8");
  expectFailure("secret-shaped value", scan("--all"), "OpenAI-style secret key");
  unlinkSync(candidatePath);

  const privateEmail = ["person", "@", "private-domain", ".com"].join("");
  writeFileSync(candidatePath, `${privateEmail}\n`, "utf8");
  expectFailure("personal email", scan("--all"), "non-example email address");
  unlinkSync(candidatePath);

  const userHome = ["C:", "\\", "Users", "\\", "private-user", "\\", "repo"].join("");
  writeFileSync(candidatePath, `${userHome}\n`, "utf8");
  expectFailure("local path", scan("--all"), "Windows user-home path");
  unlinkSync(candidatePath);

  const unsafeEnvironmentPath = join(temporaryRoot, ".env.production");
  writeFileSync(unsafeEnvironmentPath, "PLACEHOLDER=true\n", "utf8");
  expectFailure("environment filename", scan("--all"), "environment file is not publishable");
  unlinkSync(unsafeEnvironmentPath);

  writeFileSync(candidatePath, "safe staged value\n", "utf8");
  git("add", "candidate.txt");
  writeFileSync(candidatePath, `${privateEmail}\n`, "utf8");
  expectPass("staged snapshot isolation", scan("--staged"));
  git("add", "candidate.txt");
  expectFailure("staged private value", scan("--staged"), "non-example email address");

  console.log("Public-file checker tests passed (6 cases)." );
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}

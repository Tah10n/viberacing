import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const sourceRoot = resolve(import.meta.dirname, "..");
const fixtureRoot = mkdtempSync(join(tmpdir(), "viberacing-history-check-"));
const fixtureName = "History Test";
const fixtureEmail = ["123456+history-test", "@", "users.noreply.github.com"].join("");
const differentFixtureEmail = ["654321+different", "@", "users.noreply.github.com"].join("");

function git(directory, ...args) {
  return execFileSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function commit(directory, ...args) {
  return git(directory, "commit", "--quiet", "-s", ...args);
}

function makeFixture(name) {
  const directory = join(fixtureRoot, name);
  mkdirSync(join(directory, "scripts", "lib"), { recursive: true });
  copyFileSync(
    join(sourceRoot, "scripts", "check-git-history.mjs"),
    join(directory, "scripts", "check-git-history.mjs"),
  );
  copyFileSync(
    join(sourceRoot, "scripts", "lib", "public-content-policy.mjs"),
    join(directory, "scripts", "lib", "public-content-policy.mjs"),
  );
  git(directory, "init", "--quiet", "--initial-branch=main", "--template=");
  git(directory, "config", "user.name", fixtureName);
  git(directory, "config", "user.email", fixtureEmail);
  writeFileSync(join(directory, "safe.txt"), "safe@example.com\n192.0.2.9\n", "utf8");
  git(directory, "add", "safe.txt", "scripts");
  commit(directory, "-m", "safe baseline");
  return directory;
}

function run(directory) {
  return spawnSync(
    process.execPath,
    [join(directory, "scripts", "check-git-history.mjs"), "--root", directory],
    { cwd: directory, encoding: "utf8" },
  );
}

function expectPass(label, result) {
  if (result.status !== 0) {
    throw new Error(`${label} unexpectedly failed:\n${result.stdout}${result.stderr}`);
  }
}

function expectFailure(label, result, expectedFinding) {
  if (result.status === 0) {
    throw new Error(`${label} unexpectedly passed`);
  }
  const output = `${result.stdout}${result.stderr}`;
  if (!output.includes(expectedFinding)) {
    throw new Error(`${label} did not report ${expectedFinding}:\n${output}`);
  }
}

try {
  const safe = makeFixture("safe");
  expectPass("safe reachable history", run(safe));

  const removedSecret = makeFixture("removed-secret");
  const secretPath = join(removedSecret, "history.txt");
  const fakeKey = ["sk", "-", "proj", "-", "H".repeat(24)].join("");
  writeFileSync(secretPath, `${fakeKey}\n`, "utf8");
  git(removedSecret, "add", "history.txt");
  commit(removedSecret, "-m", "add then remove test fixture");
  unlinkSync(secretPath);
  git(removedSecret, "add", "-u");
  commit(removedSecret, "-m", "remove test fixture");
  expectFailure("removed historical secret", run(removedSecret), "OpenAI-style secret key");

  const commitMessage = makeFixture("commit-message");
  const privateEmail = ["person", "@", "private-domain", ".com"].join("");
  commit(commitMessage, "--allow-empty", "-m", `contact ${privateEmail}`);
  expectFailure("commit message data", run(commitMessage), "non-example email address");

  const forbiddenPath = makeFixture("forbidden-path");
  const environmentPath = join(forbiddenPath, ".env.production");
  writeFileSync(environmentPath, "EXAMPLE=true\n", "utf8");
  git(forbiddenPath, "add", ".env.production");
  commit(forbiddenPath, "-m", "historical forbidden path fixture");
  unlinkSync(environmentPath);
  git(forbiddenPath, "add", "-u");
  commit(forbiddenPath, "-m", "remove forbidden path fixture");
  expectFailure(
    "historical forbidden path",
    run(forbiddenPath),
    "environment file is not publishable",
  );

  const binaryMetadata = makeFixture("binary-metadata");
  const binaryPath = join(binaryMetadata, "fixture.bin");
  const fakeToken = ["ghp", "_", "C".repeat(24)].join("");
  writeFileSync(
    binaryPath,
    Buffer.concat([Buffer.from([0, 1, 2, 3]), Buffer.from(fakeToken, "ascii")]),
  );
  git(binaryMetadata, "add", "fixture.bin");
  commit(binaryMetadata, "-m", "binary metadata fixture");
  expectFailure("binary metadata", run(binaryMetadata), "GitHub token");

  const unreachable = makeFixture("unreachable");
  const unreachablePath = join(unreachable, "unreachable.txt");
  writeFileSync(unreachablePath, `${fakeKey}\n`, "utf8");
  git(unreachable, "hash-object", "-w", "unreachable.txt");
  unlinkSync(unreachablePath);
  expectPass("unreachable object scope", run(unreachable));

  const missingDco = makeFixture("missing-dco");
  git(missingDco, "commit", "--quiet", "--allow-empty", "-m", "unsigned change");
  expectFailure("missing DCO", run(missingDco), "missing exact author DCO sign-off");

  const mismatchedDco = makeFixture("mismatched-dco");
  git(
    mismatchedDco,
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "mismatched sign-off",
    "-m",
    `Signed-off-by: Different Contributor <${differentFixtureEmail}>`,
  );
  expectFailure("mismatched DCO", run(mismatchedDco), "DCO sign-off does not match commit author");

  const placeholderIdentity = makeFixture("placeholder-identity");
  git(placeholderIdentity, "config", "user.name", "Vibe Racing Maintainer");
  git(placeholderIdentity, "config", "user.email", "maintainer@viberacing.invalid");
  commit(placeholderIdentity, "--allow-empty", "-m", "placeholder identity");
  expectFailure(
    "placeholder identity",
    run(placeholderIdentity),
    "placeholder author email is not publishable Git identity",
  );

  const duplicateDco = makeFixture("duplicate-dco");
  git(
    duplicateDco,
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "duplicate sign-off",
    "-m",
    `Signed-off-by: ${fixtureName} <${fixtureEmail}>\nSigned-off-by: ${fixtureName} <${fixtureEmail}>`,
  );
  expectFailure(
    "duplicate DCO",
    run(duplicateDco),
    "commit must contain exactly one Signed-off-by trailer",
  );

  const nonFinalDco = makeFixture("non-final-dco");
  git(
    nonFinalDco,
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "misplaced sign-off",
    "-m",
    `Signed-off-by: ${fixtureName} <${fixtureEmail}>\nordinary body after the trailer`,
  );
  expectFailure(
    "non-final DCO",
    run(nonFinalDco),
    "Signed-off-by must be the final commit trailer",
  );

  console.log("Git history checker tests passed (11 cases).");
} finally {
  rmSync(fixtureRoot, { force: true, recursive: true });
}

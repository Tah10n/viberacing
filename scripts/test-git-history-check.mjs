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

function individualRemediationMessage(name, email, oid) {
  return `I, ${name} <${email}>, hereby add my Signed-off-by to this commit: ${oid}`;
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

function run(directory, extraArguments = []) {
  return spawnSync(
    process.execPath,
    [join(directory, "scripts", "check-git-history.mjs"), "--root", directory, ...extraArguments],
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

  const remediatedMissingDco = makeFixture("remediated-missing-dco");
  git(
    remediatedMissingDco,
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "unsigned published change",
  );
  const missingDcoOid = git(remediatedMissingDco, "rev-parse", "HEAD").trim();
  commit(
    remediatedMissingDco,
    "--allow-empty",
    "-m",
    "remediate published DCO",
    "-m",
    individualRemediationMessage(fixtureName, fixtureEmail, missingDcoOid),
  );
  expectPass("same-author missing-DCO remediation", run(remediatedMissingDco));

  const remediatedNameMismatch = makeFixture("remediated-name-mismatch");
  git(
    remediatedNameMismatch,
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "published name mismatch",
    "-m",
    `Signed-off-by: Wrong History Name <${fixtureEmail}>`,
  );
  const mismatchedNameOid = git(remediatedNameMismatch, "rev-parse", "HEAD").trim();
  commit(
    remediatedNameMismatch,
    "--allow-empty",
    "-m",
    "remediate published DCO",
    "-m",
    individualRemediationMessage(fixtureName, fixtureEmail, mismatchedNameOid),
  );
  expectPass("same-email name-mismatch remediation", run(remediatedNameMismatch));

  const unreachableRemediationTarget = makeFixture("unreachable-remediation-target");
  commit(
    unreachableRemediationTarget,
    "--allow-empty",
    "-m",
    "reference unreachable remediation target",
    "-m",
    individualRemediationMessage(fixtureName, fixtureEmail, "0".repeat(40)),
  );
  expectFailure(
    "unreachable remediation target",
    run(unreachableRemediationTarget),
    "DCO remediation target must be reachable",
  );

  const nonAncestorRemediation = makeFixture("non-ancestor-remediation");
  git(nonAncestorRemediation, "switch", "--quiet", "-c", "published-target");
  git(
    nonAncestorRemediation,
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "unsigned sibling change",
  );
  const siblingTargetOid = git(nonAncestorRemediation, "rev-parse", "HEAD").trim();
  git(nonAncestorRemediation, "switch", "--quiet", "main");
  commit(
    nonAncestorRemediation,
    "--allow-empty",
    "-m",
    "invalid sibling remediation",
    "-m",
    individualRemediationMessage(fixtureName, fixtureEmail, siblingTargetOid),
  );
  expectFailure(
    "non-ancestor remediation",
    run(nonAncestorRemediation),
    "DCO remediation target must be a strict ancestor",
  );

  const unsignedRemediation = makeFixture("unsigned-remediation");
  git(unsignedRemediation, "commit", "--quiet", "--allow-empty", "-m", "unsigned published change");
  const unsignedTargetOid = git(unsignedRemediation, "rev-parse", "HEAD").trim();
  git(
    unsignedRemediation,
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "unsigned remediation",
    "-m",
    individualRemediationMessage(fixtureName, fixtureEmail, unsignedTargetOid),
  );
  expectFailure(
    "unsigned remediation",
    run(unsignedRemediation),
    "individual DCO remediation commit must be directly signed",
  );

  const wrongAuthorRemediation = makeFixture("wrong-author-remediation");
  git(
    wrongAuthorRemediation,
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "unsigned published change",
  );
  const wrongAuthorTargetOid = git(wrongAuthorRemediation, "rev-parse", "HEAD").trim();
  git(wrongAuthorRemediation, "config", "user.name", "Different History Test");
  git(wrongAuthorRemediation, "config", "user.email", differentFixtureEmail);
  commit(
    wrongAuthorRemediation,
    "--allow-empty",
    "-m",
    "wrong-author remediation",
    "-m",
    individualRemediationMessage(fixtureName, fixtureEmail, wrongAuthorTargetOid),
  );
  expectFailure(
    "wrong-author remediation",
    run(wrongAuthorRemediation),
    "individual DCO remediation must match both commit authors",
  );

  const differentEmailTarget = makeFixture("different-email-target");
  git(
    differentEmailTarget,
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "published different-email sign-off",
    "-m",
    `Signed-off-by: Different History Test <${differentFixtureEmail}>`,
  );
  const differentEmailTargetOid = git(differentEmailTarget, "rev-parse", "HEAD").trim();
  commit(
    differentEmailTarget,
    "--allow-empty",
    "-m",
    "ineligible remediation",
    "-m",
    individualRemediationMessage(fixtureName, fixtureEmail, differentEmailTargetOid),
  );
  expectFailure(
    "different-email target remediation",
    run(differentEmailTarget),
    "target commit is not eligible for DCO remediation",
  );

  const duplicateRemediation = makeFixture("duplicate-remediation");
  git(
    duplicateRemediation,
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "unsigned published change",
  );
  const duplicateTargetOid = git(duplicateRemediation, "rev-parse", "HEAD").trim();
  for (const ordinal of ["first", "second"]) {
    commit(
      duplicateRemediation,
      "--allow-empty",
      "-m",
      `${ordinal} remediation`,
      "-m",
      individualRemediationMessage(fixtureName, fixtureEmail, duplicateTargetOid),
    );
  }
  expectFailure(
    "duplicate remediation",
    run(duplicateRemediation),
    "commit must have exactly one individual DCO remediation",
  );

  const malformedRemediation = makeFixture("malformed-remediation");
  commit(
    malformedRemediation,
    "--allow-empty",
    "-m",
    "malformed remediation",
    "-m",
    individualRemediationMessage(fixtureName, fixtureEmail, "a".repeat(12)),
  );
  expectFailure(
    "malformed remediation",
    run(malformedRemediation),
    "malformed individual DCO remediation declaration",
  );

  const multipleDeclarations = makeFixture("multiple-remediation-declarations");
  git(
    multipleDeclarations,
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "unsigned published change",
  );
  const multipleDeclarationsTargetOid = git(multipleDeclarations, "rev-parse", "HEAD").trim();
  const repeatedDeclaration = individualRemediationMessage(
    fixtureName,
    fixtureEmail,
    multipleDeclarationsTargetOid,
  );
  commit(
    multipleDeclarations,
    "--allow-empty",
    "-m",
    "ambiguous remediation",
    "-m",
    `${repeatedDeclaration}\n${repeatedDeclaration}`,
  );
  expectFailure(
    "multiple remediation declarations",
    run(multipleDeclarations),
    "remediation commit must contain exactly one DCO declaration",
  );

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

  const explicitRevision = makeFixture("explicit-revision");
  git(explicitRevision, "switch", "--quiet", "-c", "automation/update");
  git(explicitRevision, "commit", "--quiet", "--allow-empty", "-m", "unsigned automation change");
  git(explicitRevision, "switch", "--quiet", "main");
  expectFailure(
    "default all-ref scope",
    run(explicitRevision),
    "missing exact author DCO sign-off",
  );
  expectPass("explicit publication revision", run(explicitRevision, ["--ref", "HEAD"]));

  console.log("Git history checker tests passed (22 cases).");
} finally {
  rmSync(fixtureRoot, { force: true, recursive: true });
}

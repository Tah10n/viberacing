import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";

const repositoryRoot = resolve(import.meta.dirname, "..");
const sourceBinary = resolve(repositoryRoot, "target", "release", "viberacing-connector.exe");
const temporaryPrefix = "viberacing-connector-portable-";
const maximumBinaryBytes = 16 * 1024 * 1024;
const maximumOutputBytes = 16 * 1024;
const processTimeoutMilliseconds = 5_000;
const expectedUsage =
  "Usage:\n" +
  "  viberacing-connector connect --origin <https-origin>\n" +
  "  viberacing-connector sync [--codex <absolute-path>]\n" +
  "  viberacing-connector status\n" +
  "  viberacing-connector doctor\n" +
  "  viberacing-connector account list\n" +
  "  viberacing-connector account sync <1..16>\n" +
  "  viberacing-connector disconnect\n" +
  "  viberacing-connector forget-local\n" +
  "  viberacing-connector check-codex [--codex <absolute-path>] [--diagnostic-preview]\n" +
  "  viberacing-connector propose-car --origin <https-origin> --label <device-label> --chassis <formula|rally|roadster> --nose <classic|scoop|wedge> --cockpit <canopy|open|rally> --wing <high|low|none> --wheels <all-terrain|slick|street> --palette <magenta|mint|redline|sunburst|turbo-blue> --trail <grid|none|spark> --seed <0..65535>\n";
const expectedCandidateFailure = "no exact Codex executable was admitted\n";

function normalizeNewlines(value) {
  return value.replaceAll("\r\n", "\n");
}

function readBoundedRegularFile(path) {
  const pathStats = lstatSync(path);
  if (
    pathStats.isSymbolicLink() ||
    !pathStats.isFile() ||
    pathStats.size <= 0 ||
    pathStats.size > maximumBinaryBytes
  ) {
    throw new Error("closed file path");
  }

  const descriptor = openSync(path, "r");
  try {
    const openedStats = fstatSync(descriptor);
    if (
      !openedStats.isFile() ||
      openedStats.dev !== pathStats.dev ||
      openedStats.ino !== pathStats.ino ||
      openedStats.size !== pathStats.size
    ) {
      throw new Error("closed file identity");
    }

    const bytes = Buffer.alloc(openedStats.size);
    let offset = 0;
    while (offset < bytes.length) {
      const readBytes = readSync(descriptor, bytes, offset, bytes.length - offset, null);
      if (readBytes === 0) {
        throw new Error("closed file length");
      }
      offset += readBytes;
    }
    if (readSync(descriptor, Buffer.alloc(1), 0, 1, null) !== 0) {
      throw new Error("closed file growth");
    }

    const finalStats = fstatSync(descriptor);
    if (
      finalStats.dev !== openedStats.dev ||
      finalStats.ino !== openedStats.ino ||
      finalStats.size !== openedStats.size
    ) {
      throw new Error("closed file mutation");
    }
    return {
      bytes,
      digest: createHash("sha256").update(bytes).digest("hex"),
      size: openedStats.size,
    };
  } finally {
    closeSync(descriptor);
  }
}

function exactEntries(path, expected) {
  const entries = readdirSync(path).sort((left, right) => left.localeCompare(right));
  return (
    entries.length === expected.length && entries.every((entry, index) => entry === expected[index])
  );
}

function run(binary, arguments_, workingDirectory, environment) {
  return spawnSync(binary, arguments_, {
    cwd: workingDirectory,
    encoding: "utf8",
    env: environment,
    maxBuffer: maximumOutputBytes,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: processTimeoutMilliseconds,
    windowsHide: true,
  });
}

let failureStage = "platform admission";
let temporaryRoot;
let approvedTemporaryRoot;
let passed = false;

try {
  if (process.argv.length !== 2 || process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("closed invocation");
  }

  failureStage = "source admission";
  const sourceSnapshot = readBoundedRegularFile(sourceBinary);

  failureStage = "temporary-root admission";
  const temporaryParent = realpathSync(tmpdir());
  temporaryRoot = mkdtempSync(join(temporaryParent, temporaryPrefix));
  if (
    dirname(resolve(temporaryRoot)).toLocaleLowerCase("en-US") !==
      resolve(temporaryParent).toLocaleLowerCase("en-US") ||
    !basename(temporaryRoot).startsWith(temporaryPrefix)
  ) {
    throw new Error("closed temporary root");
  }
  const canonicalTemporaryRoot = realpathSync(temporaryRoot);
  if (
    dirname(canonicalTemporaryRoot).toLocaleLowerCase("en-US") !==
      resolve(temporaryParent).toLocaleLowerCase("en-US") ||
    !basename(canonicalTemporaryRoot).startsWith(temporaryPrefix)
  ) {
    throw new Error("closed canonical temporary root");
  }
  approvedTemporaryRoot = canonicalTemporaryRoot;

  failureStage = "portable copy";
  const installationRoot = join(canonicalTemporaryRoot, "portable");
  const stagedBinary = join(installationRoot, "viberacing-connector.exe");
  mkdirSync(installationRoot, { recursive: false });
  writeFileSync(stagedBinary, sourceSnapshot.bytes, { flag: "wx" });
  const stagedSnapshot = readBoundedRegularFile(stagedBinary);
  if (
    stagedSnapshot.size !== sourceSnapshot.size ||
    stagedSnapshot.digest !== sourceSnapshot.digest ||
    !exactEntries(canonicalTemporaryRoot, ["portable"]) ||
    !exactEntries(installationRoot, ["viberacing-connector.exe"])
  ) {
    throw new Error("closed portable copy");
  }

  failureStage = "child environment";
  const systemRoot = process.env.SystemRoot;
  const commandProcessor = process.env.ComSpec;
  if (!systemRoot || !commandProcessor) {
    throw new Error("closed child environment");
  }
  const childEnvironment = {
    ComSpec: commandProcessor,
    PATH: "",
    SystemRoot: systemRoot,
    TEMP: canonicalTemporaryRoot,
    TMP: canonicalTemporaryRoot,
  };

  failureStage = "command surface";
  const usage = run(stagedBinary, ["--help"], installationRoot, childEnvironment);
  if (
    usage.error ||
    usage.signal !== null ||
    usage.status !== 0 ||
    normalizeNewlines(usage.stdout) !== expectedUsage ||
    usage.stderr !== ""
  ) {
    throw new Error("closed command surface");
  }

  failureStage = "candidate failure";
  const missingCandidate = join(canonicalTemporaryRoot, "synthetic-missing-codex.exe");
  const candidate = run(
    stagedBinary,
    ["check-codex", "--codex", missingCandidate],
    installationRoot,
    childEnvironment,
  );
  if (
    existsSync(missingCandidate) ||
    candidate.error ||
    candidate.signal !== null ||
    candidate.status !== 1 ||
    candidate.stdout !== "" ||
    normalizeNewlines(candidate.stderr) !== expectedCandidateFailure
  ) {
    throw new Error("closed candidate failure");
  }

  failureStage = "post-run integrity";
  const finalSourceSnapshot = readBoundedRegularFile(sourceBinary);
  const finalStagedSnapshot = readBoundedRegularFile(stagedBinary);
  if (
    finalSourceSnapshot.size !== sourceSnapshot.size ||
    finalSourceSnapshot.digest !== sourceSnapshot.digest ||
    finalStagedSnapshot.size !== sourceSnapshot.size ||
    finalStagedSnapshot.digest !== sourceSnapshot.digest ||
    !exactEntries(canonicalTemporaryRoot, ["portable"]) ||
    !exactEntries(installationRoot, ["viberacing-connector.exe"])
  ) {
    throw new Error("closed post-run integrity");
  }

  failureStage = "portable removal";
  unlinkSync(stagedBinary);
  if (existsSync(stagedBinary) || !exactEntries(installationRoot, [])) {
    throw new Error("closed portable removal");
  }
  rmdirSync(installationRoot);
  if (existsSync(installationRoot) || !exactEntries(canonicalTemporaryRoot, [])) {
    throw new Error("closed installation-root removal");
  }
  passed = true;
} catch {
  passed = false;
} finally {
  if (approvedTemporaryRoot !== undefined) {
    try {
      const cleanupStats = lstatSync(approvedTemporaryRoot);
      const canonicalCleanupRoot = realpathSync(approvedTemporaryRoot);
      if (
        cleanupStats.isSymbolicLink() ||
        !cleanupStats.isDirectory() ||
        canonicalCleanupRoot.toLocaleLowerCase("en-US") !==
          approvedTemporaryRoot.toLocaleLowerCase("en-US") ||
        !basename(canonicalCleanupRoot).startsWith(temporaryPrefix)
      ) {
        throw new Error("closed cleanup root");
      }
      rmSync(canonicalCleanupRoot, { force: true, recursive: true });
      if (existsSync(approvedTemporaryRoot)) {
        passed = false;
        failureStage = "bounded cleanup";
      }
    } catch {
      passed = false;
      failureStage = "bounded cleanup";
    }
  }
}

if (!passed) {
  console.error(`Windows portable connector smoke failed during ${failureStage}.`);
  process.exit(1);
}

console.log(
  "Windows portable connector smoke passed (bounded copy, closed commands, integrity, removal).",
);

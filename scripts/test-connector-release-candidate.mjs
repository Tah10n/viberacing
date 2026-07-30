import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createSpdxDocument,
  validateReleaseCandidateDirectory,
  writeReleaseCandidate,
} from "./connector-release-candidate.mjs";

const sourceCommit = "1".repeat(40);
const sourceCommittedAt = "2026-07-29T21:10:49.000Z";
const metadata = {
  packages: [
    {
      id: "path+file:///private/workspace/crates/connector#viberacing-connector@0.0.0",
      license: "Apache-2.0",
      name: "viberacing-connector",
      source: null,
      version: "0.0.0",
    },
    {
      id: "registry+https://github.com/rust-lang/crates.io-index#sha2@0.11.0",
      license: "MIT OR Apache-2.0",
      name: "sha2",
      source: "registry+https://github.com/rust-lang/crates.io-index",
      version: "0.11.0",
    },
  ],
  resolve: {
    nodes: [
      {
        dependencies: ["registry+https://github.com/rust-lang/crates.io-index#sha2@0.11.0"],
        id: "path+file:///private/workspace/crates/connector#viberacing-connector@0.0.0",
      },
      {
        dependencies: [],
        id: "registry+https://github.com/rust-lang/crates.io-index#sha2@0.11.0",
      },
    ],
  },
};
const readerSourceText =
  'pub const CODEX_APP_SERVER_0_144_5_READER_VERSION: &str = "codex_app_server_0_144_5_v1";';
const testRoot = mkdtempSync(join(tmpdir(), "viberacing-release-candidate-test-"));

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function refreshChecksums(directory) {
  const entries = ["compatibility-manifest.json", "sbom.spdx.json", "viberacing-connector"];
  const checksums = entries
    .map((fileName) => [fileName, sha256(readFileSync(join(directory, fileName)))])
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([fileName, digest]) => `${digest} *${fileName}`)
    .join("\n")
    .concat("\n");
  writeFileSync(join(directory, "SHA256SUMS"), checksums);
}

try {
  const binaryPath = join(testRoot, "synthetic-connector");
  writeFileSync(binaryPath, Buffer.from("synthetic connector binary"));
  const firstOutputRoot = join(testRoot, "first");
  const result = writeReleaseCandidate({
    binaryPath,
    cargoLockBytes: Buffer.from("version = 4\n"),
    codexManifestBytes: Buffer.from('{"manifestVersion":1}\n'),
    metadata,
    outputRoot: firstOutputRoot,
    readerSourceText,
    sourceCommit,
    sourceCommittedAt,
    target: "linux-x86_64",
  });
  assert.equal(result.artifactBytes, 26);
  assert.equal(result.packageCount, 2);
  assert.match(result.artifactSha256, /^[a-f0-9]{64}$/);

  const candidateDirectory = join(firstOutputRoot, "linux-x86_64");
  const manifest = JSON.parse(
    readFileSync(join(candidateDirectory, "compatibility-manifest.json"), "utf8"),
  );
  assert.equal(manifest.officialRelease, false);
  assert.equal(manifest.releaseStatus, "unsigned-candidate");
  assert.deepEqual(manifest.support.officialSupportedTargets, []);
  assert.deepEqual(manifest.support.candidateBuildTargets, [
    "linux-aarch64",
    "linux-x86_64",
    "macos-aarch64",
    "macos-x86_64",
    "windows-x86_64",
  ]);
  assert.equal(manifest.supplyChain.nativePlatformSignature, "absent-blocks-official-release");

  const firstSpdx = createSpdxDocument({
    metadata,
    sourceCommit,
    sourceCommittedAt,
    target: "linux-x86_64",
  });
  const secondSpdx = createSpdxDocument({
    metadata: structuredClone(metadata),
    sourceCommit,
    sourceCommittedAt,
    target: "linux-x86_64",
  });
  assert.deepEqual(firstSpdx, secondSpdx);
  const spdxText = JSON.stringify(firstSpdx);
  assert.doesNotMatch(spdxText, /private\/workspace/);
  assert.match(spdxText, /pkg:cargo\/sha2@0.11.0/);

  const officialMutation = join(testRoot, "official-mutation");
  cpSync(candidateDirectory, officialMutation, { recursive: true });
  const officialManifestPath = join(officialMutation, "compatibility-manifest.json");
  const officialManifest = JSON.parse(readFileSync(officialManifestPath, "utf8"));
  officialManifest.officialRelease = true;
  writeFileSync(officialManifestPath, `${JSON.stringify(officialManifest, null, 2)}\n`);
  refreshChecksums(officialMutation);
  assert.throws(
    () => validateReleaseCandidateDirectory(officialMutation, "linux-x86_64"),
    /compatibility manifest/,
  );

  const privatePathMutation = join(testRoot, "private-path-mutation");
  cpSync(candidateDirectory, privatePathMutation, { recursive: true });
  const sbomPath = join(privatePathMutation, "sbom.spdx.json");
  const sbom = JSON.parse(readFileSync(sbomPath, "utf8"));
  sbom.name = "C:\\Users\\private\\connector";
  writeFileSync(sbomPath, `${JSON.stringify(sbom, null, 2)}\n`);
  refreshChecksums(privatePathMutation);
  assert.throws(
    () => validateReleaseCandidateDirectory(privatePathMutation, "linux-x86_64"),
    /local path/,
  );

  const extraFileMutation = join(testRoot, "extra-file-mutation");
  cpSync(candidateDirectory, extraFileMutation, { recursive: true });
  writeFileSync(join(extraFileMutation, "unexpected.txt"), "unexpected");
  assert.throws(
    () => validateReleaseCandidateDirectory(extraFileMutation, "linux-x86_64"),
    /inventory/,
  );

  assert.throws(
    () =>
      writeReleaseCandidate({
        binaryPath,
        cargoLockBytes: Buffer.from("version = 4\n"),
        codexManifestBytes: Buffer.from('{"manifestVersion":1}\n'),
        metadata,
        outputRoot: join(testRoot, "drifted-reader"),
        readerSourceText: readerSourceText.replace("_v1", "_v2"),
        sourceCommit,
        sourceCommittedAt,
        target: "linux-x86_64",
      }),
    /reader version evidence drifted/,
  );
  assert.throws(
    () =>
      createSpdxDocument({
        metadata: { packages: metadata.packages, resolve: { nodes: [] } },
        sourceCommit,
        sourceCommittedAt,
        target: "unsupported-target",
      }),
    /source identity/,
  );
} finally {
  const canonicalTestRoot = resolve(testRoot);
  const canonicalTemporaryRoot = resolve(tmpdir());
  if (
    !canonicalTestRoot.startsWith(`${canonicalTemporaryRoot}\\`) &&
    !canonicalTestRoot.startsWith(`${canonicalTemporaryRoot}/`)
  ) {
    throw new Error("release-candidate test cleanup escaped the temporary directory");
  }
  rmSync(canonicalTestRoot, { force: true, recursive: true });
}

console.log(
  "Connector release-candidate tests passed (manifest, SBOM, checksums, privacy, mutations).",
);

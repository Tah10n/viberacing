import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  constants as fileConstants,
} from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

const repositoryRoot = resolve(import.meta.dirname, "..");
const maximumBinaryBytes = 32 * 1024 * 1024;
const maximumMetadataBytes = 16 * 1024 * 1024;
const sourceCommitPattern = /^[a-f0-9]{40}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const targetDefinitions = Object.freeze({
  "linux-aarch64": Object.freeze({
    architecture: "aarch64",
    executableName: "viberacing-connector",
    operatingSystem: "linux",
  }),
  "linux-x86_64": Object.freeze({
    architecture: "x86_64",
    executableName: "viberacing-connector",
    operatingSystem: "linux",
  }),
  "macos-aarch64": Object.freeze({
    architecture: "aarch64",
    executableName: "viberacing-connector",
    operatingSystem: "macos",
  }),
  "macos-x86_64": Object.freeze({
    architecture: "x86_64",
    executableName: "viberacing-connector",
    operatingSystem: "macos",
  }),
  "windows-x86_64": Object.freeze({
    architecture: "x86_64",
    executableName: "viberacing-connector.exe",
    operatingSystem: "windows",
  }),
});
const candidateBuildTargets = Object.freeze(Object.keys(targetDefinitions).sort());
const exactCandidateEntries = Object.freeze([
  "SHA256SUMS",
  "compatibility-manifest.json",
  "sbom.spdx.json",
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return (
    isObject(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
  );
}

function readBoundedRegularFile(path, maximumBytes = maximumMetadataBytes) {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isFile() || stats.size <= 0 || stats.size > maximumBytes) {
    throw new Error("release candidate contains a non-regular or out-of-bounds file");
  }
  return readFileSync(path);
}

function exactTimestamp(value) {
  if (typeof value !== "string") {
    return null;
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function safeSpdxText(value, fallback = "NOASSERTION") {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : fallback;
}

function spdxIdentifier(packageId) {
  return `SPDXRef-Package-${sha256(Buffer.from(packageId)).slice(0, 20)}`;
}

function sortedPackages(metadata) {
  if (
    !isObject(metadata) ||
    !Array.isArray(metadata.packages) ||
    !isObject(metadata.resolve) ||
    !Array.isArray(metadata.resolve.nodes)
  ) {
    throw new Error("Cargo metadata is incomplete");
  }
  if (metadata.packages.length === 0 || metadata.packages.length > 1_024) {
    throw new Error("Cargo package inventory is out of bounds");
  }
  const packages = [...metadata.packages].sort((left, right) =>
    String(left.id).localeCompare(String(right.id)),
  );
  if (
    packages.some(
      (entry) =>
        !isObject(entry) ||
        typeof entry.id !== "string" ||
        entry.id.length === 0 ||
        typeof entry.name !== "string" ||
        entry.name.length === 0 ||
        entry.name.length > 128 ||
        typeof entry.version !== "string" ||
        !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(entry.version),
    )
  ) {
    throw new Error("Cargo package metadata is invalid");
  }
  return packages;
}

export function createSpdxDocument({ metadata, sourceCommit, sourceCommittedAt, target }) {
  const definition = targetDefinitions[target];
  const timestamp = exactTimestamp(sourceCommittedAt);
  if (definition === undefined || !sourceCommitPattern.test(sourceCommit) || timestamp === null) {
    throw new Error("release source identity is invalid");
  }

  const packages = sortedPackages(metadata);
  const packageById = new Map(packages.map((entry) => [entry.id, entry]));
  const spdxIdByPackageId = new Map(packages.map((entry) => [entry.id, spdxIdentifier(entry.id)]));
  const rootPackage = packages.find((entry) => entry.name === "viberacing-connector");
  if (rootPackage === undefined) {
    throw new Error("connector package is absent from Cargo metadata");
  }

  const spdxPackages = packages.map((entry) => {
    const packageValue = {
      SPDXID: spdxIdByPackageId.get(entry.id),
      copyrightText: "NOASSERTION",
      downloadLocation: "NOASSERTION",
      filesAnalyzed: false,
      licenseConcluded: "NOASSERTION",
      licenseDeclared: safeSpdxText(entry.license),
      name: safeSpdxText(entry.name),
      versionInfo: entry.version,
    };
    if (typeof entry.source === "string" && entry.source.startsWith("registry+")) {
      packageValue.externalRefs = [
        {
          referenceCategory: "PACKAGE-MANAGER",
          referenceLocator: `pkg:cargo/${encodeURIComponent(entry.name)}@${encodeURIComponent(entry.version)}`,
          referenceType: "purl",
        },
      ];
    }
    return packageValue;
  });

  const relationships = [
    {
      relatedSpdxElement: spdxIdByPackageId.get(rootPackage.id),
      relationshipType: "DESCRIBES",
      spdxElementId: "SPDXRef-DOCUMENT",
    },
  ];
  for (const node of metadata.resolve.nodes) {
    if (
      !isObject(node) ||
      typeof node.id !== "string" ||
      !packageById.has(node.id) ||
      !Array.isArray(node.dependencies)
    ) {
      throw new Error("Cargo dependency graph is invalid");
    }
    for (const dependencyId of node.dependencies) {
      if (typeof dependencyId !== "string" || !packageById.has(dependencyId)) {
        throw new Error("Cargo dependency graph references an unknown package");
      }
      relationships.push({
        relatedSpdxElement: spdxIdByPackageId.get(dependencyId),
        relationshipType: "DEPENDS_ON",
        spdxElementId: spdxIdByPackageId.get(node.id),
      });
    }
  }
  relationships.sort((left, right) =>
    `${left.spdxElementId}\0${left.relationshipType}\0${left.relatedSpdxElement}`.localeCompare(
      `${right.spdxElementId}\0${right.relationshipType}\0${right.relatedSpdxElement}`,
    ),
  );

  return {
    SPDXID: "SPDXRef-DOCUMENT",
    creationInfo: {
      created: timestamp,
      creators: ["Tool: viberacing-release-candidate-v1"],
    },
    dataLicense: "CC0-1.0",
    documentDescribes: [spdxIdByPackageId.get(rootPackage.id)],
    documentNamespace: `https://viberacing.dev/spdx/connector/${sourceCommit}/${target}`,
    name: `viberacing-connector-${target}-${sourceCommit.slice(0, 12)}`,
    packages: spdxPackages,
    relationships,
    spdxVersion: "SPDX-2.3",
  };
}

function createCompatibilityManifest({
  binaryBytes,
  cargoLockBytes,
  codexManifestBytes,
  connectorVersion,
  readerVersion,
  sourceCommit,
  sourceCommittedAt,
  target,
}) {
  const definition = targetDefinitions[target];
  const timestamp = exactTimestamp(sourceCommittedAt);
  if (
    definition === undefined ||
    !sourceCommitPattern.test(sourceCommit) ||
    timestamp === null ||
    typeof connectorVersion !== "string" ||
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(connectorVersion) ||
    readerVersion !== "codex_app_server_0_144_5_v1"
  ) {
    throw new Error("compatibility manifest input is invalid");
  }

  return {
    schemaVersion: "viberacing.connector-release-candidate.v1",
    releaseStatus: "unsigned-candidate",
    officialRelease: false,
    source: {
      commit: sourceCommit,
      committedAt: timestamp,
    },
    artifact: {
      fileName: definition.executableName,
      bytes: binaryBytes.length,
      sha256: sha256(binaryBytes),
      connectorVersion,
      buildProfile: "release",
      cargoLocked: true,
    },
    platform: {
      target,
      operatingSystem: definition.operatingSystem,
      architecture: definition.architecture,
    },
    support: {
      candidateBuildTargets,
      officialSupportedTargets: [],
      providerReaders: [
        {
          providerId: "codex",
          state: "recognized",
          agentVersion: "0.144.5",
          readerVersion,
          accountingRevision: 1,
          accountingScope: "agent_account",
          admittedPlatforms: ["windows-x86_64"],
          compatibilityEvidenceSha256: sha256(codexManifestBytes),
        },
      ],
    },
    supplyChain: {
      cargoLockSha256: sha256(cargoLockBytes),
      checksumAlgorithm: "SHA-256",
      sbomFormat: "SPDX-2.3",
      provenance: "GitHub Sigstore attestation required before candidate upload",
      nativePlatformSignature: "absent-blocks-official-release",
      installLifecycle: "bounded-portable-copy-remove-smoke",
      automaticSelfUpdate: false,
    },
  };
}

function assertNoPrivatePath(value) {
  if (
    /(?:[A-Za-z]:\\|\/Users\/|\/home\/|file:\/\/|\\Users\\)/i.test(value) ||
    value.includes(repositoryRoot)
  ) {
    throw new Error("release metadata contains a local path");
  }
}

export function validateReleaseCandidateDirectory(directory, target) {
  const definition = targetDefinitions[target];
  if (definition === undefined) {
    throw new Error("release target is invalid");
  }
  const entries = readdirSync(directory).sort();
  const expectedEntries = [...exactCandidateEntries, definition.executableName].sort();
  if (JSON.stringify(entries) !== JSON.stringify(expectedEntries)) {
    throw new Error("release candidate inventory is not exact");
  }
  for (const entry of entries) {
    const stats = lstatSync(join(directory, entry));
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error("release candidate accepts only regular files");
    }
  }

  const binaryBytes = readBoundedRegularFile(
    join(directory, definition.executableName),
    maximumBinaryBytes,
  );
  const manifestBytes = readBoundedRegularFile(join(directory, "compatibility-manifest.json"));
  const sbomBytes = readBoundedRegularFile(join(directory, "sbom.spdx.json"));
  const checksums = readBoundedRegularFile(join(directory, "SHA256SUMS"), 4_096).toString("utf8");
  const expectedChecksums = [
    [definition.executableName, sha256(binaryBytes)],
    ["compatibility-manifest.json", sha256(manifestBytes)],
    ["sbom.spdx.json", sha256(sbomBytes)],
  ]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([fileName, digest]) => `${digest} *${fileName}`)
    .join("\n")
    .concat("\n");
  if (checksums !== expectedChecksums) {
    throw new Error("release candidate checksums are not exact");
  }

  const manifestText = manifestBytes.toString("utf8");
  const sbomText = sbomBytes.toString("utf8");
  assertNoPrivatePath(manifestText);
  assertNoPrivatePath(sbomText);
  const manifest = JSON.parse(manifestText);
  const sbom = JSON.parse(sbomText);
  if (
    !exactKeys(manifest, [
      "artifact",
      "officialRelease",
      "platform",
      "releaseStatus",
      "schemaVersion",
      "source",
      "supplyChain",
      "support",
    ]) ||
    manifest.schemaVersion !== "viberacing.connector-release-candidate.v1" ||
    manifest.releaseStatus !== "unsigned-candidate" ||
    manifest.officialRelease !== false ||
    !sourceCommitPattern.test(manifest.source?.commit ?? "") ||
    exactTimestamp(manifest.source?.committedAt) !== manifest.source?.committedAt ||
    manifest.artifact?.fileName !== definition.executableName ||
    manifest.artifact?.bytes !== binaryBytes.length ||
    manifest.artifact?.sha256 !== sha256(binaryBytes) ||
    manifest.artifact?.buildProfile !== "release" ||
    manifest.artifact?.cargoLocked !== true ||
    manifest.platform?.target !== target ||
    manifest.platform?.operatingSystem !== definition.operatingSystem ||
    manifest.platform?.architecture !== definition.architecture ||
    JSON.stringify(manifest.support?.candidateBuildTargets) !==
      JSON.stringify(candidateBuildTargets) ||
    !Array.isArray(manifest.support?.officialSupportedTargets) ||
    manifest.support.officialSupportedTargets.length !== 0 ||
    manifest.support?.providerReaders?.length !== 1 ||
    manifest.support.providerReaders[0]?.providerId !== "codex" ||
    manifest.support.providerReaders[0]?.state !== "recognized" ||
    manifest.support.providerReaders[0]?.readerVersion !== "codex_app_server_0_144_5_v1" ||
    !digestPattern.test(manifest.support.providerReaders[0]?.compatibilityEvidenceSha256 ?? "") ||
    !digestPattern.test(manifest.supplyChain?.cargoLockSha256 ?? "") ||
    manifest.supplyChain?.checksumAlgorithm !== "SHA-256" ||
    manifest.supplyChain?.sbomFormat !== "SPDX-2.3" ||
    manifest.supplyChain?.provenance !==
      "GitHub Sigstore attestation required before candidate upload" ||
    manifest.supplyChain?.nativePlatformSignature !== "absent-blocks-official-release" ||
    manifest.supplyChain?.installLifecycle !== "bounded-portable-copy-remove-smoke" ||
    manifest.supplyChain?.automaticSelfUpdate !== false
  ) {
    throw new Error("release compatibility manifest is invalid");
  }
  if (
    sbom.spdxVersion !== "SPDX-2.3" ||
    sbom.dataLicense !== "CC0-1.0" ||
    sbom.SPDXID !== "SPDXRef-DOCUMENT" ||
    !Array.isArray(sbom.packages) ||
    sbom.packages.length === 0 ||
    sbom.packages.length > 1_024 ||
    !sbom.packages.some(
      (entry) =>
        entry?.name === "viberacing-connector" &&
        entry?.versionInfo === manifest.artifact.connectorVersion,
    ) ||
    !Array.isArray(sbom.relationships) ||
    !sbom.relationships.some((entry) => entry?.relationshipType === "DESCRIBES")
  ) {
    throw new Error("release SBOM is invalid");
  }
  return {
    artifactBytes: binaryBytes.length,
    artifactSha256: manifest.artifact.sha256,
    packageCount: sbom.packages.length,
  };
}

export function writeReleaseCandidate({
  binaryPath,
  cargoLockBytes,
  codexManifestBytes,
  metadata,
  outputRoot,
  readerSourceText,
  sourceCommit,
  sourceCommittedAt,
  target,
}) {
  const definition = targetDefinitions[target];
  if (definition === undefined) {
    throw new Error("release target is invalid");
  }
  const binaryBytes = readBoundedRegularFile(binaryPath, maximumBinaryBytes);
  if (
    !(cargoLockBytes instanceof Uint8Array) ||
    cargoLockBytes.length === 0 ||
    cargoLockBytes.length > maximumMetadataBytes ||
    !(codexManifestBytes instanceof Uint8Array) ||
    codexManifestBytes.length === 0 ||
    codexManifestBytes.length > maximumMetadataBytes ||
    typeof readerSourceText !== "string" ||
    readerSourceText.length === 0 ||
    readerSourceText.length > maximumMetadataBytes
  ) {
    throw new Error("release evidence input is invalid");
  }
  const readerVersionMatch = readerSourceText.match(
    /CODEX_APP_SERVER_0_144_5_READER_VERSION:\s*&str\s*=\s*"([^"]+)"/,
  );
  if (readerVersionMatch?.[1] !== "codex_app_server_0_144_5_v1") {
    throw new Error("reader version evidence drifted");
  }
  const packages = sortedPackages(metadata);
  const connectorPackage = packages.find((entry) => entry.name === "viberacing-connector");
  if (connectorPackage === undefined) {
    throw new Error("connector package metadata is absent");
  }

  mkdirSync(outputRoot, { recursive: true });
  const candidateDirectory = join(outputRoot, target);
  if (existsSync(candidateDirectory)) {
    throw new Error("release candidate target already exists");
  }
  mkdirSync(candidateDirectory, { recursive: false });
  const artifactPath = join(candidateDirectory, definition.executableName);
  copyFileSync(binaryPath, artifactPath, fileConstants.COPYFILE_EXCL);
  if (definition.operatingSystem !== "windows") {
    chmodSync(artifactPath, 0o755);
  }

  const manifest = createCompatibilityManifest({
    binaryBytes,
    cargoLockBytes,
    codexManifestBytes,
    connectorVersion: connectorPackage.version,
    readerVersion: readerVersionMatch[1],
    sourceCommit,
    sourceCommittedAt,
    target,
  });
  const sbom = createSpdxDocument({
    metadata,
    sourceCommit,
    sourceCommittedAt,
    target,
  });
  const manifestBytes = Buffer.from(canonicalJson(manifest));
  const sbomBytes = Buffer.from(canonicalJson(sbom));
  writeFileSync(join(candidateDirectory, "compatibility-manifest.json"), manifestBytes, {
    flag: "wx",
  });
  writeFileSync(join(candidateDirectory, "sbom.spdx.json"), sbomBytes, { flag: "wx" });
  const checksums = [
    [definition.executableName, sha256(binaryBytes)],
    ["compatibility-manifest.json", sha256(manifestBytes)],
    ["sbom.spdx.json", sha256(sbomBytes)],
  ]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([fileName, digest]) => `${digest} *${fileName}`)
    .join("\n")
    .concat("\n");
  writeFileSync(join(candidateDirectory, "SHA256SUMS"), checksums, {
    encoding: "utf8",
    flag: "wx",
  });
  return validateReleaseCandidateDirectory(candidateDirectory, target);
}

function commandOutput(command, arguments_) {
  return execFileSync(command, arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: maximumMetadataBytes,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  }).trim();
}

export function runReleaseCandidateCli() {
  const target = process.env.VIBERACING_CONNECTOR_RELEASE_TARGET;
  const definition = targetDefinitions[target];
  if (process.argv.length !== 2 || definition === undefined) {
    throw new Error("closed release-candidate invocation");
  }
  const sourceCommit = commandOutput("git", ["show", "-s", "--format=%H", "HEAD"]);
  const sourceCommittedAt = commandOutput("git", ["show", "-s", "--format=%cI", "HEAD"]);
  const metadata = JSON.parse(
    commandOutput("cargo", ["metadata", "--format-version", "1", "--locked", "--offline"]),
  );
  const result = writeReleaseCandidate({
    binaryPath: resolve(repositoryRoot, "target", "release", definition.executableName),
    cargoLockBytes: readBoundedRegularFile(resolve(repositoryRoot, "Cargo.lock")),
    codexManifestBytes: readBoundedRegularFile(
      resolve(repositoryRoot, "compat", "codex", "0.144.5", "manifest.json"),
    ),
    metadata,
    outputRoot: resolve(repositoryRoot, "target", "connector-release-candidate"),
    readerSourceText: readBoundedRegularFile(
      resolve(repositoryRoot, "crates", "connector", "src", "codex_reader.rs"),
    ).toString("utf8"),
    sourceCommit,
    sourceCommittedAt,
    target,
  });
  console.log(
    `Connector ${target} unsigned candidate prepared (${result.packageCount} SBOM packages, ${result.artifactBytes} artifact bytes).`,
  );
}

const invokedPath = process.argv[1] === undefined ? null : resolve(process.argv[1]);
if (invokedPath === resolve(import.meta.filename)) {
  try {
    runReleaseCandidateCli();
  } catch {
    console.error("Connector release candidate preparation failed closed.");
    process.exit(1);
  }
}

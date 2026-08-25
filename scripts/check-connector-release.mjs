import { execFile as execFileCallback, execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const expectedPackageName = "@viberacing/connector";
const expectedRegistry = "https://registry.npmjs.org";
const expectedRepository = Object.freeze({
  type: "git",
  url: "git+https://github.com/Tah10n/viberacing.git",
  directory: "packages/connector",
});
const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const semanticVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const publishedVerificationAttempts = 181;
const publishedVerificationDelayMs = 10_000;

export class ConnectorReleaseError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ConnectorReleaseError";
    this.code = code;
  }
}

function releaseError(code, message) {
  throw new ConnectorReleaseError(code, message);
}

export function compareStableVersions(left, right) {
  const leftMatch = stableVersionPattern.exec(left);
  const rightMatch = stableVersionPattern.exec(right);
  if (leftMatch === null || rightMatch === null) {
    releaseError("CONNECTOR_RELEASE_VERSION_INVALID", "Stable semantic versions are required");
  }
  for (let index = 1; index <= 3; index += 1) {
    const leftPart = BigInt(leftMatch[index]);
    const rightPart = BigInt(rightMatch[index]);
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }
  return 0;
}

function releaseVersionFromTag(tag) {
  if (typeof tag !== "string" || !tag.startsWith("v")) {
    releaseError("CONNECTOR_RELEASE_TAG_INVALID", "Release tag must match vX.Y.Z");
  }
  const version = tag.slice(1);
  const semanticMatch = semanticVersionPattern.exec(version);
  if (semanticMatch === null) {
    releaseError("CONNECTOR_RELEASE_TAG_INVALID", "Release tag must match vX.Y.Z");
  }
  if (semanticMatch[4] !== undefined) {
    releaseError(
      "CONNECTOR_RELEASE_PRERELEASE_FORBIDDEN",
      "Prereleases are not published by the stable connector workflow",
    );
  }
  if (!stableVersionPattern.test(version)) {
    releaseError("CONNECTOR_RELEASE_TAG_INVALID", "Release tag must match vX.Y.Z");
  }
  return version;
}

function validatePackageMetadata(packageMetadata, version) {
  if (packageMetadata.name !== expectedPackageName) {
    releaseError(
      "CONNECTOR_RELEASE_PACKAGE_NAME_INVALID",
      `Package name must be ${expectedPackageName}`,
    );
  }
  if (!stableVersionPattern.test(packageMetadata.version ?? "")) {
    releaseError(
      "CONNECTOR_RELEASE_PACKAGE_VERSION_INVALID",
      "Connector package version must be a canonical stable semantic version",
    );
  }
  if (packageMetadata.version !== version) {
    releaseError(
      "CONNECTOR_RELEASE_TAG_VERSION_MISMATCH",
      "Release tag must exactly match the connector package version",
    );
  }
  if (packageMetadata.private === true) {
    releaseError("CONNECTOR_RELEASE_PACKAGE_PRIVATE", "Connector package must be publishable");
  }
  if (
    packageMetadata.publishConfig?.access !== "public" ||
    packageMetadata.publishConfig?.registry !== expectedRegistry
  ) {
    releaseError(
      "CONNECTOR_RELEASE_PUBLISH_CONFIG_INVALID",
      `Connector publishConfig must use public access and ${expectedRegistry}`,
    );
  }
  if (
    packageMetadata.repository?.type !== expectedRepository.type ||
    packageMetadata.repository?.url !== expectedRepository.url ||
    packageMetadata.repository?.directory !== expectedRepository.directory
  ) {
    releaseError(
      "CONNECTOR_RELEASE_REPOSITORY_INVALID",
      "Connector repository metadata must point to Tah10n/viberacing packages/connector",
    );
  }
  if (
    Object.keys(packageMetadata.bin ?? {}).length !== 1 ||
    packageMetadata.bin?.viberacing !== "bin/viberacing.mjs"
  ) {
    releaseError(
      "CONNECTOR_RELEASE_BIN_INVALID",
      "Connector package must expose only the viberacing binary",
    );
  }
}

export function validateReleaseFiles({ tag, packageMetadata, generatedVersion }) {
  const version = releaseVersionFromTag(tag);
  validatePackageMetadata(packageMetadata, version);
  if (!stableVersionPattern.test(generatedVersion ?? "")) {
    releaseError(
      "CONNECTOR_RELEASE_GENERATED_VERSION_INVALID",
      "Generated connector version must be a canonical stable semantic version",
    );
  }
  if (generatedVersion !== version) {
    releaseError(
      "CONNECTOR_RELEASE_GENERATED_VERSION_MISMATCH",
      "Generated connector version must match package.json and the release tag",
    );
  }
  return version;
}

export async function validateConnectorRelease({
  tag,
  packageMetadata,
  generatedVersion,
  releaseSha,
  candidateIntegrity,
  registry,
}) {
  const version = validateReleaseFiles({ tag, packageMetadata, generatedVersion });
  if (!/^[0-9a-f]{40}$/.test(releaseSha ?? "")) {
    releaseError(
      "CONNECTOR_RELEASE_SHA_INVALID",
      "Release SHA must be a full lowercase commit SHA",
    );
  }
  if (typeof candidateIntegrity !== "string" || !candidateIntegrity.startsWith("sha512-")) {
    releaseError(
      "CONNECTOR_RELEASE_INTEGRITY_INVALID",
      "The local npm package must have a SHA-512 integrity",
    );
  }
  const latest = await registry.latest(expectedPackageName);
  if (latest === null) {
    releaseError(
      "CONNECTOR_RELEASE_BOOTSTRAP_REQUIRED",
      "The package is not published yet; complete the documented interactive first publication before enabling OIDC releases",
    );
  }
  if (!stableVersionPattern.test(latest)) {
    releaseError(
      "CONNECTOR_RELEASE_REGISTRY_LATEST_INVALID",
      "npm latest must be a canonical stable semantic version",
    );
  }
  const published = await registry.metadata(expectedPackageName, version);
  if (published !== null) {
    const repository = published.repository;
    const publishedIntegrity = published.integrity ?? published.dist?.integrity;
    if (
      published.name !== expectedPackageName ||
      published.version !== version ||
      repository?.type !== expectedRepository.type ||
      repository?.url !== expectedRepository.url ||
      repository?.directory !== expectedRepository.directory ||
      published.gitHead !== releaseSha ||
      publishedIntegrity !== candidateIntegrity
    ) {
      releaseError(
        "CONNECTOR_RELEASE_PUBLISHED_MISMATCH",
        "The immutable npm version exists but does not match this release commit and package",
      );
    }
    if (compareStableVersions(version, latest) < 0) {
      releaseError(
        "CONNECTOR_RELEASE_NOT_NEWER_THAN_LATEST",
        "The matching published connector version is older than npm latest",
      );
    }
    return {
      packageName: expectedPackageName,
      version,
      latest,
      action: "verify",
      state: latest === version ? "published_matching_release" : "published_not_latest_yet",
    };
  }
  if (compareStableVersions(version, latest) <= 0) {
    releaseError(
      "CONNECTOR_RELEASE_NOT_NEWER_THAN_LATEST",
      "Candidate connector version must be higher than npm latest",
    );
  }
  return {
    packageName: expectedPackageName,
    version,
    latest,
    action: "publish",
    state: "unpublished",
  };
}

function parseNpmJson(stdout) {
  try {
    return JSON.parse(stdout.trim());
  } catch {
    releaseError(
      "CONNECTOR_RELEASE_REGISTRY_RESPONSE_INVALID",
      "npm returned an invalid release lookup response",
    );
  }
}

export function normalizeNpmLookupString(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === "string") {
    return value[0];
  }
  return "";
}

function normalizeNpmLookupObject(value) {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value;
  if (
    Array.isArray(value) &&
    value.length === 1 &&
    value[0] !== null &&
    typeof value[0] === "object" &&
    !Array.isArray(value[0])
  )
    return value[0];
  return null;
}

function isNpmNotFound(error) {
  return (
    error !== null &&
    typeof error === "object" &&
    (error.code === "E404" ||
      String(error.stdout ?? "").includes("E404") ||
      String(error.stderr ?? "").includes("E404"))
  );
}

async function npmView(arguments_) {
  try {
    const { stdout } = await execFile("npm", ["view", ...arguments_, "--json"], {
      encoding: "utf8",
      env: { ...process.env, npm_config_loglevel: "silent", npm_config_update_notifier: "false" },
      maxBuffer: 1024 * 1024,
    });
    return { found: true, value: parseNpmJson(stdout) };
  } catch (error) {
    if (isNpmNotFound(error)) return { found: false, value: null };
    releaseError(
      "CONNECTOR_RELEASE_REGISTRY_UNAVAILABLE",
      "npm release metadata could not be verified",
    );
  }
}

export const npmRegistry = Object.freeze({
  async latest(packageName) {
    const result = await npmView([packageName, "dist-tags.latest"]);
    if (!result.found) return null;
    return normalizeNpmLookupString(result.value);
  },
  async metadata(packageName, version) {
    const result = await npmView([
      `${packageName}@${version}`,
      "name",
      "version",
      "repository",
      "gitHead",
      "dist.integrity",
    ]);
    if (!result.found) return null;
    const metadata = normalizeNpmLookupObject(result.value);
    if (metadata === null) {
      releaseError(
        "CONNECTOR_RELEASE_REGISTRY_RESPONSE_INVALID",
        "npm returned invalid package metadata",
      );
    }
    return {
      ...metadata,
      integrity: metadata["dist.integrity"] ?? metadata.dist?.integrity,
    };
  },
  async exists(packageName, version) {
    return (await this.metadata(packageName, version)) !== null;
  },
});

export function assertReleaseToolVersions({ nodeVersion, npmVersion }) {
  if (compareStableVersions(nodeVersion, "22.14.0") < 0) {
    releaseError("CONNECTOR_RELEASE_NODE_TOO_OLD", "Connector publication requires Node 22.14.0+");
  }
  if (compareStableVersions(npmVersion, "11.5.1") < 0) {
    releaseError("CONNECTOR_RELEASE_NPM_TOO_OLD", "Connector publication requires npm 11.5.1+");
  }
}

async function readReleaseFiles() {
  const packageUrl = new URL("../packages/connector/package.json", import.meta.url);
  const versionUrl = new URL("../packages/connector/lib/version.mjs", import.meta.url);
  const [packageSource, versionSource] = await Promise.all([
    readFile(packageUrl, "utf8"),
    readFile(versionUrl, "utf8"),
  ]);
  const generatedVersion = versionSource.match(/export const connectorVersion = "([^"]+)";/)?.[1];
  return { packageMetadata: JSON.parse(packageSource), generatedVersion };
}

export function packageIntegrityFromPackManifest(manifest) {
  const candidates = Array.isArray(manifest)
    ? manifest
    : manifest?.integrity === undefined
      ? Object.values(manifest ?? {})
      : [manifest];
  const integrity = candidates.length === 1 ? candidates[0]?.integrity : undefined;
  if (typeof integrity !== "string" || !integrity.startsWith("sha512-")) {
    releaseError(
      "CONNECTOR_RELEASE_INTEGRITY_INVALID",
      "npm pack returned an invalid package integrity",
    );
  }
  return integrity;
}

async function connectorPackageIntegrity() {
  const cache = await mkdtemp(join(tmpdir(), "viberacing-release-npm-cache-"));
  try {
    const { stdout } = await execFile("npm", ["pack", "--dry-run", "--json"], {
      cwd: fileURLToPath(new URL("../packages/connector/", import.meta.url)),
      encoding: "utf8",
      env: { ...process.env, npm_config_cache: cache },
      maxBuffer: 10 * 1024 * 1024,
    });
    return packageIntegrityFromPackManifest(parseNpmJson(stdout));
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
}

export async function verifyPublishedConnector({
  version,
  registry = npmRegistry,
  attempts = publishedVerificationAttempts,
  delayMs = publishedVerificationDelayMs,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const [latest, exists] = await Promise.all([
      registry.latest(expectedPackageName),
      registry.exists(expectedPackageName, version),
    ]);
    if (latest === version && exists) return;
    if (attempt < attempts) {
      await sleep(delayMs);
    }
  }
  releaseError(
    "CONNECTOR_RELEASE_PUBLISH_VERIFICATION_FAILED",
    "Published connector version or npm latest did not become visible before the retry limit",
  );
}

async function main() {
  const [firstArgument, secondArgument, thirdArgument, ...extraArguments] = process.argv.slice(2);
  if (extraArguments.length > 0 || firstArgument === undefined) {
    releaseError(
      "CONNECTOR_RELEASE_USAGE_INVALID",
      "Usage: check-connector-release.mjs --plan vX.Y.Z <release-sha>",
    );
  }
  const { packageMetadata, generatedVersion } = await readReleaseFiles();
  if (firstArgument === "--verify-published") {
    if (secondArgument === undefined || thirdArgument !== undefined) {
      releaseError(
        "CONNECTOR_RELEASE_USAGE_INVALID",
        "Usage: check-connector-release.mjs --verify-published vX.Y.Z",
      );
    }
    const version = validateReleaseFiles({
      tag: secondArgument,
      packageMetadata,
      generatedVersion,
    });
    await verifyPublishedConnector({ version });
    process.stdout.write(`Verified ${expectedPackageName}@${version} and npm latest.\n`);
    return;
  }
  if (firstArgument !== "--plan" || secondArgument === undefined || thirdArgument === undefined) {
    releaseError(
      "CONNECTOR_RELEASE_USAGE_INVALID",
      "Usage: check-connector-release.mjs --plan vX.Y.Z <release-sha>",
    );
  }
  const npmVersion = execFileSync("npm", ["--version"], { encoding: "utf8" }).trim();
  assertReleaseToolVersions({ nodeVersion: process.versions.node, npmVersion });
  const candidateIntegrity = await connectorPackageIntegrity();
  const result = await validateConnectorRelease({
    tag: secondArgument,
    packageMetadata,
    generatedVersion,
    releaseSha: thirdArgument,
    candidateIntegrity,
    registry: npmRegistry,
  });
  process.stdout.write(`${result.action}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const code =
      error instanceof ConnectorReleaseError ? error.code : "CONNECTOR_RELEASE_VALIDATION_FAILED";
    const message =
      error instanceof ConnectorReleaseError
        ? error.message
        : "Connector release validation failed";
    process.stderr.write(`${code}: ${message}\n`);
    process.exitCode = 1;
  });
}

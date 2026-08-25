import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compareStableVersions,
  normalizeNpmLookupString,
  packageIntegrityFromPackManifest,
  validateConnectorRelease,
  validateReleaseFiles,
  verifyPublishedConnector,
} from "./check-connector-release.mjs";

const validPackage = Object.freeze({
  name: "@viberacing/connector",
  version: "0.4.0",
  repository: {
    type: "git",
    url: "git+https://github.com/Tah10n/viberacing.git",
    directory: "packages/connector",
  },
  bin: { viberacing: "bin/viberacing.mjs" },
  publishConfig: { access: "public", registry: "https://registry.npmjs.org" },
});
const releaseSha = "0123456789abcdef0123456789abcdef01234567";
const candidateIntegrity = "sha512-candidate-integrity";
const matchingPublishedMetadata = Object.freeze({
  name: "@viberacing/connector",
  version: "0.4.0",
  repository: validPackage.repository,
  gitHead: releaseSha,
  integrity: candidateIntegrity,
});

function registry({ latest = "0.3.0", published = null } = {}) {
  return {
    latest: async () => latest,
    metadata: async () => published,
  };
}

function validateRelease(options) {
  return validateConnectorRelease({ releaseSha, candidateIntegrity, ...options });
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => error?.code === code);
}

describe("connector release validation", () => {
  it("normalizes scalar and npm 12 single-result array lookups", () => {
    assert.equal(normalizeNpmLookupString("0.4.0"), "0.4.0");
    assert.equal(normalizeNpmLookupString(["0.4.0"]), "0.4.0");
  });

  it("rejects ambiguous or non-string npm lookup responses", () => {
    for (const value of [null, undefined, 0, {}, [], ["0.4.0", "0.4.1"], [0], [["0.4.0"]]]) {
      assert.equal(normalizeNpmLookupString(value), "");
    }
  });

  it("reads npm pack integrity from npm 11 arrays and npm 12 keyed objects", () => {
    assert.equal(
      packageIntegrityFromPackManifest([{ integrity: candidateIntegrity }]),
      candidateIntegrity,
    );
    assert.equal(
      packageIntegrityFromPackManifest({
        "@viberacing/connector": { integrity: candidateIntegrity },
      }),
      candidateIntegrity,
    );
  });

  it("accepts a matching stable tag and a newer unpublished version", async () => {
    assert.equal(
      validateReleaseFiles({
        tag: "v0.4.0",
        packageMetadata: validPackage,
        generatedVersion: "0.4.0",
      }),
      "0.4.0",
    );
    assert.deepEqual(
      await validateRelease({
        tag: "v0.4.0",
        packageMetadata: validPackage,
        generatedVersion: "0.4.0",
        registry: registry(),
      }),
      {
        packageName: "@viberacing/connector",
        version: "0.4.0",
        latest: "0.3.0",
        action: "publish",
        state: "unpublished",
      },
    );
  });

  it("rejects a tag and package version mismatch", () => {
    assert.throws(
      () =>
        validateReleaseFiles({
          tag: "v0.4.1",
          packageMetadata: validPackage,
          generatedVersion: "0.4.0",
        }),
      { code: "CONNECTOR_RELEASE_TAG_VERSION_MISMATCH" },
    );
  });

  it("rejects prerelease tags in the stable workflow", () => {
    assert.throws(
      () =>
        validateReleaseFiles({
          tag: "v0.4.0-rc.1",
          packageMetadata: validPackage,
          generatedVersion: "0.4.0",
        }),
      { code: "CONNECTOR_RELEASE_PRERELEASE_FORBIDDEN" },
    );
  });

  it("rejects malformed and non-canonical versions", () => {
    for (const tag of ["0.4.0", "v0.4", "v01.4.0", "v0.4.0+build"]) {
      assert.throws(
        () =>
          validateReleaseFiles({ tag, packageMetadata: validPackage, generatedVersion: "0.4.0" }),
        { code: "CONNECTOR_RELEASE_TAG_INVALID" },
      );
    }
    assert.throws(
      () =>
        validateReleaseFiles({
          tag: "v0.4.0",
          packageMetadata: { ...validPackage, version: "0.4" },
          generatedVersion: "0.4.0",
        }),
      { code: "CONNECTOR_RELEASE_PACKAGE_VERSION_INVALID" },
    );
  });

  it("resumes an already published package that exactly matches the release", async () => {
    assert.deepEqual(
      await validateRelease({
        tag: "v0.4.0",
        packageMetadata: validPackage,
        generatedVersion: "0.4.0",
        registry: registry({ latest: "0.4.0", published: matchingPublishedMetadata }),
      }),
      {
        packageName: "@viberacing/connector",
        version: "0.4.0",
        latest: "0.4.0",
        action: "verify",
        state: "published_matching_release",
      },
    );
  });

  it("waits for latest when the matching immutable package is already visible", async () => {
    const result = await validateRelease({
      tag: "v0.4.0",
      packageMetadata: validPackage,
      generatedVersion: "0.4.0",
      registry: registry({ latest: "0.3.0", published: matchingPublishedMetadata }),
    });
    assert.equal(result.action, "verify");
    assert.equal(result.state, "published_not_latest_yet");
  });

  it("fails closed when an immutable package has mismatched integrity or commit", async () => {
    for (const published of [
      { ...matchingPublishedMetadata, integrity: "sha512-different" },
      { ...matchingPublishedMetadata, gitHead: "f".repeat(40) },
    ]) {
      await expectCode(
        validateRelease({
          tag: "v0.4.0",
          packageMetadata: validPackage,
          generatedVersion: "0.4.0",
          registry: registry({ latest: "0.4.0", published }),
        }),
        "CONNECTOR_RELEASE_PUBLISHED_MISMATCH",
      );
    }
  });

  it("rejects a candidate below npm latest", async () => {
    await expectCode(
      validateRelease({
        tag: "v0.4.0",
        packageMetadata: validPackage,
        generatedVersion: "0.4.0",
        registry: registry({ latest: "0.5.0" }),
      }),
      "CONNECTOR_RELEASE_NOT_NEWER_THAN_LATEST",
    );
    assert.equal(compareStableVersions("0.4.0", "0.5.0"), -1);
  });

  it("rejects a candidate equal to npm latest even if the exact lookup is inconsistent", async () => {
    await expectCode(
      validateRelease({
        tag: "v0.4.0",
        packageMetadata: validPackage,
        generatedVersion: "0.4.0",
        registry: registry({ latest: "0.4.0" }),
      }),
      "CONNECTOR_RELEASE_NOT_NEWER_THAN_LATEST",
    );
  });

  it("accepts a candidate above npm latest", async () => {
    const result = await validateRelease({
      tag: "v0.4.0",
      packageMetadata: validPackage,
      generatedVersion: "0.4.0",
      registry: registry({ latest: "0.3.99" }),
    });
    assert.equal(result.version, "0.4.0");
    assert.equal(compareStableVersions("0.4.0", "0.3.99"), 1);
  });

  it("requires an interactive bootstrap when the package is absent", async () => {
    await expectCode(
      validateRelease({
        tag: "v0.4.0",
        packageMetadata: validPackage,
        generatedVersion: "0.4.0",
        registry: registry({ latest: null }),
      }),
      "CONNECTOR_RELEASE_BOOTSTRAP_REQUIRED",
    );
  });

  it("rejects unsafe repository metadata", () => {
    assert.throws(
      () =>
        validateReleaseFiles({
          tag: "v0.4.0",
          packageMetadata: {
            ...validPackage,
            repository: { ...validPackage.repository, url: "https://example.invalid/repo.git" },
          },
          generatedVersion: "0.4.0",
        }),
      { code: "CONNECTOR_RELEASE_REPOSITORY_INVALID" },
    );
  });

  it("waits for both the exact version and latest tag to become visible", async () => {
    const latest = ["0.4.1", "0.4.2", "0.4.2"];
    const exists = [false, false, true];
    const delays = [];

    await verifyPublishedConnector({
      version: "0.4.2",
      registry: {
        latest: async () => latest.shift(),
        exists: async () => exists.shift(),
      },
      attempts: 3,
      delayMs: 250,
      sleep: async (milliseconds) => delays.push(milliseconds),
    });

    assert.deepEqual(delays, [250, 250]);
    assert.deepEqual(latest, []);
    assert.deepEqual(exists, []);
  });

  it("stops after the configured publish verification window", async () => {
    let latestLookups = 0;
    let exactLookups = 0;
    const delays = [];

    await expectCode(
      verifyPublishedConnector({
        version: "0.4.2",
        registry: {
          latest: async () => {
            latestLookups += 1;
            return "0.4.1";
          },
          exists: async () => {
            exactLookups += 1;
            return false;
          },
        },
        attempts: 3,
        delayMs: 250,
        sleep: async (milliseconds) => delays.push(milliseconds),
      }),
      "CONNECTOR_RELEASE_PUBLISH_VERIFICATION_FAILED",
    );

    assert.equal(latestLookups, 3);
    assert.equal(exactLookups, 3);
    assert.deepEqual(delays, [250, 250]);
  });
});

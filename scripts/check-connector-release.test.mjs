import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compareStableVersions,
  normalizeNpmLookupString,
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

function registry({ latest = "0.3.0", exists = false } = {}) {
  return {
    latest: async () => latest,
    exists: async () => exists,
  };
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
      await validateConnectorRelease({
        tag: "v0.4.0",
        packageMetadata: validPackage,
        generatedVersion: "0.4.0",
        registry: registry(),
      }),
      { packageName: "@viberacing/connector", version: "0.4.0", latest: "0.3.0" },
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

  it("rejects an already published candidate", async () => {
    await expectCode(
      validateConnectorRelease({
        tag: "v0.4.0",
        packageMetadata: validPackage,
        generatedVersion: "0.4.0",
        registry: registry({ exists: true }),
      }),
      "CONNECTOR_RELEASE_VERSION_EXISTS",
    );
  });

  it("rejects a candidate below npm latest", async () => {
    await expectCode(
      validateConnectorRelease({
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
      validateConnectorRelease({
        tag: "v0.4.0",
        packageMetadata: validPackage,
        generatedVersion: "0.4.0",
        registry: registry({ latest: "0.4.0", exists: false }),
      }),
      "CONNECTOR_RELEASE_NOT_NEWER_THAN_LATEST",
    );
  });

  it("accepts a candidate above npm latest", async () => {
    const result = await validateConnectorRelease({
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
      validateConnectorRelease({
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

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compareStableVersions,
  validateConnectorRelease,
  validateReleaseFiles,
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
});

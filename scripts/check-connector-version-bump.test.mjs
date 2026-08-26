import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isPublishedConnectorPath,
  validateConnectorVersionBump,
} from "./check-connector-version-bump.mjs";

test("classifies exactly the files that can change connector archive contents", () => {
  for (const path of [
    "packages/connector/package.json",
    "packages/connector/README.md",
    "packages/connector/LICENSE",
    "packages/connector/bin/viberacing.mjs",
    "packages/connector/lib/runtime.mjs",
    "packages/connector/scripts/generate-version.mjs",
  ]) {
    assert.equal(isPublishedConnectorPath(path), true, path);
  }
  for (const path of [
    "packages/connector/test/config.test.mjs",
    "apps/web/app/page.tsx",
    "docs/RELEASING.md",
  ]) {
    assert.equal(isPublishedConnectorPath(path), false, path);
  }
});

test("rejects changed archive bytes under an immutable package version", () => {
  assert.throws(
    () =>
      validateConnectorVersionBump({
        baseVersion: "0.4.2",
        changedPaths: ["packages/connector/bin/viberacing.mjs"],
        headVersion: "0.4.2",
      }),
    /without a version increase/,
  );
});

test("accepts a newer version or test-only connector changes", () => {
  assert.deepEqual(
    validateConnectorVersionBump({
      baseVersion: "0.4.2",
      changedPaths: ["packages/connector/bin/viberacing.mjs", "packages/connector/package.json"],
      headVersion: "0.4.3",
    }).publishedChanges,
    ["packages/connector/bin/viberacing.mjs", "packages/connector/package.json"],
  );
  assert.deepEqual(
    validateConnectorVersionBump({
      baseVersion: "0.4.2",
      changedPaths: ["packages/connector/test/config.test.mjs"],
      headVersion: "0.4.2",
    }).publishedChanges,
    [],
  );
});

test("production CI compares connector archive inputs with the pull request base", async () => {
  const workflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(workflow, /node scripts\/check-connector-version-bump\.mjs "\$BASE_SHA" HEAD/);
});

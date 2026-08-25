import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/publish-connector.yml", import.meta.url),
  "utf8",
);
const trigger = workflow.slice(workflow.indexOf("on:"), workflow.indexOf("permissions:"));

describe("Publish connector workflow", () => {
  it("runs only for a published stable GitHub Release", () => {
    assert.match(workflow, /^name: Publish connector$/m);
    assert.match(trigger, /release:\n\s+types: \[published\]/);
    for (const forbiddenTrigger of ["pull_request:", "push:", "schedule:"]) {
      assert.equal(trigger.includes(forbiddenTrigger), false);
    }
    assert.match(
      workflow,
      /if: github\.event\.release\.draft == false && github\.event\.release\.prerelease == false/,
    );
  });

  it("uses minimal OIDC permissions and the protected npm environment", () => {
    assert.match(workflow, /permissions:\n\s+contents: read\n\s+id-token: write/);
    assert.match(workflow, /environment: npm-production/);
    assert.match(workflow, /group: publish-connector\n\s+cancel-in-progress: false/);
    assert.equal(workflow.includes("NPM_TOKEN"), false);
    assert.equal(workflow.includes("NODE_AUTH_TOKEN"), false);
    assert.equal(workflow.includes("--provenance"), false);
  });

  it("pins every action and checks out the exact release tag", () => {
    const actionReferences = [...workflow.matchAll(/uses:\s+([^\s]+)/g)].map((match) => match[1]);
    assert.ok(actionReferences.length > 0);
    for (const action of actionReferences) {
      assert.match(action, /^[^@]+@[0-9a-f]{40}$/);
    }
    assert.match(workflow, /ref: \$\{\{ github\.event\.release\.tag_name \}\}/);
    assert.match(workflow, /persist-credentials: false/);
    assert.match(workflow, /fetch-depth: 0/);
  });

  it("validates, fully verifies, publishes from the package root, and checks latest", () => {
    assert.match(workflow, /check-connector-release\.mjs "\$RELEASE_TAG"/);
    assert.match(workflow, /git merge-base --is-ancestor HEAD origin\/main/);
    assert.match(workflow, /corepack pnpm verify/);
    assert.match(workflow, /corepack pnpm connector:package:check/);
    assert.match(workflow, /npm pack --dry-run/);
    assert.match(workflow, /working-directory: packages\/connector\n\s+run: npm publish/);
    assert.match(workflow, /npm publish --access public --tag latest/);
    assert.match(workflow, /--verify-published "\$RELEASE_TAG"/);
  });
});

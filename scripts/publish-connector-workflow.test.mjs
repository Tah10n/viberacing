import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/publish-connector.yml", import.meta.url),
  "utf8",
);
const requestWorkflow = readFileSync(
  new URL("../.github/workflows/connector-release-request.yml", import.meta.url),
  "utf8",
);
const releasingDocumentation = readFileSync(
  new URL("../docs/RELEASING.md", import.meta.url),
  "utf8",
);
const productionChecklist = readFileSync(
  new URL("../docs/PRODUCTION_CHECKLIST.md", import.meta.url),
  "utf8",
);
const trigger = workflow.slice(workflow.indexOf("on:"), workflow.indexOf("permissions:"));
const requestTrigger = requestWorkflow.slice(
  requestWorkflow.indexOf("on:"),
  requestWorkflow.indexOf("permissions:"),
);

describe("Publish connector workflow", () => {
  it("forwards stable releases without granting the tag workflow publication authority", () => {
    assert.match(requestWorkflow, /^name: Connector release request$/m);
    assert.match(requestTrigger, /release:\n\s+types: \[published\]/);
    assert.match(requestWorkflow, /permissions:\n\s+contents: read/);
    assert.match(
      requestWorkflow,
      /if: github\.event\.release\.draft == false && github\.event\.release\.prerelease == false/,
    );
    assert.equal(requestWorkflow.includes("id-token"), false);
    assert.equal(requestWorkflow.includes("npm-production"), false);
    assert.equal(requestWorkflow.includes("actions/checkout@"), false);
    assert.equal(requestWorkflow.includes("npm publish"), false);
  });

  it("publishes only from a completed release request on the default branch", () => {
    assert.match(workflow, /^name: Publish connector$/m);
    assert.match(
      trigger,
      /workflow_run:\n\s+workflows: \[Connector release request\]\n\s+types: \[completed\]/,
    );
    for (const forbiddenTrigger of [
      "release:",
      "pull_request:",
      "push:",
      "schedule:",
      "workflow_dispatch:",
    ]) {
      assert.equal(trigger.includes(forbiddenTrigger), false);
    }
    assert.match(
      workflow,
      /if:\n\s+github\.ref == 'refs\/heads\/main' && github\.event\.workflow_run\.conclusion == 'success' &&\n\s+github\.event\.workflow_run\.event == 'release' &&\n\s+github\.event\.workflow_run\.head_repository\.full_name == github\.repository/,
    );
    assert.match(workflow, /RELEASE_TAG: \$\{\{ github\.event\.workflow_run\.head_branch \}\}/);
    assert.match(workflow, /RELEASE_SHA: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  });

  it("uses minimal OIDC permissions and the protected npm environment", () => {
    assert.match(workflow, /permissions:\n\s+contents: read\n\s+id-token: write/);
    assert.match(workflow, /environment: npm-production/);
    assert.match(workflow, /group: publish-connector\n\s+cancel-in-progress: false/);
    assert.equal(workflow.includes("NPM_TOKEN"), false);
    assert.equal(workflow.includes("NODE_AUTH_TOKEN"), false);
    assert.equal(workflow.includes("--provenance"), false);
  });

  it("requires the protected environment before trusted publishing in every setup guide", () => {
    const setupGuides = [
      {
        contents: releasingDocumentation,
        environmentMarker: "### 3. Configure the protected GitHub environment",
        trustedPublishingMarker: "### 4. Configure npm Trusted Publisher",
      },
      {
        contents: productionChecklist,
        environmentMarker: "create the GitHub `npm-production` environment",
        trustedPublishingMarker: "configure npm trusted publishing with provenance",
      },
    ];

    for (const { contents, environmentMarker, trustedPublishingMarker } of setupGuides) {
      const environmentIndex = contents.indexOf(environmentMarker);
      const trustedPublishingIndex = contents.indexOf(trustedPublishingMarker);

      assert.ok(environmentIndex >= 0);
      assert.ok(trustedPublishingIndex > environmentIndex);
      assert.match(contents, /select \*\*Protected branches only\*\*/);
      assert.match(
        contents,
        /confirm(?: that)?\s+`main`\s+is\s+covered\s+by\s+the repository's (?:active )?branch ruleset/,
      );
      assert.match(contents, /Do not allow tags or unprotected branches/i);
      assert.match(contents, /do not\s+store a publish token in the environment/i);
      assert.match(
        contents,
        /gh api repos\/Tah10n\/viberacing\/environments\/npm-production[\s\\]+--jq '\.deployment_branch_policy'/,
      );
      assert.match(contents, /protected_branches: true.*custom_branch_policies: false/s);
      assert.match(contents, /environment is absent or unrestricted/);
    }
  });

  it("pins every action and checks out the exact release commit", () => {
    const actionReferences = [...workflow.matchAll(/uses:\s+([^\s]+)/g)].map((match) => match[1]);
    assert.ok(actionReferences.length > 0);
    for (const action of actionReferences) {
      assert.match(action, /^[^@]+@[0-9a-f]{40}$/);
    }
    assert.match(workflow, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
    assert.match(workflow, /persist-credentials: false/);
    assert.match(workflow, /fetch-depth: 0/);
  });

  it("checks main ancestry before executing release-tag code", () => {
    const checkoutIndex = workflow.indexOf("actions/checkout@");
    const ancestryStepIndex = workflow.indexOf(
      "- name: Require the tagged commit to be part of origin/main",
    );
    const ancestryIndex = workflow.indexOf("git merge-base --is-ancestor");
    const setupNodeIndex = workflow.indexOf("actions/setup-node@");
    const installIndex = workflow.indexOf("pnpm install --frozen-lockfile");
    const validationIndex = workflow.indexOf("check-connector-release.mjs");

    assert.ok(checkoutIndex >= 0);
    assert.ok(ancestryStepIndex > checkoutIndex);
    assert.ok(ancestryIndex > ancestryStepIndex);
    assert.ok(ancestryIndex < setupNodeIndex);
    assert.ok(ancestryIndex < installIndex);
    assert.ok(ancestryIndex < validationIndex);
    assert.doesNotMatch(
      workflow.slice(checkoutIndex + "actions/checkout@".length, ancestryStepIndex),
      /^\s+- /m,
    );
    assert.match(
      workflow.slice(ancestryStepIndex, setupNodeIndex),
      /git fetch --no-tags origin refs\/heads\/main:refs\/remotes\/origin\/main\n\s+git merge-base --is-ancestor HEAD refs\/remotes\/origin\/main/,
    );
  });

  it("fully verifies and either publishes or resumes a matching immutable release", () => {
    assert.match(workflow, /refs\/tags\/\$\{RELEASE_TAG\}\^\{commit\}/);
    assert.match(workflow, /releases\/tags\/\$RELEASE_TAG/);
    assert.match(workflow, /\.draft == false and \.prerelease == false/);
    assert.match(workflow, /check-connector-release\.mjs --plan "\$RELEASE_TAG" "\$RELEASE_SHA"/);
    assert.match(workflow, /git merge-base --is-ancestor HEAD refs\/remotes\/origin\/main/);
    assert.match(workflow, /corepack pnpm verify/);
    assert.match(workflow, /corepack pnpm connector:package:check/);
    assert.match(workflow, /npm pack --dry-run/);
    assert.match(workflow, /id: release-plan/);
    assert.match(workflow, /publish\) echo "publish=true"/);
    assert.match(workflow, /verify\) echo "publish=false"/);
    assert.match(workflow, /if: steps\.release-plan\.outputs\.publish == 'true'/);
    assert.match(workflow, /working-directory: packages\/connector\n\s+run: npm publish/);
    assert.match(workflow, /npm publish --access public --tag latest/);
    assert.match(workflow, /--verify-published "\$RELEASE_TAG"/);
  });
});

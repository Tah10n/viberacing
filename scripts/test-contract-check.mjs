import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { writeGeneratedArtifacts } from "./lib/contract-generation.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const checker = resolve(import.meta.dirname, "check-contracts.mjs");
const temporaryRoot = mkdtempSync(join(tmpdir(), "viberacing-contract-check-"));
const evidencePaths = [
  "apps/edge/src/worker.mjs",
  "apps/ingest/src/protocol.ts",
  "apps/ingest/src/database-pool.ts",
  "database/migrations/0004_usage_ingest_replay_and_idempotency.sql",
  "database/tests/usage_accounting.sql",
];
let caseCount = 0;

function jsonPath(root, file) {
  return resolve(root, "contracts", "v1", file);
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function mutateJson(root, file, mutate) {
  const path = jsonPath(root, file);
  const value = JSON.parse(readFileSync(path, "utf8"));
  mutate(value);
  writeJson(path, value);
}

async function makeFixture(name) {
  const root = resolve(temporaryRoot, name);
  cpSync(resolve(repositoryRoot, "contracts", "v1"), resolve(root, "contracts", "v1"), {
    recursive: true,
  });
  mkdirSync(resolve(root, "contracts", "generated"), { recursive: true });
  mkdirSync(resolve(root, "packages", "contracts", "src"), { recursive: true });
  for (const relativePath of evidencePaths) {
    const destination = resolve(root, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(resolve(repositoryRoot, relativePath), destination);
  }
  await writeGeneratedArtifacts(root);
  return root;
}

function run(root) {
  try {
    return {
      output: execFileSync(process.execPath, [checker, "--root", root], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
      status: 0,
    };
  } catch (error) {
    return {
      output: `${error.stdout?.toString() ?? ""}${error.stderr?.toString() ?? ""}`,
      status: error.status ?? 1,
    };
  }
}

async function expectPass(name) {
  caseCount += 1;
  const result = run(await makeFixture(name));
  assert.equal(result.status, 0, result.output);
}

async function expectFail(name, mutation, expected, regenerate = true) {
  caseCount += 1;
  const root = await makeFixture(name);
  await mutation(root);
  if (regenerate) {
    await writeGeneratedArtifacts(root);
  }
  const result = run(root);
  assert.notEqual(result.status, 0, `${name} unexpectedly passed`);
  assert.match(result.output, expected, result.output);
}

async function expectOpenApi() {
  caseCount += 1;
  const root = await makeFixture("generated-openapi");
  const document = JSON.parse(
    readFileSync(resolve(root, "contracts", "generated", "openapi.v1.json"), "utf8"),
  );
  assert.equal(Object.hasOwn(document, "servers"), false);
  assert.equal(Object.hasOwn(document.components, "securitySchemes"), false);
  assert.deepEqual(Object.keys(document.paths), [
    "/v1/connector/cars/proposals",
    "/v1/connector/pairing/poll",
    "/v1/connector/pairing/start",
    "/v1/leaderboards/{seasonStart}",
    "/v1/leaderboards/current",
    "/v1/profiles/{handle}",
    "/v1/usage",
  ]);
  assert.equal(
    Object.keys(document.paths).some((path) => path.startsWith("/v1/community/")),
    false,
  );

  const historical = document.paths["/v1/leaderboards/{seasonStart}"].get;
  assert.deepEqual(
    historical.parameters.map(({ in: location, name, required }) => ({
      location,
      name,
      required,
    })),
    [
      { location: "path", name: "seasonStart", required: true },
      { location: "query", name: "trustTier", required: true },
      { location: "query", name: "page", required: true },
      { location: "header", name: "Accept", required: false },
      { location: "header", name: "If-None-Match", required: false },
    ],
  );
  assert.deepEqual(historical.responses["200"].headers["Cache-Control"].schema.enum, [
    "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
    "public, max-age=300, s-maxage=31536000, immutable",
  ]);
  assert.equal(historical.responses["200"].headers.Vary.schema.const, "Accept");
  assert.equal(historical.responses["304"].headers.ETag.schema.pattern, '^"sha256:[a-f0-9]{64}"$');
  assert.equal(historical.responses["503"].headers["Cache-Control"].schema.const, "no-store");
  assert.equal(historical["x-viberacing-cookie-policy"], "none");
  assert.equal(document.paths["/v1/usage"].post["x-viberacing-status"], "implemented-local");
  assert.equal(
    document.paths["/v1/connector/pairing/start"].post["x-viberacing-status"],
    "contract-only",
  );
}

try {
  await expectPass("baseline");
  await expectOpenApi();

  await expectFail(
    "legacy-route",
    (root) =>
      mutateJson(root, "manifest.json", (manifest) => {
        manifest.operations[4].path = "/v1/community/tokens";
        manifest.operations.sort((left, right) =>
          `${left.path}\u0000${left.method}`.localeCompare(`${right.path}\u0000${right.method}`),
        );
      }),
    /legacy Community route|differs from review/u,
  );
  await expectFail(
    "provider-widening",
    (root) =>
      mutateJson(root, "agent-provider.schema.json", (schema) => {
        schema.enum.push("claude_code");
        schema.maxLength = 11;
      }),
    /supported provider enum differs/u,
  );
  await expectFail(
    "usage-provider",
    (root) =>
      mutateJson(root, "usage-sync.schema.json", (schema) => {
        schema.properties.provider = {
          type: "string",
          enum: ["codex"],
          minLength: 5,
          maxLength: 5,
        };
        schema["x-viberacing-optionalProperties"] = ["provider"];
      }),
    /provider or server-derived field leaked/u,
  );
  await expectFail(
    "usage-number",
    (root) =>
      mutateJson(root, "usage-sync.schema.json", (schema) => {
        schema.properties.dailyEntries.items.properties.dailyTokenTotal = {
          type: "integer",
          minimum: 0,
          maximum: Number.MAX_SAFE_INTEGER,
        };
      }),
    /not an exact decimal string/u,
  );
  await expectFail(
    "usage-decimal-width",
    (root) =>
      mutateJson(root, "usage-sync.schema.json", (schema) => {
        schema.properties.dailyEntries.items.properties.dailyTokenTotal.maxLength = 31;
      }),
    /not an exact decimal string/u,
  );
  await expectFail(
    "discovery-private-field",
    (root) =>
      mutateJson(root, "connector-discovery-manifest.schema.json", (schema) => {
        const candidate = schema.properties.candidates.items;
        candidate.properties.email = { type: "string", minLength: 1, maxLength: 64 };
        candidate["x-viberacing-optionalProperties"].push("email");
      }),
    /private or non-competitive field leaked/u,
  );
  await expectFail(
    "discovery-candidate-bound",
    (root) =>
      mutateJson(root, "connector-discovery-manifest.schema.json", (schema) => {
        schema.properties.candidates.maxItems = 17;
      }),
    /embedded discovery manifest has drifted/u,
  );
  await expectFail(
    "discovery-optional-ledger",
    (root) =>
      mutateJson(root, "connector-discovery-manifest.schema.json", (schema) => {
        delete schema.properties.candidates.items["x-viberacing-optionalProperties"];
      }),
    /optional properties must be declared exactly/u,
  );
  await expectFail(
    "pairing-start-embedded-drift",
    (root) =>
      mutateJson(root, "connector-pairing-start.schema.json", (schema) => {
        schema.properties.discoveryManifest.properties.candidates.maxItems = 15;
      }),
    /embedded discovery manifest has drifted/u,
  );
  await expectFail(
    "pairing-start-proof-removed",
    (root) =>
      mutateJson(root, "connector-pairing-start.schema.json", (schema) => {
        schema.required = schema.required.filter(
          (field) => field !== "installationPossessionProof",
        );
        schema["x-viberacing-optionalProperties"] = ["installationPossessionProof"];
      }),
    /top-level required field inventory differs/u,
  );
  await expectFail(
    "pairing-action-widened",
    (root) =>
      mutateJson(root, "connector-pairing-approval.schema.json", (schema) => {
        schema.properties.decisions.items.properties.action.enum.push("merge");
      }),
    /pairing decision action enum differs/u,
  );
  await expectFail(
    "pairing-poll-profile-leak",
    (root) =>
      mutateJson(root, "connector-pairing-poll-result.schema.json", (schema) => {
        const activation = schema.properties.candidateActivations.items;
        activation.properties.profileId = { type: "string", minLength: 1, maxLength: 64 };
        activation["x-viberacing-optionalProperties"].push("profileId");
      }),
    /private server identity leaked/u,
  );
  await expectFail(
    "leaderboard-account-count",
    (root) =>
      mutateJson(root, "leaderboard-snapshot.schema.json", (schema) => {
        const participant = schema.properties.participants.items;
        participant.properties.accountCount = { type: "integer", minimum: 0, maximum: 100 };
        participant["x-viberacing-optionalProperties"].push("accountCount");
      }),
    /private or non-competitive field leaked/u,
  );
  await expectFail(
    "leaderboard-number-total",
    (root) =>
      mutateJson(root, "leaderboard-snapshot.schema.json", (schema) => {
        schema.properties.participants.items.properties.weeklyTokenTotal = {
          type: "integer",
          minimum: 0,
          maximum: Number.MAX_SAFE_INTEGER,
        };
      }),
    /direct-token snapshot semantics differ/u,
  );
  await expectFail(
    "leaderboard-null-order",
    (root) =>
      mutateJson(root, "leaderboard-snapshot.schema.json", (schema) => {
        schema.properties.nextPage.type = ["null", "integer"];
      }),
    /ordered nullable union/u,
  );
  await expectFail(
    "profile-device-leak",
    (root) =>
      mutateJson(root, "public-profile-summary.schema.json", (schema) => {
        schema.properties.deviceId = { type: "string", minLength: 26, maxLength: 26 };
        schema["x-viberacing-optionalProperties"].push("deviceId");
      }),
    /private or non-competitive field leaked/u,
  );
  await expectFail(
    "profile-car-not-nullable",
    (root) =>
      mutateJson(root, "public-profile-summary.schema.json", (schema) => {
        schema.properties.carRecipe.type = "object";
      }),
    /car nullability differs/u,
  );
  await expectFail(
    "public-no-store",
    (root) =>
      mutateJson(root, "manifest.json", (manifest) => {
        manifest.operations[3].cacheControl = "no-store";
      }),
    /operation getSeasonLeaderboardV1 differs from review/u,
  );
  await expectFail(
    "false-implementation-claim",
    (root) =>
      mutateJson(root, "manifest.json", (manifest) => {
        manifest.operations[2].implementationStatus = "implemented-local";
      }),
    /has no reviewed evidence policy/u,
  );
  await expectFail(
    "missing-usage-evidence",
    (root) => {
      rmSync(resolve(root, "database", "tests", "usage_accounting.sql"));
    },
    /implemented-local contract evidence is missing/u,
    false,
  );
  await expectFail(
    "pairing-policy-drift",
    (root) =>
      mutateJson(root, "connector-pairing-authentication.json", (policy) => {
        policy.pollProof.messagePrefix = "legacy-pairing-proof";
      }),
    /batch pairing possession policy differs/u,
  );
  await expectFail(
    "pairing-vector-drift",
    (root) =>
      mutateJson(root, "connector-pairing-possession.test-vector.json", (vector) => {
        vector.possessionSignature = "A".repeat(86);
      }),
    /pairing possession vector is not self-consistent/u,
  );
  await expectFail(
    "pairing-start-vector-drift",
    (root) =>
      mutateJson(root, "connector-pairing-start-possession.test-vector.json", (vector) => {
        vector.manifest.candidates[0].safeDisplayLabel = "mutated";
      }),
    /pairing start possession vector is not self-consistent/u,
  );
  await expectFail(
    "duplicate-json-key",
    (root) => {
      const path = jsonPath(root, "usage-sync.schema.json");
      const text = readFileSync(path, "utf8");
      writeFileSync(
        path,
        text.replace(
          '"title": "UsageSyncV1",',
          '"title": "UsageSyncV1",\n  "title": "UsageSyncV1",',
        ),
        "utf8",
      );
    },
    /duplicate JSON object key is forbidden/u,
    false,
  );
  await expectFail(
    "unknown-schema-keyword",
    (root) =>
      mutateJson(root, "leaderboard-query.schema.json", (schema) => {
        schema.oneOf = [];
      }),
    /unsupported schema keyword/u,
  );
  await expectFail(
    "unlisted-legacy-schema",
    (root) => {
      writeJson(jsonPath(root, "community-score-page.schema.json"), {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "https://schemas.viberacing.example/v1/community-score-page.schema.json",
        title: "LegacyV1",
        description: "Forbidden legacy schema.",
        type: "object",
        additionalProperties: false,
        required: [],
        properties: {},
      });
    },
    /file inventory differs/u,
    false,
  );
  await expectFail(
    "generated-drift",
    (root) => {
      appendFileSync(resolve(root, "contracts", "generated", "openapi.v1.json"), "\n");
    },
    /generated contract artifact has drifted/u,
    false,
  );

  console.log(`Contract checker regression suite passed (${String(caseCount)} cases).`);
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { writeGeneratedArtifacts } from "./lib/contract-generation.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const checker = resolve(import.meta.dirname, "check-contracts.mjs");
const temporaryRoot = mkdtempSync(join(tmpdir(), "viberacing-contract-check-"));
let caseCount = 0;
const implementedLocalEvidencePaths = [
  "apps/ingest/src/community-sync-admission.test.ts",
  "apps/ingest/src/community-sync-admission.ts",
  "apps/ingest/src/community-sync-application.test.ts",
  "apps/ingest/src/community-sync-application.ts",
  "apps/ingest/src/community-sync-http-server-contract-failure.test.ts",
  "apps/ingest/src/community-sync-http-server.test.ts",
  "apps/ingest/src/community-sync-http-server.ts",
  "scripts/test-ingest-postgres-integration.mjs",
  "apps/web/app/v1/community/race/route.test.ts",
  "apps/web/app/v1/community/race/route.ts",
  "apps/web/app/v1/community/scores/route.test.ts",
  "apps/web/app/v1/community/scores/route.ts",
  "apps/web/app/v1/connector/cars/proposals/route.test.ts",
  "apps/web/app/v1/connector/cars/proposals/route.ts",
  "apps/web/app/v1/connector/pairing/poll/route.test.ts",
  "apps/web/app/v1/connector/pairing/poll/route.ts",
  "apps/web/app/v1/connector/pairing/start/route.test.ts",
  "apps/web/app/v1/connector/pairing/start/route.ts",
  "apps/web/lib/pairing-http.test.ts",
  "apps/web/lib/pairing-http.ts",
  "apps/web/lib/pairing-rate-policy.test.ts",
  "apps/web/lib/pairing-rate-policy.ts",
  "apps/web/lib/public-community-race.test.ts",
  "apps/web/lib/public-community-race.ts",
  "apps/web/lib/public-community-score-mapper.test.ts",
  "apps/web/lib/public-community-score-mapper.ts",
  "apps/web/lib/public-community-score-route.test.ts",
  "apps/web/lib/public-community-score-route.ts",
  "apps/web/lib/public-community-score-store.test.ts",
  "apps/web/lib/public-community-score-store.ts",
  "apps/web/lib/public-score-admission.test.ts",
  "apps/web/lib/public-score-admission.ts",
  "apps/web/lib/connector-car-proposal-admission.test.ts",
  "apps/web/lib/connector-car-proposal-admission.ts",
  "apps/web/lib/connector-car-proposal-application.test.ts",
  "apps/web/lib/connector-car-proposal-application.ts",
  "apps/web/lib/connector-car-proposal-database.test.ts",
  "apps/web/lib/connector-car-proposal-database.ts",
  "apps/web/lib/connector-car-proposal-http.test.ts",
  "apps/web/lib/connector-car-proposal-http.ts",
  "apps/web/lib/connector-car-proposal-service.test.ts",
  "apps/web/lib/connector-car-proposal-service.ts",
  "apps/web/lib/connector-car-proposal-verifier.test.ts",
  "apps/web/lib/connector-car-proposal-verifier.ts",
  "crates/connector/src/car_proposal.rs",
  "crates/connector/src/connect/car_proposal_command.rs",
  "database/migrations/0028_connector_car_proposal_ingress.sql",
  "database/tests/car_recipe_device_proposal_concurrency_assertions.sql",
  "database/tests/car_recipe_device_proposal_concurrency_setup.sql",
  "database/tests/car_recipe_proposals.sql",
  "scripts/test-database-integration.mjs",
];

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function makeFixture(name) {
  const root = resolve(temporaryRoot, name);
  cpSync(resolve(repositoryRoot, "contracts", "v1"), resolve(root, "contracts", "v1"), {
    recursive: true,
  });
  mkdirSync(resolve(root, "contracts", "generated"), { recursive: true });
  mkdirSync(resolve(root, "packages", "contracts", "src"), { recursive: true });
  for (const relativePath of implementedLocalEvidencePaths) {
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

async function expectGeneratedPublicOperations(name) {
  caseCount += 1;
  const root = await makeFixture(name);
  const document = JSON.parse(
    readFileSync(resolve(root, "contracts", "generated", "openapi.v1.json"), "utf8"),
  );
  assert.equal(document["x-viberacing-status"], "implemented-local");
  assert.equal(Object.hasOwn(document, "servers"), false);
  assert.deepEqual(Object.keys(document.paths), [
    "/v1/community/race",
    "/v1/community/scores",
    "/v1/community/sync",
    "/v1/connector/cars/proposals",
    "/v1/connector/pairing/poll",
    "/v1/connector/pairing/start",
  ]);

  const raceOperation = document.paths["/v1/community/race"].get;
  assert.equal(raceOperation.operationId, "getCommunityRaceV1");
  assert.equal(raceOperation["x-viberacing-status"], "implemented-local");
  assert.equal(raceOperation["x-viberacing-authentication-contract"], "none");
  assert.deepEqual(raceOperation["x-viberacing-query-contract"], {
    $ref: "#/components/schemas/CommunityScoreQueryV1",
  });
  assert.deepEqual(raceOperation.responses["200"].content["application/json"].schema, {
    $ref: "#/components/schemas/CommunityRacePageV1",
  });

  const operation = document.paths["/v1/community/scores"].get;
  assert.equal(operation.operationId, "getCommunityScoresV1");
  assert.equal(operation["x-viberacing-status"], "implemented-local");
  assert.equal(operation["x-viberacing-cache-policy"], "no-store");
  assert.equal(operation["x-viberacing-cors-policy"], "same-origin");
  assert.equal(operation["x-viberacing-admission-policy"], "no-queue-4");
  assert.equal(operation["x-viberacing-authentication-contract"], "none");
  assert.deepEqual(operation["x-viberacing-query-contract"], {
    $ref: "#/components/schemas/CommunityScoreQueryV1",
  });
  assert.equal(operation["x-viberacing-query-policy"], "closed-single-value");
  assert.equal(operation["x-viberacing-request-body-policy"], "none");
  assert.equal(operation["x-viberacing-request-contract"], "none");
  assert.equal(Object.hasOwn(operation, "requestBody"), false);
  assert.deepEqual(
    operation.parameters.map(({ in: location, name, required }) => ({
      location,
      name,
      required,
    })),
    [{ location: "query", name: "seasonStart", required: true }],
  );
  assert.equal(operation.parameters[0].schema["x-viberacing-isoWeekday"], 1);
  assert.deepEqual(Object.keys(operation.responses), ["200", "400", "406", "429", "500", "503"]);
  for (const response of Object.values(operation.responses)) {
    assert.equal(response.headers["Cache-Control"].schema.const, "no-store");
    assert.equal(response.headers.Vary.schema.const, "Accept");
    assert.equal(response.headers["x-request-id"].schema.pattern, "^req_[A-Za-z0-9_-]{22}$");
    assert.equal(Object.hasOwn(response.headers, "Access-Control-Allow-Origin"), false);
  }
  assert.deepEqual(operation.responses["200"].content["application/json"].schema, {
    $ref: "#/components/schemas/CommunityScorePageV1",
  });
  for (const status of ["400", "406", "429", "500", "503"]) {
    assert.deepEqual(operation.responses[status].content["application/problem+json"].schema, {
      $ref: "#/components/schemas/ProblemDetailsV1",
    });
  }

  const syncOperation = document.paths["/v1/community/sync"].post;
  assert.equal(syncOperation.operationId, "postCommunitySyncV1");
  assert.equal(syncOperation["x-viberacing-status"], "implemented-local");
  assert.equal(syncOperation["x-viberacing-admission-policy"], "no-queue-4");
  assert.equal(
    syncOperation["x-viberacing-authentication-contract"],
    "contracts/v1/connector-sync-authentication.json",
  );
  assert.equal(syncOperation["x-viberacing-cache-policy"], "no-store");
  assert.equal(syncOperation["x-viberacing-cors-policy"], "same-origin");
  assert.equal(syncOperation["x-viberacing-query-contract"], "none");
  assert.equal(syncOperation["x-viberacing-query-policy"], "none");
  assert.equal(syncOperation["x-viberacing-request-body-policy"], "exact-raw-json-8192");
  assert.deepEqual(syncOperation["x-viberacing-request-contract"], {
    $ref: "#/components/schemas/ConnectorSyncV1",
  });
  assert.equal(Object.hasOwn(syncOperation, "parameters"), false);
  assert.equal(Object.hasOwn(syncOperation, "security"), false);
  assert.equal(syncOperation.requestBody.required, true);
  assert.deepEqual(syncOperation.requestBody.content["application/json"].schema, {
    $ref: "#/components/schemas/ConnectorSyncV1",
  });
  assert.deepEqual(Object.keys(syncOperation.responses), [
    "200",
    "400",
    "401",
    "405",
    "406",
    "422",
    "500",
    "503",
  ]);
  assert.deepEqual(syncOperation.responses["200"].content["application/json"].schema, {
    $ref: "#/components/schemas/ConnectorSyncResultV1",
  });
  assert.equal(syncOperation.responses["405"].headers.Allow.schema.const, "POST");
  for (const response of Object.values(syncOperation.responses)) {
    assert.equal(response.headers["Cache-Control"].schema.const, "no-store");
    assert.equal(response.headers.Vary.schema.const, "Accept");
    assert.equal(response.headers["x-request-id"].schema.pattern, "^req_[A-Za-z0-9_-]{22}$");
    assert.equal(Object.hasOwn(response.headers, "Access-Control-Allow-Origin"), false);
  }
  for (const status of ["400", "401", "405", "406", "422", "500", "503"]) {
    assert.deepEqual(syncOperation.responses[status].content["application/problem+json"].schema, {
      $ref: "#/components/schemas/ProblemDetailsV1",
    });
  }

  const proposalOperation = document.paths["/v1/connector/cars/proposals"].post;
  assert.equal(proposalOperation.operationId, "postConnectorCarProposalV1");
  assert.equal(proposalOperation["x-viberacing-status"], "implemented-local");
  assert.equal(proposalOperation["x-viberacing-admission-policy"], "no-queue-4");
  assert.equal(
    proposalOperation["x-viberacing-authentication-contract"],
    "contracts/v1/connector-car-proposal-authentication.json",
  );
  assert.equal(proposalOperation["x-viberacing-cache-policy"], "no-store");
  assert.equal(proposalOperation["x-viberacing-cors-policy"], "same-origin");
  assert.equal(proposalOperation["x-viberacing-query-contract"], "none");
  assert.equal(proposalOperation["x-viberacing-query-policy"], "none");
  assert.equal(proposalOperation["x-viberacing-request-body-policy"], "exact-raw-json-512");
  assert.deepEqual(proposalOperation["x-viberacing-request-contract"], {
    $ref: "#/components/schemas/CarRecipeV1",
  });
  assert.equal(Object.hasOwn(proposalOperation, "parameters"), false);
  assert.equal(Object.hasOwn(proposalOperation, "security"), false);
  assert.deepEqual(proposalOperation.requestBody.content["application/json"].schema, {
    $ref: "#/components/schemas/CarRecipeV1",
  });
  assert.deepEqual(Object.keys(proposalOperation.responses), [
    "200",
    "400",
    "401",
    "405",
    "406",
    "422",
    "429",
    "500",
    "503",
  ]);
  assert.deepEqual(proposalOperation.responses["200"].content["application/json"].schema, {
    $ref: "#/components/schemas/ConnectorCarProposalResultV1",
  });
  assert.equal(proposalOperation.responses["405"].headers.Allow.schema.const, "POST");
  for (const response of Object.values(proposalOperation.responses)) {
    assert.equal(response.headers["Cache-Control"].schema.const, "no-store");
    assert.equal(response.headers.Vary.schema.const, "Accept");
    assert.equal(response.headers["x-request-id"].schema.pattern, "^req_[A-Za-z0-9_-]{22}$");
    assert.equal(Object.hasOwn(response.headers, "Access-Control-Allow-Origin"), false);
  }
  for (const status of ["400", "401", "405", "406", "422", "429", "500", "503"]) {
    assert.deepEqual(
      proposalOperation.responses[status].content["application/problem+json"].schema,
      {
        $ref: "#/components/schemas/ProblemDetailsV1",
      },
    );
  }

  for (const [path, operationId, requestSchema, responseSchema] of [
    [
      "/v1/connector/pairing/poll",
      "postConnectorPairingPollV1",
      "ConnectorPairingPollV1",
      "ConnectorPairingPollResultV1",
    ],
    [
      "/v1/connector/pairing/start",
      "postConnectorPairingStartV1",
      "ConnectorPairingStartV1",
      "ConnectorPairingStartResultV1",
    ],
  ]) {
    const pairingOperation = document.paths[path].post;
    assert.equal(pairingOperation.operationId, operationId);
    assert.equal(pairingOperation["x-viberacing-status"], "implemented-local");
    assert.equal(pairingOperation["x-viberacing-admission-policy"], "no-queue-4");
    assert.equal(
      pairingOperation["x-viberacing-authentication-contract"],
      "contracts/v1/connector-pairing-transport.json",
    );
    assert.equal(pairingOperation["x-viberacing-request-body-policy"], "exact-raw-json-1024");
    assert.deepEqual(pairingOperation.requestBody.content["application/json"].schema, {
      $ref: `#/components/schemas/${requestSchema}`,
    });
    assert.deepEqual(Object.keys(pairingOperation.responses), [
      "200",
      "400",
      "405",
      "406",
      "429",
      "500",
      "503",
    ]);
    assert.deepEqual(pairingOperation.responses["200"].content["application/json"].schema, {
      $ref: `#/components/schemas/${responseSchema}`,
    });
    assert.equal(pairingOperation.responses["405"].headers.Allow.schema.const, "POST");
    for (const response of Object.values(pairingOperation.responses)) {
      assert.equal(response.headers["Cache-Control"].schema.const, "no-store");
      assert.equal(Object.hasOwn(response.headers, "Access-Control-Allow-Origin"), false);
    }
  }
}

async function expectFailure(name, mutate, expected) {
  caseCount += 1;
  const root = await makeFixture(name);
  await mutate(root);
  const result = run(root);
  assert.notEqual(result.status, 0, `${name} unexpectedly passed`);
  assert.match(result.output, expected);
}

function readSchema(root, file) {
  const path = resolve(root, "contracts", "v1", file);
  return { path, schema: JSON.parse(readFileSync(path, "utf8")) };
}

try {
  await expectPass("valid");
  await expectGeneratedPublicOperations("generated-public-operations");
  await expectFailure(
    "unknown-fields",
    (root) => {
      const { path, schema } = readSchema(root, "problem-details.schema.json");
      schema.additionalProperties = true;
      writeJson(path, schema);
    },
    /additionalProperties to false/,
  );
  await expectFailure(
    "unbounded-string",
    (root) => {
      const { path, schema } = readSchema(root, "problem-details.schema.json");
      delete schema.properties.title.maxLength;
      writeJson(path, schema);
    },
    /reviewed minLength\/maxLength bounds/,
  );
  await expectFailure(
    "derived-client-field",
    (root) => {
      const { path, schema } = readSchema(root, "connector-sync.schema.json");
      schema.required.push("trustTier");
      schema.properties.trustTier = {
        type: "string",
        enum: ["verified"],
        minLength: 8,
        maxLength: 8,
      };
      writeJson(path, schema);
    },
    /server-owned or prohibited field trustTier/,
  );
  await expectFailure(
    "derived-client-score-alias",
    (root) => {
      const { path, schema } = readSchema(root, "connector-sync.schema.json");
      const dailyEntry = schema.properties.dailyEntries.items;
      dailyEntry.required.push("weeklyScore");
      dailyEntry.properties.weeklyScore = {
        type: "integer",
        minimum: 0,
        maximum: 7000,
      };
      writeJson(path, schema);
    },
    /server-owned or prohibited field weeklyScore/,
  );
  await expectFailure(
    "connector-extra-daily-field",
    (root) => {
      const { path, schema } = readSchema(root, "connector-sync.schema.json");
      const dailyEntry = schema.properties.dailyEntries.items;
      dailyEntry.required.push("points");
      dailyEntry.properties.points = {
        type: "integer",
        minimum: 0,
        maximum: 7000,
      };
      writeJson(path, schema);
    },
    /connector daily-entry fields differ from the exact writable allowlist/,
  );
  await expectFailure(
    "community-trust-drift",
    (root) => {
      const { path, schema } = readSchema(root, "community-score-page.schema.json");
      schema.properties.trustTier.const = "verified";
      schema.properties.trustTier.minLength = 8;
      schema.properties.trustTier.maxLength = 8;
      writeJson(path, schema);
    },
    /Community score trust metadata must remain explicit and constant/,
  );
  await expectFailure(
    "community-private-field",
    (root) => {
      const { path, schema } = readSchema(root, "community-score-page.schema.json");
      const participant = schema.properties.participants.items;
      participant.required.push("profileId");
      participant.properties.profileId = {
        type: "string",
        minLength: 1,
        maxLength: 64,
      };
      writeJson(path, schema);
    },
    /Community score participant fields differ from the public allowlist/,
  );
  await expectFailure(
    "community-race-required-recipe",
    (root) => {
      const { path, schema } = readSchema(root, "community-race-page.schema.json");
      schema.properties.participants.items.required.push("carRecipe");
      writeJson(path, schema);
    },
    /Community race participant fields differ from the public allowlist/,
  );
  await expectFailure(
    "community-race-recipe-drift",
    (root) => {
      const { path, schema } = readSchema(root, "community-race-page.schema.json");
      schema.properties.participants.items.properties.carRecipe.properties.palette.enum.push(
        "arbitrary-color",
      );
      writeJson(path, schema);
    },
    /Community race CarRecipe differs from the canonical optional recipe/,
  );
  await expectFailure(
    "optional-properties-on-scalar",
    (root) => {
      const { path, schema } = readSchema(root, "community-race-page.schema.json");
      schema.properties.participants.items.properties.handle["x-viberacing-optionalProperties"] = [
        "value",
      ];
      writeJson(path, schema);
    },
    /optional properties are supported only on closed objects/,
  );
  await expectFailure(
    "community-score-bound-drift",
    (root) => {
      const { path, schema } = readSchema(root, "community-score-page.schema.json");
      schema.properties.participants.items.properties.weeklyScore.maximum = 7001;
      writeJson(path, schema);
    },
    /Community score participant bounds differ from the reviewed projection/,
  );
  await expectFailure(
    "community-query-weekday-drift",
    (root) => {
      const { path, schema } = readSchema(root, "community-score-query.schema.json");
      delete schema.properties.seasonStart["x-viberacing-isoWeekday"];
      writeJson(path, schema);
    },
    /date extensions must define one valid ordered range and ISO weekday/,
  );
  await expectFailure(
    "date-extension-on-integer",
    (root) => {
      const { path, schema } = readSchema(root, "problem-details.schema.json");
      schema.properties.schemaVersion["x-viberacing-dateMinimum"] = "1999-12-27";
      writeJson(path, schema);
    },
    /date extensions are supported only on date strings/,
  );
  await expectFailure(
    "problem-vocabulary-drift",
    (root) => {
      const { path, schema } = readSchema(root, "problem-details.schema.json");
      schema.properties.errorCode.enum = schema.properties.errorCode.enum.filter(
        (value) => value !== "not_acceptable",
      );
      schema.properties.title.enum = schema.properties.title.enum.filter(
        (value) => value !== "Not acceptable",
      );
      writeJson(path, schema);
    },
    /public problem contract differs from the reviewed HTTP boundary/,
  );
  await expectFailure(
    "problem-request-id-drift",
    (root) => {
      const { path, schema } = readSchema(root, "problem-details.schema.json");
      schema.properties.requestId.maxLength = 27;
      writeJson(path, schema);
    },
    /public problem contract differs from the reviewed HTTP boundary/,
  );
  await expectFailure(
    "operation-contract-drift",
    (root) => {
      const path = resolve(root, "contracts", "v1", "manifest.json");
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      manifest.operations[1].path = "/v1/community/results";
      writeJson(path, manifest);
    },
    /public Community score operation differs from the reviewed HTTP contract/,
  );
  await expectFailure(
    "race-operation-contract-drift",
    (root) => {
      const path = resolve(root, "contracts", "v1", "manifest.json");
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      manifest.operations[0].responseSchema = "CommunityScorePageV1";
      writeJson(path, manifest);
    },
    /public Community race operation differs from the reviewed HTTP contract/,
  );
  await expectFailure(
    "unsafe-operation-path",
    (root) => {
      const path = resolve(root, "contracts", "v1", "manifest.json");
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      manifest.operations[0].path = "/v1/../private";
      writeJson(path, manifest);
    },
    /contract operation 1 has unsafe names or shape/,
  );
  await expectFailure(
    "unknown-operation-schema",
    (root) => {
      const path = resolve(root, "contracts", "v1", "manifest.json");
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      manifest.operations[0].querySchema = "MissingQueryV1";
      writeJson(path, manifest);
    },
    /contract operation 1 references invalid schemas/,
  );
  await expectFailure(
    "duplicate-operation",
    (root) => {
      const path = resolve(root, "contracts", "v1", "manifest.json");
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      manifest.operations.push(structuredClone(manifest.operations[0]));
      writeJson(path, manifest);
    },
    /operations must be uniquely sorted by path and method/,
  );
  await expectFailure(
    "duplicate-operation-id",
    (root) => {
      const path = resolve(root, "contracts", "v1", "manifest.json");
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      const duplicateId = structuredClone(manifest.operations[0]);
      duplicateId.path = "/v1/z";
      manifest.operations.push(duplicateId);
      writeJson(path, manifest);
    },
    /contains a duplicate operation ID/,
  );
  await expectFailure(
    "unsorted-problem-statuses",
    (root) => {
      const path = resolve(root, "contracts", "v1", "manifest.json");
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      manifest.operations[0].problemStatuses = [400, 429, 406, 500, 503];
      writeJson(path, manifest);
    },
    /contract operation 1 has invalid problem statuses/,
  );
  await expectFailure(
    "unsafe-query-policy",
    (root) => {
      const path = resolve(root, "contracts", "v1", "manifest.json");
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      manifest.operations[0].queryPolicy = "allow-repeated";
      writeJson(path, manifest);
    },
    /contract operation 1 has unsafe names or shape/,
  );
  await expectFailure(
    "unsafe-request-body-policy",
    (root) => {
      const path = resolve(root, "contracts", "v1", "manifest.json");
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      manifest.operations[2].requestBodyPolicy = "unbounded-json";
      writeJson(path, manifest);
    },
    /contract operation 3 has unsafe names or shape/,
  );
  await expectFailure(
    "unknown-request-schema",
    (root) => {
      const path = resolve(root, "contracts", "v1", "manifest.json");
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      manifest.operations[2].requestSchema = "MissingRequestV1";
      writeJson(path, manifest);
    },
    /contract operation 3 references invalid schemas/,
  );
  await expectFailure(
    "unknown-authentication-policy",
    (root) => {
      const path = resolve(root, "contracts", "v1", "manifest.json");
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      manifest.operations[2].authenticationContract = "connector-missing-authentication.json";
      writeJson(path, manifest);
    },
    /contract operation 3 references an unknown policy/,
  );
  await expectFailure(
    "duplicate-authentication-policy-id",
    (root) => {
      const path = resolve(root, "contracts", "v1", "manifest.json");
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      manifest.policies[1].policyId = manifest.policies[0].policyId;
      writeJson(path, manifest);
    },
    /contains a duplicate policy ID/,
  );
  await expectFailure(
    "unsafe-implementation-status",
    (root) => {
      const path = resolve(root, "contracts", "v1", "manifest.json");
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      manifest.operations[0].implementationStatus = "deployed";
      writeJson(path, manifest);
    },
    /contract operation 1 has unsafe names or shape/,
  );
  await expectFailure(
    "missing-local-implementation-evidence",
    (root) => {
      rmSync(resolve(root, "apps", "web", "app", "v1", "community", "scores", "route.ts"));
    },
    /implemented-local contract evidence is missing/,
  );
  await expectFailure(
    "missing-race-implementation-evidence",
    (root) => {
      rmSync(resolve(root, "apps", "web", "app", "v1", "community", "race", "route.ts"));
    },
    /implemented-local contract evidence is missing/,
  );
  await expectFailure(
    "missing-sync-implementation-evidence",
    (root) => {
      rmSync(resolve(root, "apps", "ingest", "src", "community-sync-http-server.ts"));
    },
    /implemented-local contract evidence is missing/,
  );
  await expectFailure(
    "missing-sync-postgres-integration-evidence",
    (root) => {
      rmSync(resolve(root, "scripts", "test-ingest-postgres-integration.mjs"));
    },
    /implemented-local contract evidence is missing/,
  );
  await expectFailure(
    "missing-car-proposal-implementation-evidence",
    (root) => {
      rmSync(resolve(root, "crates", "connector", "src", "car_proposal.rs"));
    },
    /implemented-local contract evidence is missing/,
  );
  await expectFailure(
    "get-problem-status-drift",
    (root) => {
      const path = resolve(root, "contracts", "v1", "manifest.json");
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      manifest.operations[1].problemStatuses = [400, 405, 406, 429, 500, 503];
      writeJson(path, manifest);
    },
    /public Community score operation differs from the reviewed HTTP contract/,
  );
  await expectFailure(
    "post-problem-status-drift",
    (root) => {
      const path = resolve(root, "contracts", "v1", "manifest.json");
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      manifest.operations[2].problemStatuses = [400, 401, 405, 406, 422, 429, 500, 503];
      writeJson(path, manifest);
    },
    /Community sync operation differs from the reviewed HTTP contract/,
  );
  await expectFailure(
    "car-proposal-operation-drift",
    (root) => {
      const path = resolve(root, "contracts", "v1", "manifest.json");
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      manifest.operations[3].problemStatuses = [400, 401, 405, 406, 429, 500, 503];
      writeJson(path, manifest);
    },
    /connector car proposal operation differs from review/,
  );
  await expectFailure(
    "car-proposal-policy-semantic-drift",
    async (root) => {
      const path = resolve(root, "contracts", "v1", "connector-car-proposal-authentication.json");
      const policy = JSON.parse(readFileSync(path, "utf8"));
      policy.requestFreshness.maximumAgeMilliseconds = 300_001;
      writeJson(path, policy);
      await writeGeneratedArtifacts(root);
    },
    /connector car proposal policy differs from the reviewed boundary/,
  );
  await expectFailure(
    "car-proposal-vector-message-drift",
    (root) => {
      const path = resolve(
        root,
        "contracts",
        "v1",
        "connector-car-proposal-device-request.test-vector.json",
      );
      const vector = JSON.parse(readFileSync(path, "utf8"));
      vector.deviceSignatureMessage += "\n";
      writeJson(path, vector);
    },
    /shared connector car proposal vector differs from the reviewed boundary/,
  );
  await expectFailure(
    "authentication-contract-digest-drift",
    (root) => {
      const path = resolve(root, "contracts", "v1", "connector-sync-authentication.json");
      const policy = JSON.parse(readFileSync(path, "utf8"));
      policy.maximumBodyBytes = 4096;
      writeJson(path, policy);
    },
    /generated contract artifact has drifted/,
  );
  await expectFailure(
    "pairing-policy-semantic-drift",
    (root) => {
      const path = resolve(root, "contracts", "v1", "connector-pairing-authentication.json");
      const policy = JSON.parse(readFileSync(path, "utf8"));
      policy.canonicalMessageTrailingSeparator = true;
      writeJson(path, policy);
      return writeGeneratedArtifacts(root);
    },
    /pairing possession policy differs from the reviewed boundary/,
  );
  await expectFailure(
    "pairing-vector-message-drift",
    (root) => {
      const path = resolve(
        root,
        "contracts",
        "v1",
        "connector-pairing-possession.test-vector.json",
      );
      const vector = JSON.parse(readFileSync(path, "utf8"));
      vector.possessionMessage += "\n";
      writeJson(path, vector);
    },
    /shared pairing possession vector differs from the reviewed boundary/,
  );
  await expectFailure(
    "generated-drift",
    (root) => {
      const path = resolve(root, "packages", "contracts", "src", "generated.ts");
      writeFileSync(path, `${readFileSync(path, "utf8")}\n// stale\n`, "utf8");
    },
    /generated contract artifact has drifted/,
  );
  await expectFailure(
    "unlisted-schema",
    (root) => {
      cpSync(
        resolve(root, "contracts", "v1", "problem-details.schema.json"),
        resolve(root, "contracts", "v1", "shadow.schema.json"),
      );
    },
    /schema is not listed/,
  );
  await expectFailure(
    "unlisted-authentication-policy",
    (root) => {
      cpSync(
        resolve(root, "contracts", "v1", "connector-pairing-authentication.json"),
        resolve(root, "contracts", "v1", "connector-shadow-authentication.json"),
      );
    },
    /authentication policy is not listed in the manifest/,
  );
  await expectFailure(
    "unsafe-manifest-path",
    (root) => {
      const path = resolve(root, "contracts", "v1", "manifest.json");
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      manifest.schemas[0].file = "../private.schema.json";
      writeJson(path, manifest);
    },
    /unsafe names or shape/,
  );
  await expectFailure(
    "missing-date-dedup",
    (root) => {
      const { path, schema } = readSchema(root, "connector-sync.schema.json");
      delete schema.properties.dailyEntries["x-viberacing-uniqueBy"];
      writeJson(path, schema);
    },
    /unique by codexReportedDate/,
  );
  await expectFailure(
    "unsupported-schema-keyword",
    (root) => {
      const { path, schema } = readSchema(root, "problem-details.schema.json");
      schema.$ref = "https://unreviewed.example/schema";
      writeJson(path, schema);
    },
    /unsupported schema keyword/,
  );
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}

console.log(`Contract checker tests passed (${String(caseCount)} cases).`);

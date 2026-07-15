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
  "apps/web/app/v1/community/scores/route.test.ts",
  "apps/web/app/v1/community/scores/route.ts",
  "apps/web/lib/public-community-score-route.test.ts",
  "apps/web/lib/public-community-score-route.ts",
  "apps/web/lib/public-score-admission.test.ts",
  "apps/web/lib/public-score-admission.ts",
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

async function expectGeneratedPublicScoreOperation(name) {
  caseCount += 1;
  const root = await makeFixture(name);
  const document = JSON.parse(
    readFileSync(resolve(root, "contracts", "generated", "openapi.v1.json"), "utf8"),
  );
  assert.equal(document["x-viberacing-status"], "implemented-local");
  assert.equal(Object.hasOwn(document, "servers"), false);
  assert.deepEqual(Object.keys(document.paths), ["/v1/community/scores"]);

  const operation = document.paths["/v1/community/scores"].get;
  assert.equal(operation.operationId, "getCommunityScoresV1");
  assert.equal(operation["x-viberacing-status"], "implemented-local");
  assert.equal(operation["x-viberacing-cache-policy"], "no-store");
  assert.equal(operation["x-viberacing-cors-policy"], "same-origin");
  assert.deepEqual(operation["x-viberacing-query-contract"], {
    $ref: "#/components/schemas/CommunityScoreQueryV1",
  });
  assert.equal(operation["x-viberacing-query-policy"], "closed-single-value");
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
  await expectGeneratedPublicScoreOperation("generated-public-score-operation");
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
      manifest.operations[0].path = "/v1/community/results";
      writeJson(path, manifest);
    },
    /public Community score operation differs from the reviewed HTTP contract/,
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
    "get-problem-status-drift",
    (root) => {
      const path = resolve(root, "contracts", "v1", "manifest.json");
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      manifest.operations[0].problemStatuses = [400, 405, 406, 429, 500, 503];
      writeJson(path, manifest);
    },
    /public Community score operation differs from the reviewed HTTP contract/,
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

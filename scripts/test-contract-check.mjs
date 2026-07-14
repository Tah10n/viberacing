import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { writeGeneratedArtifacts } from "./lib/contract-generation.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const checker = resolve(import.meta.dirname, "check-contracts.mjs");
const temporaryRoot = mkdtempSync(join(tmpdir(), "viberacing-contract-check-"));
let caseCount = 0;

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

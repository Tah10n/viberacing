import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

import { buildGeneratedArtifacts, readContractSources } from "./lib/contract-generation.mjs";

const args = process.argv.slice(2);
if (!(args.length === 0 || (args.length === 2 && args[0] === "--root" && args[1]))) {
  console.error("Usage: node scripts/check-contracts.mjs [--root <directory>]");
  process.exit(2);
}

const root = args.length === 0 ? resolve(import.meta.dirname, "..") : resolve(args[1]);
const findings = [];
const schemaKeys = new Set([
  "$id",
  "$schema",
  "additionalProperties",
  "const",
  "description",
  "enum",
  "format",
  "items",
  "maxItems",
  "maxLength",
  "maximum",
  "minItems",
  "minLength",
  "minimum",
  "pattern",
  "properties",
  "required",
  "title",
  "type",
  "x-viberacing-uniqueBy",
]);
const schemaTypes = new Set(["array", "boolean", "integer", "object", "string"]);
const forbiddenConnectorFields = new Set([
  "accessToken",
  "accountId",
  "apiKey",
  "conversation",
  "email",
  "moderationState",
  "profileId",
  "prompt",
  "rank",
  "receivedAt",
  "repository",
  "score",
  "season",
  "streak",
  "trustTier",
]);
const expectedFields = new Map([
  [
    "connector-sync.schema.json",
    [
      "schemaVersion",
      "sourceId",
      "syncId",
      "observedAt",
      "connectorVersion",
      "codexVersion",
      "dailyEntries",
    ],
  ],
  [
    "connector-sync-result.schema.json",
    ["schemaVersion", "requestId", "syncId", "outcome", "acceptedEntries"],
  ],
  [
    "problem-details.schema.json",
    ["schemaVersion", "requestId", "status", "errorCode", "title", "retryable"],
  ],
]);

function report(scope, message) {
  findings.push(`${scope} — ${message}`);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameEntries(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function validatePrimitiveConstraints(schema, scope) {
  if (schema.const !== undefined) {
    const validConst =
      (schema.type === "string" && typeof schema.const === "string") ||
      (schema.type === "integer" && Number.isSafeInteger(schema.const)) ||
      (schema.type === "boolean" && typeof schema.const === "boolean");
    if (!validConst) {
      report(scope, "const does not match the declared primitive type");
    }
  }
  if (schema.enum !== undefined) {
    const entryMatchesType = (entry) =>
      (schema.type === "string" && typeof entry === "string") ||
      (schema.type === "integer" && Number.isSafeInteger(entry)) ||
      (schema.type === "boolean" && typeof entry === "boolean");
    if (
      !Array.isArray(schema.enum) ||
      schema.enum.length === 0 ||
      schema.enum.length > 32 ||
      !schema.enum.every((entry) => entryMatchesType(entry)) ||
      new Set(schema.enum.map((entry) => `${typeof entry}:${String(entry)}`)).size !==
        schema.enum.length
    ) {
      report(scope, "enum must contain 1 to 32 unique primitive values");
    }
  }
}

function validateSchemaNode(schema, scope, depth, state) {
  state.nodes += 1;
  if (depth > 8 || state.nodes > 200) {
    report(scope, "schema exceeds the reviewed structure budget");
    return;
  }
  if (!isObject(schema)) {
    report(scope, "schema node must be an object");
    return;
  }
  for (const key of Object.keys(schema)) {
    if (!schemaKeys.has(key)) {
      report(scope, `unsupported schema keyword ${JSON.stringify(key)}`);
    }
  }
  if (!schemaTypes.has(schema.type)) {
    report(scope, "type must be one supported scalar, array, or object type");
    return;
  }
  if (
    schema.description !== undefined &&
    (typeof schema.description !== "string" ||
      schema.description.length === 0 ||
      schema.description.length > 300 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(schema.description))
  ) {
    report(scope, "description must be bounded printable text");
  }
  validatePrimitiveConstraints(schema, scope);

  if (schema.type === "object") {
    if (schema.additionalProperties !== false) {
      report(scope, "object schemas must set additionalProperties to false");
    }
    if (!isObject(schema.properties)) {
      report(scope, "object schemas must define a properties map");
      return;
    }
    const properties = Object.keys(schema.properties);
    if (properties.length === 0 || properties.length > 32) {
      report(scope, "object schemas must contain 1 to 32 properties");
    }
    if (!Array.isArray(schema.required) || !sameEntries(schema.required, properties)) {
      report(scope, "every property must be required in the same reviewed order");
    }
    for (const [name, propertySchema] of Object.entries(schema.properties)) {
      if (!/^[a-z][A-Za-z0-9]*$/.test(name)) {
        report(scope, `property name is not lower camel case: ${JSON.stringify(name)}`);
      }
      validateSchemaNode(propertySchema, `${scope}.${name}`, depth + 1, state);
    }
  } else if (schema.type === "array") {
    if (
      !Number.isSafeInteger(schema.minItems) ||
      !Number.isSafeInteger(schema.maxItems) ||
      schema.minItems < 0 ||
      schema.maxItems < 1 ||
      schema.maxItems > 64 ||
      schema.minItems > schema.maxItems
    ) {
      report(scope, "arrays must have reviewed minItems/maxItems bounds no greater than 64");
    }
    validateSchemaNode(schema.items, `${scope}[]`, depth + 1, state);
    const uniqueBy = schema["x-viberacing-uniqueBy"];
    if (
      uniqueBy !== undefined &&
      (typeof uniqueBy !== "string" ||
        schema.items?.type !== "object" ||
        !Object.hasOwn(schema.items?.properties ?? {}, uniqueBy) ||
        !schema.items?.required?.includes(uniqueBy))
    ) {
      report(scope, "x-viberacing-uniqueBy must name a required item property");
    }
  } else if (schema.type === "string") {
    if (
      !Number.isSafeInteger(schema.minLength) ||
      !Number.isSafeInteger(schema.maxLength) ||
      schema.minLength < 0 ||
      schema.maxLength < 1 ||
      schema.maxLength > 256 ||
      schema.minLength > schema.maxLength
    ) {
      report(scope, "strings must have reviewed minLength/maxLength bounds no greater than 256");
    }
    if (schema.pattern !== undefined) {
      if (
        typeof schema.pattern !== "string" ||
        schema.pattern.length > 256 ||
        !schema.pattern.startsWith("^") ||
        !schema.pattern.endsWith("$")
      ) {
        report(scope, "patterns must be bounded and fully anchored");
      } else {
        try {
          new RegExp(schema.pattern, "u");
        } catch {
          report(scope, "pattern is not a valid Unicode regular expression");
        }
      }
    }
    if (schema.format !== undefined && !["date", "date-time"].includes(schema.format)) {
      report(scope, "only date and date-time formats are supported");
    }
  } else if (schema.type === "integer") {
    if (
      !Number.isSafeInteger(schema.minimum) ||
      !Number.isSafeInteger(schema.maximum) ||
      schema.minimum > schema.maximum
    ) {
      report(scope, "integers must have safe minimum and maximum bounds");
    }
  }
}

let sources;
try {
  sources = readContractSources(root);
} catch (error) {
  report("contracts/v1", error.message);
}

if (sources !== undefined) {
  const { manifest, records } = sources;
  const manifestStats = lstatSync(resolve(root, "contracts", "v1", "manifest.json"));
  if (manifestStats.isSymbolicLink() || !manifestStats.isFile()) {
    report("contracts/v1/manifest.json", "manifest must be a regular non-symbolic-link file");
  }
  if (
    !isObject(manifest) ||
    Object.keys(manifest).sort().join(",") !== "contractVersion,schemaVersion,schemas" ||
    manifest.schemaVersion !== 1 ||
    manifest.contractVersion !== "v1" ||
    !Array.isArray(manifest.schemas)
  ) {
    report("contracts/v1/manifest.json", "manifest shape or version is invalid");
  }

  let previousFile = "";
  const listedFiles = new Set();
  for (const [index, record] of records.entries()) {
    const { entry, schema } = record;
    const scope = record.relativePath;
    if (
      !isObject(entry) ||
      Object.keys(entry).sort().join(",") !== "exportName,file,typeName" ||
      !/^[a-z][A-Za-z0-9]*$/.test(entry.exportName ?? "") ||
      !/^[A-Z][A-Za-z0-9]*V1$/.test(entry.typeName ?? "")
    ) {
      report("contracts/v1/manifest.json", `schema entry ${String(index + 1)} is invalid`);
    }
    if (previousFile && previousFile.localeCompare(entry.file) >= 0) {
      report("contracts/v1/manifest.json", "schema entries must be uniquely sorted by file");
    }
    previousFile = entry.file;
    listedFiles.add(entry.file);

    const stats = lstatSync(resolve(root, scope));
    if (stats.isSymbolicLink() || !stats.isFile()) {
      report(scope, "contract sources must be regular non-symbolic-link files");
    }
    if (
      schema?.$schema !== "https://json-schema.org/draft/2020-12/schema" ||
      schema?.$id !== `https://schemas.viberacing.example/v1/${entry.file}` ||
      schema?.title !== entry.typeName ||
      typeof schema?.description !== "string"
    ) {
      report(scope, "root schema identity, title, or description is invalid");
    }
    validateSchemaNode(schema, scope, 0, { nodes: 0 });

    const fields = Object.keys(schema?.properties ?? {});
    const expected = expectedFields.get(entry.file);
    if (expected === undefined || !sameEntries(fields, expected)) {
      report(scope, "top-level writable fields differ from the reviewed contract boundary");
    }
    if (entry.file === "connector-sync.schema.json") {
      const nestedNames = [];
      const collectNames = (node) => {
        for (const [name, child] of Object.entries(node?.properties ?? {})) {
          nestedNames.push(name);
          collectNames(child);
          if (child?.items) {
            collectNames(child.items);
          }
        }
      };
      collectNames(schema);
      for (const name of nestedNames) {
        if (forbiddenConnectorFields.has(name)) {
          report(
            scope,
            `connector-writable schema contains server-owned or prohibited field ${name}`,
          );
        }
      }
      if (schema?.properties?.dailyEntries?.["x-viberacing-uniqueBy"] !== "codexReportedDate") {
        report(scope, "daily entries must remain unique by codexReportedDate");
      }
    }
  }

  const schemaDirectory = resolve(root, "contracts", "v1");
  for (const entry of readdirSync(schemaDirectory, { withFileTypes: true })) {
    if (entry.name.endsWith(".schema.json") && !listedFiles.has(entry.name)) {
      report(`contracts/v1/${entry.name}`, "schema is not listed in the version manifest");
    }
  }

  try {
    const expectedArtifacts = await buildGeneratedArtifacts(root);
    for (const [relativePath, expected] of expectedArtifacts) {
      const absolutePath = resolve(root, relativePath);
      if (!existsSync(absolutePath)) {
        report(relativePath, "generated contract artifact is missing");
      } else {
        const stats = lstatSync(absolutePath);
        if (stats.isSymbolicLink() || !stats.isFile()) {
          report(relativePath, "generated artifact must be a regular non-symbolic-link file");
        } else if (readFileSync(absolutePath, "utf8").replaceAll("\r\n", "\n") !== expected) {
          report(relativePath, "generated contract artifact has drifted from canonical schemas");
        }
      }
    }
  } catch (error) {
    report("generated contracts", `could not generate expected artifacts: ${error.message}`);
  }
}

if (findings.length > 0) {
  console.error(`Contract check failed with ${String(findings.length)} finding(s):`);
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log(
  `Contract check passed (${String(sources.records.length)} schemas, 2 generated artifacts).`,
);

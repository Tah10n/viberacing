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
  "x-viberacing-dateMaximum",
  "x-viberacing-dateMinimum",
  "x-viberacing-isoWeekday",
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
  "activeDays",
  "apiKey",
  "conversation",
  "dailyScore",
  "displayPosition",
  "email",
  "githubUserId",
  "handle",
  "moderationState",
  "profileId",
  "prompt",
  "rank",
  "rankPosition",
  "receivedAt",
  "repository",
  "score",
  "scoreVersion",
  "season",
  "seasonEnd",
  "seasonFinalized",
  "seasonStart",
  "selfReported",
  "sourceCount",
  "streak",
  "trustTier",
  "weeklyScore",
]);
const expectedFields = new Map([
  [
    "community-score-page.schema.json",
    ["schemaVersion", "trustTier", "selfReported", "participants"],
  ],
  ["community-score-query.schema.json", ["seasonStart"]],
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
const publicProblemCodes = [
  "conflict",
  "forbidden",
  "internal_error",
  "invalid_request",
  "method_not_allowed",
  "not_acceptable",
  "not_found",
  "rate_limited",
  "temporarily_unavailable",
  "unauthorized",
  "validation_failed",
];
const publicProblemTitles = [
  "Conflict",
  "Forbidden",
  "Internal server error",
  "Invalid request",
  "Method not allowed",
  "Not acceptable",
  "Not found",
  "Rate limited",
  "Temporarily unavailable",
  "Unauthorized",
  "Validation failed",
];
const implementedLocalEvidencePaths = new Map([
  [
    "getCommunityScoresV1",
    [
      "apps/web/app/v1/community/scores/route.test.ts",
      "apps/web/app/v1/community/scores/route.ts",
      "apps/web/lib/public-community-score-route.test.ts",
      "apps/web/lib/public-community-score-route.ts",
      "apps/web/lib/public-score-admission.test.ts",
      "apps/web/lib/public-score-admission.ts",
    ],
  ],
  [
    "postCommunitySyncV1",
    [
      "apps/ingest/src/community-sync-admission.test.ts",
      "apps/ingest/src/community-sync-admission.ts",
      "apps/ingest/src/community-sync-application.test.ts",
      "apps/ingest/src/community-sync-application.ts",
      "apps/ingest/src/community-sync-http-server-contract-failure.test.ts",
      "apps/ingest/src/community-sync-http-server.test.ts",
      "apps/ingest/src/community-sync-http-server.ts",
    ],
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

function calendarDate(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  const match = /^((?:1999|20[0-9]{2}|2100))-([0-9]{2})-([0-9]{2})$/.exec(value);
  if (match === null) {
    return undefined;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : undefined;
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
  const hasDateExtension =
    schema["x-viberacing-dateMaximum"] !== undefined ||
    schema["x-viberacing-dateMinimum"] !== undefined ||
    schema["x-viberacing-isoWeekday"] !== undefined;
  if (hasDateExtension && schema.type !== "string") {
    report(scope, "date extensions are supported only on date strings");
  }

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
    const dateMaximum = schema["x-viberacing-dateMaximum"];
    const dateMinimum = schema["x-viberacing-dateMinimum"];
    const isoWeekday = schema["x-viberacing-isoWeekday"];
    if (dateMaximum !== undefined || dateMinimum !== undefined || isoWeekday !== undefined) {
      const parsedMaximum = calendarDate(dateMaximum);
      const parsedMinimum = calendarDate(dateMinimum);
      if (
        schema.format !== "date" ||
        parsedMaximum === undefined ||
        parsedMinimum === undefined ||
        !Number.isSafeInteger(isoWeekday) ||
        isoWeekday < 1 ||
        isoWeekday > 7 ||
        parsedMinimum.valueOf() > parsedMaximum.valueOf()
      ) {
        report(scope, "date extensions must define one valid ordered range and ISO weekday");
      }
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
  const { manifest, operations, records } = sources;
  const manifestStats = lstatSync(resolve(root, "contracts", "v1", "manifest.json"));
  if (manifestStats.isSymbolicLink() || !manifestStats.isFile()) {
    report("contracts/v1/manifest.json", "manifest must be a regular non-symbolic-link file");
  }
  if (
    !isObject(manifest) ||
    Object.keys(manifest).sort().join(",") !== "contractVersion,operations,schemaVersion,schemas" ||
    manifest.schemaVersion !== 1 ||
    manifest.contractVersion !== "v1" ||
    !Array.isArray(manifest.schemas) ||
    !Array.isArray(manifest.operations)
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
      report(scope, "top-level fields differ from the reviewed contract boundary");
    }
    if (entry.file === "connector-sync.schema.json") {
      const dailyEntry = schema?.properties?.dailyEntries?.items;
      if (
        !sameEntries(Object.keys(dailyEntry?.properties ?? {}), ["codexReportedDate", "tokens"])
      ) {
        report(scope, "connector daily-entry fields differ from the exact writable allowlist");
      }
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
    if (entry.file === "community-score-page.schema.json") {
      const participantArray = schema?.properties?.participants;
      const participantProperties = participantArray?.items?.properties ?? {};
      const participantFields = Object.keys(participantProperties);
      if (
        schema?.properties?.trustTier?.const !== "community" ||
        schema?.properties?.selfReported?.const !== true
      ) {
        report(scope, "Community score trust metadata must remain explicit and constant");
      }
      if (
        participantArray?.minItems !== 0 ||
        participantArray?.maxItems !== 32 ||
        participantArray?.["x-viberacing-uniqueBy"] !== "displayPosition"
      ) {
        report(scope, "Community score participants must remain a bounded unique display page");
      }
      if (
        !sameEntries(participantFields, [
          "seasonStart",
          "seasonEnd",
          "scoreVersion",
          "seasonFinalized",
          "handle",
          "weeklyScore",
          "activeDays",
          "sourceCount",
          "rankPosition",
          "displayPosition",
        ])
      ) {
        report(scope, "Community score participant fields differ from the public allowlist");
      }
      const exactIntegerBounds = [
        ["weeklyScore", 0, 7000],
        ["activeDays", 0, 7],
        ["sourceCount", 0, 32],
        ["rankPosition", 1, 32],
        ["displayPosition", 1, 32],
      ];
      if (
        exactIntegerBounds.some(([name, minimum, maximum]) => {
          const field = participantProperties[name];
          return field?.minimum !== minimum || field?.maximum !== maximum;
        }) ||
        participantProperties.scoreVersion?.minLength !== 3 ||
        participantProperties.scoreVersion?.maxLength !== 32 ||
        participantProperties.scoreVersion?.pattern !== "^[a-z][a-z0-9_]{2,31}$" ||
        participantProperties.handle?.minLength !== 3 ||
        participantProperties.handle?.maxLength !== 24 ||
        participantProperties.handle?.pattern !== "^[a-z0-9][a-z0-9_-]{1,22}[a-z0-9]$" ||
        participantProperties.seasonStart?.format !== "date" ||
        participantProperties.seasonStart?.pattern !==
          "^(?:1999-12-27|20[0-9]{2}-[0-9]{2}-[0-9]{2})$" ||
        participantProperties.seasonStart?.["x-viberacing-dateMinimum"] !== "1999-12-27" ||
        participantProperties.seasonStart?.["x-viberacing-dateMaximum"] !== "2099-12-28" ||
        participantProperties.seasonStart?.["x-viberacing-isoWeekday"] !== 1 ||
        participantProperties.seasonEnd?.format !== "date" ||
        participantProperties.seasonEnd?.pattern !==
          "^(?:20[0-9]{2}-[0-9]{2}-[0-9]{2}|2100-01-03)$" ||
        participantProperties.seasonEnd?.["x-viberacing-dateMinimum"] !== "2000-01-02" ||
        participantProperties.seasonEnd?.["x-viberacing-dateMaximum"] !== "2100-01-03" ||
        participantProperties.seasonEnd?.["x-viberacing-isoWeekday"] !== 7
      ) {
        report(scope, "Community score participant bounds differ from the reviewed projection");
      }
    }
    if (entry.file === "community-score-query.schema.json") {
      const seasonStart = schema?.properties?.seasonStart;
      if (
        seasonStart?.minLength !== 10 ||
        seasonStart?.maxLength !== 10 ||
        seasonStart?.pattern !== "^(?:1999-12-27|20[0-9]{2}-[0-9]{2}-[0-9]{2})$" ||
        seasonStart?.format !== "date" ||
        seasonStart?.["x-viberacing-dateMinimum"] !== "1999-12-27" ||
        seasonStart?.["x-viberacing-dateMaximum"] !== "2099-12-28" ||
        seasonStart?.["x-viberacing-isoWeekday"] !== 1
      ) {
        report(scope, "Community score query differs from the reviewed season boundary");
      }
    }
    if (entry.file === "problem-details.schema.json") {
      const errorCode = schema?.properties?.errorCode;
      const requestId = schema?.properties?.requestId;
      const retryable = schema?.properties?.retryable;
      const schemaVersion = schema?.properties?.schemaVersion;
      const status = schema?.properties?.status;
      const title = schema?.properties?.title;
      if (
        schemaVersion?.const !== 1 ||
        schemaVersion?.minimum !== 1 ||
        schemaVersion?.maximum !== 1 ||
        requestId?.minLength !== 26 ||
        requestId?.maxLength !== 26 ||
        requestId?.pattern !== "^req_[A-Za-z0-9_-]{22}$" ||
        status?.minimum !== 400 ||
        status?.maximum !== 599 ||
        !sameEntries(errorCode?.enum ?? [], publicProblemCodes) ||
        errorCode?.minLength !== 8 ||
        errorCode?.maxLength !== 23 ||
        !sameEntries(title?.enum ?? [], publicProblemTitles) ||
        title?.minLength !== 1 ||
        title?.maxLength !== 23 ||
        retryable?.type !== "boolean"
      ) {
        report(scope, "public problem contract differs from the reviewed HTTP boundary");
      }
    }
  }

  const publicScoreOperation = operations[0];
  if (
    operations.length !== 2 ||
    publicScoreOperation?.entry.method !== "get" ||
    publicScoreOperation.entry.path !== "/v1/community/scores" ||
    publicScoreOperation.entry.operationId !== "getCommunityScoresV1" ||
    publicScoreOperation.entry.implementationStatus !== "implemented-local" ||
    publicScoreOperation.entry.summary !== "Read one bounded Community score page" ||
    publicScoreOperation.entry.admissionPolicy !== "no-queue-4" ||
    publicScoreOperation.entry.authenticationContract !== "none" ||
    publicScoreOperation.entry.querySchema !== "CommunityScoreQueryV1" ||
    publicScoreOperation.entry.requestSchema !== "none" ||
    publicScoreOperation.entry.responseSchema !== "CommunityScorePageV1" ||
    publicScoreOperation.entry.problemSchema !== "ProblemDetailsV1" ||
    !sameEntries(publicScoreOperation.entry.problemStatuses, [400, 406, 429, 500, 503]) ||
    publicScoreOperation.entry.queryPolicy !== "closed-single-value" ||
    publicScoreOperation.entry.requestBodyPolicy !== "none" ||
    publicScoreOperation.entry.cacheControl !== "no-store" ||
    publicScoreOperation.entry.corsPolicy !== "same-origin"
  ) {
    report(
      "contracts/v1/manifest.json",
      "public Community score operation differs from the reviewed HTTP contract",
    );
  }

  const communitySyncOperation = operations[1];
  if (
    operations.length !== 2 ||
    communitySyncOperation?.entry.method !== "post" ||
    communitySyncOperation.entry.path !== "/v1/community/sync" ||
    communitySyncOperation.entry.operationId !== "postCommunitySyncV1" ||
    communitySyncOperation.entry.implementationStatus !== "implemented-local" ||
    communitySyncOperation.entry.summary !== "Submit one bounded Community usage snapshot" ||
    communitySyncOperation.entry.admissionPolicy !== "no-queue-4" ||
    communitySyncOperation.entry.authenticationContract !== "connector-sync-authentication.json" ||
    communitySyncOperation.entry.querySchema !== "none" ||
    communitySyncOperation.entry.requestSchema !== "ConnectorSyncV1" ||
    communitySyncOperation.entry.responseSchema !== "ConnectorSyncResultV1" ||
    communitySyncOperation.entry.problemSchema !== "ProblemDetailsV1" ||
    !sameEntries(
      communitySyncOperation.entry.problemStatuses,
      [400, 401, 405, 406, 422, 500, 503],
    ) ||
    communitySyncOperation.entry.queryPolicy !== "none" ||
    communitySyncOperation.entry.requestBodyPolicy !== "exact-raw-json-8192" ||
    communitySyncOperation.entry.cacheControl !== "no-store" ||
    communitySyncOperation.entry.corsPolicy !== "same-origin"
  ) {
    report(
      "contracts/v1/manifest.json",
      "Community sync operation differs from the reviewed HTTP contract",
    );
  }

  for (const operation of operations) {
    if (operation.entry.implementationStatus !== "implemented-local") {
      continue;
    }
    const evidencePaths = implementedLocalEvidencePaths.get(operation.entry.operationId);
    if (evidencePaths === undefined) {
      report(
        "contracts/v1/manifest.json",
        `implemented-local operation ${operation.entry.operationId} has no evidence policy`,
      );
      continue;
    }
    for (const relativePath of evidencePaths) {
      const absolutePath = resolve(root, relativePath);
      if (!existsSync(absolutePath)) {
        report(relativePath, "implemented-local contract evidence is missing");
      } else {
        const stats = lstatSync(absolutePath);
        if (stats.isSymbolicLink() || !stats.isFile()) {
          report(relativePath, "implemented-local contract evidence must be a regular file");
        }
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
  `Contract check passed (${String(sources.records.length)} schemas, ${String(sources.operations.length)} operations, 2 generated artifacts).`,
);

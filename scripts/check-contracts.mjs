import { createHash, createPublicKey, verify } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";

import { buildGeneratedArtifacts, readContractSources } from "./lib/contract-generation.mjs";
import { implementedContractEvidence } from "./lib/contract-evidence.mjs";

const args = process.argv.slice(2);
if (!(args.length === 0 || (args.length === 2 && args[0] === "--root" && args[1]))) {
  console.error("Usage: node scripts/check-contracts.mjs [--root <directory>]");
  process.exit(2);
}

const root = args.length === 0 ? resolve(import.meta.dirname, "..") : resolve(args[1]);
const findings = [];
const schemaFiles = [
  "agent-provider.schema.json",
  "car-recipe.schema.json",
  "connector-car-proposal-result.schema.json",
  "connector-discovery-manifest.schema.json",
  "connector-pairing-approval.schema.json",
  "connector-pairing-poll-result.schema.json",
  "connector-pairing-poll.schema.json",
  "connector-pairing-start-result.schema.json",
  "connector-pairing-start.schema.json",
  "leaderboard-query.schema.json",
  "leaderboard-season-path.schema.json",
  "leaderboard-snapshot.schema.json",
  "problem-details.schema.json",
  "public-profile-path.schema.json",
  "public-profile-query.schema.json",
  "public-profile-summary.schema.json",
  "usage-sync-result.schema.json",
  "usage-sync.schema.json",
];
const policyFiles = [
  "connector-car-proposal-authentication.json",
  "connector-pairing-authentication.json",
  "connector-pairing-transport.json",
  "connector-usage-sync-authentication.json",
];
const vectorFiles = [
  "connector-car-proposal-device-request.test-vector.json",
  "connector-pairing-possession.test-vector.json",
  "connector-pairing-start-possession.test-vector.json",
  "connector-usage-sync-device-request.test-vector.json",
];
const expectedContractFiles = [
  ...schemaFiles,
  ...policyFiles,
  ...vectorFiles,
  "manifest.json",
].sort();
const schemaKeywords = new Set([
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
  "x-viberacing-dateMaximum",
  "x-viberacing-dateMinimum",
  "x-viberacing-isoWeekday",
  "x-viberacing-optionalProperties",
  "x-viberacing-uniqueBy",
]);
const schemaTypes = new Set(["array", "boolean", "integer", "null", "object", "string"]);
const expectedSchemaFields = new Map([
  [
    "car-recipe.schema.json",
    ["chassis", "cockpit", "nose", "palette", "schemaVersion", "seed", "trail", "wheels", "wing"],
  ],
  ["connector-car-proposal-result.schema.json", ["outcome", "requestId", "schemaVersion"]],
  [
    "connector-discovery-manifest.schema.json",
    [
      "architecture",
      "candidates",
      "connectorVersion",
      "installationPublicKey",
      "osFamily",
      "schemaVersion",
    ],
  ],
  [
    "connector-pairing-approval.schema.json",
    ["decisions", "manifestDigest", "pairingId", "schemaVersion"],
  ],
  [
    "connector-pairing-poll-result.schema.json",
    ["candidateActivations", "pairingState", "requestId", "schemaVersion"],
  ],
  [
    "connector-pairing-poll.schema.json",
    ["pairingId", "pollToken", "possessionSignature", "schemaVersion"],
  ],
  [
    "connector-pairing-start-result.schema.json",
    [
      "approvalUrl",
      "expiresAt",
      "pairingChallenge",
      "pairingId",
      "pollToken",
      "requestId",
      "schemaVersion",
      "userCode",
    ],
  ],
  [
    "connector-pairing-start.schema.json",
    ["clientRateIdentifier", "discoveryManifest", "installationPossessionProof", "schemaVersion"],
  ],
  ["leaderboard-query.schema.json", ["page", "trustTier"]],
  ["leaderboard-season-path.schema.json", ["seasonStart"]],
  [
    "leaderboard-snapshot.schema.json",
    [
      "generatedAt",
      "metricVersion",
      "nextPage",
      "page",
      "pageSize",
      "participantCount",
      "participants",
      "schemaVersion",
      "seasonEnd",
      "seasonStart",
      "seasonState",
      "snapshotRevision",
      "trustTier",
    ],
  ],
  [
    "problem-details.schema.json",
    ["errorCode", "requestId", "retryable", "schemaVersion", "status", "title"],
  ],
  ["public-profile-path.schema.json", ["handle"]],
  ["public-profile-query.schema.json", ["trustTier"]],
  [
    "public-profile-summary.schema.json",
    [
      "carRecipe",
      "freshnessDays",
      "handle",
      "participantCount",
      "providerBreakdown",
      "rankPosition",
      "schemaVersion",
      "season",
      "trustTier",
      "weeklyTokenTotal",
    ],
  ],
  [
    "usage-sync-result.schema.json",
    [
      "acceptedEntries",
      "nextAllowedSyncAt",
      "outcome",
      "recoveryAction",
      "requestId",
      "schemaVersion",
      "syncId",
    ],
  ],
  [
    "usage-sync.schema.json",
    [
      "agentAccountId",
      "clientVersion",
      "dailyEntries",
      "observedAt",
      "readerVersion",
      "schemaVersion",
      "syncId",
    ],
  ],
]);
const expectedOptionalFields = new Map([
  ["public-profile-summary.schema.json", ["providerBreakdown"]],
  ["usage-sync-result.schema.json", ["nextAllowedSyncAt", "recoveryAction"]],
]);
const expectedOperations = new Map([
  [
    "postConnectorCarProposalV1",
    {
      authenticationContract: "connector-car-proposal-authentication.json",
      cacheControl: "no-store",
      method: "post",
      path: "/v1/connector/cars/proposals",
      pathSchema: "none",
      querySchema: "none",
      requestSchema: "CarRecipeV1",
      responseSchema: "ConnectorCarProposalResultV1",
    },
  ],
  [
    "postConnectorPairingPollV1",
    {
      authenticationContract: "connector-pairing-transport.json",
      cacheControl: "no-store",
      method: "post",
      path: "/v1/connector/pairing/poll",
      pathSchema: "none",
      querySchema: "none",
      requestSchema: "ConnectorPairingPollV1",
      responseSchema: "ConnectorPairingPollResultV1",
    },
  ],
  [
    "postConnectorPairingStartV1",
    {
      authenticationContract: "connector-pairing-transport.json",
      cacheControl: "no-store",
      method: "post",
      path: "/v1/connector/pairing/start",
      pathSchema: "none",
      querySchema: "none",
      requestSchema: "ConnectorPairingStartV1",
      responseSchema: "ConnectorPairingStartResultV1",
    },
  ],
  [
    "getSeasonLeaderboardV1",
    {
      authenticationContract: "none",
      cacheControl: "snapshot-by-season-state",
      method: "get",
      path: "/v1/leaderboards/{seasonStart}",
      pathSchema: "LeaderboardSeasonPathV1",
      querySchema: "LeaderboardQueryV1",
      requestSchema: "none",
      responseSchema: "LeaderboardSnapshotV1",
    },
  ],
  [
    "getCurrentLeaderboardV1",
    {
      authenticationContract: "none",
      cacheControl: "snapshot-by-season-state",
      method: "get",
      path: "/v1/leaderboards/current",
      pathSchema: "none",
      querySchema: "LeaderboardQueryV1",
      requestSchema: "none",
      responseSchema: "LeaderboardSnapshotV1",
    },
  ],
  [
    "getCurrentPublicProfileV1",
    {
      authenticationContract: "none",
      cacheControl: "snapshot-by-season-state",
      method: "get",
      path: "/v1/profiles/{handle}",
      pathSchema: "PublicProfilePathV1",
      querySchema: "PublicProfileQueryV1",
      requestSchema: "none",
      responseSchema: "PublicProfileSummaryV1",
    },
  ],
  [
    "postUsageSyncV1",
    {
      authenticationContract: "connector-usage-sync-authentication.json",
      cacheControl: "no-store",
      method: "post",
      path: "/v1/usage",
      pathSchema: "none",
      querySchema: "none",
      requestSchema: "UsageSyncV1",
      responseSchema: "UsageSyncResultV1",
    },
  ],
]);
function report(scope, message) {
  findings.push(`${scope} — ${message}`);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameSet(left, right) {
  return (
    left.length === right.length &&
    [...left].sort().every((entry, index) => entry === [...right].sort()[index])
  );
}

function hasDuplicateJsonObjectKey(text) {
  let cursor = 0;
  let duplicate = false;
  const whitespace = () => {
    while (/\s/u.test(text[cursor] ?? "")) {
      cursor += 1;
    }
  };
  const stringToken = () => {
    const start = cursor;
    cursor += 1;
    while (cursor < text.length) {
      if (text[cursor] === "\\") {
        cursor += 2;
      } else if (text[cursor] === '"') {
        cursor += 1;
        return JSON.parse(text.slice(start, cursor));
      } else {
        cursor += 1;
      }
    }
    throw new Error("unterminated JSON string");
  };
  const value = () => {
    whitespace();
    if (text[cursor] === "{") {
      object();
      return;
    }
    if (text[cursor] === "[") {
      cursor += 1;
      whitespace();
      while (text[cursor] !== "]") {
        value();
        whitespace();
        if (text[cursor] === ",") {
          cursor += 1;
          whitespace();
        } else {
          break;
        }
      }
      cursor += 1;
      return;
    }
    if (text[cursor] === '"') {
      stringToken();
      return;
    }
    while (cursor < text.length && !/[\s,\]}]/u.test(text[cursor] ?? "")) {
      cursor += 1;
    }
  };
  const object = () => {
    cursor += 1;
    const keys = new Set();
    whitespace();
    while (text[cursor] !== "}") {
      const key = stringToken();
      if (keys.has(key)) {
        duplicate = true;
      }
      keys.add(key);
      whitespace();
      cursor += 1;
      value();
      whitespace();
      if (text[cursor] === ",") {
        cursor += 1;
        whitespace();
      } else {
        break;
      }
    }
    cursor += 1;
  };
  value();
  return duplicate;
}

function validateSchema(schema, scope, topLevel = false) {
  if (!isObject(schema)) {
    report(scope, "schema node must be an object");
    return;
  }
  for (const key of Object.keys(schema)) {
    if (!schemaKeywords.has(key)) {
      report(scope, `unsupported schema keyword ${JSON.stringify(key)}`);
    }
  }
  if (
    topLevel &&
    (schema.$schema !== "https://json-schema.org/draft/2020-12/schema" ||
      typeof schema.$id !== "string" ||
      typeof schema.title !== "string" ||
      typeof schema.description !== "string")
  ) {
    report(scope, "top-level schema identity or description is incomplete");
  }

  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (
    types.length === 0 ||
    types.length > 2 ||
    new Set(types).size !== types.length ||
    types.some((type) => !schemaTypes.has(type)) ||
    (types.length === 2 && (!types.includes("null") || types[1] !== "null"))
  ) {
    report(scope, "schema type must be one supported type or one ordered nullable union");
    return;
  }

  const objectType = types.includes("object");
  if (objectType) {
    if (schema.additionalProperties !== false || !isObject(schema.properties)) {
      report(scope, "object schemas must be closed and declare properties");
    } else {
      const propertyNames = Object.keys(schema.properties);
      const required = Array.isArray(schema.required) ? schema.required : [];
      if (
        propertyNames.length > 64 ||
        new Set(required).size !== required.length ||
        required.some((name) => !propertyNames.includes(name)) ||
        propertyNames.some((name) => !/^[a-z][A-Za-z0-9]*$/u.test(name))
      ) {
        report(scope, "object property or required inventory is invalid");
      }
      const optional = propertyNames.filter((name) => !required.includes(name));
      const declaredOptional = schema["x-viberacing-optionalProperties"];
      if (
        (optional.length === 0 && declaredOptional !== undefined) ||
        (optional.length > 0 &&
          (!Array.isArray(declaredOptional) || !sameSet(optional, declaredOptional)))
      ) {
        report(scope, "optional properties must be declared exactly");
      }
      for (const [name, child] of Object.entries(schema.properties)) {
        validateSchema(child, `${scope}.properties.${name}`);
      }
    }
  } else if (
    schema.additionalProperties !== undefined ||
    schema.properties !== undefined ||
    schema.required !== undefined ||
    schema["x-viberacing-optionalProperties"] !== undefined
  ) {
    report(scope, "non-object schema carries object-only keywords");
  }

  if (types.includes("array")) {
    if (
      !isObject(schema.items) ||
      !Number.isSafeInteger(schema.minItems) ||
      !Number.isSafeInteger(schema.maxItems) ||
      schema.minItems < 0 ||
      schema.maxItems < schema.minItems ||
      schema.maxItems > 256
    ) {
      report(scope, "array schema must have bounded items");
    } else {
      validateSchema(schema.items, `${scope}.items`);
      if (
        schema["x-viberacing-uniqueBy"] !== undefined &&
        (!types.includes("array") ||
          !isObject(schema.items.properties) ||
          !Object.hasOwn(schema.items.properties, schema["x-viberacing-uniqueBy"]))
      ) {
        report(scope, "array unique-key extension must name an item property");
      }
    }
  } else if (
    schema.items !== undefined ||
    schema.minItems !== undefined ||
    schema.maxItems !== undefined ||
    schema["x-viberacing-uniqueBy"] !== undefined
  ) {
    report(scope, "non-array schema carries array-only keywords");
  }

  if (types.includes("string")) {
    if (
      !Number.isSafeInteger(schema.minLength) ||
      !Number.isSafeInteger(schema.maxLength) ||
      schema.minLength < 0 ||
      schema.maxLength < schema.minLength ||
      schema.maxLength > 4096
    ) {
      report(scope, "string schema must have finite length bounds");
    }
    if (schema.pattern !== undefined) {
      try {
        new RegExp(schema.pattern, "u");
      } catch {
        report(scope, "string pattern is invalid");
      }
    }
  }
  if (
    types.includes("integer") &&
    (!Number.isSafeInteger(schema.minimum) ||
      !Number.isSafeInteger(schema.maximum) ||
      schema.maximum < schema.minimum)
  ) {
    report(scope, "integer schema must have safe inclusive bounds");
  }
  if (
    schema.enum !== undefined &&
    (!Array.isArray(schema.enum) ||
      schema.enum.length === 0 ||
      schema.enum.length > 64 ||
      new Set(schema.enum.map((entry) => JSON.stringify(entry))).size !== schema.enum.length)
  ) {
    report(scope, "enum must be a bounded unique closed list");
  }
}

function allPropertyNames(schema, names = new Set()) {
  if (!isObject(schema)) {
    return names;
  }
  if (isObject(schema.properties)) {
    for (const [name, child] of Object.entries(schema.properties)) {
      names.add(name);
      allPropertyNames(child, names);
    }
  }
  if (isObject(schema.items)) {
    allPropertyNames(schema.items, names);
  }
  return names;
}

function objectCore(schema) {
  return {
    type: schema.type,
    additionalProperties: schema.additionalProperties,
    ...(schema["x-viberacing-optionalProperties"] === undefined
      ? {}
      : { "x-viberacing-optionalProperties": schema["x-viberacing-optionalProperties"] }),
    required: schema.required,
    properties: schema.properties,
  };
}

function verifyEd25519(publicKeyBase64Url, message, signatureBase64Url) {
  try {
    const rawPublicKey = Buffer.from(publicKeyBase64Url, "base64url");
    const key = createPublicKey({
      key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), rawPublicKey]),
      format: "der",
      type: "spki",
    });
    return (
      rawPublicKey.length === 32 &&
      Buffer.from(signatureBase64Url, "base64url").length === 64 &&
      verify(null, Buffer.from(message, "utf8"), key, Buffer.from(signatureBase64Url, "base64url"))
    );
  } catch {
    return false;
  }
}

function readJson(relativePath) {
  const absolutePath = resolve(root, relativePath);
  try {
    const text = readFileSync(absolutePath, "utf8").replaceAll("\r\n", "\n");
    if (hasDuplicateJsonObjectKey(text)) {
      report(relativePath, "duplicate JSON object key is forbidden");
    }
    return JSON.parse(text);
  } catch (error) {
    report(relativePath, `could not parse regular JSON: ${error.message}`);
    return undefined;
  }
}

const contractDirectory = resolve(root, "contracts", "v1");
if (!existsSync(contractDirectory)) {
  report("contracts/v1", "contract directory is missing");
} else {
  const entries = readdirSync(contractDirectory, { withFileTypes: true });
  const actualFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  if (!sameSet(actualFiles, expectedContractFiles)) {
    report("contracts/v1", "file inventory differs from the clean version 1 contract catalog");
  }
  for (const entry of entries) {
    const path = resolve(contractDirectory, entry.name);
    if (!entry.isFile() || lstatSync(path).isSymbolicLink()) {
      report(
        `contracts/v1/${entry.name}`,
        "contract entries must be regular non-symbolic-link files",
      );
    }
  }
}

for (const file of expectedContractFiles) {
  const relativePath = `contracts/v1/${file}`;
  if (existsSync(resolve(root, relativePath))) {
    readJson(relativePath);
  } else {
    report(relativePath, "required clean contract file is missing");
  }
}

let sources;
try {
  sources = readContractSources(root);
} catch (error) {
  report("contracts/v1/manifest.json", error.message);
}

if (sources !== undefined) {
  const records = new Map(sources.records.map((record) => [record.entry.file, record]));
  if (!sameSet([...records.keys()], schemaFiles)) {
    report(
      "contracts/v1/manifest.json",
      "schema catalog differs from the clean contract inventory",
    );
  }
  if (
    !sameSet(
      sources.policies.map((record) => record.entry.file),
      policyFiles,
    )
  ) {
    report(
      "contracts/v1/manifest.json",
      "policy catalog differs from the clean contract inventory",
    );
  }

  for (const record of sources.records) {
    validateSchema(record.schema, record.relativePath, true);
    const expectedFields = expectedSchemaFields.get(record.entry.file);
    if (expectedFields !== undefined) {
      const actualFields = Object.keys(record.schema.properties ?? []);
      if (!sameSet(actualFields, expectedFields)) {
        report(record.relativePath, "top-level field inventory differs from the reviewed contract");
      }
      const expectedOptional = expectedOptionalFields.get(record.entry.file) ?? [];
      const expectedRequired = expectedFields.filter((field) => !expectedOptional.includes(field));
      if (!sameSet(record.schema.required ?? [], expectedRequired)) {
        report(record.relativePath, "top-level required field inventory differs from review");
      }
    }
  }

  const providerSchema = records.get("agent-provider.schema.json")?.schema;
  if (providerSchema?.type !== "string" || !isDeepStrictEqual(providerSchema.enum, ["codex"])) {
    report(
      "contracts/v1/agent-provider.schema.json",
      "built-in reader provider enum differs from evidence",
    );
  }

  const discoverySchema = records.get("connector-discovery-manifest.schema.json")?.schema;
  const startSchema = records.get("connector-pairing-start.schema.json")?.schema;
  if (
    !isObject(discoverySchema) ||
    !isObject(startSchema?.properties?.discoveryManifest) ||
    !isDeepStrictEqual(
      objectCore(discoverySchema),
      objectCore(startSchema.properties.discoveryManifest),
    )
  ) {
    report(
      "contracts/v1/connector-pairing-start.schema.json",
      "embedded discovery manifest has drifted from ConnectorDiscoveryManifestV1",
    );
  }
  const approvalSchema = records.get("connector-pairing-approval.schema.json")?.schema;
  if (
    !isDeepStrictEqual(approvalSchema?.properties?.decisions?.items?.properties?.action?.enum, [
      "attach_existing",
      "create",
      "skip",
    ])
  ) {
    report(
      "contracts/v1/connector-pairing-approval.schema.json",
      "pairing decision action enum differs from review",
    );
  }
  const pollResultNames = allPropertyNames(
    records.get("connector-pairing-poll-result.schema.json")?.schema,
  );
  if (
    ["accountFingerprintDigest", "githubUserId", "passkeyId", "privateLabel", "profileId"].some(
      (field) => pollResultNames.has(field),
    )
  ) {
    report(
      "contracts/v1/connector-pairing-poll-result.schema.json",
      "private server identity leaked into connector activation result",
    );
  }

  const usageSchema = records.get("usage-sync.schema.json")?.schema;
  const usageNames = allPropertyNames(usageSchema);
  for (const forbidden of [
    "accountingRevision",
    "deviceCount",
    "model",
    "price",
    "profileId",
    "provider",
    "rank",
    "sourceCount",
    "subscription",
    "trustTier",
    "weeklyTokenTotal",
  ]) {
    if (usageNames.has(forbidden)) {
      report(
        "contracts/v1/usage-sync.schema.json",
        "provider or server-derived field leaked into upload",
      );
    }
  }
  const dailyTotal = usageSchema?.properties?.dailyEntries?.items?.properties?.dailyTokenTotal;
  if (
    dailyTotal?.type !== "string" ||
    dailyTotal.maxLength !== 30 ||
    dailyTotal.pattern !== "^(?:0|[1-9][0-9]{0,29})$"
  ) {
    report(
      "contracts/v1/usage-sync.schema.json",
      "daily token total is not an exact decimal string",
    );
  }

  for (const [file, forbiddenFields] of [
    [
      "connector-discovery-manifest.schema.json",
      [
        "accessToken",
        "apiKey",
        "code",
        "conversation",
        "email",
        "localPath",
        "login",
        "model",
        "prompt",
        "repository",
      ],
    ],
    [
      "leaderboard-snapshot.schema.json",
      [
        "accountCount",
        "agentAccountId",
        "deviceCount",
        "deviceId",
        "email",
        "profileId",
        "sourceCount",
      ],
    ],
    [
      "public-profile-summary.schema.json",
      [
        "agentAccountId",
        "deviceCount",
        "deviceId",
        "email",
        "privateLabel",
        "profileId",
        "sourceCount",
      ],
    ],
  ]) {
    const names = allPropertyNames(records.get(file)?.schema);
    if (forbiddenFields.some((field) => names.has(field))) {
      report(
        `contracts/v1/${file}`,
        "private or non-competitive field leaked into public contract",
      );
    }
  }

  const leaderboardSchema = records.get("leaderboard-snapshot.schema.json")?.schema;
  const participant = leaderboardSchema?.properties?.participants?.items;
  if (
    leaderboardSchema?.properties?.metricVersion?.const !== "provider_reported_tokens_v1" ||
    leaderboardSchema?.properties?.trustTier?.const !== "community" ||
    participant?.properties?.weeklyTokenTotal?.type !== "string" ||
    participant?.properties?.freshnessDays?.type?.[1] !== "null" ||
    !sameSet(participant?.properties?.providerBreakdown?.items?.required ?? [], [
      "provider",
      "percentage",
    ])
  ) {
    report(
      "contracts/v1/leaderboard-snapshot.schema.json",
      "direct-token snapshot semantics differ from review",
    );
  }
  const profileSchema = records.get("public-profile-summary.schema.json")?.schema;
  if (
    profileSchema?.properties?.weeklyTokenTotal?.type !== "string" ||
    !isDeepStrictEqual(profileSchema?.properties?.carRecipe?.type, ["object", "null"])
  ) {
    report(
      "contracts/v1/public-profile-summary.schema.json",
      "profile total or car nullability differs from review",
    );
  }

  if (sources.operations.length !== expectedOperations.size) {
    report("contracts/v1/manifest.json", "operation count differs from the clean route surface");
  }
  for (const operation of sources.operations) {
    const expected = expectedOperations.get(operation.entry.operationId);
    if (
      expected === undefined ||
      Object.entries(expected).some(([key, value]) => operation.entry[key] !== value) ||
      operation.entry.problemSchema !== "ProblemDetailsV1" ||
      operation.entry.corsPolicy !== "same-origin"
    ) {
      report(
        "contracts/v1/manifest.json",
        `operation ${operation.entry.operationId} differs from review`,
      );
    }
    if (operation.entry.path.startsWith("/v1/community/")) {
      report("contracts/v1/manifest.json", "legacy Community route survived the clean replacement");
    }
    if (operation.entry.implementationStatus === "implemented-local") {
      const evidence = implementedContractEvidence.get(operation.entry.operationId);
      if (evidence === undefined) {
        report(
          "contracts/v1/manifest.json",
          `implemented-local operation ${operation.entry.operationId} has no reviewed evidence policy`,
        );
      } else {
        for (const [relativePath, requiredTokens] of evidence) {
          const absolutePath = resolve(root, relativePath);
          if (!existsSync(absolutePath) || !lstatSync(absolutePath).isFile()) {
            report(relativePath, "implemented-local contract evidence is missing");
            continue;
          }
          const text = readFileSync(absolutePath, "utf8");
          if (requiredTokens.some((token) => !text.includes(token))) {
            report(
              relativePath,
              "implemented-local evidence does not contain the reviewed boundary",
            );
          }
        }
      }
    }
  }

  const pairingPolicy = sources.policies.find(
    (record) => record.entry.file === "connector-pairing-authentication.json",
  )?.policy;
  if (
    pairingPolicy?.algorithm !== "Ed25519" ||
    pairingPolicy.pairingIdPattern !== "^pair_[A-Za-z0-9_-]{22}$" ||
    pairingPolicy.startProof?.messagePrefix !== "viberacing-pairing-start-possession-v1" ||
    pairingPolicy.pollProof?.messagePrefix !== "viberacing-pairing-poll-possession-v1" ||
    !isDeepStrictEqual(pairingPolicy.pollProof?.canonicalFields, [
      "messagePrefix",
      "pairingId",
      "pairingChallenge",
      "installationPublicKey",
    ])
  ) {
    report(
      "contracts/v1/connector-pairing-authentication.json",
      "batch pairing possession policy differs from review",
    );
  }
  const transportPolicy = sources.policies.find(
    (record) => record.entry.file === "connector-pairing-transport.json",
  )?.policy;
  if (
    !isDeepStrictEqual(transportPolicy?.methods, {
      poll: "POST /v1/connector/pairing/poll",
      start: "POST /v1/connector/pairing/start",
    }) ||
    transportPolicy?.requestBodyBytes !== 32768 ||
    transportPolicy?.clientRateIdentifierLocation !== "request-body" ||
    transportPolicy?.cacheControl !== "no-store"
  ) {
    report(
      "contracts/v1/connector-pairing-transport.json",
      "pairing transport differs from review",
    );
  }
  const usagePolicy = sources.policies.find(
    (record) => record.entry.file === "connector-usage-sync-authentication.json",
  )?.policy;
  if (
    usagePolicy?.requestTarget !== "/v1/usage" ||
    usagePolicy?.maximumBodyBytes !== 8192 ||
    usagePolicy?.deviceSignature?.deviceIdPattern !== "^dev_[A-Za-z0-9_-]{22}$" ||
    usagePolicy?.deviceSignature?.idempotencyKeyPattern !== "^syn_[A-Za-z0-9_-]{22}$"
  ) {
    report(
      "contracts/v1/connector-usage-sync-authentication.json",
      "usage authentication policy differs from review",
    );
  }

  try {
    const expectedArtifacts = await buildGeneratedArtifacts(root);
    for (const [relativePath, expected] of expectedArtifacts) {
      const absolutePath = resolve(root, relativePath);
      if (!existsSync(absolutePath) || !lstatSync(absolutePath).isFile()) {
        report(relativePath, "generated contract artifact is missing");
      } else if (readFileSync(absolutePath, "utf8").replaceAll("\r\n", "\n") !== expected) {
        report(relativePath, "generated contract artifact has drifted from canonical sources");
      }
    }
  } catch (error) {
    report("generated contracts", `could not generate expected artifacts: ${error.message}`);
  }
}

const pairingVector = readJson("contracts/v1/connector-pairing-possession.test-vector.json");
if (isObject(pairingVector)) {
  const encodedChallenge = Buffer.from(pairingVector.pairingChallengeBytes ?? []).toString(
    "base64url",
  );
  const expectedMessage = [
    "viberacing-pairing-poll-possession-v1",
    pairingVector.pairingId,
    pairingVector.pairingChallenge,
    pairingVector.installationPublicKey,
  ].join("\n");
  if (
    pairingVector.pairingChallenge !== encodedChallenge ||
    pairingVector.possessionMessage !== expectedMessage ||
    !verifyEd25519(
      pairingVector.installationPublicKey,
      expectedMessage,
      pairingVector.possessionSignature,
    )
  ) {
    report(
      "contracts/v1/connector-pairing-possession.test-vector.json",
      "pairing possession vector is not self-consistent",
    );
  }
}

const pairingStartVector = readJson(
  "contracts/v1/connector-pairing-start-possession.test-vector.json",
);
if (isObject(pairingStartVector)) {
  const canonicalManifest = JSON.stringify(pairingStartVector.manifest);
  const manifestDigest = createHash("sha256").update(canonicalManifest, "utf8").digest("hex");
  const expectedMessage = [
    "viberacing-pairing-start-possession-v1",
    manifestDigest,
    pairingStartVector.clientRateIdentifier,
    pairingStartVector.signedAt,
    pairingStartVector.nonce,
  ].join("\n");
  if (
    pairingStartVector.canonicalManifest !== canonicalManifest ||
    pairingStartVector.manifestDigest !== manifestDigest ||
    pairingStartVector.possessionMessage !== expectedMessage ||
    !verifyEd25519(
      pairingStartVector.manifest?.installationPublicKey,
      expectedMessage,
      pairingStartVector.possessionSignature,
    )
  ) {
    report(
      "contracts/v1/connector-pairing-start-possession.test-vector.json",
      "pairing start possession vector is not self-consistent",
    );
  }
}

for (const [file, requestTarget, messagePrefix] of [
  [
    "connector-car-proposal-device-request.test-vector.json",
    "/v1/connector/cars/proposals",
    "viberacing-car-proposal-request-v1",
  ],
  [
    "connector-usage-sync-device-request.test-vector.json",
    "/v1/usage",
    "viberacing-device-request-v1",
  ],
]) {
  const relativePath = `contracts/v1/${file}`;
  const vector = readJson(relativePath);
  if (!isObject(vector)) {
    continue;
  }
  const bodyDigest = createHash("sha256")
    .update(vector.body ?? "", "utf8")
    .digest("base64url");
  const timestamp = vector.deviceTimestamp ?? JSON.parse(vector.body ?? "{}").observedAt;
  const fields = [
    messagePrefix,
    "POST",
    requestTarget,
    bodyDigest,
    vector.deviceId,
    vector.deviceNonceBase64Url,
    timestamp,
    ...(file.startsWith("connector-usage") ? [JSON.parse(vector.body ?? "{}").syncId] : []),
  ];
  const message = fields.join("\n");
  if (
    vector.bodyDigestBase64Url !== bodyDigest ||
    vector.deviceSignatureMessage !== message ||
    !verifyEd25519(vector.devicePublicKeyBase64Url, message, vector.deviceSignatureBase64Url)
  ) {
    report(relativePath, "device request vector is not self-consistent");
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
  `Contract check passed (${String(schemaFiles.length)} schemas, ${String(policyFiles.length)} policies, ${String(expectedOperations.size)} operations, 3 signed vectors, 2 generated artifacts).`,
);

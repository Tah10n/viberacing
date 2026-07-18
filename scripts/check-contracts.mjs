import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";

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
  "x-viberacing-optionalProperties",
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
    "car-recipe.schema.json",
    ["schemaVersion", "chassis", "nose", "cockpit", "wing", "wheels", "palette", "trail", "seed"],
  ],
  [
    "community-race-page.schema.json",
    ["schemaVersion", "trustTier", "selfReported", "participants"],
  ],
  [
    "community-race-status-page.schema.json",
    ["schemaVersion", "trustTier", "selfReported", "participants"],
  ],
  [
    "community-score-page.schema.json",
    ["schemaVersion", "trustTier", "selfReported", "participants"],
  ],
  ["community-score-query.schema.json", ["seasonStart"]],
  ["connector-car-proposal-result.schema.json", ["schemaVersion", "requestId", "outcome"]],
  ["connector-pairing-poll-result.schema.json", ["schemaVersion", "requestId", "deviceBindings"]],
  ["connector-pairing-poll.schema.json", ["schemaVersion", "pollToken", "possessionSignature"]],
  [
    "connector-pairing-start-result.schema.json",
    [
      "schemaVersion",
      "requestId",
      "pairingId",
      "pollToken",
      "pairingChallengeBase64Url",
      "userCode",
      "expiresAt",
    ],
  ],
  [
    "connector-pairing-start.schema.json",
    [
      "schemaVersion",
      "devicePublicKeyBase64Url",
      "deviceLabel",
      "connectorVersion",
      "osFamily",
      "architecture",
    ],
  ],
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
    "getCommunityRaceStatusV1",
    [
      "apps/web/app/v1/community/race/status/route.test.ts",
      "apps/web/app/v1/community/race/status/route.ts",
      "apps/web/lib/public-community-race.test.ts",
      "apps/web/lib/public-community-race.ts",
      "apps/web/lib/public-community-score-mapper.test.ts",
      "apps/web/lib/public-community-score-mapper.ts",
      "apps/web/lib/public-community-score-route.test.ts",
      "apps/web/lib/public-community-score-route.ts",
      "apps/web/lib/public-community-score-store.test.ts",
      "apps/web/lib/public-community-score-store.ts",
      "database/migrations/0029_community_public_race_status.sql",
      "database/tests/public_score_read.sql",
    ],
  ],
  [
    "getCommunityRaceV1",
    [
      "apps/web/app/v1/community/race/route.test.ts",
      "apps/web/app/v1/community/race/route.ts",
      "apps/web/lib/public-community-race.test.ts",
      "apps/web/lib/public-community-race.ts",
      "apps/web/lib/public-community-score-mapper.test.ts",
      "apps/web/lib/public-community-score-mapper.ts",
      "apps/web/lib/public-community-score-route.test.ts",
      "apps/web/lib/public-community-score-route.ts",
      "apps/web/lib/public-community-score-store.test.ts",
      "apps/web/lib/public-community-score-store.ts",
    ],
  ],
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
      "scripts/test-ingest-postgres-integration.mjs",
    ],
  ],
  [
    "postConnectorCarProposalV1",
    [
      "apps/web/app/v1/connector/cars/proposals/route.test.ts",
      "apps/web/app/v1/connector/cars/proposals/route.ts",
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
    ],
  ],
  [
    "postConnectorPairingPollV1",
    [
      "apps/web/app/v1/connector/pairing/poll/route.test.ts",
      "apps/web/app/v1/connector/pairing/poll/route.ts",
      "apps/web/lib/pairing-http.test.ts",
      "apps/web/lib/pairing-http.ts",
      "apps/web/lib/pairing-rate-policy.test.ts",
      "apps/web/lib/pairing-rate-policy.ts",
    ],
  ],
  [
    "postConnectorPairingStartV1",
    [
      "apps/web/app/v1/connector/pairing/start/route.test.ts",
      "apps/web/app/v1/connector/pairing/start/route.ts",
      "apps/web/lib/pairing-http.test.ts",
      "apps/web/lib/pairing-http.ts",
      "apps/web/lib/pairing-rate-policy.test.ts",
      "apps/web/lib/pairing-rate-policy.ts",
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

function validatePairingPolicy(record) {
  const { policy, relativePath } = record;
  const expectedKeys = [
    "activationPreconditions",
    "algorithm",
    "binaryEncoding",
    "canonicalFields",
    "canonicalMessageEncoding",
    "canonicalMessageSeparator",
    "canonicalMessageTrailingSeparator",
    "challengeBytes",
    "messagePrefix",
    "pairingIdPattern",
    "protocolId",
    "publicKeyBytes",
    "schemaVersion",
    "signatureBytes",
  ];
  if (
    !sameEntries(Object.keys(policy).sort(), expectedKeys) ||
    policy.schemaVersion !== 1 ||
    policy.protocolId !== "viberacing-device-pairing-possession-v1" ||
    policy.algorithm !== "Ed25519" ||
    policy.publicKeyBytes !== 32 ||
    policy.challengeBytes !== 32 ||
    policy.signatureBytes !== 64 ||
    policy.binaryEncoding !== "base64url-unpadded" ||
    policy.canonicalMessageEncoding !== "UTF-8" ||
    policy.canonicalMessageSeparator !== "LF" ||
    policy.canonicalMessageTrailingSeparator !== false ||
    policy.messagePrefix !== "viberacing-pairing-possession-v1" ||
    policy.pairingIdPattern !==
      "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" ||
    !Array.isArray(policy.canonicalFields) ||
    !sameEntries(policy.canonicalFields, [
      "messagePrefix",
      "pairingId",
      "pairingChallengeBase64Url",
      "devicePublicKeyBase64Url",
    ]) ||
    !Array.isArray(policy.activationPreconditions) ||
    !sameEntries(policy.activationPreconditions, [
      "exact-poll-verifier-match",
      "browser-approved-transaction",
      "unexpired-pending-device-key",
      "strict-possession-signature",
    ])
  ) {
    report(relativePath, "pairing possession policy differs from the reviewed boundary");
  }
}

function validatePairingTransportPolicy(record) {
  const { policy, relativePath } = record;
  const expectedKeys = [
    "cacheControl",
    "clientIdAuthority",
    "clientIdBytes",
    "clientIdEncoding",
    "clientIdHeader",
    "corsPolicy",
    "databaseQueryDeadlineMilliseconds",
    "databaseStatementDeadlineMilliseconds",
    "distributedRatePolicy",
    "localConcurrency",
    "mediaType",
    "methods",
    "possessionPolicy",
    "protocolId",
    "requestBodyBytes",
    "responseBodyBytes",
    "schemaVersion",
  ];
  if (
    !sameEntries(Object.keys(policy).sort(), expectedKeys) ||
    policy.schemaVersion !== 1 ||
    policy.protocolId !== "viberacing-connector-pairing-transport-v1" ||
    !isObject(policy.methods) ||
    !sameEntries(Object.keys(policy.methods).sort(), ["poll", "start"]) ||
    policy.methods.start !== "POST /v1/connector/pairing/start" ||
    policy.methods.poll !== "POST /v1/connector/pairing/poll" ||
    policy.mediaType !== "application/json" ||
    policy.requestBodyBytes !== 1024 ||
    policy.responseBodyBytes !== 2048 ||
    policy.clientIdHeader !== "x-viberacing-client-id" ||
    policy.clientIdBytes !== 16 ||
    policy.clientIdEncoding !== "base64url-unpadded" ||
    policy.clientIdAuthority !== "anonymous-rate-shaping-only" ||
    policy.distributedRatePolicy !== "global-and-64-fixed-client-buckets" ||
    policy.localConcurrency !== 4 ||
    policy.databaseStatementDeadlineMilliseconds !== 5000 ||
    policy.databaseQueryDeadlineMilliseconds !== 6000 ||
    policy.cacheControl !== "no-store" ||
    policy.corsPolicy !== "same-origin-no-cors-headers" ||
    policy.possessionPolicy !== "connector-pairing-authentication.json"
  ) {
    report(relativePath, "pairing transport policy differs from the reviewed boundary");
  }
}

function validateCarProposalPolicy(record) {
  const { policy, relativePath } = record;
  const expectedKeys = [
    "binaryEncoding",
    "canonicalMessageEncoding",
    "canonicalMessageSeparator",
    "canonicalMessageTrailingSeparator",
    "deviceSignature",
    "digestEncoding",
    "maximumBodyBytes",
    "maximumDecodedJsonStringCodeUnits",
    "maximumHeaderNameCharacters",
    "maximumHeaderPairs",
    "maximumHeaderValueCharacters",
    "maximumJsonArrayItems",
    "maximumJsonDepth",
    "maximumJsonNodes",
    "maximumJsonNumberCharacters",
    "maximumJsonObjectMembers",
    "mediaType",
    "method",
    "protocolId",
    "requestFreshness",
    "requestTarget",
    "schemaVersion",
  ];
  const signature = policy.deviceSignature;
  const freshness = policy.requestFreshness;
  if (
    !sameEntries(Object.keys(policy).sort(), expectedKeys) ||
    policy.schemaVersion !== 1 ||
    policy.protocolId !== "viberacing-connector-car-proposal-auth-v1" ||
    policy.method !== "POST" ||
    policy.requestTarget !== "/v1/connector/cars/proposals" ||
    policy.mediaType !== "application/json" ||
    policy.maximumBodyBytes !== 512 ||
    policy.maximumHeaderPairs !== 32 ||
    policy.maximumHeaderNameCharacters !== 64 ||
    policy.maximumHeaderValueCharacters !== 256 ||
    policy.maximumJsonDepth !== 2 ||
    policy.maximumJsonNodes !== 10 ||
    policy.maximumJsonObjectMembers !== 9 ||
    policy.maximumJsonArrayItems !== 0 ||
    policy.maximumJsonNumberCharacters !== 5 ||
    policy.maximumDecodedJsonStringCodeUnits !== 16 ||
    policy.canonicalMessageEncoding !== "UTF-8" ||
    policy.canonicalMessageSeparator !== "LF" ||
    policy.canonicalMessageTrailingSeparator !== false ||
    policy.binaryEncoding !== "base64url-unpadded" ||
    policy.digestEncoding !== "base64url-unpadded" ||
    !isObject(freshness) ||
    !sameEntries(Object.keys(freshness).sort(), [
      "maximumAgeBoundary",
      "maximumAgeMilliseconds",
      "maximumFutureSkewBoundary",
      "maximumFutureSkewMilliseconds",
    ]) ||
    freshness.maximumAgeMilliseconds !== 300_000 ||
    freshness.maximumAgeBoundary !== "exclusive" ||
    freshness.maximumFutureSkewMilliseconds !== 120_000 ||
    freshness.maximumFutureSkewBoundary !== "inclusive" ||
    !isObject(signature) ||
    !sameEntries(Object.keys(signature).sort(), [
      "algorithm",
      "canonicalFields",
      "deviceIdPattern",
      "headers",
      "messagePrefix",
      "nonceBytes",
      "publicKeyBytes",
      "signatureBytes",
    ]) ||
    signature.messagePrefix !== "viberacing-car-proposal-request-v1" ||
    signature.algorithm !== "Ed25519" ||
    signature.publicKeyBytes !== 32 ||
    signature.signatureBytes !== 64 ||
    signature.nonceBytes !== 16 ||
    signature.deviceIdPattern !== "^dev_[A-Za-z0-9_-]{22}$" ||
    !isObject(signature.headers) ||
    !isDeepStrictEqual(signature.headers, {
      deviceId: "x-viberacing-device-id",
      timestamp: "x-viberacing-device-timestamp",
      nonce: "x-viberacing-device-nonce",
      signature: "x-viberacing-device-signature",
    }) ||
    !sameEntries(signature.canonicalFields ?? [], [
      "messagePrefix",
      "method",
      "requestTarget",
      "bodyDigestBase64Url",
      "deviceId",
      "nonce",
      "timestamp",
    ])
  ) {
    report(relativePath, "connector car proposal policy differs from the reviewed boundary");
  }
}

function validateCarProposalVector() {
  const relativePath = "contracts/v1/connector-car-proposal-device-request.test-vector.json";
  const absolutePath = resolve(root, relativePath);
  if (!existsSync(absolutePath)) {
    report(relativePath, "shared connector car proposal vector is missing");
    return;
  }
  const stats = lstatSync(absolutePath);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    report(relativePath, "shared connector car proposal vector must be a regular file");
    return;
  }
  let vector;
  try {
    vector = JSON.parse(readFileSync(absolutePath, "utf8"));
  } catch {
    report(relativePath, "shared connector car proposal vector must be valid JSON");
    return;
  }
  const expectedKeys = [
    "body",
    "bodyDigestBase64Url",
    "deviceId",
    "deviceNonceBase64Url",
    "deviceNonceBytes",
    "devicePublicKeyBase64Url",
    "deviceSignatureBase64Url",
    "deviceSignatureMessage",
    "deviceTimestamp",
    "schemaVersion",
  ];
  const nonce = Buffer.from(Array.from({ length: 16 }, (_, index) => index));
  const canonicalBase64Url = (value, expectedBytes) => {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
      return false;
    }
    const decoded = Buffer.from(value, "base64url");
    return (
      decoded.length === expectedBytes &&
      decoded.toString("base64url") === value &&
      value.length === Math.ceil((expectedBytes * 8) / 6)
    );
  };
  const expectedBody =
    '{"schemaVersion":1,"chassis":"formula","nose":"wedge","cockpit":"canopy","wing":"high","wheels":"slick","palette":"turbo-blue","trail":"spark","seed":4242}';
  const expectedDigest = createHash("sha256").update(expectedBody).digest("base64url");
  if (
    !isObject(vector) ||
    !sameEntries(Object.keys(vector).sort(), expectedKeys) ||
    vector.schemaVersion !== 1 ||
    vector.deviceId !== "dev_CCCCCCCCCCCCCCCCCCCCCC" ||
    !sameEntries(vector.deviceNonceBytes ?? [], [...nonce]) ||
    vector.deviceNonceBase64Url !== nonce.toString("base64url") ||
    vector.deviceTimestamp !== "2026-07-15T12:34:56.789Z" ||
    vector.body !== expectedBody ||
    vector.bodyDigestBase64Url !== expectedDigest ||
    !canonicalBase64Url(vector.devicePublicKeyBase64Url, 32) ||
    !canonicalBase64Url(vector.deviceSignatureBase64Url, 64) ||
    vector.deviceSignatureMessage !==
      [
        "viberacing-car-proposal-request-v1",
        "POST",
        "/v1/connector/cars/proposals",
        expectedDigest,
        vector.deviceId,
        vector.deviceNonceBase64Url,
        vector.deviceTimestamp,
      ].join("\n")
  ) {
    report(relativePath, "shared connector car proposal vector differs from the reviewed boundary");
  }
}

function validatePairingVector() {
  const relativePath = "contracts/v1/connector-pairing-possession.test-vector.json";
  const absolutePath = resolve(root, relativePath);
  if (!existsSync(absolutePath)) {
    report(relativePath, "shared pairing possession vector is missing");
    return;
  }
  const stats = lstatSync(absolutePath);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    report(relativePath, "shared pairing possession vector must be a regular file");
    return;
  }
  let vector;
  try {
    vector = JSON.parse(readFileSync(absolutePath, "utf8"));
  } catch {
    report(relativePath, "shared pairing possession vector must be valid JSON");
    return;
  }
  const expectedKeys = [
    "devicePublicKeyBase64Url",
    "pairingChallengeBase64Url",
    "pairingChallengeBytes",
    "pairingId",
    "possessionMessage",
    "possessionSignatureBase64Url",
    "protocolId",
    "schemaVersion",
  ];
  const challenge = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
  const challengeBase64Url = challenge.toString("base64url");
  const canonicalBase64Url = (value, expectedBytes) => {
    const expectedCharacters = Math.ceil((expectedBytes * 8) / 6);
    if (
      typeof value !== "string" ||
      value.length !== expectedCharacters ||
      !/^[A-Za-z0-9_-]+$/.test(value)
    ) {
      return false;
    }
    const decoded = Buffer.from(value, "base64url");
    return decoded.length === expectedBytes && decoded.toString("base64url") === value;
  };
  if (
    !isObject(vector) ||
    !sameEntries(Object.keys(vector).sort(), expectedKeys) ||
    vector.schemaVersion !== 1 ||
    vector.protocolId !== "viberacing-device-pairing-possession-v1" ||
    typeof vector.pairingId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      vector.pairingId,
    ) ||
    !Array.isArray(vector.pairingChallengeBytes) ||
    !sameEntries(vector.pairingChallengeBytes, [...challenge]) ||
    vector.pairingChallengeBase64Url !== challengeBase64Url ||
    !canonicalBase64Url(vector.devicePublicKeyBase64Url, 32) ||
    !canonicalBase64Url(vector.possessionSignatureBase64Url, 64) ||
    vector.possessionMessage !==
      [
        "viberacing-pairing-possession-v1",
        vector.pairingId,
        challengeBase64Url,
        vector.devicePublicKeyBase64Url,
      ].join("\n")
  ) {
    report(relativePath, "shared pairing possession vector differs from the reviewed boundary");
  }
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
  if (schema["x-viberacing-optionalProperties"] !== undefined && schema.type !== "object") {
    report(scope, "optional properties are supported only on closed objects");
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
    const optionalProperties = schema["x-viberacing-optionalProperties"];
    if (optionalProperties === undefined) {
      if (!Array.isArray(schema.required) || !sameEntries(schema.required, properties)) {
        report(scope, "every property must be required in the same reviewed order");
      }
    } else {
      const optionalPropertyList = Array.isArray(optionalProperties) ? optionalProperties : [];
      const optionalPropertySet = new Set(optionalPropertyList);
      const reviewedOptionalOrder = properties.filter((name) => optionalPropertySet.has(name));
      if (
        !Array.isArray(optionalProperties) ||
        optionalProperties.length === 0 ||
        optionalProperties.length > 8 ||
        optionalPropertySet.size !== optionalProperties.length ||
        !sameEntries(optionalPropertyList, reviewedOptionalOrder)
      ) {
        report(scope, "optional properties must be a bounded ordered subset of object fields");
      }
      const requiredProperties = properties.filter((name) => !optionalPropertySet.has(name));
      if (!Array.isArray(schema.required) || !sameEntries(schema.required, requiredProperties)) {
        report(scope, "required properties must exclude only the reviewed optional fields");
      }
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
  const { manifest, operations, policies, records } = sources;
  const manifestStats = lstatSync(resolve(root, "contracts", "v1", "manifest.json"));
  if (manifestStats.isSymbolicLink() || !manifestStats.isFile()) {
    report("contracts/v1/manifest.json", "manifest must be a regular non-symbolic-link file");
  }
  if (
    !isObject(manifest) ||
    Object.keys(manifest).sort().join(",") !==
      "contractVersion,operations,policies,schemaVersion,schemas" ||
    manifest.schemaVersion !== 1 ||
    manifest.contractVersion !== "v1" ||
    !Array.isArray(manifest.schemas) ||
    !Array.isArray(manifest.policies) ||
    !Array.isArray(manifest.operations)
  ) {
    report("contracts/v1/manifest.json", "manifest shape or version is invalid");
  }

  if (
    !sameEntries(
      policies.map(({ entry }) => entry.file),
      [
        "connector-car-proposal-authentication.json",
        "connector-pairing-authentication.json",
        "connector-pairing-transport.json",
        "connector-sync-authentication.json",
      ],
    )
  ) {
    report("contracts/v1/manifest.json", "authentication policy inventory differs from review");
  }
  const listedPolicies = new Set(policies.map(({ entry }) => entry.file));
  for (const record of policies) {
    const stats = lstatSync(resolve(root, record.relativePath));
    if (stats.isSymbolicLink() || !stats.isFile()) {
      report(record.relativePath, "authentication policies must be regular files");
    }
    if (!isObject(record.entry) || Object.keys(record.entry).sort().join(",") !== "file,policyId") {
      report("contracts/v1/manifest.json", "authentication policy entry is invalid");
    }
    if (record.entry.file === "connector-car-proposal-authentication.json") {
      validateCarProposalPolicy(record);
    } else if (record.entry.file === "connector-pairing-authentication.json") {
      validatePairingPolicy(record);
    } else if (record.entry.file === "connector-pairing-transport.json") {
      validatePairingTransportPolicy(record);
    }
  }
  validateCarProposalVector();
  validatePairingVector();

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
    if (
      entry.file === "community-race-page.schema.json" ||
      entry.file === "community-race-status-page.schema.json" ||
      entry.file === "community-score-page.schema.json"
    ) {
      const isRacePage = entry.file !== "community-score-page.schema.json";
      const isStatusPage = entry.file === "community-race-status-page.schema.json";
      const participantArray = schema?.properties?.participants;
      const participantProperties = participantArray?.items?.properties ?? {};
      const participantFields = Object.keys(participantProperties);
      const scoreParticipantFields = [
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
      ];
      const requiredParticipantFields = isStatusPage
        ? [...scoreParticipantFields, "freshnessDays"]
        : scoreParticipantFields;
      const expectedParticipantFields = isStatusPage
        ? [
            "seasonStart",
            "seasonEnd",
            "scoreVersion",
            "seasonFinalized",
            "handle",
            "carRecipe",
            "weeklyScore",
            "activeDays",
            "sourceCount",
            "rankPosition",
            "displayPosition",
            "freshnessDays",
            "streakDays",
          ]
        : isRacePage
          ? [
              "seasonStart",
              "seasonEnd",
              "scoreVersion",
              "seasonFinalized",
              "handle",
              "carRecipe",
              "weeklyScore",
              "activeDays",
              "sourceCount",
              "rankPosition",
              "displayPosition",
            ]
          : requiredParticipantFields;
      if (
        schema?.properties?.trustTier?.const !== "community" ||
        schema?.properties?.selfReported?.const !== true
      ) {
        report(
          scope,
          isRacePage
            ? "Community race trust metadata must remain explicit and constant"
            : "Community score trust metadata must remain explicit and constant",
        );
      }
      if (
        participantArray?.minItems !== 0 ||
        participantArray?.maxItems !== 32 ||
        participantArray?.["x-viberacing-uniqueBy"] !== "displayPosition"
      ) {
        report(
          scope,
          isRacePage
            ? "Community race participants must remain a bounded unique display page"
            : "Community score participants must remain a bounded unique display page",
        );
      }
      if (
        !sameEntries(participantFields, expectedParticipantFields) ||
        !sameEntries(participantArray?.items?.required ?? [], requiredParticipantFields)
      ) {
        report(
          scope,
          isRacePage
            ? "Community race participant fields differ from the public allowlist"
            : "Community score participant fields differ from the public allowlist",
        );
      }
      if (isRacePage) {
        const carRecipeSchema = records.find(
          (candidate) => candidate.entry.file === "car-recipe.schema.json",
        )?.schema;
        const canonicalCarRecipeShape = {
          type: carRecipeSchema?.type,
          additionalProperties: carRecipeSchema?.additionalProperties,
          required: carRecipeSchema?.required,
          properties: carRecipeSchema?.properties,
        };
        if (
          participantArray?.items?.required?.includes("carRecipe") ||
          !isDeepStrictEqual(participantProperties.carRecipe, canonicalCarRecipeShape)
        ) {
          report(scope, "Community race CarRecipe differs from the canonical optional recipe");
        }
      }
      if (
        isStatusPage &&
        (participantArray?.items?.required?.includes("streakDays") ||
          !participantArray?.items?.required?.includes("freshnessDays") ||
          !sameEntries(participantArray?.items?.["x-viberacing-optionalProperties"] ?? [], [
            "carRecipe",
            "streakDays",
          ]))
      ) {
        report(scope, "Community race status visibility fields differ from the reviewed boundary");
      }
      const exactIntegerBounds = [
        ["weeklyScore", 0, 7000],
        ["activeDays", 0, 7],
        ["sourceCount", 0, 32],
        ["rankPosition", 1, 32],
        ["displayPosition", 1, 32],
        ...(isStatusPage
          ? [
              ["freshnessDays", 0, 65535],
              ["streakDays", 0, 36533],
            ]
          : []),
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
        report(
          scope,
          isRacePage
            ? "Community race participant bounds differ from the reviewed projection"
            : "Community score participant bounds differ from the reviewed projection",
        );
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
    if (entry.file === "car-recipe.schema.json") {
      const properties = schema?.properties ?? {};
      const exactEnums = [
        ["chassis", ["formula", "rally", "roadster"]],
        ["nose", ["classic", "scoop", "wedge"]],
        ["cockpit", ["canopy", "open", "rally"]],
        ["wing", ["high", "low", "none"]],
        ["wheels", ["all-terrain", "slick", "street"]],
        ["palette", ["magenta", "mint", "redline", "sunburst", "turbo-blue"]],
        ["trail", ["grid", "none", "spark"]],
      ];
      if (
        properties.schemaVersion?.const !== 1 ||
        properties.schemaVersion?.minimum !== 1 ||
        properties.schemaVersion?.maximum !== 1 ||
        properties.seed?.minimum !== 0 ||
        properties.seed?.maximum !== 65_535 ||
        exactEnums.some(([name, values]) => !sameEntries(properties[name]?.enum ?? [], values))
      ) {
        report(scope, "CarRecipe version, enum set, or seed bounds differ from ADR 0005");
      }
    }
    if (entry.file === "connector-car-proposal-result.schema.json") {
      const outcome = schema?.properties?.outcome;
      const requestId = schema?.properties?.requestId;
      const schemaVersion = schema?.properties?.schemaVersion;
      if (
        schemaVersion?.const !== 1 ||
        schemaVersion?.minimum !== 1 ||
        schemaVersion?.maximum !== 1 ||
        requestId?.minLength !== 26 ||
        requestId?.maxLength !== 26 ||
        requestId?.pattern !== "^req_[A-Za-z0-9_-]{22}$" ||
        outcome?.const !== "accepted" ||
        outcome?.minLength !== 8 ||
        outcome?.maxLength !== 8
      ) {
        report(scope, "connector car proposal result differs from the generic acknowledgement");
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

  const publicRaceStatusOperation = operations[0];
  if (
    operations.length !== 7 ||
    publicRaceStatusOperation?.entry.method !== "get" ||
    publicRaceStatusOperation.entry.path !== "/v1/community/race/status" ||
    publicRaceStatusOperation.entry.operationId !== "getCommunityRaceStatusV1" ||
    publicRaceStatusOperation.entry.implementationStatus !== "implemented-local" ||
    publicRaceStatusOperation.entry.summary !== "Read one bounded Community race status page" ||
    publicRaceStatusOperation.entry.admissionPolicy !== "no-queue-4" ||
    publicRaceStatusOperation.entry.authenticationContract !== "none" ||
    publicRaceStatusOperation.entry.querySchema !== "CommunityScoreQueryV1" ||
    publicRaceStatusOperation.entry.requestSchema !== "none" ||
    publicRaceStatusOperation.entry.responseSchema !== "CommunityRaceStatusPageV1" ||
    publicRaceStatusOperation.entry.problemSchema !== "ProblemDetailsV1" ||
    !sameEntries(publicRaceStatusOperation.entry.problemStatuses, [400, 406, 429, 500, 503]) ||
    publicRaceStatusOperation.entry.queryPolicy !== "closed-single-value" ||
    publicRaceStatusOperation.entry.requestBodyPolicy !== "none" ||
    publicRaceStatusOperation.entry.cacheControl !== "no-store" ||
    publicRaceStatusOperation.entry.corsPolicy !== "same-origin"
  ) {
    report(
      "contracts/v1/manifest.json",
      "public Community race status operation differs from the reviewed HTTP contract",
    );
  }

  const publicRaceOperation = operations[1];
  if (
    operations.length !== 7 ||
    publicRaceOperation?.entry.method !== "get" ||
    publicRaceOperation.entry.path !== "/v1/community/race" ||
    publicRaceOperation.entry.operationId !== "getCommunityRaceV1" ||
    publicRaceOperation.entry.implementationStatus !== "implemented-local" ||
    publicRaceOperation.entry.summary !== "Read one bounded Community race page" ||
    publicRaceOperation.entry.admissionPolicy !== "no-queue-4" ||
    publicRaceOperation.entry.authenticationContract !== "none" ||
    publicRaceOperation.entry.querySchema !== "CommunityScoreQueryV1" ||
    publicRaceOperation.entry.requestSchema !== "none" ||
    publicRaceOperation.entry.responseSchema !== "CommunityRacePageV1" ||
    publicRaceOperation.entry.problemSchema !== "ProblemDetailsV1" ||
    !sameEntries(publicRaceOperation.entry.problemStatuses, [400, 406, 429, 500, 503]) ||
    publicRaceOperation.entry.queryPolicy !== "closed-single-value" ||
    publicRaceOperation.entry.requestBodyPolicy !== "none" ||
    publicRaceOperation.entry.cacheControl !== "no-store" ||
    publicRaceOperation.entry.corsPolicy !== "same-origin"
  ) {
    report(
      "contracts/v1/manifest.json",
      "public Community race operation differs from the reviewed HTTP contract",
    );
  }

  const publicScoreOperation = operations[2];
  if (
    operations.length !== 7 ||
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

  const communitySyncOperation = operations[3];
  if (
    operations.length !== 7 ||
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

  const carProposalOperation = operations[4];
  if (
    carProposalOperation?.entry.method !== "post" ||
    carProposalOperation.entry.path !== "/v1/connector/cars/proposals" ||
    carProposalOperation.entry.operationId !== "postConnectorCarProposalV1" ||
    carProposalOperation.entry.implementationStatus !== "implemented-local" ||
    carProposalOperation.entry.summary !== "Submit one bounded device-authenticated car proposal" ||
    carProposalOperation.entry.admissionPolicy !== "no-queue-4" ||
    carProposalOperation.entry.authenticationContract !==
      "connector-car-proposal-authentication.json" ||
    carProposalOperation.entry.querySchema !== "none" ||
    carProposalOperation.entry.requestSchema !== "CarRecipeV1" ||
    carProposalOperation.entry.responseSchema !== "ConnectorCarProposalResultV1" ||
    carProposalOperation.entry.problemSchema !== "ProblemDetailsV1" ||
    !sameEntries(
      carProposalOperation.entry.problemStatuses,
      [400, 401, 405, 406, 422, 429, 500, 503],
    ) ||
    carProposalOperation.entry.queryPolicy !== "none" ||
    carProposalOperation.entry.requestBodyPolicy !== "exact-raw-json-512" ||
    carProposalOperation.entry.cacheControl !== "no-store" ||
    carProposalOperation.entry.corsPolicy !== "same-origin"
  ) {
    report("contracts/v1/manifest.json", "connector car proposal operation differs from review");
  }

  const pairingPollOperation = operations[5];
  if (
    pairingPollOperation?.entry.method !== "post" ||
    pairingPollOperation.entry.path !== "/v1/connector/pairing/poll" ||
    pairingPollOperation.entry.operationId !== "postConnectorPairingPollV1" ||
    pairingPollOperation.entry.implementationStatus !== "implemented-local" ||
    pairingPollOperation.entry.summary !== "Poll and complete one approved connector pairing" ||
    pairingPollOperation.entry.admissionPolicy !== "no-queue-4" ||
    pairingPollOperation.entry.authenticationContract !== "connector-pairing-transport.json" ||
    pairingPollOperation.entry.querySchema !== "none" ||
    pairingPollOperation.entry.requestSchema !== "ConnectorPairingPollV1" ||
    pairingPollOperation.entry.responseSchema !== "ConnectorPairingPollResultV1" ||
    pairingPollOperation.entry.problemSchema !== "ProblemDetailsV1" ||
    !sameEntries(pairingPollOperation.entry.problemStatuses, [400, 405, 406, 429, 500, 503]) ||
    pairingPollOperation.entry.queryPolicy !== "none" ||
    pairingPollOperation.entry.requestBodyPolicy !== "exact-raw-json-1024" ||
    pairingPollOperation.entry.cacheControl !== "no-store" ||
    pairingPollOperation.entry.corsPolicy !== "same-origin"
  ) {
    report("contracts/v1/manifest.json", "pairing poll operation differs from review");
  }

  const pairingStartOperation = operations[6];
  if (
    pairingStartOperation?.entry.method !== "post" ||
    pairingStartOperation.entry.path !== "/v1/connector/pairing/start" ||
    pairingStartOperation.entry.operationId !== "postConnectorPairingStartV1" ||
    pairingStartOperation.entry.implementationStatus !== "implemented-local" ||
    pairingStartOperation.entry.summary !== "Start one bounded connector pairing transaction" ||
    pairingStartOperation.entry.admissionPolicy !== "no-queue-4" ||
    pairingStartOperation.entry.authenticationContract !== "connector-pairing-transport.json" ||
    pairingStartOperation.entry.querySchema !== "none" ||
    pairingStartOperation.entry.requestSchema !== "ConnectorPairingStartV1" ||
    pairingStartOperation.entry.responseSchema !== "ConnectorPairingStartResultV1" ||
    pairingStartOperation.entry.problemSchema !== "ProblemDetailsV1" ||
    !sameEntries(pairingStartOperation.entry.problemStatuses, [400, 405, 406, 429, 500, 503]) ||
    pairingStartOperation.entry.queryPolicy !== "none" ||
    pairingStartOperation.entry.requestBodyPolicy !== "exact-raw-json-1024" ||
    pairingStartOperation.entry.cacheControl !== "no-store" ||
    pairingStartOperation.entry.corsPolicy !== "same-origin"
  ) {
    report("contracts/v1/manifest.json", "pairing start operation differs from review");
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
    if (
      /^connector-[a-z0-9]+(?:-[a-z0-9]+)*-authentication\.json$/.test(entry.name) &&
      !listedPolicies.has(entry.name)
    ) {
      report(`contracts/v1/${entry.name}`, "authentication policy is not listed in the manifest");
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
  `Contract check passed (${String(sources.records.length)} schemas, ${String(sources.policies.length)} policies, ${String(sources.operations.length)} operations, 2 generated artifacts).`,
);

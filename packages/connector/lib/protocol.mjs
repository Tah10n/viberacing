import { hasTerminalControlCharacters } from "./terminal.mjs";

export const connectorProtocolVersion = 5;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const decimalPattern = /^(?:0|[1-9]\d{0,29})$/;
const tokenPattern = /^[A-Za-z0-9_-]{32,128}$/;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const errorCodePattern = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const responseLimit = 65_536;

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return record(value) && Object.keys(value).every((key) => keys.has(key));
}

function requiredExactKeys(value, keys) {
  return exactKeys(value, keys) && [...keys].every((key) => Object.hasOwn(value, key));
}

function invalid(message = "Vibe Racing returned an invalid protocol response") {
  const error = new Error(message);
  error.code = "invalid_server_response";
  return error;
}

function safeText(value, maximum = 500, minimum = 0) {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum &&
    !hasTerminalControlCharacters(value)
  );
}

function safeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function safeVerificationUrl(value, origin, code) {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    if (url.origin !== origin || url.pathname !== "/connect" || url.hash !== "") return false;
    if (
      url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
      return false;
    return (
      [...url.searchParams.keys()].every((key) => key === "code") &&
      url.searchParams.getAll("code").length === 1 &&
      url.searchParams.get("code") === code
    );
  } catch {
    return false;
  }
}

async function readLimitedBody(response) {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > responseLimit)) {
    await response.body?.cancel().catch(() => {});
    throw invalid("Vibe Racing response body is too large");
  }
  if (response.body === null) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > responseLimit) {
        await reader.cancel().catch(() => {});
        throw invalid("Vibe Racing response body is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    length,
  );
}

function parseJsonBody(response, body) {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw invalid("Vibe Racing returned non-JSON content");
  if (body.length === 0) throw invalid("Vibe Racing returned an empty JSON response");
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw invalid("Vibe Racing returned malformed JSON");
  }
}

function parsePairingStart(value, context) {
  const keys = new Set([
    "installationId",
    "code",
    "pollToken",
    "verificationUrl",
    "expiresInSeconds",
  ]);
  if (
    !requiredExactKeys(value, keys) ||
    value.installationId !== context.installationId ||
    !uuidPattern.test(value.installationId) ||
    typeof value.code !== "string" ||
    !/^[A-Z2-9]{8}$/.test(value.code) ||
    !tokenPattern.test(value.pollToken) ||
    !Number.isSafeInteger(value.expiresInSeconds) ||
    value.expiresInSeconds < 1 ||
    value.expiresInSeconds > 900 ||
    !safeVerificationUrl(value.verificationUrl, context.origin, value.code)
  )
    throw invalid();
  return value;
}

const legacyMappingKeys = new Set([
  "clientSourceId",
  "sourceId",
  "agentAccountId",
  "agentId",
  "accountLabel",
  "collectionMethod",
  "lastAcceptedSyncSequence",
]);
const mappingKeys = new Set([
  ...legacyMappingKeys,
  "historyBackfillYear",
  "historyBackfillStatus",
  "historyGapRangeStart",
  "historyGapRangeEnd",
]);
const requiredHistoryMappingKeys = new Set([
  ...legacyMappingKeys,
  "historyBackfillYear",
  "historyBackfillStatus",
]);

function validHistoryGap(value) {
  const start = value?.historyGapRangeStart;
  const end = value?.historyGapRangeEnd;
  return (
    (start === undefined && end === undefined) ||
    (start === null && end === null) ||
    (typeof start === "string" &&
      typeof end === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(start) &&
      /^\d{4}-\d{2}-\d{2}$/.test(end) &&
      start <= end)
  );
}

function validHistoryStatus(value) {
  return (
    Number.isSafeInteger(value?.historyBackfillYear) &&
    value.historyBackfillYear >= 1970 &&
    value.historyBackfillYear <= 9999 &&
    ["pending", "complete", "partial"].includes(value.historyBackfillStatus) &&
    validHistoryGap(value)
  );
}

function parseMapping(value, local, historyRequired = false) {
  const keys = historyRequired ? mappingKeys : legacyMappingKeys;
  if (
    !exactKeys(value, keys) ||
    ![...(historyRequired ? requiredHistoryMappingKeys : legacyMappingKeys)].every((key) =>
      Object.hasOwn(value, key),
    ) ||
    value.clientSourceId !== local.clientSourceId ||
    !identifierPattern.test(value.clientSourceId) ||
    !uuidPattern.test(value.sourceId) ||
    !uuidPattern.test(value.agentAccountId) ||
    value.agentId !== local.agentId ||
    value.collectionMethod !== local.collectionMethod ||
    (typeof local.sourceId === "string" && value.sourceId !== local.sourceId) ||
    !safeText(value.accountLabel, 40, 1) ||
    !decimalPattern.test(value.lastAcceptedSyncSequence) ||
    (historyRequired && !validHistoryStatus(value))
  )
    throw invalid();
  return {
    ...local,
    sourceId: value.sourceId,
    agentAccountId: value.agentAccountId,
    accountLabel: value.accountLabel,
    lastAcceptedSyncSequence: value.lastAcceptedSyncSequence,
    ...(historyRequired
      ? {
          historyBackfillYear: value.historyBackfillYear,
          historyBackfillStatus: value.historyBackfillStatus,
          historyGapRangeStart: value.historyGapRangeStart,
          historyGapRangeEnd: value.historyGapRangeEnd,
        }
      : {}),
  };
}

function parsePairingPoll(value, context) {
  if (
    requiredExactKeys(value, new Set(["status"])) &&
    ["pending", "revoked"].includes(value.status)
  )
    return value;
  const keys = new Set(["status", "deviceToken", "sources", "protocol"]);
  if (
    !requiredExactKeys(value, keys) ||
    value.status !== "active" ||
    !tokenPattern.test(value.deviceToken) ||
    !Array.isArray(value.sources) ||
    !requiredExactKeys(
      value.protocol,
      new Set(["version", "snapshotDays", "maximumSources", "maximumEntries"]),
    ) ||
    value.protocol.version !== connectorProtocolVersion ||
    value.protocol.snapshotDays !== 31 ||
    value.protocol.maximumSources !== 32 ||
    value.protocol.maximumEntries !== 1_024
  )
    throw invalid();
  const localById = new Map(context.localSources.map((source) => [source.clientSourceId, source]));
  const requiredClientSourceIds = new Set(
    context.requiredClientSourceIds ?? context.localSources.map((source) => source.clientSourceId),
  );
  if (
    value.sources.length > localById.size ||
    [...requiredClientSourceIds].some((clientSourceId) => !localById.has(clientSourceId))
  )
    throw invalid();
  const seen = new Set();
  const sources = value.sources.map((mapping) => {
    const clientSourceId = record(mapping) ? mapping.clientSourceId : undefined;
    const local = typeof clientSourceId === "string" ? localById.get(clientSourceId) : undefined;
    if (local === undefined || seen.has(clientSourceId)) throw invalid();
    seen.add(clientSourceId);
    return parseMapping(mapping, local, true);
  });
  if ([...requiredClientSourceIds].some((clientSourceId) => !seen.has(clientSourceId))) {
    throw invalid();
  }
  return { status: "active", deviceToken: value.deviceToken, sources, protocol: value.protocol };
}

function parseReconciliation(value, context) {
  const expectedAttestationId = context.handlerAttestationId;
  const expectedBootstrapIds = new Set(context.bootstrapSourceIds ?? []);
  const allowedKeys = new Set(["sources"]);
  if (expectedAttestationId !== undefined) allowedKeys.add("acceptedHandlerAttestationId");
  if (context.bootstrapSourceIds !== undefined) allowedKeys.add("sourceBaselines");
  if (
    !exactKeys(value, allowedKeys) ||
    !Object.hasOwn(value, "sources") ||
    !Array.isArray(value.sources) ||
    (Object.hasOwn(value, "acceptedHandlerAttestationId") &&
      value.acceptedHandlerAttestationId !== expectedAttestationId) ||
    (context.bootstrapSourceIds !== undefined &&
      (!Object.hasOwn(value, "sourceBaselines") || !Array.isArray(value.sourceBaselines)))
  )
    throw invalid();
  const expected = new Set(context.sourceIds ?? []);
  if (expected.size > 100 || value.sources.length !== expected.size) throw invalid();
  const seen = new Set();
  for (const source of value.sources) {
    const reconciliationKeys =
      context.protocolVersion >= 5
        ? new Set([
            "sourceId",
            "status",
            "lastAcceptedSyncSequence",
            "historyBackfillYear",
            "historyBackfillStatus",
            "historyGapRangeStart",
            "historyGapRangeEnd",
          ])
        : new Set(["sourceId", "status", "lastAcceptedSyncSequence"]);
    const requiredReconciliationKeys =
      context.protocolVersion >= 5
        ? new Set([
            "sourceId",
            "status",
            "lastAcceptedSyncSequence",
            "historyBackfillYear",
            "historyBackfillStatus",
          ])
        : reconciliationKeys;
    if (
      !exactKeys(source, reconciliationKeys) ||
      ![...requiredReconciliationKeys].every((key) => Object.hasOwn(source, key)) ||
      !expected.has(source.sourceId) ||
      seen.has(source.sourceId) ||
      !["active", "disconnected"].includes(source.status) ||
      !decimalPattern.test(source.lastAcceptedSyncSequence) ||
      (context.protocolVersion >= 5 && !validHistoryStatus(source))
    )
      throw invalid();
    seen.add(source.sourceId);
  }
  if ([...expected].some((sourceId) => !seen.has(sourceId))) throw invalid();
  if (context.bootstrapSourceIds !== undefined) {
    if (value.sourceBaselines.length !== expectedBootstrapIds.size) throw invalid();
    const baselineSeen = new Set();
    for (const baseline of value.sourceBaselines) {
      if (
        !requiredExactKeys(baseline, new Set(["sourceId", "acceptedAt", "entries"])) ||
        !expectedBootstrapIds.has(baseline.sourceId) ||
        baselineSeen.has(baseline.sourceId) ||
        !safeText(baseline.acceptedAt, 40, 20) ||
        !Number.isFinite(Date.parse(baseline.acceptedAt)) ||
        new Date(baseline.acceptedAt).toISOString() !== baseline.acceptedAt ||
        !Array.isArray(baseline.entries) ||
        baseline.entries.length > 31 ||
        baseline.entries.some(
          (entry) =>
            !requiredExactKeys(entry, new Set(["date", "totalTokens"])) ||
            !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) ||
            !decimalPattern.test(entry.totalTokens),
        )
      )
        throw invalid();
      baselineSeen.add(baseline.sourceId);
    }
  }
  return value;
}

function parseSourceRegistration(value, context) {
  if (!requiredExactKeys(value, new Set(["source"]))) throw invalid();
  const registrationKeys = new Set([...mappingKeys, "profileSourceId"]);
  const requiredRegistrationKeys = new Set([...requiredHistoryMappingKeys, "profileSourceId"]);
  if (
    !exactKeys(value.source, registrationKeys) ||
    ![...requiredRegistrationKeys].every((key) => Object.hasOwn(value.source, key)) ||
    value.source.profileSourceId !== context.profileSourceId ||
    !uuidPattern.test(value.source.profileSourceId)
  )
    throw invalid();
  const { profileSourceId, ...mapping } = value.source;
  const source = { ...parseMapping(mapping, context.localSource, true), profileSourceId };
  if (source.agentId !== "codex" || source.profileClientSourceId !== context.profileClientSourceId)
    throw invalid();
  return { source };
}

function parseUsage(value, context) {
  const keys = new Set([
    "acceptedEntries",
    "acceptedSnapshots",
    "acceptedSourceErrors",
    "staleSourceErrors",
    "legacySourceErrorsIgnored",
    "staleSnapshots",
    "sourceSequences",
  ]);
  if (
    !requiredExactKeys(value, keys) ||
    !safeInteger(value.acceptedEntries) ||
    !safeInteger(value.acceptedSnapshots) ||
    !safeInteger(value.acceptedSourceErrors) ||
    !safeInteger(value.staleSourceErrors) ||
    !safeInteger(value.legacySourceErrorsIgnored) ||
    !safeInteger(value.staleSnapshots) ||
    !Array.isArray(value.sourceSequences)
  )
    throw invalid();
  const expected = new Set(context.sourceIds);
  if (value.sourceSequences.length !== expected.size) throw invalid();
  const seen = new Set();
  for (const sequence of value.sourceSequences) {
    const sequenceKeys =
      context.protocolVersion >= 5
        ? new Set([
            "sourceId",
            "lastAcceptedSyncSequence",
            "accepted",
            "historyGapRangeStart",
            "historyGapRangeEnd",
          ])
        : new Set(["sourceId", "lastAcceptedSyncSequence", "accepted"]);
    if (
      !exactKeys(sequence, sequenceKeys) ||
      !["sourceId", "lastAcceptedSyncSequence", "accepted"].every((key) =>
        Object.hasOwn(sequence, key),
      ) ||
      !expected.has(sequence.sourceId) ||
      seen.has(sequence.sourceId) ||
      !decimalPattern.test(sequence.lastAcceptedSyncSequence) ||
      typeof sequence.accepted !== "boolean" ||
      (context.protocolVersion >= 5 && !validHistoryGap(sequence))
    )
      throw invalid();
    seen.add(sequence.sourceId);
  }
  return value;
}

function parseBrowserSyncClaim(value) {
  if (
    !requiredExactKeys(value, new Set(["requestId", "sourceIds"])) ||
    !uuidPattern.test(value.requestId) ||
    !Array.isArray(value.sourceIds) ||
    value.sourceIds.length < 1 ||
    value.sourceIds.length > 32 ||
    value.sourceIds.some((sourceId) => !uuidPattern.test(sourceId)) ||
    new Set(value.sourceIds).size !== value.sourceIds.length
  )
    throw invalid();
  return value;
}

function parseDiagnostics(value, context) {
  if (
    !requiredExactKeys(value, new Set(["acceptedEvents"])) ||
    !safeInteger(value.acceptedEvents) ||
    value.acceptedEvents !== context.expectedEvents
  )
    throw invalid();
  return value;
}

export function mergeStoredSourceMapping(local, mapping) {
  if (!record(mapping) || mapping.clientSourceId !== local.clientSourceId)
    throw invalid("Connector configuration contains an invalid source mapping");
  if (mapping.agentId !== local.agentId || mapping.collectionMethod !== local.collectionMethod)
    throw invalid("Connector configuration source identity changed");
  if (
    !uuidPattern.test(mapping.sourceId) ||
    !safeText(mapping.accountLabel, 40, 1) ||
    !decimalPattern.test(mapping.lastAcceptedSyncSequence ?? "0")
  )
    throw invalid("Connector configuration contains an invalid source mapping");
  if (mapping.agentAccountId !== undefined && !uuidPattern.test(mapping.agentAccountId))
    throw invalid("Connector configuration contains an invalid account mapping");
  if (
    (mapping.historyBackfillYear !== undefined ||
      mapping.historyBackfillStatus !== undefined ||
      mapping.historyGapRangeStart !== undefined ||
      mapping.historyGapRangeEnd !== undefined) &&
    !validHistoryStatus(mapping)
  )
    throw invalid("Connector configuration contains invalid history state");
  if (
    mapping.profileSourceId !== undefined &&
    (local.agentId !== "codex" ||
      local.profileClientSourceId === undefined ||
      !uuidPattern.test(mapping.profileSourceId))
  )
    throw invalid("Connector configuration contains an invalid profile mapping");
  return {
    ...local,
    sourceId: mapping.sourceId,
    ...(mapping.agentAccountId === undefined ? {} : { agentAccountId: mapping.agentAccountId }),
    accountLabel: mapping.accountLabel,
    lastAcceptedSyncSequence: mapping.lastAcceptedSyncSequence ?? "0",
    ...(mapping.historyBackfillYear === undefined
      ? {}
      : {
          historyBackfillYear: mapping.historyBackfillYear,
          historyBackfillStatus: mapping.historyBackfillStatus,
          historyGapRangeStart: mapping.historyGapRangeStart,
          historyGapRangeEnd: mapping.historyGapRangeEnd,
        }),
    ...(mapping.profileSourceId === undefined ? {} : { profileSourceId: mapping.profileSourceId }),
  };
}

export async function parseProtocolResponse(response, context) {
  const body = await readLimitedBody(response);
  if (response.status === 204) {
    if (body.length !== 0 || context.kind !== "empty") throw invalid();
    return null;
  }
  const value = parseJsonBody(response, body);
  if (!response.ok) {
    if (
      !requiredExactKeys(value, new Set(["error"])) ||
      !safeText(value.error, 128, 1) ||
      !errorCodePattern.test(value.error)
    )
      throw invalid();
    return { error: value.error };
  }
  if (context.kind === "pairingStart") return parsePairingStart(value, context);
  if (context.kind === "pairingPoll") return parsePairingPoll(value, context);
  if (context.kind === "reconciliation") return parseReconciliation(value, context);
  if (context.kind === "sourceRegistration") return parseSourceRegistration(value, context);
  if (context.kind === "usage") return parseUsage(value, context);
  if (context.kind === "browserSyncClaim") return parseBrowserSyncClaim(value);
  if (context.kind === "diagnostics") return parseDiagnostics(value, context);
  throw invalid();
}

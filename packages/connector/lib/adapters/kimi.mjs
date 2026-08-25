import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  collectJsonl,
  componentEntry,
  diagnosePath,
  findFile,
  mergeEntries,
  previousJsonlEntries,
  parserResult,
  utcDay,
} from "./shared.mjs";

const kimiParserVersion = 1;

function currentRecord(line) {
  try {
    const record = JSON.parse(line);
    const usage = record?.usage;
    const day = utcDay(record?.time);
    const entry =
      record?.type === "usage.record" &&
      usage &&
      usage.inputOther !== undefined &&
      usage.output !== undefined &&
      day
        ? componentEntry(day, {
            inputTokens: usage.inputOther,
            outputTokens: usage.output,
            cacheReadTokens: usage.inputCacheRead,
            cacheWriteTokens: usage.inputCacheCreation,
            reasoningTokens: 0,
          })
        : null;
    return entry ? { id: createHash("sha256").update(line).digest("hex"), date: day, entry } : null;
  } catch {
    return null;
  }
}

function legacyRecord(line) {
  try {
    const record = JSON.parse(line);
    const message = record?.message ?? record;
    const payload = message?.payload;
    const usage = payload?.token_usage;
    const id = payload?.message_id;
    const timestamp = record?.timestamp ?? message?.timestamp;
    const day =
      typeof timestamp === "number" && Number.isFinite(timestamp)
        ? utcDay(timestamp * 1_000)
        : utcDay(timestamp);
    const entry =
      message?.type === "StatusUpdate" &&
      usage &&
      usage.input_other !== undefined &&
      usage.output !== undefined &&
      typeof id === "string" &&
      id.length > 0 &&
      id.length <= 256 &&
      day
        ? componentEntry(day, {
            inputTokens: usage.input_other,
            outputTokens: usage.output,
            cacheReadTokens: usage.input_cache_read,
            cacheWriteTokens: usage.input_cache_creation,
            reasoningTokens: 0,
          })
        : null;
    return entry ? { id, date: day, entry } : null;
  } catch {
    return null;
  }
}

function parseRecords(lines, decoder, relevant) {
  const seen = new Set();
  const entries = [];
  let candidateRecords = 0;
  let parsedRecords = 0;
  let unsupportedCandidates = 0;
  for (const line of lines) {
    let native;
    try {
      native = JSON.parse(line);
    } catch {
      candidateRecords += 1;
      unsupportedCandidates += 1;
      continue;
    }
    if (!relevant(native)) continue;
    candidateRecords += 1;
    const record = decoder(line);
    if (record === null) {
      unsupportedCandidates += 1;
      continue;
    }
    parsedRecords += 1;
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    entries.push(record.entry);
  }
  return parserResult(
    mergeEntries(entries),
    candidateRecords,
    parsedRecords,
    unsupportedCandidates,
  );
}

export function parseKimiCurrentLines(lines) {
  return parseRecords(lines, currentRecord, (record) => record?.type === "usage.record").entries;
}

export function parseKimiLegacyLines(lines) {
  return parseRecords(
    lines,
    legacyRecord,
    (record) => (record?.message ?? record)?.type === "StatusUpdate",
  ).entries;
}

// The unqualified parser intentionally means the current persisted wire format.
export const parseKimiLines = parseKimiCurrentLines;

function eventKey(decoder) {
  return (line) => {
    const record = decoder(line);
    return record === null ? null : { id: record.id, date: record.date };
  };
}

export function kimiSourcePaths(environment = process.env, home = homedir()) {
  const currentRoot = environment.KIMI_CODE_HOME
    ? resolve(environment.KIMI_CODE_HOME)
    : join(home, ".kimi-code");
  const legacyRoot = environment.KIMI_SHARE_DIR
    ? resolve(environment.KIMI_SHARE_DIR)
    : join(home, ".kimi");
  return {
    current: join(currentRoot, "sessions"),
    legacy: join(legacyRoot, "sessions"),
  };
}

export function kimiCollectionMethodForPath(dataPath, paths = kimiSourcePaths()) {
  const normalized = resolve(dataPath);
  return normalized === resolve(paths.legacy) || basename(dirname(normalized)) === ".kimi"
    ? "kimi_legacy_wire_jsonl"
    : "kimi_wire_jsonl";
}

const initialPaths = kimiSourcePaths();
export const kimiDefaultPaths = [initialPaths.current, initialPaths.legacy];
export async function detectKimiSources({ environment = process.env, home = homedir() } = {}) {
  const paths = kimiSourcePaths(environment, home);
  const current = {
    dataPath: paths.current,
    collectionMethod: "kimi_wire_jsonl",
    supportedSurface: "cli",
  };
  if (await findFile(current.dataPath, (name) => name === "wire.jsonl"))
    return [
      {
        ...current,
        suggestedLabel: "Kimi Code",
        supersedesDataPaths: environment.KIMI_SHARE_DIR ? [] : [paths.legacy],
      },
    ];
  const legacy = {
    dataPath: paths.legacy,
    collectionMethod: "kimi_legacy_wire_jsonl",
    supportedSurface: "cli",
  };
  return (await findFile(legacy.dataPath, (name) => name === "wire.jsonl"))
    ? [{ ...legacy, suggestedLabel: "Kimi Code (legacy)" }]
    : [];
}

export const kimiAdapter = Object.freeze({
  id: "kimi_code",
  displayName: "Kimi Code",
  supportedSurfaces: ["cli"],
  collectionMethods: ["kimi_wire_jsonl", "kimi_legacy_wire_jsonl"],
  collectionMethodForPath: kimiCollectionMethodForPath,
  aggregationMode: "source_sum",
  trigger: "Stop hook",
  defaultPaths: kimiDefaultPaths,
  detect: detectKimiSources,
  collect: (source, range, state) => {
    const legacy =
      source.collectionMethod === "kimi_legacy_wire_jsonl" ||
      kimiCollectionMethodForPath(source.dataPath) === "kimi_legacy_wire_jsonl";
    const stateCompatible = state?.parserVersion === kimiParserVersion;
    const decoder = legacy ? legacyRecord : currentRecord;
    const parser = (lines) =>
      parseRecords(
        lines,
        decoder,
        legacy
          ? (record) => (record?.message ?? record)?.type === "StatusUpdate"
          : (record) => record?.type === "usage.record",
      );
    return collectJsonl(
      source,
      parser,
      (path) => basename(path) === "wire.jsonl",
      stateCompatible ? state : {},
      range,
      eventKey(decoder),
    ).then((result) => {
      if (
        !stateCompatible &&
        result.completeness === "partial" &&
        Object.keys(state?.files ?? {}).length > 0
      ) {
        return {
          ...result,
          entries: previousJsonlEntries(state ?? {}),
          nextState: state ?? {},
        };
      }
      return {
        ...result,
        nextState: { ...result.nextState, parserVersion: kimiParserVersion },
      };
    });
  },
  diagnose: (source) => diagnosePath(source),
});

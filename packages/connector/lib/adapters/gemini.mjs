import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  collectJsonl,
  componentEntry,
  diagnosePath,
  findFile,
  integer,
  mergeEntries,
  parserResult,
  utcDay,
} from "./shared.mjs";

const geminiParserVersion = 5;
const geminiUsageContainerKeys = ["usageMetadata", "usage", "tokenUsage", "tokens"];

function hasGeminiUsageContainer(record) {
  return (
    record !== null &&
    typeof record === "object" &&
    geminiUsageContainerKeys.some((key) => Object.hasOwn(record, key))
  );
}

function analyzeGeminiRecords(records, malformedJsonRecords = 0) {
  const seen = new Set();
  const entries = [];
  let candidateRecords = malformedJsonRecords;
  let parsedRecords = 0;
  let unsupportedCandidates = malformedJsonRecords;
  for (const record of records) {
    const usage = record?.usageMetadata ?? record?.usage ?? record?.tokenUsage ?? record?.tokens;
    if (record?.type !== "gemini" && !hasGeminiUsageContainer(record)) continue;
    candidateRecords += 1;
    const id = record?.id ?? record?.messageId ?? record?.event_id;
    const day = utcDay(record?.timestamp ?? record?.time ?? record?.startTime);
    if (
      record?.type !== "gemini" ||
      !usage ||
      typeof id !== "string" ||
      id.length < 1 ||
      id.length > 256 ||
      day === null
    ) {
      unsupportedCandidates += 1;
      continue;
    }
    const input = integer(
      usage.input ?? usage.promptTokenCount ?? usage.inputTokens ?? usage.input_token_count,
    );
    const output =
      usage.output ?? usage.candidatesTokenCount ?? usage.outputTokens ?? usage.output_token_count;
    const cached = integer(
      usage.cached ??
        usage.cachedContentTokenCount ??
        usage.cacheReadTokens ??
        usage.cache_read_token_count ??
        0,
    );
    const entry =
      input === null || cached === null || output === undefined
        ? null
        : componentEntry(
            day,
            {
              inputTokens: input >= cached ? input - cached : input,
              outputTokens: output,
              cacheReadTokens: cached,
              cacheWriteTokens: usage.cacheWriteTokens ?? usage.cache_write_token_count,
              reasoningTokens:
                usage.thoughts ??
                usage.thoughtsTokenCount ??
                usage.thoughtTokens ??
                usage.thought_token_count,
            },
            usage.total ?? usage.totalTokenCount ?? usage.totalTokens ?? usage.total_token_count,
          );
    if (entry === null) {
      unsupportedCandidates += 1;
      continue;
    }
    parsedRecords += 1;
    if (seen.has(id)) continue;
    seen.add(id);
    entries.push(entry);
  }
  return parserResult(
    mergeEntries(entries),
    candidateRecords,
    parsedRecords,
    unsupportedCandidates,
  );
}

export function parseGeminiRecords(records) {
  return analyzeGeminiRecords(records).entries;
}

function parseGeminiLines(lines) {
  const records = [];
  let malformedJsonRecords = 0;
  for (const line of lines) {
    try {
      records.push(JSON.parse(line));
    } catch {
      malformedJsonRecords += 1;
    }
  }
  return analyzeGeminiRecords(records, malformedJsonRecords);
}

function geminiEventKey(line, context = {}) {
  try {
    const record = JSON.parse(line);
    const id = record?.id ?? record?.messageId ?? record?.event_id;
    const date = utcDay(record?.timestamp ?? record?.time ?? record?.startTime);
    const usage = record?.usageMetadata ?? record?.usage ?? record?.tokenUsage ?? record?.tokens;
    if (record?.type !== "gemini" || !usage || !date) return null;
    if (id !== undefined && id !== null) {
      const entry = parseGeminiLines([line]).entries[0];
      return typeof id === "string" && id.length >= 1 && id.length <= 256 && entry
        ? { id, date, entry }
        : null;
    }
    if (!context.path) return null;
    const syntheticId = "fallback-event";
    const entry = analyzeGeminiRecords([{ ...record, id: syntheticId }]).entries[0];
    if (!entry) return null;
    const identity = JSON.stringify([
      "gemini-session-event-v2",
      basename(context.path),
      record?.timestamp ?? record?.time ?? record?.startTime,
      entry.totalTokens,
      entry.inputTokens,
      entry.outputTokens,
      entry.cacheReadTokens,
      entry.cacheWriteTokens,
      entry.reasoningTokens,
    ]);
    return { id: createHash("sha256").update(identity).digest("hex"), date, entry };
  } catch {
    return null;
  }
}

export function geminiSourcePath(environment = process.env, home = homedir()) {
  const geminiHome = environment.GEMINI_CLI_HOME ? resolve(environment.GEMINI_CLI_HOME) : home;
  return join(geminiHome, ".gemini", "tmp");
}

export async function detectGeminiSources({ environment = process.env, home = homedir() } = {}) {
  const dataPath = geminiSourcePath(environment, home);
  return (await findFile(
    dataPath,
    (name) => name.startsWith("session-") && name.endsWith(".jsonl"),
  ))
    ? [
        {
          dataPath,
          collectionMethod: "gemini_session_json",
          supportedSurface: "cli",
          suggestedLabel: "Gemini CLI",
        },
      ]
    : [];
}

const defaultPath = geminiSourcePath();
export const geminiAdapter = Object.freeze({
  id: "gemini_cli",
  displayName: "Gemini CLI",
  supportedSurfaces: ["cli"],
  collectionMethods: ["gemini_session_json"],
  aggregationMode: "source_sum",
  accountSwitchMode: "combined_local_history",
  trigger: "SessionEnd hook",
  defaultPaths: [defaultPath],
  detect: detectGeminiSources,
  collect: async (source, range, state = {}) => {
    const result = await collectJsonl(
      source,
      parseGeminiLines,
      (path) => basename(path).startsWith("session-"),
      state,
      range,
      geminiEventKey,
      geminiParserVersion,
    );
    return {
      ...result,
      nextState: { ...result.nextState, parserVersion: geminiParserVersion },
    };
  },
  diagnose: (source) => diagnosePath(source),
});

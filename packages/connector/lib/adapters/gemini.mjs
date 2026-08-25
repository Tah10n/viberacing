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
  previousJsonlEntries,
  utcDay,
} from "./shared.mjs";

const geminiParserVersion = 1;

function analyzeGeminiRecords(records, malformedJsonRecords = 0) {
  const seen = new Set();
  const entries = [];
  let candidateRecords = malformedJsonRecords;
  let parsedRecords = 0;
  let unsupportedCandidates = malformedJsonRecords;
  for (const record of records) {
    if (record?.type !== "gemini") continue;
    candidateRecords += 1;
    const usage = record?.usageMetadata ?? record?.usage ?? record?.tokenUsage ?? record?.tokens;
    const id = record?.id ?? record?.messageId ?? record?.event_id;
    const day = utcDay(record?.timestamp ?? record?.time ?? record?.startTime);
    if (!usage || typeof id !== "string" || id.length < 1 || id.length > 256 || day === null) {
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

function geminiEventKey(line) {
  try {
    const record = JSON.parse(line);
    const id = record?.id ?? record?.messageId ?? record?.event_id;
    const date = utcDay(record?.timestamp ?? record?.time ?? record?.startTime);
    const usage = record?.usageMetadata ?? record?.usage ?? record?.tokenUsage ?? record?.tokens;
    return record?.type === "gemini" && usage && typeof id === "string" && date
      ? { id, date }
      : null;
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
  trigger: "SessionEnd hook",
  defaultPaths: [defaultPath],
  detect: detectGeminiSources,
  collect: async (source, range, state = {}) => {
    const stateCompatible = state.parserVersion === geminiParserVersion;
    const result = await collectJsonl(
      source,
      parseGeminiLines,
      (path) => basename(path).startsWith("session-"),
      stateCompatible ? state : {},
      range,
      geminiEventKey,
    );
    if (
      !stateCompatible &&
      result.completeness === "partial" &&
      Object.keys(state.files ?? {}).length > 0
    ) {
      return {
        ...result,
        entries: previousJsonlEntries(state),
        nextState: state,
      };
    }
    return {
      ...result,
      nextState: { ...result.nextState, parserVersion: geminiParserVersion },
    };
  },
  diagnose: (source) => diagnosePath(source),
});

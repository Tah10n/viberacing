import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { componentEntry, diagnosePath, integer, mergeEntries, utcDay, walk } from "./shared.mjs";

export function parseGeminiRecords(records) {
  const seen = new Set();
  const entries = [];
  for (const record of records) {
    if (record?.type !== "gemini") continue;
    const usage = record?.usageMetadata ?? record?.usage ?? record?.tokenUsage ?? record?.tokens;
    const id = record?.id ?? record?.messageId ?? record?.event_id;
    const day = utcDay(record?.timestamp ?? record?.time ?? record?.startTime);
    if (!usage || !id || seen.has(id) || day === null) continue;
    const input = integer(
      usage.input ?? usage.promptTokenCount ?? usage.inputTokens ?? usage.input_token_count,
    );
    const cached = integer(
      usage.cached ??
        usage.cachedContentTokenCount ??
        usage.cacheReadTokens ??
        usage.cache_read_token_count ??
        0,
    );
    if (input === null || cached === null) continue;
    seen.add(id);
    entries.push(
      componentEntry(
        day,
        {
          inputTokens: input >= cached ? input - cached : input,
          outputTokens:
            usage.output ??
            usage.candidatesTokenCount ??
            usage.outputTokens ??
            usage.output_token_count,
          cacheReadTokens: cached,
          cacheWriteTokens: usage.cacheWriteTokens ?? usage.cache_write_token_count,
          reasoningTokens:
            usage.thoughts ??
            usage.thoughtsTokenCount ??
            usage.thoughtTokens ??
            usage.thought_token_count,
        },
        usage.total ?? usage.totalTokenCount ?? usage.totalTokens ?? usage.total_token_count,
      ),
    );
  }
  return mergeEntries(entries);
}

async function collect(source, _range, state = {}) {
  const discovered = await walk(source.dataPath, [".json", ".jsonl"]);
  const records = [];
  let partial = discovered.incomplete;
  for (const file of discovered.files) {
    try {
      const text = await readFile(file.path, "utf8");
      if (file.path.endsWith(".jsonl"))
        for (const line of text.split(/\r?\n/))
          try {
            records.push(JSON.parse(line));
          } catch {}
      else {
        const value = JSON.parse(text);
        if (Array.isArray(value)) records.push(...value);
        else {
          records.push(value);
          for (const key of ["messages", "events", "history"])
            if (Array.isArray(value?.[key])) records.push(...value[key]);
        }
      }
    } catch {
      partial = true;
    }
  }
  return {
    entries: parseGeminiRecords(records),
    completeness: partial ? "partial" : "complete",
    nextState: state,
    warnings: partial ? ["unreadable_session_file"] : [],
  };
}

const geminiHome = process.env.GEMINI_CLI_HOME ? resolve(process.env.GEMINI_CLI_HOME) : homedir();
const defaultPath = join(geminiHome, ".gemini", "tmp");
export const geminiAdapter = Object.freeze({
  id: "gemini_cli",
  displayName: "Gemini CLI",
  supportedSurfaces: ["cli"],
  collectionMethods: ["gemini_session_json"],
  aggregationMode: "source_sum",
  trigger: "SessionEnd hook",
  defaultPaths: [defaultPath],
  detect: async () =>
    (
      await diagnosePath({
        dataPath: defaultPath,
        collectionMethod: "gemini_session_json",
        supportedSurface: "cli",
      })
    ).dataLocationAvailable
      ? [
          {
            dataPath: defaultPath,
            collectionMethod: "gemini_session_json",
            supportedSurface: "cli",
            suggestedLabel: "Gemini CLI",
          },
        ]
      : [],
  collect,
  diagnose: (source) => diagnosePath(source),
});

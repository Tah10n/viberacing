import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { collectJsonl, componentEntry, diagnosePath, mergeEntries, utcDay } from "./shared.mjs";

export function parseKimiLines(lines) {
  const seen = new Set();
  const entries = [];
  for (const line of lines) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = record?.payload ?? record;
    const usage = payload?.usage ?? payload?.token_usage ?? payload?.tokenUsage;
    if (
      record?.type &&
      record.type !== "usage.record" &&
      !payload?.token_usage &&
      !payload?.tokenUsage
    )
      continue;
    const id = record?.id ?? payload?.id ?? payload?.message_id ?? payload?.messageId ?? line;
    const day = utcDay(record?.timestamp ?? payload?.timestamp ?? record?.time);
    if (!usage || !id || seen.has(id) || day === null) continue;
    seen.add(id);
    entries.push(
      componentEntry(
        day,
        {
          inputTokens: usage.inputOther ?? usage.input_other ?? usage.input_tokens,
          outputTokens: usage.output ?? usage.output_tokens,
          cacheReadTokens:
            usage.inputCacheRead ?? usage.input_cache_read ?? usage.cache_read_input_tokens,
          cacheWriteTokens:
            usage.inputCacheCreation ??
            usage.input_cache_creation ??
            usage.cache_creation_input_tokens,
          reasoningTokens: usage.reasoning ?? usage.thoughts_tokens,
        },
        usage.total ?? usage.total_tokens,
      ),
    );
  }
  return mergeEntries(entries);
}

const kimiRoot = process.env.KIMI_CODE_HOME
  ? resolve(process.env.KIMI_CODE_HOME)
  : join(homedir(), ".kimi-code");
const defaultPath = join(kimiRoot, "sessions");
export const kimiAdapter = Object.freeze({
  id: "kimi_code",
  displayName: "Kimi Code",
  supportedSurfaces: ["cli"],
  collectionMethods: ["kimi_wire_jsonl"],
  aggregationMode: "source_sum",
  trigger: "manual sync",
  defaultPaths: [defaultPath],
  detect: async () =>
    (
      await diagnosePath({
        dataPath: defaultPath,
        collectionMethod: "kimi_wire_jsonl",
        supportedSurface: "cli",
      })
    ).dataLocationAvailable
      ? [
          {
            dataPath: defaultPath,
            collectionMethod: "kimi_wire_jsonl",
            supportedSurface: "cli",
            suggestedLabel: "Kimi Code",
          },
        ]
      : [],
  collect: (source, _range, state) =>
    collectJsonl(source, parseKimiLines, (path) => basename(path) === "wire.jsonl", state),
  diagnose: (source) => diagnosePath(source),
});

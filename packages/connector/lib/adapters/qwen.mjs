import { homedir } from "node:os";
import { basename, join } from "node:path";
import { resolve } from "node:path";
import {
  collectJsonl,
  componentEntry,
  diagnosePath,
  integer,
  mergeEntries,
  utcDay,
} from "./shared.mjs";

export function parseQwenLines(lines) {
  const seen = new Set();
  const entries = [];
  for (const line of lines) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record?.schemaVersion !== 1 || !record.id || seen.has(record.id)) continue;
    const day = utcDay(record.timestamp);
    const input = integer(record.inputTokens);
    const cached = integer(record.cachedTokens ?? 0);
    if (day === null || input === null || cached === null) continue;
    seen.add(record.id);
    entries.push(
      componentEntry(
        day,
        {
          inputTokens: input >= cached ? input - cached : input,
          outputTokens: record.outputTokens,
          cacheReadTokens: cached,
          cacheWriteTokens: 0,
          reasoningTokens: record.thoughtsTokens,
        },
        record.totalTokens,
      ),
    );
  }
  return mergeEntries(entries);
}

function qwenEventKey(line) {
  try {
    const record = JSON.parse(line);
    const date = utcDay(record?.timestamp);
    return record?.schemaVersion === 1 && typeof record?.id === "string" && date
      ? { id: record.id, date }
      : null;
  } catch {
    return null;
  }
}

function resolvedRoot(value) {
  if (value === "~") return homedir();
  if (/^~[\\/]/.test(value ?? "")) return join(homedir(), value.slice(2));
  return resolve(value);
}

const runtimeRoot = process.env.QWEN_RUNTIME_DIR
  ? resolvedRoot(process.env.QWEN_RUNTIME_DIR)
  : process.env.QWEN_HOME
    ? resolvedRoot(process.env.QWEN_HOME)
    : join(homedir(), ".qwen");
const defaultPaths = [join(runtimeRoot, "usage")];
export const qwenAdapter = Object.freeze({
  id: "qwen_code",
  displayName: "Qwen Code",
  supportedSurfaces: ["cli"],
  collectionMethods: ["qwen_stats_jsonl"],
  aggregationMode: "source_sum",
  trigger: "usage stats file",
  defaultPaths,
  detect: async () => {
    const result = [];
    for (const dataPath of defaultPaths)
      if (
        (
          await diagnosePath({
            dataPath,
            collectionMethod: "qwen_stats_jsonl",
            supportedSurface: "cli",
          })
        ).dataLocationAvailable
      )
        result.push({
          dataPath,
          collectionMethod: "qwen_stats_jsonl",
          supportedSurface: "cli",
          suggestedLabel: "Qwen Code",
        });
    return result;
  },
  collect: (source, range, state) =>
    collectJsonl(
      source,
      parseQwenLines,
      (path) => basename(path).startsWith("token-usage-"),
      state,
      range,
      qwenEventKey,
    ),
  diagnose: (source) => diagnosePath(source),
});

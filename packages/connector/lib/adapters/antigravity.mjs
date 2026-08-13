import { homedir } from "node:os";
import { join } from "node:path";
import {
  collectJsonl,
  componentEntry,
  dayPattern,
  diagnosePath,
  mergeEntries,
  utcDay,
} from "./shared.mjs";

export function parseAntigravityLines(lines) {
  const seen = new Set();
  const entries = [];
  for (const line of lines)
    try {
      const record = JSON.parse(line);
      const usage = record?.usage ?? record?.result?.usage;
      const id = record?.id ?? record?.session_id;
      if (!usage || !id || seen.has(id)) continue;
      seen.add(id);
      const date = dayPattern.test(record.date ?? "")
        ? record.date
        : utcDay(record.timestamp ?? record.time ?? Date.now());
      if (date === null) continue;
      const entry = componentEntry(
        date,
        {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          cacheReadTokens: usage.cache_read_tokens,
          cacheWriteTokens: usage.cache_write_tokens,
          reasoningTokens: usage.reasoning_tokens ?? usage.thinking_tokens,
        },
        usage.total_tokens,
      );
      if (entry) entries.push(entry);
    } catch {}
  return mergeEntries(entries);
}

const defaultPath = join(homedir(), ".viberacing", "captures", "antigravity.jsonl");
export const antigravityAdapter = Object.freeze({
  id: "antigravity",
  displayName: "Antigravity CLI",
  supportedSurfaces: ["cli"],
  collectionMethods: ["antigravity_cli_capture"],
  aggregationMode: "source_sum",
  trigger: "viberacing run antigravity",
  defaultPaths: [defaultPath],
  detect: async () =>
    (
      await diagnosePath(
        {
          dataPath: defaultPath,
          collectionMethod: "antigravity_cli_capture",
          supportedSurface: "cli",
        },
        ["Antigravity Desktop usage"],
      )
    ).dataLocationAvailable
      ? [
          {
            dataPath: defaultPath,
            collectionMethod: "antigravity_cli_capture",
            supportedSurface: "cli",
            suggestedLabel: "Antigravity CLI",
          },
        ]
      : [],
  collect: (source, _range, state) =>
    collectJsonl(source, parseAntigravityLines, () => true, state),
  parseCapture: parseAntigravityLines,
  diagnose: (source) => diagnosePath(source, ["Antigravity Desktop usage"]),
});

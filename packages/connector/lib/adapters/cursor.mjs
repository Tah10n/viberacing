import { join } from "node:path";
import { stateDirectory } from "../config.mjs";
import {
  collectJsonl,
  componentEntry,
  dayPattern,
  diagnosePath,
  mergeEntries,
  utcDay,
} from "./shared.mjs";

export function parseCursorLines(lines) {
  const seen = new Set();
  const entries = [];
  for (const line of lines)
    try {
      const record = JSON.parse(line);
      const usage = record?.usage ?? record?.result?.usage;
      const id = record?.id ?? record?.sessionId ?? record?.session_id;
      if (!usage || !id || seen.has(id)) continue;
      seen.add(id);
      const date = dayPattern.test(record.date ?? "")
        ? record.date
        : utcDay(record.timestamp ?? record.time ?? Date.now());
      if (date === null) continue;
      const entry = componentEntry(
        date,
        {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheWriteTokens: usage.cacheWriteTokens,
          reasoningTokens: usage.reasoningTokens,
        },
        usage.totalTokens,
      );
      if (entry) entries.push(entry);
    } catch {}
  return mergeEntries(entries);
}

function captureEventKey(line) {
  try {
    const record = JSON.parse(line);
    return record?.usage && typeof record?.id === "string" && dayPattern.test(record?.date ?? "")
      ? { id: record.id, date: record.date }
      : null;
  } catch {
    return null;
  }
}

const defaultPath = join(stateDirectory, "captures", "cursor.jsonl");
export const cursorAdapter = Object.freeze({
  id: "cursor",
  displayName: "Cursor CLI",
  supportedSurfaces: ["cli"],
  collectionMethods: ["cursor_cli_capture"],
  aggregationMode: "source_sum",
  trigger: "viberacing run cursor",
  defaultPaths: [defaultPath],
  detect: async () =>
    (
      await diagnosePath(
        { dataPath: defaultPath, collectionMethod: "cursor_cli_capture", supportedSurface: "cli" },
        ["Cursor Desktop usage"],
      )
    ).dataLocationAvailable
      ? [
          {
            dataPath: defaultPath,
            collectionMethod: "cursor_cli_capture",
            supportedSurface: "cli",
            suggestedLabel: "Cursor CLI",
          },
        ]
      : [],
  collect: (source, range, state) =>
    collectJsonl(source, parseCursorLines, () => true, state, range, captureEventKey),
  parseCapture: parseCursorLines,
  diagnose: (source) => diagnosePath(source, ["Cursor Desktop usage"]),
});

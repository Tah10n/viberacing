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
    const message = record?.message;
    const payload = message?.payload;
    const usage = payload?.token_usage;
    const id = payload?.message_id;
    const timestamp = record?.timestamp;
    const day =
      typeof timestamp === "number" && Number.isFinite(timestamp)
        ? utcDay(timestamp * 1_000)
        : null;
    if (
      message?.type !== "StatusUpdate" ||
      !usage ||
      typeof id !== "string" ||
      id.length === 0 ||
      id.length > 256 ||
      seen.has(id) ||
      day === null
    )
      continue;
    seen.add(id);
    entries.push(
      componentEntry(day, {
        inputTokens: usage.input_other,
        outputTokens: usage.output,
        cacheReadTokens: usage.input_cache_read,
        cacheWriteTokens: usage.input_cache_creation,
        reasoningTokens: 0,
      }),
    );
  }
  return mergeEntries(entries);
}

function kimiEventKey(line) {
  try {
    const record = JSON.parse(line);
    const timestamp = record?.timestamp;
    const date =
      typeof timestamp === "number" && Number.isFinite(timestamp)
        ? utcDay(timestamp * 1_000)
        : null;
    const id = record?.message?.payload?.message_id;
    return record?.message?.type === "StatusUpdate" &&
      record?.message?.payload?.token_usage &&
      typeof id === "string" &&
      date
      ? { id, date }
      : null;
  } catch {
    return null;
  }
}

const kimiRoot = process.env.KIMI_SHARE_DIR
  ? resolve(process.env.KIMI_SHARE_DIR)
  : join(homedir(), ".kimi");
const defaultPath = join(kimiRoot, "sessions");
export const kimiAdapter = Object.freeze({
  id: "kimi_code",
  displayName: "Kimi Code",
  supportedSurfaces: ["cli"],
  collectionMethods: ["kimi_wire_jsonl"],
  aggregationMode: "source_sum",
  trigger: "Stop hook",
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
  collect: (source, range, state) =>
    collectJsonl(
      source,
      parseKimiLines,
      (path) => basename(path) === "wire.jsonl",
      state,
      range,
      kimiEventKey,
    ),
  diagnose: (source) => diagnosePath(source),
});

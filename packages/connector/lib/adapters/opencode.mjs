import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { componentEntry, diagnosePath, mergeEntries, utcDay } from "./shared.mjs";

export function parseOpenCodeMessages(rows) {
  const seen = new Set();
  const entries = [];
  for (const row of rows) {
    let message;
    try {
      message = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
    } catch {
      continue;
    }
    if (message?.role !== "assistant" || seen.has(row.id)) continue;
    const day = utcDay(message?.time?.created ?? row.time_created);
    const usage = message?.tokens;
    if (day === null || !usage) continue;
    seen.add(row.id);
    entries.push(
      componentEntry(
        day,
        {
          inputTokens: usage.input,
          outputTokens: usage.output,
          cacheReadTokens: usage.cache?.read,
          cacheWriteTokens: usage.cache?.write,
          reasoningTokens: usage.reasoning,
        },
        usage.total,
      ),
    );
  }
  return mergeEntries(entries);
}

async function collect(source, _range, state = {}) {
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(source.dataPath, { readOnly: true });
  try {
    const rows = database
      .prepare("SELECT id, time_created, data FROM message ORDER BY time_created")
      .all();
    return {
      entries: parseOpenCodeMessages(rows),
      completeness: "complete",
      nextState: state,
      warnings: [],
    };
  } finally {
    database.close();
  }
}

const openCodeData = join(
  process.env.XDG_DATA_HOME
    ? resolve(process.env.XDG_DATA_HOME)
    : join(homedir(), ".local", "share"),
  "opencode",
);
const configuredDatabase = process.env.OPENCODE_DB
  ? isAbsolute(process.env.OPENCODE_DB)
    ? process.env.OPENCODE_DB
    : join(openCodeData, process.env.OPENCODE_DB)
  : null;
const defaultPaths = [
  ...(configuredDatabase ? [configuredDatabase] : []),
  join(openCodeData, "opencode.db"),
  join(openCodeData, "opencode-prod.db"),
].filter((path, index, values) => values.indexOf(path) === index);
export const openCodeAdapter = Object.freeze({
  id: "opencode",
  displayName: "OpenCode",
  supportedSurfaces: ["cli"],
  collectionMethods: ["opencode_sqlite"],
  aggregationMode: "source_sum",
  trigger: "manual sync",
  defaultPaths,
  detect: async () => {
    const result = [];
    for (const dataPath of defaultPaths)
      if (
        (
          await diagnosePath({
            dataPath,
            collectionMethod: "opencode_sqlite",
            supportedSurface: "cli",
          })
        ).dataLocationAvailable
      )
        result.push({
          dataPath,
          collectionMethod: "opencode_sqlite",
          supportedSurface: "cli",
          suggestedLabel: "OpenCode",
        });
    return result;
  },
  collect,
  diagnose: (source) => diagnosePath(source),
});

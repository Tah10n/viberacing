import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { componentEntry, diagnosePath, jsonLines, mergeEntries, utcDay, walk } from "./shared.mjs";

function contribution(line) {
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    return null;
  }
  const id = record?.message?.id;
  const usage = record?.message?.usage;
  const day = utcDay(record?.timestamp);
  if (
    record?.type !== "assistant" ||
    record?.message?.role !== "assistant" ||
    typeof id !== "string" ||
    !usage ||
    day === null
  )
    return null;
  const entry = componentEntry(day, {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens,
    cacheWriteTokens: usage.cache_creation_input_tokens,
    reasoningTokens: usage.reasoning_tokens,
  });
  return entry && { id, entry };
}

export function parseClaudeLines(lines) {
  const messages = new Map();
  for (const line of lines) {
    const value = contribution(line);
    if (value && !messages.has(value.id)) messages.set(value.id, value.entry);
  }
  return mergeEntries([...messages.values()]);
}

async function collect(source, range, state = {}) {
  const discovered = await walk(source.dataPath, [".jsonl"], 10_000);
  const nextState = { files: { ...(state.files ?? {}) }, messages: { ...(state.messages ?? {}) } };
  let partial = discovered.incomplete;
  for (const file of discovered.files) {
    const previous = nextState.files[file.path];
    let offset = previous?.size ?? 0;
    if (offset > file.size) {
      for (const id of previous?.ids ?? []) delete nextState.messages[id];
      offset = 0;
    }
    const ids = offset === 0 ? [] : [...(previous?.ids ?? [])];
    try {
      for (const line of await jsonLines(file.path, offset)) {
        const value = contribution(line);
        if (value) {
          nextState.messages[value.id] = value.entry;
          ids.push(value.id);
        }
      }
      nextState.files[file.path] = { size: file.size, ids };
    } catch {
      partial = true;
    }
  }
  const activeFiles = new Set(discovered.files.map((file) => file.path));
  for (const [path, fileState] of Object.entries(nextState.files)) {
    if (!activeFiles.has(path)) {
      for (const id of fileState.ids ?? []) delete nextState.messages[id];
      delete nextState.files[path];
    }
  }
  for (const [id, entry] of Object.entries(nextState.messages))
    if (entry.date < range.rangeStart || entry.date > range.rangeEnd) delete nextState.messages[id];
  return {
    entries: mergeEntries(Object.values(nextState.messages)),
    completeness: partial ? "partial" : "complete",
    nextState,
    warnings: partial ? ["unreadable_or_unbounded_session_data"] : [],
  };
}

const claudeRoot = process.env.CLAUDE_CONFIG_DIR
  ? resolve(process.env.CLAUDE_CONFIG_DIR)
  : join(homedir(), ".claude");
const defaultPath = join(claudeRoot, "projects");
export const claudeAdapter = Object.freeze({
  id: "claude_code",
  displayName: "Claude Code",
  supportedSurfaces: ["cli"],
  collectionMethods: ["claude_jsonl"],
  aggregationMode: "source_sum",
  trigger: "Stop hook",
  defaultPaths: [defaultPath],
  detect: async () =>
    (
      await diagnosePath({
        dataPath: defaultPath,
        collectionMethod: "claude_jsonl",
        supportedSurface: "cli",
      })
    ).dataLocationAvailable
      ? [
          {
            dataPath: defaultPath,
            collectionMethod: "claude_jsonl",
            supportedSurface: "cli",
            suggestedLabel: "Claude Code",
          },
        ]
      : [],
  collect,
  diagnose: (source) => diagnosePath(source),
});

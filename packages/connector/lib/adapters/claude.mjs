import { join, resolve } from "node:path";
import { homedir } from "node:os";
import {
  componentEntry,
  diagnosePath,
  findFile,
  jsonLinesChunk,
  mergeEntries,
  tailFingerprint,
  utcDay,
  walk,
} from "./shared.mjs";

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

export async function collectClaude(
  source,
  range,
  state = {},
  { maximumBytes = 100_000_000, readChunk = jsonLinesChunk, fingerprint = tailFingerprint } = {},
) {
  const discovered = await walk(source.dataPath, [".jsonl"], 10_000);
  const nextState = {
    files: { ...(state.files ?? {}) },
    messages: Object.assign(Object.create(null), state.messages ?? {}),
  };
  let partial = discovered.incomplete;
  let bytes = 0;
  for (const file of discovered.files) {
    if (bytes + file.size > maximumBytes) {
      partial = true;
      continue;
    }
    bytes += file.size;
    const previous = nextState.files[file.path];
    if (
      previous &&
      previous.size === file.size &&
      previous.modifiedAt === file.modifiedAt &&
      (previous.ino === undefined || previous.ino === file.ino)
    )
      continue;
    let appended =
      previous &&
      previous.size <= file.size &&
      (previous.ino === undefined || previous.ino === file.ino);
    if (appended && previous.tailFingerprint !== undefined) {
      try {
        appended =
          previous.tailFingerprint ===
          (await fingerprint(file.path, previous.safeOffset ?? previous.size));
      } catch {
        appended = false;
      }
    }
    const offset = appended ? (previous.safeOffset ?? previous.size) : 0;
    const ids = appended ? new Set(previous?.ids ?? []) : new Set();
    try {
      const chunk = await readChunk(file.path, offset, file.size);
      if (chunk.oversizedLines > 0) partial = true;
      const messages = Object.create(null);
      for (const line of chunk.lines) {
        const value = contribution(line);
        if (value && !ids.has(value.id)) {
          messages[value.id] = value.entry;
          ids.add(value.id);
        }
      }
      const fileState = {
        size: file.size,
        modifiedAt: file.modifiedAt,
        ino: file.ino,
        safeOffset: chunk.safeOffset,
        tailFingerprint: await fingerprint(file.path, chunk.safeOffset),
        ids: [...ids],
      };
      if (!appended) for (const id of previous?.ids ?? []) delete nextState.messages[id];
      Object.assign(nextState.messages, messages);
      nextState.files[file.path] = fileState;
    } catch {
      partial = true;
    }
  }
  const activeFiles = new Set(discovered.files.map((file) => file.path));
  for (const [path, fileState] of Object.entries(nextState.files)) {
    if (partial) break;
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

export function claudeSourcePath(environment = process.env, home = homedir()) {
  const root = environment.CLAUDE_CONFIG_DIR
    ? resolve(environment.CLAUDE_CONFIG_DIR)
    : join(home, ".claude");
  return join(root, "projects");
}

export async function detectClaudeSources({ environment = process.env, home = homedir() } = {}) {
  const dataPath = claudeSourcePath(environment, home);
  return (await findFile(dataPath, (name) => name.endsWith(".jsonl")))
    ? [
        {
          dataPath,
          collectionMethod: "claude_jsonl",
          supportedSurface: "cli",
          suggestedLabel: "Claude Code",
        },
      ]
    : [];
}

const defaultPath = claudeSourcePath();
export const claudeAdapter = Object.freeze({
  id: "claude_code",
  displayName: "Claude Code",
  supportedSurfaces: ["cli"],
  collectionMethods: ["claude_jsonl"],
  aggregationMode: "source_sum",
  trigger: "Stop hook",
  defaultPaths: [defaultPath],
  detect: detectClaudeSources,
  collect: collectClaude,
  diagnose: (source) => diagnosePath(source),
});

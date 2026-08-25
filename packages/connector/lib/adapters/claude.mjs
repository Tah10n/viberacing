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

const claudeParserVersion = 1;

function classifiedContribution(line) {
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    return { kind: "unsupported" };
  }
  const id = record?.message?.id;
  const usage = record?.message?.usage;
  if (record?.type !== "assistant")
    return record?.message?.role === "assistant" || usage !== undefined
      ? { kind: "unsupported" }
      : { kind: "irrelevant" };
  const day = utcDay(record?.timestamp);
  if (
    record?.message?.role !== "assistant" ||
    typeof id !== "string" ||
    id.length < 1 ||
    id.length > 256 ||
    !usage ||
    usage.input_tokens === undefined ||
    usage.output_tokens === undefined ||
    day === null
  )
    return { kind: "unsupported" };
  const entry = componentEntry(day, {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens,
    cacheWriteTokens: usage.cache_creation_input_tokens,
    reasoningTokens: usage.reasoning_tokens,
  });
  return entry ? { kind: "parsed", id, entry } : { kind: "unsupported" };
}

function analyzeClaudeLines(lines) {
  const records = [];
  let candidateRecords = 0;
  let parsedRecords = 0;
  let unsupportedCandidates = 0;
  for (const line of lines) {
    const value = classifiedContribution(line);
    if (value.kind === "irrelevant") continue;
    candidateRecords += 1;
    if (value.kind === "unsupported") {
      unsupportedCandidates += 1;
      continue;
    }
    parsedRecords += 1;
    records.push(value);
  }
  return { records, stats: { candidateRecords, parsedRecords, unsupportedCandidates } };
}

export function parseClaudeLines(lines) {
  const messages = new Map();
  for (const value of analyzeClaudeLines(lines).records)
    if (!messages.has(value.id)) messages.set(value.id, value.entry);
  return mergeEntries([...messages.values()]);
}

export async function collectClaude(
  source,
  range,
  state = {},
  { maximumBytes = 100_000_000, readChunk = jsonLinesChunk, fingerprint = tailFingerprint } = {},
) {
  const stateCompatible = state.parserVersion === claudeParserVersion;
  const compatibleState = stateCompatible ? state : {};
  const discovered = await walk(source.dataPath, [".jsonl"], 10_000);
  const nextState = {
    files: { ...(compatibleState.files ?? {}) },
    messages: Object.assign(Object.create(null), compatibleState.messages ?? {}),
  };
  let partial = discovered.incomplete;
  let schemaUnsupported = false;
  let unreadable = discovered.issues.some((issue) => issue.reason === "unreadable");
  let limited = discovered.issues.some((issue) => ["limit", "oversized"].includes(issue.reason));
  const provisionalMessages = Object.create(null);
  let bytes = 0;
  for (const file of discovered.files) {
    if (bytes + file.size > maximumBytes) {
      partial = true;
      limited = true;
      continue;
    }
    bytes += file.size;
    const previous = nextState.files[file.path];
    if (
      previous &&
      previous.size === file.size &&
      previous.modifiedAt === file.modifiedAt &&
      previous.safeOffset === file.size &&
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
      const hasUnterminatedTail = (chunk.tailBytes ?? 0) > 0;
      if (hasUnterminatedTail) partial = true;
      if (chunk.oversizedLines > 0) {
        partial = true;
        limited = true;
      }
      const provisionalLines =
        hasUnterminatedTail && chunk.tail?.trim() ? [...chunk.lines, chunk.tail] : chunk.lines;
      const analysis = analyzeClaudeLines(provisionalLines);
      if (analysis.stats.unsupportedCandidates > 0) {
        partial = true;
        schemaUnsupported = true;
        continue;
      }
      if (hasUnterminatedTail) {
        if (!previous || appended)
          for (const value of analysis.records)
            if (!ids.has(value.id)) provisionalMessages[value.id] = value.entry;
        continue;
      }
      const messages = Object.create(null);
      for (const value of analysis.records) {
        if (!ids.has(value.id)) {
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
      unreadable = true;
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
  if (!stateCompatible && partial && Object.keys(state.files ?? {}).length > 0) {
    const previousMessages = Object.values(state.messages ?? {}).filter(
      (entry) => entry.date >= range.rangeStart && entry.date <= range.rangeEnd,
    );
    return {
      entries: mergeEntries(previousMessages),
      completeness: "partial",
      nextState: state,
      warnings: ["unreadable_or_unbounded_session_data"],
      diagnostics: [
        ...(unreadable ? [{ code: "local_store_unreadable", phase: "collect" }] : []),
        ...(limited ? [{ code: "local_store_scan_limit", phase: "collect" }] : []),
        ...(schemaUnsupported
          ? [{ code: "local_store_schema_unsupported", phase: "collect" }]
          : []),
      ],
    };
  }
  return {
    entries: mergeEntries([
      ...Object.values(nextState.messages),
      ...Object.values(provisionalMessages),
    ]),
    completeness: partial ? "partial" : "complete",
    nextState: { ...nextState, parserVersion: claudeParserVersion },
    warnings: [
      ...(partial ? ["unreadable_or_unbounded_session_data"] : []),
      ...(schemaUnsupported ? ["unsupported_usage_records"] : []),
    ],
    diagnostics: [
      ...(unreadable ? [{ code: "local_store_unreadable", phase: "collect" }] : []),
      ...(limited ? [{ code: "local_store_scan_limit", phase: "collect" }] : []),
      ...(schemaUnsupported ? [{ code: "local_store_schema_unsupported", phase: "collect" }] : []),
    ],
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

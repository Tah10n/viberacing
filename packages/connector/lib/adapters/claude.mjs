import { createHash } from "node:crypto";
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
  validateObservedEventLedger,
  walk,
} from "./shared.mjs";

const claudeParserVersion = 2;

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
  const migratedLedger = {};
  if (state.ledger !== undefined) {
    validateObservedEventLedger(state.ledger, claudeParserVersion);
    Object.assign(migratedLedger, state.ledger);
  }
  for (const [id, entry] of Object.entries(state.messages ?? {})) {
    if (
      typeof id !== "string" ||
      !entry ||
      typeof entry !== "object" ||
      typeof entry.date !== "string" ||
      typeof entry.totalTokens !== "string"
    )
      throw new Error("Claude v1 message state is invalid");
    const key = createHash("sha256").update(id).digest("hex");
    const { date, ...usage } = entry;
    migratedLedger[key] = { date, usage, parserVersion: claudeParserVersion };
  }
  validateObservedEventLedger(migratedLedger, claudeParserVersion);
  for (const [key, event] of Object.entries(migratedLedger))
    if (event.date < range.rangeStart || event.date > range.rangeEnd) delete migratedLedger[key];
  let ledgerCount = validateObservedEventLedger(migratedLedger, claudeParserVersion);
  const discovered = await walk(source.dataPath, [".jsonl"], 10_000);
  const nextState = {
    files: Object.fromEntries(
      Object.entries(state.files ?? {}).map(([path, file]) => {
        const { ids: _ids, ...checkpoint } = file;
        return [path, checkpoint];
      }),
    ),
    ledger: migratedLedger,
  };
  let partial = discovered.incomplete;
  let schemaUnsupported = false;
  let identityConflict = false;
  let unreadable = discovered.issues.some((issue) => issue.reason === "unreadable");
  let limited = discovered.issues.some((issue) => ["limit", "oversized"].includes(issue.reason));
  const provisionalLedger = {};
  let ledgerBytes = Buffer.byteLength(JSON.stringify(nextState.ledger));
  const addRecord = (value, target = nextState.ledger) => {
    const key = createHash("sha256").update(value.id).digest("hex");
    const { date, ...usage } = value.entry;
    const candidate = { date, usage, parserVersion: claudeParserVersion };
    const existing = nextState.ledger[key] ?? provisionalLedger[key];
    if (existing !== undefined) {
      if (JSON.stringify(existing) !== JSON.stringify(candidate)) {
        partial = true;
        identityConflict = true;
      }
      return true;
    }
    const candidateBytes = Buffer.byteLength(JSON.stringify([key, candidate]));
    if (ledgerCount >= 65_536 || ledgerBytes + candidateBytes > 16 * 1_024 * 1_024) {
      partial = true;
      limited = true;
      return false;
    }
    target[key] = candidate;
    if (target === nextState.ledger) {
      ledgerCount += 1;
      ledgerBytes += candidateBytes;
    }
    return true;
  };
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
    try {
      const chunk = await readChunk(file.path, offset, file.size);
      const hasUnterminatedTail = (chunk.tailBytes ?? 0) > 0;
      if (hasUnterminatedTail) partial = true;
      if (chunk.oversizedLines > 0) {
        partial = true;
        limited = true;
      }
      const analysis = analyzeClaudeLines(chunk.lines);
      if (analysis.stats.unsupportedCandidates > 0) {
        partial = true;
        schemaUnsupported = true;
        continue;
      }
      if (hasUnterminatedTail) {
        for (const value of analysis.records) if (!addRecord(value)) break;
        if (chunk.tail?.trim()) {
          const tail = analyzeClaudeLines([chunk.tail]);
          if (tail.stats.unsupportedCandidates > 0) schemaUnsupported = true;
          else if (!previous || appended)
            for (const value of tail.records) addRecord(value, provisionalLedger);
        }
        continue;
      }
      let overflowed = false;
      for (const value of analysis.records)
        if (!addRecord(value)) {
          overflowed = true;
          break;
        }
      if (overflowed) {
        if (previous) nextState.files[file.path] = previous;
        continue;
      }
      const fileState = {
        size: file.size,
        modifiedAt: file.modifiedAt,
        ino: file.ino,
        safeOffset: chunk.safeOffset,
        tailFingerprint: await fingerprint(file.path, chunk.safeOffset),
      };
      nextState.files[file.path] = fileState;
    } catch {
      partial = true;
      unreadable = true;
    }
  }
  const activeFiles = new Set(discovered.files.map((file) => file.path));
  for (const path of Object.keys(nextState.files)) {
    if (partial) break;
    if (!activeFiles.has(path)) {
      delete nextState.files[path];
    }
  }
  return {
    entries: mergeEntries([
      ...Object.values(nextState.ledger).map((event) => ({ date: event.date, ...event.usage })),
      ...Object.values(provisionalLedger).map((event) => ({ date: event.date, ...event.usage })),
    ]),
    completeness: partial ? "partial" : "complete",
    nextState: { ...nextState, parserVersion: claudeParserVersion },
    warnings: [
      ...(partial ? ["unreadable_or_unbounded_session_data"] : []),
      ...(schemaUnsupported ? ["unsupported_usage_records"] : []),
      ...(identityConflict ? ["local_event_identity_conflict"] : []),
    ],
    diagnostics: [
      ...(unreadable ? [{ code: "local_store_unreadable", phase: "collect" }] : []),
      ...(limited ? [{ code: "local_store_scan_limit", phase: "collect" }] : []),
      ...(schemaUnsupported ? [{ code: "local_store_schema_unsupported", phase: "collect" }] : []),
      ...(identityConflict ? [{ code: "local_event_identity_conflict", phase: "collect" }] : []),
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
  accountSwitchMode: "combined_local_history",
  trigger: "Stop hook",
  defaultPaths: [defaultPath],
  detect: detectClaudeSources,
  collect: collectClaude,
  diagnose: (source) => diagnosePath(source),
});

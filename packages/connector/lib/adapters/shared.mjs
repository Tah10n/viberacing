import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { access, open, opendir, realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

export const dayPattern = /^\d{4}-\d{2}-\d{2}$/;

const maximumLedgerEvents = 65_536;
const maximumLedgerBytes = 16 * 1_024 * 1_024;
const ledgerHashPattern = /^[0-9a-f]{64}$/;
const ledgerUsageKeys = new Set([
  "totalTokens",
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "reasoningTokens",
]);

export function validateObservedEventLedger(ledger, parserVersion) {
  if (!ledger || typeof ledger !== "object" || Array.isArray(ledger))
    throw new Error("Observed-event ledger is invalid");
  const entries = Object.entries(ledger);
  if (
    entries.length > maximumLedgerEvents ||
    Buffer.byteLength(JSON.stringify(ledger)) > maximumLedgerBytes
  )
    throw new Error("Observed-event ledger is invalid");
  let ledgerParserVersion = parserVersion;
  for (const [key, event] of entries) {
    if (
      !ledgerHashPattern.test(key) ||
      !event ||
      typeof event !== "object" ||
      Array.isArray(event) ||
      JSON.stringify(Object.keys(event).sort()) !==
        JSON.stringify(["date", "parserVersion", "usage"]) ||
      !dayPattern.test(event.date ?? "") ||
      !Number.isInteger(event.parserVersion) ||
      event.parserVersion < 1 ||
      (ledgerParserVersion !== undefined && event.parserVersion !== ledgerParserVersion) ||
      !event.usage ||
      typeof event.usage !== "object" ||
      Array.isArray(event.usage)
    )
      throw new Error("Observed-event ledger is invalid");
    ledgerParserVersion ??= event.parserVersion;
    const usageEntries = Object.entries(event.usage);
    if (
      usageEntries.length < 1 ||
      !usageEntries.some(([name]) => name === "totalTokens") ||
      usageEntries.some(
        ([name, value]) =>
          !ledgerUsageKeys.has(name) ||
          typeof value !== "string" ||
          !/^(?:0|[1-9]\d*)$/.test(value),
      )
    )
      throw new Error("Observed-event ledger is invalid");
  }
  return entries.length;
}

function storedUsage(entry) {
  if (!entry || !dayPattern.test(entry.date ?? "") || typeof entry.totalTokens !== "string")
    return null;
  const usage = {};
  for (const key of ledgerUsageKeys) {
    if (entry[key] === undefined) continue;
    if (!/^(?:0|[1-9]\d*)$/.test(entry[key])) return null;
    usage[key] = entry[key];
  }
  return usage.totalTokens === undefined ? null : usage;
}

function observedEventKeys(event) {
  if (
    !event ||
    typeof event.id !== "string" ||
    event.id.length < 1 ||
    event.id.length > 256 ||
    (event.aliases !== undefined &&
      (!Array.isArray(event.aliases) ||
        event.aliases.length > 4 ||
        event.aliases.some(
          (alias) => typeof alias !== "string" || alias.length < 1 || alias.length > 256,
        )))
  )
    return null;
  return [event.id, ...(event.aliases ?? [])].map((id) =>
    createHash("sha256").update(id).digest("hex"),
  );
}

function validateLegacyEventDays(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Legacy observed-event index is invalid");
  const entries = Object.entries(value);
  if (
    entries.length > maximumLedgerEvents ||
    Buffer.byteLength(JSON.stringify(value)) > maximumLedgerBytes ||
    entries.some(([key, date]) => !ledgerHashPattern.test(key) || !dayPattern.test(date ?? ""))
  )
    throw new Error("Legacy observed-event index is invalid");
  return value;
}

function validateLegacyBaseline(value) {
  if (!Array.isArray(value) || value.length > 31) throw new Error("Legacy baseline is invalid");
  for (const entry of value)
    if (storedUsage(entry) === null) throw new Error("Legacy baseline is invalid");
  return value;
}

function normalizedJsonlState(state, ledgerParserVersion, range) {
  const files = {};
  const baselineEntries = [];
  const legacyEventDays = {
    ...(state.legacyEventDays === undefined ? {} : validateLegacyEventDays(state.legacyEventDays)),
  };
  if (state.legacyBaseline !== undefined)
    baselineEntries.push(...validateLegacyBaseline(state.legacyBaseline));
  for (const [path, file] of Object.entries(state.files ?? {})) {
    if (!file || typeof file !== "object" || Array.isArray(file))
      throw new Error("JSONL file state is invalid");
    const { entries = [], eventDays = {}, ...checkpoint } = file;
    if (!Array.isArray(entries)) throw new Error("Legacy JSONL file baseline is invalid");
    for (const entry of entries)
      if (storedUsage(entry) === null) throw new Error("Legacy JSONL file baseline is invalid");
    baselineEntries.push(...entries);
    for (const [key, date] of Object.entries(validateLegacyEventDays(eventDays))) {
      if (legacyEventDays[key] !== undefined && legacyEventDays[key] !== date)
        throw new Error("Legacy observed-event identity conflicts");
      legacyEventDays[key] = date;
    }
    files[path] = checkpoint;
  }
  let ledger = {};
  if (state.ledger !== undefined) {
    let compatible = true;
    try {
      validateObservedEventLedger(state.ledger, ledgerParserVersion);
    } catch {
      validateObservedEventLedger(state.ledger);
      compatible = false;
    }
    if (compatible) ledger = { ...state.ledger };
    else
      for (const [key, event] of Object.entries(state.ledger)) {
        legacyEventDays[key] = event.date;
        baselineEntries.push({ date: event.date, ...event.usage });
      }
  }
  const legacyBaseline = mergeEntries(baselineEntries).filter(
    (entry) => !range || (entry.date >= range.rangeStart && entry.date <= range.rangeEnd),
  );
  for (const [key, date] of Object.entries(legacyEventDays))
    if (range && (date < range.rangeStart || date > range.rangeEnd)) delete legacyEventDays[key];
  for (const [key, event] of Object.entries(ledger))
    if (range && (event.date < range.rangeStart || event.date > range.rangeEnd)) delete ledger[key];
  validateLegacyEventDays(legacyEventDays);
  validateLegacyBaseline(legacyBaseline);
  return { files, ledger, legacyBaseline, legacyEventDays };
}

export function integer(value) {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value === "number")
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  if (typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value)) return BigInt(value);
  return null;
}

export function utcDay(value) {
  const date = typeof value === "number" ? new Date(value) : new Date(value ?? "");
  return Number.isNaN(date.valueOf()) ? null : date.toISOString().slice(0, 10);
}

export function componentEntry(date, components, authoritativeTotal) {
  if (!dayPattern.test(date ?? "")) return null;
  const values = Object.fromEntries(
    Object.entries(components).map(([key, value]) => [
      key,
      value === undefined ? 0n : integer(value),
    ]),
  );
  if (Object.values(values).some((value) => value === null)) return null;
  const sum = Object.values(values).reduce((total, value) => total + value, 0n);
  const supplied = authoritativeTotal === undefined ? sum : integer(authoritativeTotal);
  if (supplied === null) return null;
  const entry = { date, totalTokens: supplied.toString() };
  if (supplied === sum)
    for (const [key, value] of Object.entries(values)) entry[key] = value.toString();
  return entry;
}

export function totalEntry(date, total) {
  const value = integer(total);
  return dayPattern.test(date ?? "") && value !== null
    ? { date, totalTokens: value.toString() }
    : null;
}

export function mergeEntries(entries) {
  const totals = new Map();
  const keys = [
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "reasoningTokens",
  ];
  for (const entry of entries) {
    if (entry === null) continue;
    const current =
      totals.get(entry.date) ??
      Object.assign(
        { date: entry.date, totalTokens: 0n, components: true },
        Object.fromEntries(keys.map((key) => [key, 0n])),
      );
    current.totalTokens += BigInt(entry.totalTokens);
    if (!keys.every((key) => entry[key] !== undefined)) current.components = false;
    else for (const key of keys) current[key] += BigInt(entry[key]);
    totals.set(entry.date, current);
  }
  return [...totals.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((entry) => {
      const result = { date: entry.date, totalTokens: entry.totalTokens.toString() };
      if (entry.components) for (const key of keys) result[key] = entry[key].toString();
      return result;
    });
}

export async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function canonicalPathKey(
  path,
  { platform = process.platform, resolvePath = resolve, realpathPath = realpath } = {},
) {
  let canonical = resolvePath(path);
  try {
    canonical = await realpathPath(canonical);
  } catch {}
  return platform === "win32" || platform === "darwin" ? canonical.toLowerCase() : canonical;
}

export async function findFile(root, predicate, maximumEntries = 10_000) {
  const queue = [root];
  let visited = 0;
  while (queue.length && visited < maximumEntries) {
    let directory;
    try {
      directory = await opendir(queue.shift());
    } catch {
      continue;
    }
    for await (const entry of directory) {
      visited += 1;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) queue.push(join(directory.path, entry.name));
      else if (entry.isFile() && predicate(entry.name, join(directory.path, entry.name)))
        return true;
      if (visited >= maximumEntries) break;
    }
  }
  return false;
}

export async function walk(root, suffixes, maximum = 2_000, maximumFileBytes = 20_000_000) {
  try {
    const rootInfo = await stat(root);
    if (rootInfo.isFile()) {
      return {
        files:
          rootInfo.size <= maximumFileBytes && suffixes.some((suffix) => root.endsWith(suffix))
            ? [
                {
                  path: root,
                  size: rootInfo.size,
                  modifiedAt: rootInfo.mtimeMs,
                  ino: rootInfo.ino,
                },
              ]
            : [],
        incomplete: rootInfo.size > maximumFileBytes,
        issues:
          rootInfo.size > maximumFileBytes
            ? [
                {
                  path: root,
                  size: rootInfo.size,
                  modifiedAt: rootInfo.mtimeMs,
                  reason: "oversized",
                  kind: "file",
                },
              ]
            : [],
      };
    }
  } catch {
    return {
      files: [],
      incomplete: true,
      issues: [{ path: root, reason: "unreadable", kind: "root" }],
    };
  }
  const found = [];
  const issues = [];
  const queue = [root];
  let incomplete = false;
  while (queue.length) {
    const current = queue.shift();
    let directory;
    try {
      directory = await opendir(current);
    } catch {
      incomplete = true;
      issues.push({ path: current, reason: "unreadable", kind: "directory" });
      continue;
    }
    for await (const entry of directory) {
      if (entry.isSymbolicLink()) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) queue.push(path);
      else if (entry.isFile() && suffixes.some((suffix) => entry.name.endsWith(suffix))) {
        try {
          const info = await stat(path);
          if (info.size <= maximumFileBytes)
            found.push({ path, size: info.size, modifiedAt: info.mtimeMs, ino: info.ino });
          else {
            incomplete = true;
            issues.push({
              path,
              size: info.size,
              modifiedAt: info.mtimeMs,
              reason: "oversized",
              kind: "file",
            });
          }
        } catch {
          incomplete = true;
          issues.push({ path, reason: "unreadable", kind: "file" });
        }
      }
      if (found.length >= maximum) {
        incomplete = true;
        issues.push({ path: current, reason: "limit", kind: "directory" });
        break;
      }
    }
    if (found.length >= maximum) break;
  }
  return {
    files: found.sort((a, b) => b.modifiedAt - a.modifiedAt || a.path.localeCompare(b.path)),
    incomplete,
    issues,
  };
}

export async function jsonLinesChunk(path, start = 0, size) {
  if (size !== undefined && start >= size)
    return { lines: [], safeOffset: start, oversizedLines: 0, tail: "", tailBytes: 0 };
  let contents = "";
  const stream = createReadStream(path, {
    encoding: "utf8",
    start,
    ...(size === undefined ? {} : { end: size - 1 }),
  });
  for await (const chunk of stream) contents += chunk;
  const newline = contents.lastIndexOf("\n");
  if (newline < 0)
    return {
      lines: [],
      safeOffset: start,
      oversizedLines: 0,
      tail: contents,
      tailBytes: Buffer.byteLength(contents),
    };
  const complete = contents.slice(0, newline + 1);
  const tail = contents.slice(newline + 1);
  const lines = complete.split(/\r?\n/).filter(Boolean);
  return {
    lines,
    safeOffset: start + Buffer.byteLength(complete),
    oversizedLines: lines.filter((line) => Buffer.byteLength(line) > 1_000_000).length,
    tail,
    tailBytes: Buffer.byteLength(tail),
  };
}

export async function jsonLines(path, start = 0, size) {
  return (await jsonLinesChunk(path, start, size)).lines;
}

export async function tailFingerprint(path, offset) {
  const length = Math.min(256, Math.max(0, offset));
  const buffer = Buffer.alloc(length);
  const handle = await open(path, "r");
  try {
    if (length > 0) await handle.read(buffer, 0, length, offset - length);
  } finally {
    await handle.close();
  }
  return createHash("sha256").update(buffer).digest("hex");
}

export async function collectJsonl(
  source,
  parser,
  filter = () => true,
  state = {},
  range,
  eventKey,
  ledgerParserVersion = 1,
) {
  const discovered = await walk(source.dataPath, [".jsonl"]);
  const files = discovered.files.filter((file) => filter(file.path));
  const normalized = normalizedJsonlState(state, ledgerParserVersion, range);
  let ledgerCount = validateObservedEventLedger(normalized.ledger, ledgerParserVersion);
  const ledger = normalized.ledger;
  const legacyEventDays = normalized.legacyEventDays;
  const legacyBaseline = normalized.legacyBaseline;
  const provisionalLedger = {};
  const nextState = { files: {}, ledger, legacyBaseline, legacyEventDays };
  let incomplete = discovered.incomplete;
  let oversized = false;
  let schemaUnsupported = false;
  let identityConflict = false;
  let unreadable = discovered.issues.some((issue) => issue.reason === "unreadable");
  let limited = discovered.issues.some((issue) => ["limit", "oversized"].includes(issue.reason));
  let bytes = 0;
  let ledgerBytes = Buffer.byteLength(JSON.stringify(ledger));
  for (const file of files) {
    if (bytes + file.size > 100_000_000) {
      incomplete = true;
      limited = true;
      const previous = normalized.files[file.path];
      if (previous) {
        nextState.files[file.path] = previous;
      }
      continue;
    }
    bytes += file.size;
    const previous = normalized.files[file.path];
    if (
      previous &&
      previous.size === file.size &&
      previous.modifiedAt === file.modifiedAt &&
      previous.safeOffset === file.size &&
      (previous.ino === undefined || previous.ino === file.ino)
    ) {
      nextState.files[file.path] = previous;
      continue;
    }
    let appended =
      previous &&
      previous.size <= file.size &&
      previous.safeOffset <= file.size &&
      (previous.ino === undefined || previous.ino === file.ino);
    if (appended && previous.tailFingerprint !== undefined) {
      try {
        appended =
          previous.tailFingerprint === (await tailFingerprint(file.path, previous.safeOffset));
      } catch {
        appended = false;
      }
    }
    const offset = appended ? previous.safeOffset : 0;
    try {
      const chunk = await jsonLinesChunk(file.path, offset, file.size);
      const hasUnterminatedTail = (chunk.tailBytes ?? 0) > 0;
      if (hasUnterminatedTail) incomplete = true;
      if (chunk.oversizedLines > 0) {
        incomplete = true;
        oversized = true;
        limited = true;
      }
      const unseenLines = [];
      let overflowed = false;
      let lineCount = appended ? (previous.lineCount ?? 0) : 0;
      for (let index = 0; index < chunk.lines.length; index += 1) {
        const line = chunk.lines[index];
        const event = eventKey?.(line, {
          path: file.path,
          lineIndex: lineCount + index,
        });
        const keys = observedEventKeys(event);
        if (
          keys === null ||
          !dayPattern.test(event.date ?? "") ||
          storedUsage(event.entry) === null ||
          (range && (event.date < range.rangeStart || event.date > range.rangeEnd))
        ) {
          unseenLines.push(line);
          continue;
        }
        const [key, ...aliasKeys] = keys;
        const candidate = {
          date: event.date,
          usage: storedUsage(event.entry),
          parserVersion: ledgerParserVersion,
        };
        const legacyDates = [key, ...aliasKeys]
          .map((candidateKey) => legacyEventDays[candidateKey])
          .filter((date) => date !== undefined);
        if (legacyDates.length > 0) {
          if (legacyDates.some((date) => date !== event.date)) {
            incomplete = true;
            identityConflict = true;
          }
          continue;
        }
        if (ledger[key] !== undefined) {
          if (JSON.stringify(ledger[key]) !== JSON.stringify(candidate)) {
            incomplete = true;
            identityConflict = true;
          }
          continue;
        }
        const candidateBytes = Buffer.byteLength(JSON.stringify([key, candidate]));
        if (
          ledgerCount >= maximumLedgerEvents ||
          ledgerBytes + candidateBytes > maximumLedgerBytes
        ) {
          incomplete = true;
          limited = true;
          overflowed = true;
          break;
        }
        ledger[key] = candidate;
        ledgerCount += 1;
        ledgerBytes += candidateBytes;
      }
      if (overflowed) {
        if (previous) nextState.files[file.path] = previous;
        continue;
      }
      if (hasUnterminatedTail && chunk.tail?.trim() && (!previous || appended)) {
        const event = eventKey?.(chunk.tail, {
          path: file.path,
          lineIndex: lineCount + chunk.lines.length,
        });
        const usage = event ? storedUsage(event.entry) : null;
        const keys = observedEventKeys(event);
        if (
          keys !== null &&
          dayPattern.test(event.date ?? "") &&
          usage !== null &&
          (!range || (event.date >= range.rangeStart && event.date <= range.rangeEnd))
        ) {
          const [key, ...aliasKeys] = keys;
          const candidate = { date: event.date, usage, parserVersion: ledgerParserVersion };
          const legacyDates = [key, ...aliasKeys]
            .map((candidateKey) => legacyEventDays[candidateKey])
            .filter((date) => date !== undefined);
          const existing = ledger[key] ?? provisionalLedger[key];
          if (legacyDates.length > 0) {
            if (legacyDates.some((date) => date !== event.date)) {
              incomplete = true;
              identityConflict = true;
            }
          } else if (existing === undefined) provisionalLedger[key] = candidate;
          else if (JSON.stringify(existing) !== JSON.stringify(candidate)) {
            incomplete = true;
            identityConflict = true;
          }
        } else unseenLines.push(chunk.tail);
      } else if (hasUnterminatedTail && chunk.tail?.trim()) unseenLines.push(chunk.tail);
      lineCount += chunk.lines.length;
      const parserOutput = parser(unseenLines);
      const unsupportedRecords = Array.isArray(parserOutput)
        ? 0
        : parserOutput.stats.unsupportedCandidates;
      if (unsupportedRecords > 0) {
        incomplete = true;
        schemaUnsupported = true;
        if (previous) {
          nextState.files[file.path] = previous;
        }
        continue;
      }
      if (hasUnterminatedTail) {
        if (previous) nextState.files[file.path] = previous;
        continue;
      }
      nextState.files[file.path] = {
        size: file.size,
        modifiedAt: file.modifiedAt,
        ino: file.ino,
        safeOffset: chunk.safeOffset,
        tailFingerprint: await tailFingerprint(file.path, chunk.safeOffset),
        lineCount,
      };
    } catch {
      incomplete = true;
      unreadable = true;
      if (previous) {
        nextState.files[file.path] = previous;
      }
    }
  }
  if (incomplete)
    for (const [path, previous] of Object.entries(normalized.files))
      if (nextState.files[path] === undefined) {
        nextState.files[path] = previous;
      }
  const warnings = [];
  if (incomplete) warnings.push("collector_limits_or_unreadable_files");
  if (oversized) warnings.push("oversized_jsonl_records");
  if (schemaUnsupported) warnings.push("unsupported_usage_records");
  if (identityConflict) warnings.push("local_event_identity_conflict");
  const entries = mergeEntries([
    ...legacyBaseline,
    ...[...Object.values(ledger), ...Object.values(provisionalLedger)].map((event) => ({
      date: event.date,
      ...event.usage,
    })),
  ]);
  return {
    entries,
    completeness: incomplete ? "partial" : "complete",
    nextState,
    warnings,
    diagnostics: [
      ...(unreadable ? [{ code: "local_store_unreadable", phase: "collect" }] : []),
      ...(limited ? [{ code: "local_store_scan_limit", phase: "collect" }] : []),
      ...(schemaUnsupported ? [{ code: "local_store_schema_unsupported", phase: "collect" }] : []),
      ...(identityConflict ? [{ code: "local_event_identity_conflict", phase: "collect" }] : []),
    ],
  };
}

export function parserResult(entries, candidateRecords, parsedRecords, unsupportedCandidates) {
  return {
    entries,
    stats: { candidateRecords, parsedRecords, unsupportedCandidates },
  };
}

export function previousJsonlEntries(state) {
  if (state.legacyBaseline) validateLegacyBaseline(state.legacyBaseline);
  if (state.ledger) {
    validateObservedEventLedger(state.ledger);
    return mergeEntries([
      ...(state.legacyBaseline ?? []),
      ...Object.values(state.ledger).map((event) => ({ date: event.date, ...(event.usage ?? {}) })),
    ]);
  }
  return mergeEntries(Object.values(state.files ?? {}).flatMap((file) => file.entries ?? []));
}

export async function diagnosePath(source, excluded = []) {
  const available = await exists(source.dataPath);
  return {
    status: available ? "ok" : "unavailable",
    collectionMethod: source.collectionMethod,
    supportedSurfaces: [source.supportedSurface],
    dataLocationAvailable: available,
    excluded,
  };
}

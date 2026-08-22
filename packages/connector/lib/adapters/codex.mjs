import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { createZstdDecompress } from "node:zlib";
import {
  executableOverride,
  resolveAgentExecutable,
  spawnResolvedExecutable,
} from "../executables.mjs";
import {
  componentEntry,
  integer,
  jsonLinesChunk,
  mergeEntries,
  tailFingerprint,
  totalEntry,
  utcDay,
  walk,
} from "./shared.mjs";
import { connectorVersion } from "../version.mjs";

const codexComponentStateVersion = 9;
const codexEventReferencesIndex = 7;
const codexTokenCountPattern = /"type"\s*:\s*"token_count"/;
const codexSessionMetaPattern = /"type"\s*:\s*"session_meta"/;
const codexThreadSettingsPattern = /"type"\s*:\s*"thread_settings_applied"/;
const codexIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const codexRolloutFilePattern =
  /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([0-9a-f-]{36})(?:_([0-9a-f-]{36}))?\.jsonl(?:\.zst)?$/i;
const codexUsageKeys = [
  "inputTokens",
  "cachedInputTokens",
  "cacheWriteInputTokens",
  "outputTokens",
  "reasoningOutputTokens",
  "totalTokens",
];

function codexUsage(value) {
  if (value === null || typeof value !== "object") return null;
  const usage = {
    inputTokens: integer(value.input_tokens),
    cachedInputTokens: integer(value.cached_input_tokens ?? 0),
    cacheWriteInputTokens: integer(value.cache_write_input_tokens ?? 0),
    outputTokens: integer(value.output_tokens),
    reasoningOutputTokens: integer(value.reasoning_output_tokens ?? 0),
    totalTokens: integer(value.total_tokens),
  };
  if (Object.values(usage).some((counter) => counter === null)) return null;
  return usage;
}

function hasExactCodexComponents(usage) {
  return (
    usage !== null &&
    usage.totalTokens === usage.inputTokens + usage.outputTokens &&
    usage.cachedInputTokens + usage.cacheWriteInputTokens <= usage.inputTokens &&
    usage.reasoningOutputTokens <= usage.outputTokens
  );
}

function exactCodexUsage(value) {
  const usage = codexUsage(value);
  return hasExactCodexComponents(usage) ? usage : null;
}

function isContextWindowUsage(usage) {
  return (
    usage !== null &&
    usage.totalTokens > 0n &&
    usage.inputTokens === 0n &&
    usage.cachedInputTokens === 0n &&
    usage.cacheWriteInputTokens === 0n &&
    usage.outputTokens === 0n &&
    usage.reasoningOutputTokens === 0n
  );
}

function storedCodexUsage(value) {
  if (value === null || typeof value !== "object") return null;
  const usage = Object.fromEntries(codexUsageKeys.map((key) => [key, integer(value[key])]));
  return Object.values(usage).some((counter) => counter === null) ? null : usage;
}

function serializeCodexUsage(usage) {
  return usage === null
    ? null
    : Object.fromEntries(codexUsageKeys.map((key) => [key, usage[key].toString()]));
}

function sameCodexUsage(left, right) {
  return codexUsageKeys.every((key) => left[key] === right[key]);
}

function codexUsageDelta(current, previous) {
  if (previous === null || codexUsageKeys.some((key) => current[key] < previous[key])) {
    return current;
  }
  return Object.fromEntries(codexUsageKeys.map((key) => [key, current[key] - previous[key]]));
}

function codexHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url").slice(0, 16);
}

function codexId(value) {
  return typeof value === "string" && codexIdPattern.test(value) ? value.toLowerCase() : null;
}

function codexIdentityKey(kind, value) {
  const id = codexId(value);
  return id === null ? null : codexHash([`codex-${kind}`, id]);
}

function codexRolloutFileIdentity(path) {
  if (typeof path !== "string") return null;
  const match = basename(path).match(codexRolloutFilePattern);
  if (!match) return null;
  const threadId = codexId(match[1]);
  const rolloutId = codexId(match[2] ?? match[1]);
  return threadId === null || rolloutId === null ? null : { threadId, rolloutId };
}

function codexUsageSignature(total, last) {
  return codexHash([
    ...codexUsageKeys.map((key) => total[key].toString()),
    ...codexUsageKeys.map((key) => last[key].toString()),
  ]);
}

function codexSessionContext(lines, priorSessionContext, rolloutPath) {
  if (priorSessionContext?.complete === true) return priorSessionContext;
  let sessionMeta = null;
  let sessionMetaOrdinal = null;
  let metadataInvalid = false;
  for (const line of lines) {
    if (!codexSessionMetaPattern.test(line)) continue;
    try {
      const record = JSON.parse(line);
      if (record?.type !== "session_meta") continue;
      if (
        record.payload === null ||
        typeof record.payload !== "object" ||
        codexId(record.payload.id) === null ||
        (record.payload.forked_from_id != null &&
          codexId(record.payload.forked_from_id) === null) ||
        (record.payload.history_base != null &&
          (typeof record.payload.history_base !== "object" ||
            Array.isArray(record.payload.history_base)))
      ) {
        metadataInvalid = true;
        continue;
      }
      if (sessionMeta === null) {
        sessionMeta = record.payload;
        sessionMetaOrdinal = record.ordinal ?? null;
      }
    } catch {
      metadataInvalid = true;
    }
  }
  if (metadataInvalid)
    return { complete: false, metadataInvalid: true, threadKey: null, rolloutKey: null };
  if (sessionMeta === null)
    return { complete: false, metadataPending: true, threadKey: null, rolloutKey: null };
  const historyMode = sessionMeta.history_mode ?? "legacy";
  const subagentHistoryStartOrdinal = sessionMeta.subagent_history_start_ordinal ?? null;
  const historyBase = sessionMeta.history_base ?? null;
  if (
    (historyMode !== "legacy" && historyMode !== "paginated") ||
    (historyMode === "paginated" &&
      (!Number.isSafeInteger(sessionMetaOrdinal) ||
        sessionMetaOrdinal !== (historyBase?.end_ordinal_exclusive ?? 0))) ||
    (subagentHistoryStartOrdinal !== null &&
      (!Number.isSafeInteger(subagentHistoryStartOrdinal) || subagentHistoryStartOrdinal < 0)) ||
    (historyBase !== null &&
      (historyMode !== "paginated" ||
        codexId(historyBase.thread_id) === null ||
        !Number.isSafeInteger(historyBase.end_ordinal_exclusive) ||
        historyBase.end_ordinal_exclusive < 0 ||
        !Number.isSafeInteger(historyBase.end_byte_offset) ||
        historyBase.end_byte_offset < 0))
  )
    return { complete: false, metadataInvalid: true, threadKey: null, rolloutKey: null };
  const threadId = codexId(sessionMeta.id);
  const fileIdentity = codexRolloutFileIdentity(rolloutPath);
  if (
    (fileIdentity !== null && fileIdentity.threadId !== threadId) ||
    (fileIdentity === null && historyMode === "paginated")
  )
    return { complete: false, metadataInvalid: true, threadKey: null, rolloutKey: null };
  const rolloutId = fileIdentity?.rolloutId ?? threadId;
  const threadKey = codexIdentityKey("thread", threadId);
  const rolloutKey = codexIdentityKey("rollout", rolloutId);
  const forkParentThreadKey =
    historyBase === null ? codexIdentityKey("thread", sessionMeta.forked_from_id) : null;
  const historyBaseRolloutKey = codexIdentityKey("rollout", historyBase?.thread_id);
  const startedAt = Date.parse(sessionMeta?.timestamp ?? "");
  if (
    forkParentThreadKey !== null &&
    (!Number.isFinite(startedAt) ||
      (historyMode === "paginated" && subagentHistoryStartOrdinal === null))
  )
    return { complete: false, metadataInvalid: true, threadKey: null, rolloutKey: null };
  return {
    complete: true,
    threadKey,
    rolloutKey,
    forkParentThreadKey,
    historyBaseRolloutKey,
    historyBaseEndOrdinalExclusive: historyBase?.end_ordinal_exclusive ?? null,
    sessionMetaOrdinal,
    startedAt: Number.isFinite(startedAt) ? startedAt : null,
    historyMode,
    subagentHistoryStartOrdinal,
  };
}

function compactCodexEvent(entry, references = 1) {
  return [
    entry.date,
    entry.totalTokens,
    entry.inputTokens,
    entry.outputTokens,
    entry.cacheReadTokens,
    entry.cacheWriteTokens,
    entry.reasoningTokens,
    references,
  ];
}

function expandCodexEvent(event) {
  return {
    date: event[0],
    totalTokens: event[1],
    inputTokens: event[2],
    outputTokens: event[3],
    cacheReadTokens: event[4],
    cacheWriteTokens: event[5],
    reasoningTokens: event[6],
  };
}

function compactCodexRawEvent(event, range) {
  return event.entry.date < range.rangeStart || event.entry.date > range.rangeEnd
    ? [event.signature, event.timestamp, event.ordinal]
    : [
        event.signature,
        event.timestamp,
        event.ordinal,
        ...compactCodexEvent(event.entry).slice(0, codexEventReferencesIndex),
      ];
}

function expandCodexRawEvent(event) {
  return {
    signature: event[0],
    timestamp: event[1],
    ordinal: event[2],
    entry: event.length > 3 ? expandCodexEvent(event.slice(3)) : null,
  };
}

export function parseCodexSessionLines(
  lines,
  priorUsage = null,
  priorSessionContext = null,
  priorEventCount = 0,
  rolloutPath = null,
) {
  const sessionContext = codexSessionContext(lines, priorSessionContext, rolloutPath);
  let previous = storedCodexUsage(priorUsage);
  const entries = [];
  const events = [];
  const eventDates = new Set();
  const incompleteDates = new Set();
  const legacyForkBoundaries = [];
  let invalid = false;
  let unknownIncomplete = false;
  const markInvalid = (day) => {
    invalid = true;
    if (day === null) unknownIncomplete = true;
    else incompleteDates.add(day);
  };
  if (sessionContext.complete !== true) markInvalid(null);
  for (const line of lines) {
    if (codexThreadSettingsPattern.test(line)) {
      try {
        const record = JSON.parse(line);
        if (
          record?.type === "event_msg" &&
          record?.payload?.type === "thread_settings_applied" &&
          sessionContext.forkParentThreadKey !== null &&
          sessionContext.historyMode === "legacy"
        )
          legacyForkBoundaries.push(priorEventCount + events.length);
      } catch {
        markInvalid(utcDay(line.match(/"timestamp"\s*:\s*"([^"]+)"/)?.[1]));
      }
      continue;
    }
    if (!codexTokenCountPattern.test(line)) continue;
    let day = utcDay(line.match(/"timestamp"\s*:\s*"([^"]+)"/)?.[1]);
    if (Buffer.byteLength(line) > 1_000_000) {
      markInvalid(day);
      continue;
    }
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      markInvalid(day);
      continue;
    }
    if (record?.type !== "event_msg" || record?.payload?.type !== "token_count") continue;
    day = utcDay(record.timestamp);
    if (day === null) {
      markInvalid(null);
      continue;
    }
    const rawUsage = record?.payload?.info?.total_token_usage;
    if (rawUsage === null || rawUsage === undefined) continue;
    const current = codexUsage(rawUsage);
    if (current === null) {
      markInvalid(day);
      continue;
    }
    const rawLast = record?.payload?.info?.last_token_usage;
    const rawLastUsage = codexUsage(rawLast);
    if (isContextWindowUsage(current) && isContextWindowUsage(rawLastUsage)) continue;
    if (previous && sameCodexUsage(previous, current)) continue;
    if (sessionContext.complete !== true) {
      previous = current;
      continue;
    }
    const ordinal = record.ordinal ?? null;
    if (
      sessionContext.historyMode === "paginated" &&
      (!Number.isSafeInteger(ordinal) || ordinal < 0)
    ) {
      previous = current;
      markInvalid(day);
      continue;
    }
    eventDates.add(day);
    const delta = codexUsageDelta(current, previous);
    const last = exactCodexUsage(rawLast);
    let contribution = last;
    if (previous !== null && last === null) {
      contribution =
        integer(rawLast?.total_tokens) === delta.totalTokens && hasExactCodexComponents(delta)
          ? delta
          : null;
    }
    previous = current;
    if (contribution === null) {
      markInvalid(day);
      continue;
    }
    if (contribution.totalTokens === 0n) continue;
    const entry = componentEntry(
      day,
      {
        inputTokens:
          contribution.inputTokens -
          contribution.cachedInputTokens -
          contribution.cacheWriteInputTokens,
        outputTokens: contribution.outputTokens - contribution.reasoningOutputTokens,
        cacheReadTokens: contribution.cachedInputTokens,
        cacheWriteTokens: contribution.cacheWriteInputTokens,
        reasoningTokens: contribution.reasoningOutputTokens,
      },
      contribution.totalTokens,
    );
    if (entry === null || entry.inputTokens === undefined) markInvalid(day);
    else {
      entries.push(entry);
      events.push({
        signature: codexUsageSignature(current, contribution),
        timestamp: Date.parse(record.timestamp),
        ordinal,
        entry,
      });
    }
  }
  return {
    entries: mergeEntries(entries),
    events,
    lastUsage: serializeCodexUsage(previous),
    invalid,
    eventDates: [...eventDates].sort(),
    incompleteDates: [...incompleteDates].sort(),
    unknownIncomplete,
    sessionContext,
    legacyForkBoundaries,
  };
}

async function codexLinesChunk(path, start = 0, size, maximumBytes = 100_000_000) {
  if (!path.endsWith(".jsonl.zst")) {
    const chunk = await jsonLinesChunk(path, start, size);
    return { ...chunk, readBytes: Math.max(0, (size ?? chunk.safeOffset) - start) };
  }
  if (start !== 0) throw new Error("Compressed Codex rollouts cannot be read incrementally");
  let contents = "";
  let readBytes = 0;
  await pipeline(createReadStream(path), createZstdDecompress(), async (stream) => {
    stream.setEncoding("utf8");
    for await (const chunk of stream) {
      readBytes += Buffer.byteLength(chunk);
      if (readBytes > maximumBytes) {
        const error = new Error("Decompressed Codex rollout exceeds the read limit");
        error.code = "CODEX_ROLLOUT_LIMIT";
        throw error;
      }
      contents += chunk;
    }
  });
  const newline = contents.lastIndexOf("\n");
  if (newline < 0) return { lines: [], safeOffset: size ?? 0, oversizedLines: 0, readBytes };
  const complete = contents.slice(0, newline + 1);
  const lines = complete.split(/\r?\n/).filter(Boolean);
  return {
    lines,
    safeOffset: size ?? 0,
    oversizedLines: lines.filter((line) => Buffer.byteLength(line) > 1_000_000).length,
    readBytes,
  };
}

function codexPathDay(path) {
  const match = path.match(
    /(?:^|[\\/])(\d{4})[\\/](\d{2})[\\/](\d{2})(?:[\\/]|$)|rollout-(\d{4}-\d{2}-\d{2})T/,
  );
  const pathDay = match ? (match[4] ?? `${match[1]}-${match[2]}-${match[3]}`) : null;
  if (pathDay !== null && utcDay(pathDay) === pathDay) return pathDay;
  return null;
}

function intersectRange(start, end, range) {
  if (!start || !end || end < range.rangeStart || start > range.rangeEnd) return null;
  return [
    start < range.rangeStart ? range.rangeStart : start,
    end > range.rangeEnd ? range.rangeEnd : end,
  ];
}

function fileRanges(fileState, file, range) {
  const intervals = [];
  let hasDateEvidence = false;
  const hasKnownRange = Boolean(fileState?.dateStart && fileState?.dateEnd);
  if (hasKnownRange) {
    hasDateEvidence = true;
    const known = intersectRange(fileState.dateStart, fileState.dateEnd, range);
    if (known) intervals.push(known);
  }
  const fallbackDays = [];
  if (Number.isFinite(file?.modifiedAt)) {
    hasDateEvidence = true;
    const modifiedDay = utcDay(file.modifiedAt);
    if (modifiedDay !== null) fallbackDays.push(modifiedDay);
  }
  const pathDay = codexPathDay(file?.path ?? "");
  if (pathDay !== null) {
    hasDateEvidence = true;
    fallbackDays.push(pathDay);
  }
  if (fallbackDays.length) {
    const start = fallbackDays.sort()[0];
    const end = fallbackDays.at(-1);
    const fallback = intersectRange(start, end, range);
    if (fallback) intervals.push(fallback);
  }
  return hasDateEvidence ? intervals : [[range.rangeStart, range.rangeEnd]];
}

function pathIsWithin(candidate, directory) {
  const child = relative(directory, candidate);
  return child !== "" && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function incompleteIntervals(fileState, file, range) {
  const intervals = (fileState?.incompleteDates ?? [])
    .map((day) => intersectRange(day, day, range))
    .filter(Boolean);
  if (fileState?.unknownIncomplete === true) {
    intervals.push(...fileRanges(fileState, file, range));
  }
  return intervals;
}

function mergeDateBounds(previous, parsed, appended) {
  const dates = parsed.eventDates;
  const starts = [appended ? previous?.dateStart : null, dates[0]].filter(Boolean);
  const ends = [appended ? previous?.dateEnd : null, dates.at(-1)].filter(Boolean);
  return {
    ...(starts.length ? { dateStart: starts.sort()[0] } : {}),
    ...(ends.length ? { dateEnd: ends.sort().at(-1) } : {}),
  };
}

function rebuildCodexEventState(files, range) {
  const unresolved = new Set();
  const rolloutGroups = new Map();
  for (const fileState of Object.values(files)) {
    const { threadKey, rolloutKey } = fileState?.sessionContext ?? {};
    if (!threadKey || !rolloutKey) continue;
    const group = rolloutGroups.get(rolloutKey) ?? { states: [], representative: null };
    group.states.push(fileState);
    rolloutGroups.set(rolloutKey, group);
  }
  const contextIdentity = (fileState) => {
    const context = fileState.sessionContext;
    return JSON.stringify([
      context.threadKey,
      context.rolloutKey,
      context.forkParentThreadKey,
      context.historyBaseRolloutKey,
      context.historyBaseEndOrdinalExclusive,
      context.sessionMetaOrdinal,
      context.startedAt,
      context.historyMode,
      context.subagentHistoryStartOrdinal,
    ]);
  };
  const isCompatiblePrefix = (shorter, longer) => {
    if (contextIdentity(shorter) !== contextIdentity(longer)) return false;
    const shorterEvents = shorter.rawEvents ?? [];
    const longerEvents = longer.rawEvents ?? [];
    if (shorterEvents.length > longerEvents.length) return false;
    if (
      !shorterEvents.every(
        (event, index) =>
          event[0] === longerEvents[index]?.[0] &&
          event[1] === longerEvents[index]?.[1] &&
          event[2] === longerEvents[index]?.[2],
      )
    )
      return false;
    const longerBoundaries = new Set(longer.legacyForkBoundaries ?? []);
    return (shorter.legacyForkBoundaries ?? []).every((boundary) => longerBoundaries.has(boundary));
  };
  for (const group of rolloutGroups.values()) {
    group.states.sort(
      (left, right) =>
        (right.rawEvents?.length ?? 0) - (left.rawEvents?.length ?? 0) ||
        (right.safeOffset ?? right.size ?? 0) - (left.safeOffset ?? left.size ?? 0),
    );
    const representative = group.states[0];
    if (!group.states.every((fileState) => isCompatiblePrefix(fileState, representative))) {
      for (const fileState of group.states) unresolved.add(fileState);
      continue;
    }
    group.representative = representative;
  }
  const byRollout = new Map();
  const byThread = new Map();
  for (const [rolloutKey, group] of rolloutGroups) {
    if (group.representative === null) continue;
    byRollout.set(rolloutKey, group.representative);
    const { threadKey } = group.representative.sessionContext;
    const candidates = byThread.get(threadKey) ?? [];
    candidates.push(group.representative);
    byThread.set(threadKey, candidates);
  }
  const parentForThread = (threadKey, childState) => {
    const candidates = (byThread.get(threadKey) ?? []).filter(
      (candidate) => candidate.sessionContext.rolloutKey !== childState.sessionContext.rolloutKey,
    );
    const childStartedAt = childState.sessionContext.startedAt;
    if (!Number.isFinite(childStartedAt)) return null;
    const eligible = candidates.filter(
      (candidate) =>
        Number.isFinite(candidate.sessionContext.startedAt) &&
        candidate.sessionContext.startedAt <= childStartedAt,
    );
    if (eligible.length <= 1) return eligible[0] ?? null;
    const latestStartedAt = Math.max(
      ...eligible.map((candidate) => candidate.sessionContext.startedAt),
    );
    const latest = eligible.filter(
      (candidate) => candidate.sessionContext.startedAt === latestStartedAt,
    );
    return latest.length === 1 ? latest[0] : null;
  };
  const memo = new Map();
  const resolveEvents = (fileState, ancestry = new Set()) => {
    if (memo.has(fileState)) return memo.get(fileState);
    const rawEvents = (fileState.rawEvents ?? []).map(expandCodexRawEvent);
    const {
      rolloutKey,
      forkParentThreadKey,
      historyBaseRolloutKey,
      historyBaseEndOrdinalExclusive,
      startedAt,
      historyMode,
      subagentHistoryStartOrdinal,
    } = fileState.sessionContext ?? {};
    let parentEvents = null;
    let inheritedCount = 0;
    let parentOffset = 0;
    const parent = historyBaseRolloutKey
      ? byRollout.get(historyBaseRolloutKey)
      : forkParentThreadKey
        ? parentForThread(forkParentThreadKey, fileState)
        : null;
    if (historyBaseRolloutKey || forkParentThreadKey) {
      const parentRolloutKey = parent?.sessionContext?.rolloutKey;
      if (parent === null || parent === undefined || ancestry.has(parentRolloutKey)) {
        unresolved.add(fileState);
        memo.set(fileState, []);
        return [];
      }
      parentEvents = resolveEvents(parent, new Set([...ancestry, rolloutKey].filter(Boolean)));
      if (unresolved.has(parent)) {
        unresolved.add(fileState);
        memo.set(fileState, []);
        return [];
      }
      parentEvents = historyBaseRolloutKey
        ? parentEvents.filter(
            (event) =>
              Number.isSafeInteger(event.ordinal) && event.ordinal < historyBaseEndOrdinalExclusive,
          )
        : parentEvents.filter(
            (event) => !Number.isFinite(startedAt) || event.timestamp <= startedAt,
          );
      const matchesParentSuffix = (count) => {
        if (count > rawEvents.length || count > parentEvents.length) return false;
        const offset = parentEvents.length - count;
        return rawEvents
          .slice(0, count)
          .every((event, index) => event.signature === parentEvents[offset + index].signature);
      };
      if (historyBaseRolloutKey) {
        if (
          rawEvents.some(
            (event) =>
              !Number.isSafeInteger(event.ordinal) ||
              event.ordinal <= historyBaseEndOrdinalExclusive,
          )
        ) {
          unresolved.add(fileState);
          memo.set(fileState, []);
          return [];
        }
      } else if (historyMode === "paginated" && subagentHistoryStartOrdinal !== null) {
        inheritedCount = rawEvents.findIndex(
          (event) => event.ordinal >= subagentHistoryStartOrdinal,
        );
        if (inheritedCount < 0) inheritedCount = rawEvents.length;
        if (
          rawEvents.some(
            (event, index) =>
              !Number.isSafeInteger(event.ordinal) ||
              (index >= inheritedCount && event.ordinal < subagentHistoryStartOrdinal),
          ) ||
          !matchesParentSuffix(inheritedCount)
        ) {
          unresolved.add(fileState);
          memo.set(fileState, []);
          return [];
        }
      } else if (forkParentThreadKey) {
        const boundaries = [...new Set(fileState.legacyForkBoundaries ?? [])]
          .filter((count) => Number.isSafeInteger(count) && count >= 0 && count <= rawEvents.length)
          .sort((left, right) => right - left);
        const boundary = boundaries.find(matchesParentSuffix);
        if (boundary === undefined) {
          unresolved.add(fileState);
          memo.set(fileState, []);
          return [];
        }
        inheritedCount = boundary;
      }
      parentOffset = parentEvents.length - inheritedCount;
    }
    const resolved = rawEvents.map((event, index) =>
      index < inheritedCount
        ? parentEvents[parentOffset + index]
        : {
            id: codexHash(["codex-lineage-event", rolloutKey, index, event.signature]),
            ...event,
          },
    );
    memo.set(fileState, resolved);
    return resolved;
  };
  const events = {};
  for (const group of rolloutGroups.values()) {
    const fileState = group.representative;
    if (fileState === null) continue;
    const eventIds = new Set();
    for (const { id, entry } of resolveEvents(fileState)) {
      if (
        entry === null ||
        entry.date < range.rangeStart ||
        entry.date > range.rangeEnd ||
        eventIds.has(id)
      )
        continue;
      eventIds.add(id);
      if (events[id] === undefined) events[id] = compactCodexEvent(entry);
      else events[id][codexEventReferencesIndex] += 1;
    }
    for (const representation of group.states) representation.eventIds = [...eventIds];
  }
  return { events, unresolved };
}

async function discoverCodexRollouts(dataPath, discover, maximumFiles, maximumFileBytes) {
  const files = [];
  const issues = [];
  let incomplete = false;
  for (const name of ["sessions", "archived_sessions"]) {
    const root = join(dataPath, name);
    try {
      await access(root);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        incomplete = true;
        issues.push({ path: root, reason: "unreadable" });
      }
      continue;
    }
    const remaining = maximumFiles - files.length;
    if (remaining <= 0) {
      incomplete = true;
      issues.push({ path: root, reason: "limit" });
      continue;
    }
    const result = await discover(root, [".jsonl", ".jsonl.zst"], remaining, maximumFileBytes);
    files.push(...result.files);
    issues.push(...(result.issues ?? []));
    if (result.incomplete) {
      incomplete = true;
      if ((result.issues?.length ?? 0) === 0) issues.push({ path: root, reason: "incomplete" });
    }
  }
  return {
    files: files.sort((a, b) => b.modifiedAt - a.modifiedAt || a.path.localeCompare(b.path)),
    incomplete,
    issues,
  };
}

export async function collectCodexSessionUsage(
  source,
  range,
  state = {},
  {
    maximumBytes = 1_000_000_000,
    maximumFileBytes = 100_000_000,
    discover = walk,
    readChunk = codexLinesChunk,
    fingerprint = tailFingerprint,
  } = {},
) {
  const currentState =
    state.version === codexComponentStateVersion ? state : { files: {}, events: {} };
  const dataPath = resolve(source.dataPath);
  const discovered = await discoverCodexRollouts(dataPath, discover, 10_000, maximumFileBytes);
  const nextState = {
    version: codexComponentStateVersion,
    files: {},
    events: {},
  };
  const retainedFile = (fileState) => ({ ...fileState });
  const blockedIntervals = [];
  const block = (interval) => {
    if (interval) blockedIntervals.push(interval);
  };
  let discoveryRelevant = false;
  for (const issue of discovered.issues) {
    const affectedStates = Object.entries(currentState.files ?? {}).filter(
      ([path]) => path === issue.path || pathIsWithin(path, issue.path),
    );
    const intervals =
      issue.reason === "limit"
        ? [[range.rangeStart, range.rangeEnd]]
        : affectedStates.length
          ? affectedStates.flatMap(([path, fileState]) =>
              fileRanges(fileState, { path, modifiedAt: fileState.modifiedAt }, range),
            )
          : fileRanges(currentState.files?.[issue.path], issue, range);
    if (intervals.length) {
      for (const interval of intervals) block(interval);
      discoveryRelevant = true;
    }
  }
  if (discovered.incomplete && discovered.issues.length === 0) {
    block([range.rangeStart, range.rangeEnd]);
    discoveryRelevant = true;
  }
  let bytes = 0;
  for (const file of discovered.files) {
    const previous = currentState.files?.[file.path];
    if (
      previous &&
      previous.size === file.size &&
      previous.modifiedAt === file.modifiedAt &&
      (previous.ino === undefined || previous.ino === file.ino)
    ) {
      const retained = retainedFile(previous);
      nextState.files[file.path] = retained;
      for (const interval of incompleteIntervals(retained, file, range)) block(interval);
      continue;
    }
    let appended =
      !file.path.endsWith(".jsonl.zst") &&
      previous &&
      previous.size <= file.size &&
      (previous.safeOffset ?? previous.size) <= file.size &&
      (previous.ino === undefined || previous.ino === file.ino);
    if (previous?.sessionContext?.complete === false) appended = false;
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
    const requiredBytes = file.size - offset;
    const estimatedBytes = file.path.endsWith(".jsonl.zst") ? 0 : requiredBytes;
    if (bytes + estimatedBytes > maximumBytes) {
      for (const interval of fileRanges(previous, file, range)) block(interval);
      if (previous) nextState.files[file.path] = retainedFile(previous);
      continue;
    }
    try {
      const chunk = await readChunk(
        file.path,
        offset,
        file.size,
        Math.min(maximumFileBytes, maximumBytes - bytes),
      );
      const consumedBytes = chunk.readBytes ?? requiredBytes;
      if (bytes + consumedBytes > maximumBytes) throw new Error("Codex rollout budget exceeded");
      bytes += consumedBytes;
      const parsed = parseCodexSessionLines(
        chunk.lines,
        appended ? previous.lastUsage : null,
        appended ? previous.sessionContext : null,
        appended ? (previous?.rawEvents?.length ?? 0) : 0,
        file.path,
      );
      const nextFingerprint = await fingerprint(file.path, chunk.safeOffset);
      const incompleteDates = new Set(appended ? (previous?.incompleteDates ?? []) : []);
      for (const day of parsed.incompleteDates) incompleteDates.add(day);
      nextState.files[file.path] = {
        size: file.size,
        modifiedAt: file.modifiedAt,
        ino: file.ino,
        safeOffset: chunk.safeOffset,
        tailFingerprint: nextFingerprint,
        lastUsage: parsed.lastUsage,
        sessionContext: parsed.sessionContext,
        rawEvents: [
          ...(appended ? (previous?.rawEvents ?? []) : []),
          ...parsed.events.map((event) => compactCodexRawEvent(event, range)),
        ],
        legacyForkBoundaries: [
          ...(appended ? (previous?.legacyForkBoundaries ?? []) : []),
          ...parsed.legacyForkBoundaries,
        ],
        ...mergeDateBounds(previous, parsed, appended),
        ...(incompleteDates.size ? { incompleteDates: [...incompleteDates].sort() } : {}),
        ...(parsed.unknownIncomplete || (appended && previous?.unknownIncomplete === true)
          ? { unknownIncomplete: true }
          : {}),
      };
      for (const interval of incompleteIntervals(nextState.files[file.path], file, range))
        block(interval);
    } catch {
      for (const interval of fileRanges(previous, file, range)) block(interval);
      if (previous) nextState.files[file.path] = retainedFile(previous);
    }
  }
  for (const [path, previous] of Object.entries(currentState.files ?? {}))
    if (nextState.files[path] === undefined) {
      const intervals = fileRanges(previous, { path, modifiedAt: previous.modifiedAt }, range);
      if (discoveryRelevant && intervals.length) {
        nextState.files[path] = retainedFile(previous);
        for (const interval of intervals) block(interval);
      }
    }
  const rebuilt = rebuildCodexEventState(nextState.files, range);
  nextState.events = rebuilt.events;
  for (const fileState of rebuilt.unresolved)
    for (const interval of fileRanges(fileState, { modifiedAt: fileState.modifiedAt }, range))
      block(interval);
  const warnings = [];
  if (blockedIntervals.length) warnings.push("codex_session_components_incomplete");
  return {
    entries: mergeEntries(
      Object.values(nextState.events)
        .map(expandCodexEvent)
        .filter(
          (entry) =>
            !blockedIntervals.some(([start, end]) => entry.date >= start && entry.date <= end),
        ),
    ),
    nextState,
    warnings,
  };
}

export function mergeCodexUsageComponents(authoritative, components) {
  const byDate = new Map(components.map((entry) => [entry.date, entry]));
  const componentKeys = [
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "reasoningTokens",
  ];
  return authoritative.map((entry) => {
    const component = byDate.get(entry.date);
    if (!component || !componentKeys.every((key) => component[key] !== undefined)) return entry;
    return {
      ...entry,
      inputTokens: component.inputTokens,
      outputTokens: component.outputTokens,
      cacheReadTokens: component.cacheReadTokens,
      cacheWriteTokens: component.cacheWriteTokens,
      reasoningTokens: component.reasoningTokens,
    };
  });
}

export function parseCodexUsage(payload) {
  if (payload?.error)
    throw new Error(`Codex usage request failed: ${payload.error.message ?? "RPC error"}`);
  const buckets = payload?.result?.dailyUsageBuckets;
  if (buckets === null) return [];
  if (!Array.isArray(buckets)) throw new Error("Codex did not return daily usage buckets");
  const dates = new Set();
  return buckets.map((bucket) => {
    const entry = totalEntry(bucket?.startDate, bucket?.tokens);
    if (entry === null || dates.has(entry.date))
      throw new Error("Codex returned an unsupported usage shape");
    dates.add(entry.date);
    return entry;
  });
}

export function codexProfileEnvironment(source, environment = process.env) {
  const codexHome = source?.dataPath
    ? resolve(source.dataPath)
    : environment.CODEX_HOME
      ? resolve(environment.CODEX_HOME)
      : join(homedir(), ".codex");
  return { ...environment, CODEX_HOME: codexHome };
}

async function collect(source, range, state = {}) {
  const executable = source?.executablePath ?? (await resolveAgentExecutable("codex"));
  if (!executable)
    throw new Error(
      `Codex executable was not found in installed apps, package-manager bins, or PATH; set ${executableOverride("codex")} to its absolute path`,
    );
  const child = spawnResolvedExecutable(executable, ["app-server"], {
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true,
    env: codexProfileEnvironment(source),
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })[
    Symbol.asyncIterator
  ]();
  const spawnFailure = new Promise((_, reject) => child.once("error", reject));
  const next = async () => {
    let timeout;
    const timedOut = new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error("Codex App Server timed out")), 8_000);
    });
    let result;
    try {
      result = await Promise.race([lines.next(), spawnFailure, timedOut]);
    } finally {
      clearTimeout(timeout);
    }
    if (result.done) throw new Error("Codex App Server closed unexpectedly");
    return JSON.parse(result.value);
  };
  const write = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  try {
    write({
      id: 0,
      method: "initialize",
      params: {
        clientInfo: {
          name: "viberacing_connector",
          title: "Vibe Racing Connector",
          version: connectorVersion,
        },
      },
    });
    const initialized = await next();
    if (initialized?.id !== 0 || !initialized.result)
      throw new Error("Codex App Server initialization failed");
    write({ method: "initialized", params: {} });
    write({ id: 1, method: "account/usage/read", params: null });
    for (;;) {
      const response = await next();
      if (response?.id === 1) {
        const authoritative = parseCodexUsage(response);
        const components = await collectCodexSessionUsage(
          source,
          range,
          state.componentUsage ?? {},
        ).catch(() => ({
          entries: [],
          nextState: state.componentUsage ?? {},
          warnings: ["codex_session_components_incomplete"],
        }));
        return {
          entries: mergeCodexUsageComponents(authoritative, components.entries),
          completeness: "complete",
          nextState: { componentUsage: components.nextState },
          warnings: components.warnings,
        };
      }
    }
  } finally {
    child.stdin.end();
    child.kill();
  }
}

export const codexAdapter = Object.freeze({
  id: "codex",
  displayName: "Codex",
  supportedSurfaces: ["cli", "desktop"],
  collectionMethods: ["codex_app_server"],
  aggregationMode: "account_max",
  trigger: "Stop hook",
  detect: async () => {
    const dataPath = process.env.CODEX_HOME
      ? resolve(process.env.CODEX_HOME)
      : join(homedir(), ".codex");
    try {
      await access(dataPath);
    } catch {
      return [];
    }
    const executablePath = await resolveAgentExecutable("codex");
    if (executablePath === null) return [];
    return [
      {
        dataPath,
        executablePath,
        collectionMethod: "codex_app_server",
        supportedSurface: "desktop",
        suggestedLabel: "Codex",
      },
    ];
  },
  collect,
  diagnose: async (source) => {
    try {
      await access(source.dataPath);
      const executable = source?.executablePath ?? (await resolveAgentExecutable("codex"));
      if (executable === null) throw new Error("Codex executable is unavailable");
      return {
        status: "ok",
        collectionMethod: "codex_app_server",
        supportedSurfaces: ["cli", "desktop"],
        excluded: [],
      };
    } catch (error) {
      return {
        status: "error",
        error: error.message,
        collectionMethod: "codex_app_server",
        supportedSurfaces: ["cli", "desktop"],
        excluded: [],
      };
    }
  },
});

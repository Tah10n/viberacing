import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
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

const codexComponentStateVersion = 4;
const codexEventReferencesIndex = 7;
const codexTokenCountPattern = /"type"\s*:\s*"token_count"/;
const codexUsageKeys = [
  "inputTokens",
  "cachedInputTokens",
  "cacheWriteInputTokens",
  "outputTokens",
  "reasoningOutputTokens",
  "totalTokens",
];

function cumulativeCodexUsage(value) {
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
  if (
    usage.totalTokens !== usage.inputTokens + usage.outputTokens ||
    usage.cachedInputTokens + usage.cacheWriteInputTokens > usage.inputTokens ||
    usage.reasoningOutputTokens > usage.outputTokens
  )
    return null;
  return usage;
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

function codexUsageEventId(record, total, last) {
  const identity = [
    record.timestamp,
    record.ordinal,
    ...codexUsageKeys.map((key) => total[key].toString()),
    ...codexUsageKeys.map((key) => last[key].toString()),
  ];
  return createHash("sha256").update(JSON.stringify(identity)).digest("base64url").slice(0, 16);
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

export function parseCodexSessionLines(lines, priorUsage = null) {
  let previous = storedCodexUsage(priorUsage);
  const entries = [];
  const events = [];
  let invalid = false;
  for (const line of lines) {
    if (!codexTokenCountPattern.test(line)) continue;
    if (Buffer.byteLength(line) > 1_000_000) {
      invalid = true;
      continue;
    }
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      invalid = true;
      continue;
    }
    if (record?.type !== "event_msg" || record?.payload?.type !== "token_count") continue;
    const rawUsage = record?.payload?.info?.total_token_usage;
    if (rawUsage === null || rawUsage === undefined) continue;
    const current = cumulativeCodexUsage(rawUsage);
    if (current === null) {
      invalid = true;
      continue;
    }
    if (previous && sameCodexUsage(previous, current)) continue;
    const delta = codexUsageDelta(current, previous);
    const rawLast = record?.payload?.info?.last_token_usage;
    const last = cumulativeCodexUsage(rawLast);
    let contribution = last;
    if (previous !== null && (last === null || !sameCodexUsage(last, delta))) {
      contribution =
        integer(rawLast?.total_tokens) === delta.totalTokens &&
        delta.cachedInputTokens + delta.cacheWriteInputTokens <= delta.inputTokens &&
        delta.reasoningOutputTokens <= delta.outputTokens
          ? delta
          : null;
    }
    previous = current;
    if (contribution === null) {
      invalid = true;
      continue;
    }
    const day = utcDay(record.timestamp);
    if (day === null) {
      invalid = true;
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
    if (entry === null || entry.inputTokens === undefined) invalid = true;
    else {
      entries.push(entry);
      events.push({ id: codexUsageEventId(record, current, contribution), entry });
    }
  }
  return {
    entries: mergeEntries(entries),
    events,
    lastUsage: serializeCodexUsage(previous),
    invalid,
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
    readChunk = jsonLinesChunk,
    fingerprint = tailFingerprint,
  } = {},
) {
  const currentState =
    state.version === codexComponentStateVersion ? state : { files: {}, events: {} };
  const sessionRoot = join(resolve(source.dataPath), "sessions");
  try {
    await access(sessionRoot);
  } catch (error) {
    return {
      entries: [],
      nextState: { version: codexComponentStateVersion, files: {}, events: {} },
      warnings: error?.code === "ENOENT" ? [] : ["codex_session_components_incomplete"],
    };
  }
  const discovered = await discover(sessionRoot, [".jsonl"], 10_000, maximumFileBytes);
  const nextState = {
    version: codexComponentStateVersion,
    files: {},
    events: Object.fromEntries(
      Object.entries(currentState.events ?? {})
        .filter(([, event]) => event?.[0] >= range.rangeStart && event[0] <= range.rangeEnd)
        .map(([id, event]) => [id, [...event]]),
    ),
  };
  const retainedFile = (fileState) => ({
    ...fileState,
    eventIds: (fileState?.eventIds ?? []).filter((id) => nextState.events[id] !== undefined),
  });
  const removeOwnership = (fileState) => {
    for (const id of new Set(fileState?.eventIds ?? [])) {
      const event = nextState.events[id];
      if (event === undefined) continue;
      if (event[codexEventReferencesIndex] <= 1) delete nextState.events[id];
      else event[codexEventReferencesIndex] -= 1;
    }
  };
  const addOwnership = (parsedEvents, existingIds = new Set()) => {
    const ids = new Set(existingIds);
    for (const { id, entry } of parsedEvents) {
      if (ids.has(id) || entry.date < range.rangeStart || entry.date > range.rangeEnd) continue;
      ids.add(id);
      const event = nextState.events[id];
      if (event === undefined) nextState.events[id] = compactCodexEvent(entry);
      else event[codexEventReferencesIndex] += 1;
    }
    return [...ids];
  };
  let incomplete = discovered.incomplete;
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
      if (retained.incomplete === true) incomplete = true;
      continue;
    }
    let appended =
      previous &&
      previous.size <= file.size &&
      (previous.safeOffset ?? previous.size) <= file.size &&
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
    const requiredBytes = file.size - offset;
    if (bytes + requiredBytes > maximumBytes) {
      incomplete = true;
      if (previous) nextState.files[file.path] = retainedFile(previous);
      continue;
    }
    bytes += requiredBytes;
    try {
      const chunk = await readChunk(file.path, offset, file.size);
      const parsed = parseCodexSessionLines(chunk.lines, appended ? previous.lastUsage : null);
      const fileIncomplete = parsed.invalid || (appended && previous?.incomplete === true);
      if (fileIncomplete) incomplete = true;
      const nextFingerprint = await fingerprint(file.path, chunk.safeOffset);
      if (!appended && previous) removeOwnership(previous);
      const existingIds = new Set(appended ? retainedFile(previous).eventIds : []);
      nextState.files[file.path] = {
        size: file.size,
        modifiedAt: file.modifiedAt,
        ino: file.ino,
        safeOffset: chunk.safeOffset,
        tailFingerprint: nextFingerprint,
        lastUsage: parsed.lastUsage,
        eventIds: addOwnership(parsed.events, existingIds),
        ...(fileIncomplete ? { incomplete: true } : {}),
      };
    } catch {
      incomplete = true;
      if (previous) nextState.files[file.path] = retainedFile(previous);
    }
  }
  for (const [path, previous] of Object.entries(currentState.files ?? {}))
    if (nextState.files[path] === undefined) {
      if (incomplete) nextState.files[path] = retainedFile(previous);
      else removeOwnership(previous);
    }
  const warnings = [];
  if (incomplete) warnings.push("codex_session_components_incomplete");
  return {
    entries: incomplete ? [] : mergeEntries(Object.values(nextState.events).map(expandCodexEvent)),
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
  const componentPromise = collectCodexSessionUsage(
    source,
    range,
    state.componentUsage ?? {},
  ).catch(() => ({
    entries: [],
    nextState: state.componentUsage ?? {},
    warnings: ["codex_session_components_incomplete"],
  }));
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
        const components = await componentPromise;
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

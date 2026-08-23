import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { access, open, opendir, realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

export const dayPattern = /^\d{4}-\d{2}-\d{2}$/;

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
    return { lines: [], safeOffset: start, oversizedLines: 0 };
  let contents = "";
  const stream = createReadStream(path, {
    encoding: "utf8",
    start,
    ...(size === undefined ? {} : { end: size - 1 }),
  });
  for await (const chunk of stream) contents += chunk;
  const newline = contents.lastIndexOf("\n");
  if (newline < 0) return { lines: [], safeOffset: start, oversizedLines: 0 };
  const complete = contents.slice(0, newline + 1);
  const lines = complete.split(/\r?\n/).filter(Boolean);
  return {
    lines,
    safeOffset: start + Buffer.byteLength(complete),
    oversizedLines: lines.filter((line) => Buffer.byteLength(line) > 1_000_000).length,
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
) {
  const discovered = await walk(source.dataPath, [".jsonl"]);
  const files = discovered.files.filter((file) => filter(file.path));
  const nextState = { files: {} };
  const entries = [];
  let incomplete = discovered.incomplete;
  let oversized = false;
  let unreadable = discovered.issues.some((issue) => issue.reason === "unreadable");
  let limited = discovered.issues.some((issue) => ["limit", "oversized"].includes(issue.reason));
  let bytes = 0;
  for (const file of files) {
    if (bytes + file.size > 100_000_000) {
      incomplete = true;
      limited = true;
      const previous = state.files?.[file.path];
      if (previous) {
        nextState.files[file.path] = previous;
        entries.push(...(previous.entries ?? []));
      }
      continue;
    }
    bytes += file.size;
    const previous = state.files?.[file.path];
    if (
      previous &&
      previous.size === file.size &&
      previous.modifiedAt === file.modifiedAt &&
      (previous.ino === undefined || previous.ino === file.ino)
    ) {
      nextState.files[file.path] = previous;
      entries.push(...(previous.entries ?? []));
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
      if (chunk.oversizedLines > 0) {
        incomplete = true;
        oversized = true;
        limited = true;
      }
      const eventDays = appended ? { ...(previous.eventDays ?? {}) } : {};
      const unseenLines = [];
      for (const line of chunk.lines) {
        const event = eventKey?.(line);
        if (
          !event ||
          typeof event.id !== "string" ||
          !dayPattern.test(event.date ?? "") ||
          (range && (event.date < range.rangeStart || event.date > range.rangeEnd))
        ) {
          unseenLines.push(line);
          continue;
        }
        const key = createHash("sha256").update(event.id).digest("hex");
        if (eventDays[key] !== undefined) continue;
        eventDays[key] = event.date;
        unseenLines.push(line);
      }
      if (range)
        for (const [key, date] of Object.entries(eventDays))
          if (date < range.rangeStart || date > range.rangeEnd) delete eventDays[key];
      const parsed = parser(unseenLines);
      const fileEntries = mergeEntries([...(appended ? (previous.entries ?? []) : []), ...parsed]);
      const ranged = range
        ? fileEntries.filter(
            (entry) => entry.date >= range.rangeStart && entry.date <= range.rangeEnd,
          )
        : fileEntries;
      nextState.files[file.path] = {
        size: file.size,
        modifiedAt: file.modifiedAt,
        ino: file.ino,
        safeOffset: chunk.safeOffset,
        tailFingerprint: await tailFingerprint(file.path, chunk.safeOffset),
        eventDays,
        entries: ranged,
      };
      entries.push(...ranged);
    } catch {
      incomplete = true;
      unreadable = true;
      if (previous) {
        nextState.files[file.path] = previous;
        entries.push(...(previous.entries ?? []));
      }
    }
  }
  if (incomplete)
    for (const [path, previous] of Object.entries(state.files ?? {}))
      if (nextState.files[path] === undefined) {
        nextState.files[path] = previous;
        entries.push(...(previous.entries ?? []));
      }
  const warnings = [];
  if (incomplete) warnings.push("collector_limits_or_unreadable_files");
  if (oversized) warnings.push("oversized_jsonl_records");
  return {
    entries: mergeEntries(entries),
    completeness: incomplete ? "partial" : "complete",
    nextState,
    warnings,
    diagnostics: [
      ...(unreadable ? [{ code: "local_store_unreadable", phase: "collect" }] : []),
      ...(limited ? [{ code: "local_store_scan_limit", phase: "collect" }] : []),
    ],
  };
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

import { createReadStream } from "node:fs";
import { access, opendir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

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

export async function walk(root, suffixes, maximum = 2_000) {
  try {
    const rootInfo = await stat(root);
    if (rootInfo.isFile()) {
      return {
        files:
          rootInfo.size <= 20_000_000 && suffixes.some((suffix) => root.endsWith(suffix))
            ? [{ path: root, size: rootInfo.size, modifiedAt: rootInfo.mtimeMs }]
            : [],
        incomplete: rootInfo.size > 20_000_000,
      };
    }
  } catch {
    return { files: [], incomplete: true };
  }
  const found = [];
  const queue = [root];
  let incomplete = false;
  while (queue.length) {
    const current = queue.shift();
    let directory;
    try {
      directory = await opendir(current);
    } catch {
      incomplete = true;
      continue;
    }
    for await (const entry of directory) {
      if (entry.isSymbolicLink()) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) queue.push(path);
      else if (entry.isFile() && suffixes.some((suffix) => entry.name.endsWith(suffix))) {
        try {
          const info = await stat(path);
          if (info.size <= 20_000_000)
            found.push({ path, size: info.size, modifiedAt: info.mtimeMs });
          else incomplete = true;
        } catch {
          incomplete = true;
        }
      }
      if (found.length >= maximum) {
        incomplete = true;
        break;
      }
    }
    if (found.length >= maximum) break;
  }
  return {
    files: found.sort((a, b) => b.modifiedAt - a.modifiedAt || a.path.localeCompare(b.path)),
    incomplete,
  };
}

export async function jsonLines(path, start = 0) {
  const result = [];
  const input = createInterface({
    input: createReadStream(path, { encoding: "utf8", start }),
    crlfDelay: Infinity,
  });
  for await (const line of input) if (Buffer.byteLength(line) <= 1_000_000) result.push(line);
  return result;
}

export async function collectJsonl(source, parser, filter = () => true, state = {}) {
  const discovered = await walk(source.dataPath, [".jsonl"]);
  const files = discovered.files.filter((file) => filter(file.path));
  const lines = [];
  let incomplete = discovered.incomplete;
  let bytes = 0;
  for (const file of files) {
    if (bytes + file.size > 100_000_000) {
      incomplete = true;
      continue;
    }
    bytes += file.size;
    try {
      lines.push(...(await jsonLines(file.path)));
    } catch {
      incomplete = true;
    }
  }
  return {
    entries: parser(lines),
    completeness: incomplete ? "partial" : "complete",
    nextState: state,
    warnings: incomplete ? ["collector_limits_or_unreadable_files"] : [],
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

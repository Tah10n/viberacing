import { homedir } from "node:os";
import { readFile } from "node:fs/promises";
import { basename, join, posix, resolve, win32 } from "node:path";
import {
  collectJsonl,
  componentEntry,
  diagnosePath,
  integer,
  mergeEntries,
  utcDay,
} from "./shared.mjs";

export function parseQwenLines(lines) {
  const seen = new Set();
  const entries = [];
  for (const line of lines) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record?.schemaVersion !== 1 || !record.id || seen.has(record.id)) continue;
    const day = utcDay(record.timestamp);
    const input = integer(record.inputTokens);
    const cached = integer(record.cachedTokens ?? 0);
    if (day === null || input === null || cached === null) continue;
    seen.add(record.id);
    entries.push(
      componentEntry(
        day,
        {
          inputTokens: input >= cached ? input - cached : input,
          outputTokens: record.outputTokens,
          cacheReadTokens: cached,
          cacheWriteTokens: 0,
          reasoningTokens: record.thoughtsTokens,
        },
        record.totalTokens,
      ),
    );
  }
  return mergeEntries(entries);
}

function qwenEventKey(line) {
  try {
    const record = JSON.parse(line);
    const date = utcDay(record?.timestamp);
    return record?.schemaVersion === 1 && typeof record?.id === "string" && date
      ? { id: record.id, date }
      : null;
  } catch {
    return null;
  }
}

export function resolveQwenPath(value, { home = homedir(), platform = process.platform } = {}) {
  const path = platform === "win32" ? win32 : posix;
  if (value === "~") return home;
  if (/^~[\\/]/.test(value ?? "")) return path.resolve(home, value.slice(2));
  return path.isAbsolute(value) ? path.normalize(value) : null;
}

function qwenHome(environment, home, platform) {
  if (!environment.QWEN_HOME) return (platform === "win32" ? win32 : posix).join(home, ".qwen");
  return (
    resolveQwenPath(environment.QWEN_HOME, { home, platform }) ?? resolve(environment.QWEN_HOME)
  );
}

export async function qwenRuntimeRoot({
  environment = process.env,
  home = homedir(),
  platform = process.platform,
  diagnostics = [],
} = {}) {
  const path = platform === "win32" ? win32 : posix;
  if (environment.QWEN_RUNTIME_DIR) {
    const explicit =
      resolveQwenPath(environment.QWEN_RUNTIME_DIR, { home, platform }) ??
      resolve(environment.QWEN_RUNTIME_DIR);
    return explicit;
  }
  const homeRoot = qwenHome(environment, home, platform);
  try {
    const settings = JSON.parse(await readFile(path.join(homeRoot, "settings.json"), "utf8"));
    const configured = settings?.advanced?.runtimeOutputDir;
    if (typeof configured === "string" && configured.trim()) {
      const resolved = resolveQwenPath(configured.trim(), { home, platform });
      if (resolved) return resolved;
      diagnostics.push({
        error:
          "runtimeOutputDir is relative; add the resolved root explicitly with `viberacing source add --agent qwen_code --name <label> --data-dir <resolved-runtime-root>/usage`",
      });
      return null;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") diagnostics.push({ error: "Qwen user settings are unreadable" });
  }
  return homeRoot;
}

export async function detectQwenSources(options = {}) {
  const diagnostics = options.diagnostics ?? [];
  const platform = options.platform ?? process.platform;
  const root = await qwenRuntimeRoot({ ...options, diagnostics });
  if (root === null) return [];
  const path = platform === "win32" ? win32 : posix;
  const dataPath = path.join(root, "usage");
  return (
    await diagnosePath({
      dataPath,
      collectionMethod: "qwen_stats_jsonl",
      supportedSurface: "cli",
    })
  ).dataLocationAvailable
    ? [
        {
          dataPath,
          collectionMethod: "qwen_stats_jsonl",
          supportedSurface: "cli",
          suggestedLabel: "Qwen Code",
        },
      ]
    : [];
}

const initialRuntimeRoot = await qwenRuntimeRoot();
const defaultPaths = initialRuntimeRoot === null ? [] : [join(initialRuntimeRoot, "usage")];
export const qwenAdapter = Object.freeze({
  id: "qwen_code",
  displayName: "Qwen Code",
  supportedSurfaces: ["cli"],
  collectionMethods: ["qwen_stats_jsonl"],
  aggregationMode: "source_sum",
  trigger: "usage stats file",
  defaultPaths,
  detect: detectQwenSources,
  collect: (source, range, state) =>
    collectJsonl(
      source,
      parseQwenLines,
      (path) => basename(path).startsWith("token-usage-"),
      state,
      range,
      qwenEventKey,
    ),
  diagnose: (source) => diagnosePath(source),
});

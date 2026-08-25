import { homedir } from "node:os";
import { readFile } from "node:fs/promises";
import { basename, join, posix, win32 } from "node:path";
import { parseQwenEnvironment, parseQwenJsonc } from "./qwen-settings.mjs";
import {
  collectJsonl,
  componentEntry,
  diagnosePath,
  integer,
  mergeEntries,
  parserResult,
  previousJsonlEntries,
  totalEntry,
  utcDay,
} from "./shared.mjs";

const qwenParserVersion = 4;

function analyzeQwenLines(lines) {
  const seen = new Set();
  const entries = [];
  let candidateRecords = 0;
  let parsedRecords = 0;
  let unsupportedCandidates = 0;
  for (const line of lines) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      candidateRecords += 1;
      unsupportedCandidates += 1;
      continue;
    }
    if (record?.schemaVersion !== 1) continue;
    candidateRecords += 1;
    const day = utcDay(record.timestamp);
    const input = integer(record.inputTokens);
    const output = integer(record.outputTokens);
    const cached = integer(record.cachedTokens ?? 0);
    const thoughts = integer(record.thoughtsTokens ?? 0);
    const total = integer(record.totalTokens);
    if (
      typeof record.id !== "string" ||
      record.id.length < 1 ||
      record.id.length > 256 ||
      day === null ||
      input === null ||
      output === null ||
      cached === null ||
      thoughts === null ||
      total === null
    ) {
      unsupportedCandidates += 1;
      continue;
    }
    let regularOutput = null;
    if (cached <= input) {
      if (total === input + output + thoughts) regularOutput = output;
      else if (total === input + output && thoughts <= output) regularOutput = output - thoughts;
    }
    const entry =
      regularOutput === null
        ? totalEntry(day, total)
        : componentEntry(
            day,
            {
              inputTokens: input - cached,
              outputTokens: regularOutput,
              cacheReadTokens: cached,
              cacheWriteTokens: 0,
              reasoningTokens: thoughts,
            },
            total,
          );
    if (entry === null) {
      unsupportedCandidates += 1;
      continue;
    }
    parsedRecords += 1;
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    entries.push(entry);
  }
  return parserResult(
    mergeEntries(entries),
    candidateRecords,
    parsedRecords,
    unsupportedCandidates,
  );
}

export function parseQwenLines(lines) {
  return analyzeQwenLines(lines).entries;
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

async function qwenEnvironmentFile(path, requestedKeys) {
  try {
    return parseQwenEnvironment(await readFile(path, "utf8"), requestedKeys);
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

function expandedPath(value, environment) {
  const missing = new Set();
  const expanded = value.replace(
    /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g,
    (_match, braced, plain) => {
      const name = braced ?? plain;
      const replacement = environment[name];
      if (typeof replacement !== "string") {
        missing.add(name);
        return "";
      }
      return replacement;
    },
  );
  return missing.size === 0 ? expanded : null;
}

function resolveConfiguredPath(value, context, label) {
  const expanded = expandedPath(value.trim(), context.environment);
  if (expanded === null) {
    context.diagnostics.push({ error: `${label} contains an unresolved environment variable` });
    return null;
  }
  const resolved = resolveQwenPath(expanded, context);
  if (resolved) return resolved;
  context.diagnostics.push({
    error:
      label === "QWEN_HOME"
        ? "QWEN_HOME is relative; set an absolute QWEN_HOME before adding the token root explicitly"
        : `${label} is relative; add the resolved root explicitly with \`viberacing source add --agent qwen_code --name <label> --data-dir <resolved-runtime-root>/usage\``,
  });
  return null;
}

function configuredValue(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim();
}

function referencedEnvironmentKeys(value) {
  const keys = new Set();
  for (const match of value.matchAll(
    /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g,
  ))
    keys.add(match[1] ?? match[2]);
  return keys;
}

async function environmentWithReferencedKeys(context, configured, diagnostics) {
  const keys = referencedEnvironmentKeys(configured);
  if (keys.size === 0) return context.environment;
  const environment = { ...context.environment };
  for (const file of context.environmentFiles) {
    let parsed;
    try {
      parsed = await qwenEnvironmentFile(file, keys);
    } catch {
      diagnostics.push({ error: "Qwen user environment settings are unreadable" });
      continue;
    }
    for (const [key, value] of Object.entries(parsed))
      if (!configuredValue(environment[key])) environment[key] = value;
  }
  return environment;
}

async function qwenEnvironmentContext({ environment, home, platform, diagnostics }) {
  const path = platform === "win32" ? win32 : posix;
  const defaultHome = path.join(home, ".qwen");
  const initialHome = configuredValue(environment.QWEN_HOME);
  let hookConfigRoot = initialHome
    ? resolveConfiguredPath(
        initialHome,
        {
          home,
          platform,
          diagnostics,
          environment: { HOME: home, USERPROFILE: home, ...environment },
        },
        "QWEN_HOME",
      )
    : defaultHome;
  if (hookConfigRoot === null) return { environment, environmentFiles: [], hookConfigRoot };

  const loaded = {};
  const loadWithoutOverride = async (file) => {
    let parsed;
    try {
      parsed = await qwenEnvironmentFile(file);
    } catch {
      diagnostics.push({ error: "Qwen user environment settings are unreadable" });
      return;
    }
    for (const [key, value] of Object.entries(parsed))
      if (!configuredValue(environment[key], loaded[key])) loaded[key] = value;
  };

  await loadWithoutOverride(path.join(hookConfigRoot, ".env"));
  if (!initialHome) await loadWithoutOverride(path.join(home, ".env"));

  const bootstrappedEnvironment = {
    HOME: home,
    USERPROFILE: home,
    ...loaded,
    ...environment,
  };
  const discoveredHome = configuredValue(bootstrappedEnvironment.QWEN_HOME);
  if (discoveredHome && !initialHome) {
    const discoveredRoot = resolveConfiguredPath(
      discoveredHome,
      { home, platform, diagnostics, environment: bootstrappedEnvironment },
      "QWEN_HOME",
    );
    if (discoveredRoot === null)
      return { environment: bootstrappedEnvironment, environmentFiles: [], hookConfigRoot: null };
    if (discoveredRoot !== hookConfigRoot) {
      hookConfigRoot = discoveredRoot;
      await loadWithoutOverride(path.join(hookConfigRoot, ".env"));
    }
  }

  return {
    environment: { HOME: home, USERPROFILE: home, ...loaded, ...environment },
    environmentFiles: [...new Set([path.join(hookConfigRoot, ".env"), path.join(home, ".env")])],
    hookConfigRoot,
  };
}

export async function qwenSourceContext({
  environment = process.env,
  home = homedir(),
  platform = process.platform,
  diagnostics = [],
} = {}) {
  const path = platform === "win32" ? win32 : posix;
  const context = await qwenEnvironmentContext({ environment, home, platform, diagnostics });
  const pathContext = { home, platform, diagnostics, environment: context.environment };
  const runtimeOverride = context.environment.QWEN_RUNTIME_DIR;
  if (runtimeOverride)
    return {
      runtimeRoot: resolveConfiguredPath(runtimeOverride, pathContext, "QWEN_RUNTIME_DIR"),
      hookConfigRoot: context.hookConfigRoot,
    };
  if (context.hookConfigRoot === null) return { runtimeRoot: null, hookConfigRoot: null };
  try {
    const settings = parseQwenJsonc(
      await readFile(path.join(context.hookConfigRoot, "settings.json"), "utf8"),
    );
    const configured = settings?.advanced?.runtimeOutputDir;
    if (typeof configured === "string" && configured.trim()) {
      const configuredEnvironment = await environmentWithReferencedKeys(
        context,
        configured,
        diagnostics,
      );
      return {
        runtimeRoot: resolveConfiguredPath(
          configured,
          { ...pathContext, environment: configuredEnvironment },
          "runtimeOutputDir",
        ),
        hookConfigRoot: context.hookConfigRoot,
      };
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      diagnostics.push({ error: "Qwen user settings are unreadable" });
      return { runtimeRoot: null, hookConfigRoot: context.hookConfigRoot };
    }
  }
  return { runtimeRoot: context.hookConfigRoot, hookConfigRoot: context.hookConfigRoot };
}

export async function qwenRuntimeRoot(options = {}) {
  return (await qwenSourceContext(options)).runtimeRoot;
}

export async function detectQwenSources(options = {}) {
  const diagnostics = options.diagnostics ?? [];
  const platform = options.platform ?? process.platform;
  const { runtimeRoot, hookConfigRoot } = await qwenSourceContext({ ...options, diagnostics });
  if (runtimeRoot === null || hookConfigRoot === null) return [];
  const path = platform === "win32" ? win32 : posix;
  const dataPath = path.join(runtimeRoot, "usage");
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
          hookConfigRoot,
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
  localSourceMetadata: async () => {
    const { hookConfigRoot } = await qwenSourceContext();
    if (hookConfigRoot === null)
      throw new Error("Qwen hook config root is unresolved; set QWEN_HOME to an absolute path");
    return { hookConfigRoot };
  },
  detect: detectQwenSources,
  collect: async (source, range, state = {}) => {
    const result = await collectJsonl(
      source,
      analyzeQwenLines,
      (path) => basename(path).startsWith("token-usage-"),
      state.parserVersion === qwenParserVersion ? state : {},
      range,
      qwenEventKey,
    );
    if (
      state.parserVersion !== qwenParserVersion &&
      result.completeness === "partial" &&
      Object.keys(state.files ?? {}).length > 0
    ) {
      return {
        ...result,
        entries: previousJsonlEntries(state),
        nextState: state,
      };
    }
    return {
      ...result,
      nextState: { ...result.nextState, parserVersion: qwenParserVersion },
    };
  },
  diagnose: (source) => diagnosePath(source),
});

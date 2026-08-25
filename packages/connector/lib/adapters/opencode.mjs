import { homedir } from "node:os";
import { readdir, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { diagnosticError } from "../diagnostics.mjs";
import { canonicalPathKey, componentEntry, diagnosePath, mergeEntries, utcDay } from "./shared.mjs";

export const openCodeDatabasePattern = /^opencode(?:-[A-Za-z0-9._-]+)?\.db$/;

function analyzeOpenCodeMessages(rows) {
  const seen = new Set();
  const entries = [];
  let candidateRecords = 0;
  let parsedRecords = 0;
  let unsupportedCandidates = 0;
  for (const row of rows) {
    let message;
    try {
      message = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
    } catch {
      candidateRecords += 1;
      unsupportedCandidates += 1;
      continue;
    }
    if (message?.role !== "assistant") continue;
    candidateRecords += 1;
    if (seen.has(row.id)) {
      parsedRecords += 1;
      continue;
    }
    const day = utcDay(message?.time?.created ?? row.time_created);
    const usage = message?.tokens;
    const entry =
      typeof row.id === "string" && row.id.length > 0 && row.id.length <= 256 && usage
        ? componentEntry(
            day,
            {
              inputTokens: usage.input,
              outputTokens: usage.output,
              cacheReadTokens: usage.cache?.read,
              cacheWriteTokens: usage.cache?.write,
              reasoningTokens: usage.reasoning,
            },
            usage.total,
          )
        : null;
    if (entry === null) {
      unsupportedCandidates += 1;
      continue;
    }
    parsedRecords += 1;
    seen.add(row.id);
    entries.push(entry);
  }
  return {
    entries: mergeEntries(entries),
    stats: { candidateRecords, parsedRecords, unsupportedCandidates },
  };
}

export function parseOpenCodeMessages(rows) {
  return analyzeOpenCodeMessages(rows).entries;
}

async function collect(source, range, state = {}) {
  const { DatabaseSync } = await import("node:sqlite");
  let database;
  try {
    database = new DatabaseSync(source.dataPath, { readOnly: true });
    const rows = database
      .prepare(
        "SELECT id, time_created, data FROM message WHERE time_created >= ? AND time_created < ? ORDER BY time_created",
      )
      .all(
        Date.parse(`${range.rangeStart}T00:00:00.000Z`),
        Date.parse(`${range.rangeEnd}T00:00:00.000Z`) + 86_400_000,
      );
    const analysis = analyzeOpenCodeMessages(rows);
    const unsupported = analysis.stats.unsupportedCandidates > 0;
    return {
      entries: analysis.entries,
      completeness: unsupported ? "partial" : "complete",
      nextState: state,
      warnings: unsupported ? ["unsupported_usage_records"] : [],
      diagnostics: unsupported
        ? [{ code: "local_store_schema_unsupported", phase: "collect" }]
        : [],
    };
  } catch (error) {
    throw diagnosticError("OpenCode local store is unreadable", "local_store_unreadable", {
      cause: error,
    });
  } finally {
    database?.close();
  }
}

export function openCodeDataRoot(environment = process.env, home = homedir()) {
  return join(
    environment.XDG_DATA_HOME ? resolve(environment.XDG_DATA_HOME) : join(home, ".local", "share"),
    "opencode",
  );
}

export async function isCompatibleOpenCodeDatabase(dataPath) {
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(dataPath, { readOnly: true });
  try {
    const table = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get("message");
    if (table?.name !== "message") return false;
    const columns = new Set(
      database
        .prepare("PRAGMA table_info(message)")
        .all()
        .map((column) => column.name),
    );
    return ["id", "time_created", "data"].every((column) => columns.has(column));
  } finally {
    database.close();
  }
}

function databaseLabel(configured, position) {
  if (configured) return "OpenCode configured";
  return position === 1 ? "OpenCode" : `OpenCode profile ${position}`;
}

function legacyDatabaseLabel(dataPath, configured) {
  const name = dataPath.split(/[\\/]/).at(-1) ?? "";
  const channel = name.match(/^opencode-(.+)\.db$/)?.[1];
  if (channel) return `OpenCode ${channel}`;
  if (name === "opencode.db") return "OpenCode";
  return configured ? "OpenCode configured" : "OpenCode";
}

function databaseOrder(left, right) {
  const priority = (name) => (name === "opencode.db" ? 0 : name === "opencode-prod.db" ? 1 : 2);
  return priority(left) - priority(right) || left.localeCompare(right);
}

export async function detectOpenCodeSources({
  environment = process.env,
  home = homedir(),
  diagnostics = [],
} = {}) {
  const dataRoot = openCodeDataRoot(environment, home);
  const configuredValue = environment.OPENCODE_DB?.trim();
  const configuredPath = configuredValue
    ? isAbsolute(configuredValue)
      ? resolve(configuredValue)
      : resolve(dataRoot, configuredValue)
    : null;
  let names = [];
  try {
    names = (await readdir(dataRoot)).filter((name) => openCodeDatabasePattern.test(name));
  } catch (error) {
    if (error?.code !== "ENOENT")
      diagnostics.push({ error: "OpenCode data directory could not be enumerated" });
  }
  const candidates = [
    ...(configuredPath ? [{ dataPath: configuredPath, configured: true }] : []),
    ...names.sort(databaseOrder).map((name) => ({ dataPath: join(dataRoot, name) })),
  ];
  const seen = new Set();
  const sources = [];
  for (const candidate of candidates) {
    const identity = await canonicalPathKey(candidate.dataPath);
    if (seen.has(identity)) continue;
    seen.add(identity);
    try {
      if (!(await stat(candidate.dataPath)).isFile()) continue;
    } catch {
      continue;
    }
    let compatible = false;
    try {
      compatible = await isCompatibleOpenCodeDatabase(candidate.dataPath);
    } catch {}
    if (!compatible) {
      const name = candidate.dataPath.split(/[\\/]/).at(-1) ?? "configured database";
      diagnostics.push({ error: `Ignored ${name}: incompatible OpenCode SQLite schema` });
      continue;
    }
    const configured = candidate.configured === true;
    const suggestedLabel = databaseLabel(configured, sources.length + 1);
    const legacyAutoSuggestedLabel = legacyDatabaseLabel(candidate.dataPath, configured);
    sources.push({
      dataPath: candidate.dataPath,
      collectionMethod: "opencode_sqlite",
      supportedSurface: "cli",
      suggestedLabel,
      ...(legacyAutoSuggestedLabel === suggestedLabel ? {} : { legacyAutoSuggestedLabel }),
    });
  }
  return sources;
}

const initialDataRoot = openCodeDataRoot();
const defaultPaths = [
  join(initialDataRoot, "opencode.db"),
  join(initialDataRoot, "opencode-prod.db"),
];
export const openCodeAdapter = Object.freeze({
  id: "opencode",
  displayName: "OpenCode",
  supportedSurfaces: ["cli"],
  collectionMethods: ["opencode_sqlite"],
  aggregationMode: "source_sum",
  trigger: "manual sync",
  defaultPaths,
  detect: detectOpenCodeSources,
  collect,
  diagnose: async (source) => {
    const diagnostic = await diagnosePath(source);
    if (!diagnostic.dataLocationAvailable) return diagnostic;
    try {
      if (await isCompatibleOpenCodeDatabase(source.dataPath)) return diagnostic;
    } catch {}
    return {
      ...diagnostic,
      status: "error",
      dataLocationAvailable: false,
      error: "incompatible OpenCode SQLite schema",
    };
  },
});

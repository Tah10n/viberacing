import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { readdir, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { diagnosticError } from "../diagnostics.mjs";
import {
  canonicalPathKey,
  componentEntry,
  diagnosePath,
  historyRetryGenerationForFiles,
  mergeEntries,
  utcDay,
  validateObservedEventLedger,
} from "./shared.mjs";

const openCodeParserVersion = 2;
const openCodeCutoverVersion = 1;
const maximumOpenCodeLedgerEvents = 65_536;
const maximumOpenCodeLedgerBytes = 16 * 1_024 * 1_024;

export const openCodeDatabasePattern = /^opencode(?:-[A-Za-z0-9._-]+)?\.db$/;

function analyzeOpenCodeMessages(rows) {
  const seen = new Set();
  const entries = [];
  const records = [];
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
    records.push({ id: row.id, entry });
  }
  return {
    entries: mergeEntries(entries),
    records,
    stats: { candidateRecords, parsedRecords, unsupportedCandidates },
  };
}

export function parseOpenCodeMessages(rows) {
  return analyzeOpenCodeMessages(rows).entries;
}

function validatedOpenCodeCutover(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify(["aliases", "confirmedRangeEnd", "confirmedSequence", "version"]) ||
    value.version !== openCodeCutoverVersion ||
    !/^(?:0|[1-9]\d*)$/.test(value.confirmedSequence ?? "") ||
    value.confirmedSequence === "0" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.confirmedRangeEnd ?? "") ||
    !value.aliases ||
    typeof value.aliases !== "object" ||
    Array.isArray(value.aliases) ||
    Object.entries(value.aliases).some(
      ([key, date]) => !/^[0-9a-f]{64}$/.test(key) || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? ""),
    ) ||
    Object.keys(value.aliases).length > maximumOpenCodeLedgerEvents ||
    Buffer.byteLength(JSON.stringify(value.aliases)) > maximumOpenCodeLedgerBytes
  )
    throw diagnosticError(
      "OpenCode requires one confirmed sync with connector 0.4.4 before upgrading to 0.5.0.",
      "opencode_cutover_required",
    );
  return value;
}

async function collect(source, range, state = {}) {
  const { DatabaseSync } = await import("node:sqlite");
  let database;
  try {
    database = new DatabaseSync(source.dataPath, { readOnly: true });
    const bootstrapping = state.bootstrapComplete !== true && state.serverBaseline !== undefined;
    const baselineState = bootstrapping ? state.serverBaseline : state;
    const baselineEntries = bootstrapping ? baselineState?.entries : (state.legacyBaseline ?? []);
    const cutover = bootstrapping ? validatedOpenCodeCutover(state.cutover) : null;
    if (
      !Array.isArray(baselineEntries) ||
      baselineEntries.length > 31 ||
      !baselineEntries.every(
        (entry) =>
          entry &&
          /^\d{4}-\d{2}-\d{2}$/.test(entry.date ?? "") &&
          /^(?:0|[1-9]\d*)$/.test(entry.totalTokens ?? ""),
      ) ||
      (bootstrapping &&
        (typeof baselineState.acceptedAt !== "string" ||
          new Date(baselineState.acceptedAt).toISOString() !== baselineState.acceptedAt ||
          !/^(?:0|[1-9]\d*)$/.test(baselineState.acceptedSequence ?? "") ||
          baselineState.acceptedSequence !== cutover.confirmedSequence))
    )
      throw diagnosticError(
        "OpenCode requires one confirmed sync with connector 0.4.4 before upgrading to 0.5.0.",
        "opencode_cutover_required",
      );
    const legacyBaseline = baselineEntries.filter(
      (entry) => entry.date >= range.rangeStart && entry.date <= range.rangeEnd,
    );
    const rows = database
      .prepare(
        `SELECT id, time_created, data
           FROM message
          WHERE time_created >= ? AND time_created < ?
          ORDER BY time_created, id
          LIMIT ${String(maximumOpenCodeLedgerEvents + 1)}`,
      )
      .all(
        Date.parse(`${range.rangeStart}T00:00:00.000Z`),
        Date.parse(`${range.rangeEnd}T00:00:00.000Z`) + 86_400_000,
      );
    const scanLimited = rows.length > maximumOpenCodeLedgerEvents;
    const analysis = analyzeOpenCodeMessages(rows);
    const unsupported = analysis.stats.unsupportedCandidates > 0;
    const previousLedger =
      state.parserVersion === openCodeParserVersion && state.ledger !== undefined
        ? state.ledger
        : {};
    validateObservedEventLedger(previousLedger, openCodeParserVersion);
    const legacyAliases = {};
    if (bootstrapping) {
      for (const [key, date] of Object.entries(cutover.aliases))
        if (date >= range.rangeStart && date <= range.rangeEnd) legacyAliases[key] = date;
    } else
      for (const [key, date] of Object.entries(state.legacyAliases ?? {})) {
        if (!/^[0-9a-f]{64}$/.test(key) || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? ""))
          throw new Error("OpenCode legacy alias state is invalid");
        if (date >= range.rangeStart && date <= range.rangeEnd) legacyAliases[key] = date;
      }
    if (
      Object.keys(legacyAliases).length > maximumOpenCodeLedgerEvents ||
      Buffer.byteLength(JSON.stringify(legacyAliases)) > maximumOpenCodeLedgerBytes
    )
      throw new Error("OpenCode legacy alias state is invalid");
    const ledger = { ...previousLedger };
    for (const [key, event] of Object.entries(ledger))
      if (event.date < range.rangeStart || event.date > range.rangeEnd) delete ledger[key];
    let ledgerCount = Object.keys(ledger).length;
    let ledgerBytes = Buffer.byteLength(JSON.stringify(ledger));
    let identityConflict = false;
    let overflow = state.parserVersion === openCodeParserVersion ? state.overflow : undefined;
    if (overflow !== undefined) {
      if (
        !overflow ||
        typeof overflow !== "object" ||
        !/^[0-9a-f]{64}$/.test(overflow.key ?? "") ||
        validateObservedEventLedger({ [overflow.key]: overflow.event }, openCodeParserVersion) !== 1
      )
        throw new Error("OpenCode overflow checkpoint is invalid");
      if (overflow.event.date < range.rangeStart || overflow.event.date > range.rangeEnd)
        overflow = undefined;
      else {
        const overflowBytes = Buffer.byteLength(JSON.stringify([overflow.key, overflow.event]));
        if (
          ledgerCount < maximumOpenCodeLedgerEvents &&
          ledgerBytes + overflowBytes <= 16 * 1_024 * 1_024
        ) {
          ledger[overflow.key] = overflow.event;
          ledgerCount += 1;
          ledgerBytes += overflowBytes;
          overflow = undefined;
        }
      }
    }
    for (const { id, entry } of analysis.records) {
      const key = createHash("sha256").update(id).digest("hex");
      if (legacyAliases[key] !== undefined) {
        if (legacyAliases[key] !== entry.date) identityConflict = true;
        continue;
      }
      const { date, ...usage } = entry;
      const candidate = { date, usage, parserVersion: openCodeParserVersion };
      const candidateBytes = Buffer.byteLength(JSON.stringify([key, candidate]));
      if (overflow?.key === key) {
        if (JSON.stringify(overflow.event) !== JSON.stringify(candidate)) identityConflict = true;
      } else if (ledger[key] === undefined) {
        if (
          ledgerCount >= maximumOpenCodeLedgerEvents ||
          ledgerBytes + candidateBytes > maximumOpenCodeLedgerBytes
        ) {
          overflow ??= { key, event: candidate };
          break;
        }
        ledger[key] = candidate;
        ledgerCount += 1;
        ledgerBytes += candidateBytes;
      } else if (JSON.stringify(ledger[key]) !== JSON.stringify(candidate)) identityConflict = true;
    }
    const bounded =
      Object.keys(ledger).length <= maximumOpenCodeLedgerEvents &&
      Buffer.byteLength(JSON.stringify(ledger)) <= maximumOpenCodeLedgerBytes;
    const aliasesBounded =
      Object.keys(legacyAliases).length <= maximumOpenCodeLedgerEvents &&
      Buffer.byteLength(JSON.stringify(legacyAliases)) <= maximumOpenCodeLedgerBytes;
    const legacyCutoverDate = bootstrapping
      ? cutover.confirmedRangeEnd
      : (state.legacyCutoverDate ?? null);
    if (!(legacyCutoverDate === null || /^\d{4}-\d{2}-\d{2}$/.test(legacyCutoverDate)))
      throw new Error("OpenCode cutover state is invalid");
    const legacyWindowActive = legacyCutoverDate !== null && range.rangeStart <= legacyCutoverDate;
    const partial =
      unsupported ||
      identityConflict ||
      scanLimited ||
      !bounded ||
      !aliasesBounded ||
      overflow !== undefined ||
      legacyWindowActive;
    const commitLedger = !unsupported && !scanLimited && bounded && aliasesBounded;
    const nextState = commitLedger
      ? {
          parserVersion: openCodeParserVersion,
          bootstrapComplete: true,
          legacyAcceptedAt: bootstrapping
            ? baselineState.acceptedAt
            : (state.legacyAcceptedAt ?? null),
          legacyCutoverDate,
          legacyBaseline,
          legacyAliases,
          ledger,
          ...(overflow === undefined ? {} : { overflow }),
        }
      : state;
    const entries = mergeEntries([
      ...legacyBaseline,
      ...Object.values(commitLedger ? ledger : previousLedger).map((event) => ({
        date: event.date,
        ...event.usage,
      })),
    ]);
    return {
      entries,
      completeness: partial ? "partial" : "complete",
      nextState,
      warnings: [
        ...(unsupported ? ["unsupported_usage_records"] : []),
        ...(identityConflict ? ["local_event_identity_conflict"] : []),
        ...(scanLimited || !bounded || !aliasesBounded
          ? ["collector_limits_or_unreadable_files"]
          : []),
      ],
      diagnostics: [
        ...(unsupported ? [{ code: "local_store_schema_unsupported", phase: "collect" }] : []),
        ...(identityConflict ? [{ code: "local_event_identity_conflict", phase: "collect" }] : []),
        ...(scanLimited || !bounded || !aliasesBounded
          ? [{ code: "local_store_scan_limit", phase: "collect" }]
          : []),
      ],
    };
  } catch (error) {
    if (error?.diagnosticCode === "opencode_cutover_required") throw error;
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
  accountSwitchMode: "combined_local_history",
  trigger: "manual sync",
  defaultPaths,
  detect: detectOpenCodeSources,
  historyRetryGeneration: (source) =>
    historyRetryGenerationForFiles([
      source.dataPath,
      `${source.dataPath}-wal`,
      `${source.dataPath}-shm`,
    ]),
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

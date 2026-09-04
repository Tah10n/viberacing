import { lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { readCursorLedger } from "../cursor-ledger.mjs";
import { diagnosticError } from "../diagnostics.mjs";
import { inspectOwnerOnlyWindowsDirectory } from "../windows-security.mjs";
import { mergeEntries } from "./shared.mjs";

async function defaultStateRoot() {
  return (await import("../config.mjs")).stateDirectory;
}

function profileId(source) {
  return source.profileClientSourceId ?? source.clientSourceId;
}
function validDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

export async function detectCursorProfile({ home = homedir() } = {}) {
  const root = join(home, ".cursor");
  try {
    const info = await lstat(root);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (typeof process.getuid === "function" &&
        (info.uid !== process.getuid() || (info.mode & 0o022) !== 0)) ||
      !(await inspectOwnerOnlyWindowsDirectory(root))
    )
      return [];
    return [
      {
        dataPath: root,
        hookConfigRoot: root,
        suggestedLabel: "Cursor",
        collectionMethod: "cursor_local_events",
        supportedSurface: "desktop",
      },
    ];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw diagnosticError("Cursor profile is unavailable", "cursor_hook_missing");
  }
}

export async function collectCursor(source, range, state = {}, context = {}) {
  if (
    source.agentId !== "cursor" ||
    source.collectionMethod !== "cursor_local_events" ||
    !/^acct1_[A-Za-z0-9_-]{43}$/.test(source.providerAccountKey ?? "")
  )
    throw diagnosticError(
      "Cursor account has no captured identity",
      "cursor_account_identity_unavailable",
    );
  if (
    !validDay(range?.rangeStart) ||
    !validDay(range?.rangeEnd) ||
    range.rangeStart > range.rangeEnd
  )
    throw diagnosticError("Cursor capture range is invalid", "cursor_usage_incomplete");
  const now = context.now ?? new Date().toISOString();
  const ledger = await readCursorLedger(
    context.stateRoot ?? (await defaultStateRoot()),
    profileId(source),
    now,
    { checkpoint: state.checkpoint },
  );
  if (!ledger.previousCheckpointMatches)
    throw diagnosticError("Cursor capture history changed unexpectedly", "cursor_usage_incomplete");
  if (!ledger.accounts.some((account) => account.accountKey === source.providerAccountKey))
    throw diagnosticError(
      "Cursor account has no captured identity",
      "cursor_account_identity_unavailable",
    );
  const entries = mergeEntries(
    ledger.events
      .filter(
        (event) =>
          event.accountKey === source.providerAccountKey &&
          event.date >= range.rangeStart &&
          event.date <= range.rangeEnd,
      )
      .map((event) => ({ date: event.date, ...event.tokens })),
  );
  const gaps = ledger.gaps.filter(
    (gap) => gap.from.slice(0, 10) <= range.rangeEnd && gap.to.slice(0, 10) >= range.rangeStart,
  );
  const partial =
    context.hooksCurrent !== true ||
    !ledger.captureStartedAt ||
    `${range.rangeStart}T00:00:00.000Z` < ledger.captureStartedAt ||
    range.rangeEnd >= now.slice(0, 10) ||
    gaps.length > 0 ||
    ledger.torn;
  return {
    entries,
    completeness: partial ? "partial" : "complete",
    retentionSafe: !ledger.torn,
    warnings: partial ? ["cursor_capture_partial"] : [],
    diagnostics: [...new Set(gaps.map((gap) => gap.code))].map((code) => ({
      code,
      phase: "collect",
    })),
    nextState: {
      parserVersion: 1,
      ...(ledger.checkpoint ? { checkpoint: ledger.checkpoint } : {}),
    },
    cursorCheckpoint: ledger.checkpoint,
  };
}

export const cursorAdapter = Object.freeze({
  id: "cursor",
  displayName: "Cursor",
  supportedSurfaces: ["desktop", "cli"],
  collectionMethods: ["cursor_local_events"],
  aggregationMode: "source_sum",
  accountSwitchMode: "provider_account_events",
  exactAccounting: true,
  trigger: "Cursor stop/sessionEnd hooks and viberacing run cursor",
  defaultPaths: [],
  detect: detectCursorProfile,
  collect: collectCursor,
  historyRetryGeneration: async (source) =>
    (await readCursorLedger(await defaultStateRoot(), profileId(source))).checkpoint?.sha256,
  diagnose: async (source) => {
    try {
      const ledger = await readCursorLedger(await defaultStateRoot(), profileId(source));
      return {
        status: ledger.torn ? "unavailable" : "ok",
        dataLocationAvailable: !ledger.torn,
        collectionMethod: "cursor_local_events",
        supportedSurfaces: ["desktop", "cli"],
        excluded: ["Usage before capture installation"],
      };
    } catch {
      return {
        status: "unavailable",
        dataLocationAvailable: false,
        collectionMethod: "cursor_local_events",
        supportedSurfaces: ["desktop", "cli"],
        excluded: ["Usage before capture installation"],
      };
    }
  },
});

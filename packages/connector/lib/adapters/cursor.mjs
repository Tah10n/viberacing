import { lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  readCursorLedger,
  recordCursorHookObservation,
  reserveCursorEvents,
} from "../cursor-ledger.mjs";
import { diagnosticError } from "../diagnostics.mjs";
import { inspectOwnerOnlyWindowsDirectory } from "../windows-security.mjs";
import { mergeEntries } from "./shared.mjs";
import { resolveCursorExecutable } from "../cursor-cli.mjs";

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

export async function detectCursorProfile({
  home = homedir(),
  environment = process.env,
  resolveExecutable = resolveCursorExecutable,
} = {}) {
  const root = join(home, ".cursor");
  const source = {
    dataPath: root,
    hookConfigRoot: root,
    suggestedLabel: "Cursor",
    collectionMethod: "cursor_local_events",
    supportedSurface: "desktop",
  };
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
    return [source];
  } catch (error) {
    if (error.code === "ENOENT") {
      try {
        const executable = await resolveExecutable({ environment, home });
        return [{ ...source, executablePath: executable.path }];
      } catch {
        return [];
      }
    }
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
  const stateRoot = context.stateRoot ?? (await defaultStateRoot());
  if (context.hookObservation) {
    await recordCursorHookObservation(stateRoot, profileId(source), context.hookObservation, now);
  } else if (!context.stateRoot) {
    try {
      const { prepareCursorCollection } = await import("../config.mjs");
      if (!(await prepareCursorCollection(source, now, range))) throw new Error("inactive");
    } catch {
      throw diagnosticError("Cursor hook continuity is unavailable", "cursor_hook_stale");
    }
  }
  if (context.stateRoot && source.sourceId)
    await reserveCursorEvents(
      stateRoot,
      profileId(source),
      {
        sourceId: source.sourceId,
        accountKey: source.providerAccountKey,
        rangeStart: range.rangeStart,
        rangeEnd: range.rangeEnd,
      },
      now,
    );
  const ledger = await readCursorLedger(stateRoot, profileId(source), now);
  if (!ledger.previousCheckpointMatches)
    throw diagnosticError("Cursor capture history changed unexpectedly", "cursor_usage_incomplete");
  if (!ledger.accounts.some((account) => account.accountKey === source.providerAccountKey)) {
    const error = diagnosticError(
      "Cursor account has no captured identity",
      "cursor_account_identity_unavailable",
    );
    error.inactiveProviderAccount = ledger.accounts.length > 0;
    throw error;
  }
  const inRange = ledger.events.filter(
    (event) =>
      event.accountKey === source.providerAccountKey &&
      event.date >= range.rangeStart &&
      event.date <= range.rangeEnd,
  );
  const sourceId = source.sourceId?.toLowerCase();
  const owned = sourceId
    ? inRange.filter((event) => ledger.eventOwners[event.eventKey] === sourceId)
    : inRange;
  const ownershipPartial = owned.length !== inRange.length;
  const entries = mergeEntries(owned.map((event) => ({ date: event.date, ...event.tokens })));
  const gaps = ledger.gaps.filter(
    (gap) => gap.from.slice(0, 10) <= range.rangeEnd && gap.to.slice(0, 10) >= range.rangeStart,
  );
  const rangeEndExclusive = new Date(
    Date.parse(`${range.rangeEnd}T00:00:00.000Z`) + 86_400_000,
  ).toISOString();
  const covered = ledger.currentIntervals.some(
    (interval) =>
      interval.from <= `${range.rangeStart}T00:00:00.000Z` && interval.to >= rangeEndExclusive,
  );
  const partial =
    ownershipPartial ||
    !covered ||
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
    diagnostics: [
      ...new Set([
        ...gaps.map((gap) => gap.code),
        ...(ownershipPartial ? ["cursor_usage_incomplete"] : []),
      ]),
    ].map((code) => ({
      code,
      phase: "collect",
    })),
    nextState: {
      parserVersion: 1,
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

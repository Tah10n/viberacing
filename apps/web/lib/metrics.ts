import { logInfo } from "./log";

type Metric =
  | "admitted"
  | "deniedClient"
  | "deniedGlobal"
  | "earlyRejected"
  | "overloaded"
  | "dbOperations"
  | "dbDurationMs"
  | "dbWaiting"
  | "limiterKeys"
  | "publicReads"
  | "publicReadMs"
  | "httpRequests"
  | "http5xx"
  | "http429"
  | "suppressedLogs";
interface ProtectionMetrics {
  values: Partial<Record<Metric, number>>;
  nextReport: number;
  logged: number;
  logWindow: number;
}
const shared = globalThis as typeof globalThis & {
  viberacingProtectionMetrics?: ProtectionMetrics;
};
const state = (shared.viberacingProtectionMetrics ??= {
  values: {},
  nextReport: Date.now() + 60000,
  logged: 0,
  logWindow: 0,
});

export function metric(name: Metric, value = 1, gauge = false): void {
  state.values[name] = gauge ? value : (state.values[name] ?? 0) + value;
  if (Date.now() < state.nextReport) return;
  state.nextReport = Date.now() + 60000;
  try {
    logInfo("protection_summary", { ...state.values, rssBytes: process.memoryUsage().rss });
  } catch {
    /* Observability must not affect admission. */
  }
  state.values = {};
}

export function allowRequestLog(): boolean {
  const window = Math.floor(Date.now() / 60000);
  if (window !== state.logWindow) {
    state.logWindow = window;
    state.logged = 0;
  }
  if (state.logged >= 100) {
    metric("suppressedLogs");
    return false;
  }
  state.logged += 1;
  return true;
}

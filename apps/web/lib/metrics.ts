import { isLogLevelEnabled, logInfo, type LogLevel } from "./log";

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
  errorsLogged: number;
  logWindow: number;
}
const shared = globalThis as typeof globalThis & {
  viberacingProtectionMetrics?: ProtectionMetrics;
};
const state = (shared.viberacingProtectionMetrics ??= {
  values: {},
  nextReport: Date.now() + 60000,
  logged: 0,
  errorsLogged: 0,
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

export function allowRequestLog(level: Exclude<LogLevel, "silent"> = "info"): boolean {
  if (!isLogLevelEnabled(level)) return false;
  const window = Math.floor(Date.now() / 60000);
  if (window !== state.logWindow) {
    state.logWindow = window;
    state.logged = 0;
    state.errorsLogged = 0;
  }
  // Reserve bounded diagnostics capacity: routine traffic cannot spend error slots.
  const bucket = level === "error" ? "errorsLogged" : "logged";
  const maximum = level === "error" ? 20 : 100;
  if (state[bucket] >= maximum) {
    metric("suppressedLogs");
    return false;
  }
  state[bucket] += 1;
  return true;
}

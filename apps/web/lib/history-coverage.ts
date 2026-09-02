import { addUtcDays, type ResolvedUsagePeriod } from "./usage-period";

export type UsageChartStatus = "complete" | "partial" | "no-data";

interface SourceCoverage {
  readonly included: boolean;
  readonly historyBackfillYear: number | null;
  readonly historyBackfillStatus: "pending" | "complete" | "partial";
  readonly lastCompleteness: "complete" | "partial" | null;
  readonly lastRollingRangeStart: string | null;
  readonly lastRollingRangeEnd: string | null;
}

export function sourcePeriodIncomplete(
  resolved: ResolvedUsagePeriod,
  rollingToday: string,
  source: SourceCoverage,
): boolean {
  if (!source.included) return false;
  const selectedIntersectsPartialRolling =
    source.lastCompleteness === "partial" &&
    source.lastRollingRangeStart !== null &&
    source.lastRollingRangeEnd !== null &&
    source.lastRollingRangeStart < resolved.toExclusive &&
    source.lastRollingRangeEnd >= resolved.from;
  const rollingStart = addUtcDays(rollingToday, -30);
  const selectedIntersectsUnfinishedHistory =
    resolved.from < rollingStart &&
    (source.historyBackfillYear !== Number(rollingToday.slice(0, 4)) ||
      source.historyBackfillStatus !== "complete");
  return selectedIntersectsPartialRolling || selectedIntersectsUnfinishedHistory;
}

export function usageChartStatus(
  resolved: ResolvedUsagePeriod,
  rollingToday: string,
  options: {
    readonly hasUsage: boolean;
    readonly hasPartialAccount: boolean;
    readonly historyIncomplete: boolean;
  },
): UsageChartStatus {
  const rollingStart = addUtcDays(rollingToday, -30);
  const selectedHistoryIncomplete = resolved.from < rollingStart && options.historyIncomplete;
  if (options.hasPartialAccount || selectedHistoryIncomplete) return "partial";
  return options.hasUsage ? "complete" : "no-data";
}

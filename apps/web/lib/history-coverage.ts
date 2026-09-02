import { addUtcDays, type ResolvedUsagePeriod } from "./usage-period";

export type UsageChartStatus = "complete" | "partial" | "no-data";

interface SourceCoverage {
  readonly included: boolean;
  readonly aggregationMode: "account_max" | "source_sum";
  readonly historyBackfillYear: number | null;
  readonly historyBackfillStatus: "pending" | "complete" | "partial";
  readonly lastCompleteness: "complete" | "partial" | null;
  readonly lastRollingRangeStart: string | null;
  readonly lastRollingRangeEnd: string | null;
  readonly lastRollingIncompleteDates: readonly string[] | null;
  readonly provenAccountDates: ReadonlySet<string>;
}

export function sourcePeriodIncomplete(
  resolved: ResolvedUsagePeriod,
  rollingToday: string,
  source: SourceCoverage,
): boolean {
  if (!source.included) return false;
  const rollingStart = addUtcDays(rollingToday, -30);
  let selectedIntersectsPartialRolling = false;
  if (source.lastCompleteness === "partial") {
    if (
      source.lastRollingRangeStart === null ||
      source.lastRollingRangeEnd === null ||
      source.lastRollingIncompleteDates === null
    ) {
      selectedIntersectsPartialRolling = resolved.toExclusive > rollingStart;
    } else {
      selectedIntersectsPartialRolling = source.lastRollingIncompleteDates.some(
        (date) =>
          date >= resolved.from &&
          date < resolved.toExclusive &&
          (source.aggregationMode === "source_sum" || !source.provenAccountDates.has(date)),
      );
    }
  }
  const historyEnd = resolved.toExclusive < rollingStart ? resolved.toExclusive : rollingStart;
  let selectedIntersectsUnfinishedHistory =
    resolved.from < historyEnd &&
    (source.historyBackfillYear !== Number(rollingToday.slice(0, 4)) ||
      source.historyBackfillStatus !== "complete");
  if (selectedIntersectsUnfinishedHistory && source.aggregationMode === "account_max") {
    selectedIntersectsUnfinishedHistory = false;
    for (let date = resolved.from; date < historyEnd; date = addUtcDays(date, 1)) {
      if (!source.provenAccountDates.has(date)) {
        selectedIntersectsUnfinishedHistory = true;
        break;
      }
    }
  }
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

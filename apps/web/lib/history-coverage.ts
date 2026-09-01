import { addUtcDays, type ResolvedUsagePeriod } from "./usage-period";

export type UsageChartStatus = "complete" | "partial" | "no-data";

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

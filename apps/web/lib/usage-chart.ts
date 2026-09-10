import { addUtcDays, utcDate } from "./usage-period";

export type UsageChartUnit = "day" | "week" | "month" | "year";
export interface UsageChartBucket {
  readonly key: string;
  readonly date: string;
  readonly to: string;
  readonly partial: boolean;
  readonly tokens: string;
}

export function usageChartDayCount(from: string, to: string): number {
  return (
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
  );
}

export function usageChartUnit(size: number): UsageChartUnit {
  if (size <= 45) return "day";
  if (size <= 210) return "week";
  if (size <= 900) return "month";
  return "year";
}

export function usageChartBucketStart(date: string, unit: UsageChartUnit): string {
  if (unit === "year") return `${date.slice(0, 4)}-01-01`;
  if (unit === "month") return `${date.slice(0, 7)}-01`;
  if (unit === "week")
    return addUtcDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
  return date;
}

export function usageChartNextBucket(date: string, unit: UsageChartUnit): string {
  if (unit === "day" || unit === "week") return addUtcDays(date, unit === "day" ? 1 : 7);
  const next = new Date(`${date}T00:00:00Z`);
  if (unit === "month") next.setUTCMonth(next.getUTCMonth() + 1);
  else next.setUTCFullYear(next.getUTCFullYear() + 1);
  return next.toISOString().slice(0, 10);
}

export function usageChartBuckets(
  from: string,
  to: string,
  unit: UsageChartUnit,
  totals: ReadonlyMap<string, string> = new Map(),
): UsageChartBucket[] {
  if (utcDate(from) === null || utcDate(to) === null || from > to)
    throw new RangeError("Invalid chart range");
  const buckets: UsageChartBucket[] = [];
  for (let key = usageChartBucketStart(from, unit); key <= to;) {
    if (buckets.length >= 366) throw new RangeError("Chart range is too large");
    const next = usageChartNextBucket(key, unit);
    const end = addUtcDays(next, -1);
    buckets.push({
      key,
      date: key < from ? from : key,
      to: end > to ? to : end,
      partial: key < from || end > to,
      tokens: totals.get(key) ?? "0",
    });
    key = next;
  }
  return buckets;
}

export function aggregateUsageChartDays(
  days: readonly { date: string; tokens: string }[],
  from: string,
  to: string,
  unit: UsageChartUnit,
): UsageChartBucket[] {
  const totals = new Map<string, string>();
  for (const day of days) {
    if (day.date < from || day.date > to) continue;
    const key = usageChartBucketStart(day.date, unit);
    totals.set(key, (BigInt(totals.get(key) ?? "0") + BigInt(day.tokens)).toString());
  }
  return usageChartBuckets(from, to, unit, totals);
}

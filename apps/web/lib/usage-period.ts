export type UsagePeriod =
  | { readonly kind: "week" }
  | { readonly kind: "month" }
  | { readonly kind: "year" }
  | { readonly kind: "custom"; readonly from: string; readonly to: string };

export interface ResolvedUsagePeriod {
  readonly period: UsagePeriod;
  readonly from: string;
  readonly toInclusive: string;
  readonly toExclusive: string;
}

export type UsagePeriodSearchParams = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const millisecondsPerDay = 86_400_000;

function one(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function utcDate(value: string): Date | null {
  if (!isoDatePattern.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value ? date : null;
}

export function utcToday(now = new Date()): string {
  if (Number.isNaN(now.valueOf())) throw new RangeError("A valid current time is required.");
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

export function addUtcDays(date: string, days: number): string {
  const parsed = utcDate(date);
  if (parsed === null || !Number.isSafeInteger(days))
    throw new RangeError("Invalid UTC date range.");
  return new Date(parsed.valueOf() + days * millisecondsPerDay).toISOString().slice(0, 10);
}

export function currentUtcYearStart(now = new Date()): string {
  const today = utcToday(now);
  return `${today.slice(0, 4)}-01-01`;
}

export function currentUtcWeekStart(now = new Date()): string {
  const today = utcToday(now);
  const date = utcDate(today) as Date;
  return addUtcDays(today, -((date.getUTCDay() + 6) % 7));
}

export function currentUtcMonthStart(now = new Date()): string {
  const today = utcToday(now);
  return `${today.slice(0, 7)}-01`;
}

export function parseUsagePeriod(
  searchParams: UsagePeriodSearchParams,
  now = new Date(),
): UsagePeriod {
  const kind = one(searchParams.period);
  if (kind === "month") return { kind };
  if (kind === "year") return { kind };
  if (kind !== "custom") return { kind: "week" };

  const from = one(searchParams.from);
  const to = one(searchParams.to);
  if (from === undefined || to === undefined || utcDate(from) === null || utcDate(to) === null) {
    return { kind: "week" };
  }
  const yearStart = currentUtcYearStart(now);
  const today = utcToday(now);
  if (from < yearStart || from > to || to > today) return { kind: "week" };
  return { kind: "custom", from, to };
}

export function resolveUsagePeriod(period: UsagePeriod, now = new Date()): ResolvedUsagePeriod {
  const today = utcToday(now);
  if (period.kind === "custom") {
    const normalized = parseUsagePeriod(
      { period: "custom", from: period.from, to: period.to },
      now,
    );
    if (normalized.kind !== "custom") throw new RangeError("Invalid custom usage period.");
    return {
      period: normalized,
      from: normalized.from,
      toInclusive: normalized.to,
      toExclusive: addUtcDays(normalized.to, 1),
    };
  }

  if (period.kind === "year") {
    return {
      period,
      from: currentUtcYearStart(now),
      toInclusive: today,
      toExclusive: addUtcDays(today, 1),
    };
  }

  if (period.kind === "month") {
    const from = currentUtcMonthStart(now);
    const nextMonth = new Date(`${from}T00:00:00.000Z`);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    const toExclusive = nextMonth.toISOString().slice(0, 10);
    return {
      period,
      from,
      toInclusive: addUtcDays(toExclusive, -1),
      toExclusive,
    };
  }

  const from = currentUtcWeekStart(now);
  const toExclusive = addUtcDays(from, 7);
  return {
    period,
    from,
    toInclusive: addUtcDays(toExclusive, -1),
    toExclusive,
  };
}

export function usagePeriodSearch(period: UsagePeriod): string {
  const params = new URLSearchParams({ period: period.kind });
  if (period.kind === "custom") {
    params.set("from", period.from);
    params.set("to", period.to);
  }
  return params.toString();
}

const rangeDayFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const rangeYearFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function usagePeriodTitle(period: UsagePeriod): string {
  if (period.kind === "week") return "This week";
  if (period.kind === "month") return "This month";
  if (period.kind === "year") return "All time";
  return "Selected range";
}

export function usagePeriodRangeLabel(resolved: ResolvedUsagePeriod): string {
  const from = utcDate(resolved.from) as Date;
  const to = utcDate(resolved.toInclusive) as Date;
  const fromLabel =
    from.getUTCFullYear() === to.getUTCFullYear()
      ? rangeDayFormatter.format(from)
      : rangeYearFormatter.format(from);
  return `${fromLabel}–${rangeYearFormatter.format(to)} · UTC`;
}

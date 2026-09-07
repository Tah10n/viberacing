import { addUtcDays } from "./usage-period";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function usageSeries(
  from: string,
  toExclusive: string,
  today: string,
  usage: readonly { usage_date: string; tokens: string }[],
): readonly { date: string; label: string; tokens: string }[] {
  const totals = new Map(usage.map((entry) => [entry.usage_date, entry.tokens]));
  const end = toExclusive < addUtcDays(today, 1) ? toExclusive : addUtcDays(today, 1);
  const days = [];
  for (let date = from; date < end; date = addUtcDays(date, 1)) {
    days.push({
      date,
      label: dateFormatter.format(new Date(`${date}T00:00:00.000Z`)),
      tokens: totals.get(date) ?? "0",
    });
  }
  return days;
}

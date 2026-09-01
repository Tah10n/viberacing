import Link from "next/link";
import { usagePeriodSearch, type ResolvedUsagePeriod, type UsagePeriod } from "@/lib/usage-period";

interface PeriodSelectorProps {
  readonly basePath: "/" | "/dashboard";
  readonly period: UsagePeriod;
  readonly resolved: ResolvedUsagePeriod;
}

const presets = [
  ["week", "Week"],
  ["month", "Month"],
  ["year", "All time"],
] as const;

export function PeriodSelector({ basePath, period, resolved }: PeriodSelectorProps) {
  const today = resolved.toInclusive;
  const yearStart = `${today.slice(0, 4)}-01-01`;
  return (
    <div className="period-selector" aria-label="Usage period">
      <nav aria-label="Preset usage periods" className="period-presets">
        {presets.map(([kind, label]) => (
          <Link
            aria-current={period.kind === kind ? "page" : undefined}
            className={
              period.kind === kind ? "period-option period-option-active" : "period-option"
            }
            href={`${basePath}?${usagePeriodSearch({ kind })}`}
            key={kind}
          >
            {label}
          </Link>
        ))}
      </nav>
      <details className="custom-period" open={period.kind === "custom"}>
        <summary
          className={
            period.kind === "custom" ? "period-option period-option-active" : "period-option"
          }
        >
          Custom
        </summary>
        <form action={basePath} className="custom-period-form" method="get">
          <input name="period" type="hidden" value="custom" />
          <label>
            <span>From</span>
            <input
              defaultValue={
                period.kind === "custom"
                  ? period.from
                  : resolved.from < yearStart
                    ? yearStart
                    : resolved.from
              }
              max={today}
              min={yearStart}
              name="from"
              required
              type="date"
            />
          </label>
          <label>
            <span>To</span>
            <input
              defaultValue={period.kind === "custom" ? period.to : today}
              max={today}
              min={yearStart}
              name="to"
              required
              type="date"
            />
          </label>
          <button className="button button-secondary" type="submit">
            Apply range
          </button>
        </form>
      </details>
    </div>
  );
}

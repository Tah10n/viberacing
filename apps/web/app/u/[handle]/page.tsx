import { connection } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PeriodSelector } from "../../components/period-selector";
import { PageHeader, PageShell, Panel } from "../../components/ui";
import { formatCompactTokens, formatExactTokens, publicProfile } from "@/lib/leaderboard";
import {
  parseUsagePeriod,
  utcToday,
  resolveUsagePeriod,
  usagePeriodRangeLabel,
  usagePeriodSearch,
  usagePeriodTitle,
} from "@/lib/usage-period";

interface ProfileProps {
  params: Promise<{ handle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ProfilePage({ params, searchParams }: ProfileProps) {
  await connection();
  const now = new Date();
  const [{ handle }, query] = await Promise.all([params, searchParams]);
  if (!/^[A-Za-z0-9-]{1,39}$/.test(handle)) notFound();
  const period = parseUsagePeriod(query, now);
  const resolved = resolveUsagePeriod(period, now);
  const periodTitle = usagePeriodTitle(period);
  const periodSearch = usagePeriodSearch(period);
  const profile = await publicProfile(handle, resolved);
  if (profile === null) notFound();
  return (
    <PageShell className="profile-page" width="narrow">
      <Link className="back-link" href={`/?${periodSearch}`}>
        Back to standings
      </Link>
      <PageHeader
        description={`Self-reported usage · ${usagePeriodRangeLabel(resolved)}`}
        eyebrow="Racer profile"
        title={`@${profile.handle}`}
      />
      <PeriodSelector
        basePath={`/u/${encodeURIComponent(profile.handle)}`}
        period={period}
        resolved={resolved}
        today={utcToday(now)}
      />
      <section className="score-card" aria-label={`${periodTitle} score`}>
        <div>
          <span>{periodTitle} rank</span>
          <strong>{profile.rank === null ? "—" : `#${profile.rank}`}</strong>
        </div>
        <div>
          <span>Total usage</span>
          <strong title={`${formatExactTokens(profile.total)} tokens`}>
            {formatCompactTokens(profile.total)}
          </strong>
          <small className="exact-tokens">{formatExactTokens(profile.total)} tokens</small>
        </div>
      </section>
      <Panel>
        <div className="panel-heading">
          <h2>Usage by agent</h2>
          <span>{profile.breakdown.length} with usage</span>
        </div>
        {profile.breakdown.length === 0 ? (
          <p className="muted">No recorded usage in this period.</p>
        ) : null}
        {profile.breakdown.map((item) => (
          <div className="breakdown" key={item.agent}>
            <div>
              <strong>{item.label}</strong>
              <span>{periodTitle} aggregate</span>
            </div>
            <div className="profile-token-value">
              <strong>{formatCompactTokens(item.tokens)}</strong>
              <small className="exact-tokens">{formatExactTokens(item.tokens)} tokens</small>
            </div>
          </div>
        ))}
        <p className="muted">Token totals are self-reported by local connectors.</p>
      </Panel>
    </PageShell>
  );
}

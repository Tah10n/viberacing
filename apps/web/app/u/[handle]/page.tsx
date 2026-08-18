import { connection } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader, PageShell, Panel } from "../../components/ui";
import {
  currentWeekLabel,
  formatCompactTokens,
  formatExactTokens,
  publicProfile,
} from "@/lib/leaderboard";

interface ProfileProps {
  params: Promise<{ handle: string }>;
}

export default async function ProfilePage({ params }: ProfileProps) {
  await connection();
  const { handle } = await params;
  if (!/^[A-Za-z0-9-]{1,39}$/.test(handle)) notFound();
  const profile = await publicProfile(handle);
  if (profile === null) notFound();
  return (
    <PageShell className="profile-page" width="narrow">
      <Link className="back-link" href="/">
        Back to standings
      </Link>
      <PageHeader
        description={`Self-reported weekly usage · ${currentWeekLabel()}`}
        eyebrow="Racer profile"
        title={`@${profile.handle}`}
      />
      <section className="score-card" aria-label="Weekly score">
        <div>
          <span>Weekly rank</span>
          <strong>#{profile.rank}</strong>
        </div>
        <div>
          <span>Total usage</span>
          <strong title={`${formatExactTokens(profile.total)} tokens`}>
            {formatCompactTokens(profile.total)}
          </strong>
          <small>tokens</small>
        </div>
      </section>
      <Panel>
        <div className="panel-heading">
          <h2>Usage by agent</h2>
          <span>{profile.breakdown.length} connected</span>
        </div>
        {profile.breakdown.map((item) => (
          <div className="breakdown" key={item.agent}>
            <div>
              <strong>{item.label}</strong>
              <span>Weekly aggregate</span>
            </div>
            <strong title={`${formatExactTokens(item.tokens)} tokens`}>
              {formatCompactTokens(item.tokens)}
            </strong>
          </div>
        ))}
        <p className="muted">Token totals are self-reported by local connectors.</p>
      </Panel>
    </PageShell>
  );
}

import { connection } from "next/server";
import Link from "next/link";
import { RacerLink } from "./components/racer-link";
import { StandingsTable } from "./components/standings-table";
import {
  currentWeekLabel,
  formatCompactTokens,
  formatExactTokens,
  leaderboard,
  publicProfile,
} from "@/lib/leaderboard";
import { viewer } from "@/lib/session";
import { agentNames, supportedAgents } from "@/lib/agents";

interface HomePageProps {
  readonly searchParams: Promise<{ page?: string | string[] }>;
}

const leaderboardPageSize = 100;
const maximumPageNumber = Math.floor(Number.MAX_SAFE_INTEGER / leaderboardPageSize);
const supportedAgentLabels = supportedAgents.map((agent) => agentNames[agent]).join(" · ");

function parsePage(value: string | string[] | undefined): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 && page <= maximumPageNumber ? page : 1;
}

function pageHref(page: number): string {
  return page === 1 ? "/" : `/?page=${page.toString()}`;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  await connection();
  const page = parsePage((await searchParams).page);
  const offset = (page - 1) * leaderboardPageSize;
  const current = await viewer();
  const [pageRows, profile] = await Promise.all([
    leaderboard({ limit: leaderboardPageSize + 1, offset }),
    current === null ? Promise.resolve(null) : publicProfile(current.handle),
  ]);
  const hasNextPage = pageRows.length > leaderboardPageSize;
  const rows = pageRows.slice(0, leaderboardPageSize);
  return (
    <main className="home-page">
      <section className="hero" aria-labelledby="race-title">
        <div className="hero-primary">
          <div className="hero-copy">
            <h1 id="race-title">The weekly token race</h1>
          </div>
          <div
            className={`user-callout${current === null ? " user-callout-guest" : ""}`}
            aria-label="Your weekly position"
          >
            <span className="eyebrow meta-label">Your position</span>
            {current === null ? (
              <div className="hero-guest">
                <strong className="meta-value">Your grid is open</strong>
              </div>
            ) : (
              <div className="user-score-line">
                <span className="user-rank">{profile === null ? "—" : `#${profile.rank}`}</span>
                <RacerLink handle={current.handle} />
                {profile === null ? null : (
                  <span className="user-agent">
                    {profile.breakdown.length === 1
                      ? profile.breakdown[0]?.label
                      : `${profile.breakdown.length.toString()} agents`}
                  </span>
                )}
                <strong title={`${formatExactTokens(profile?.total ?? "0")} tokens`}>
                  {formatCompactTokens(profile?.total ?? "0")}
                </strong>
                <small>tokens</small>
              </div>
            )}
          </div>
          <div className="hero-race" aria-label="Current race">
            <span className="meta-label">Current race</span>
            <strong className="meta-value">{currentWeekLabel()}</strong>
            <small className="meta-value">Ends Sun · 23:59 UTC</small>
          </div>
        </div>
        <aside className="hero-summary" aria-label="How Vibe Racing works">
          <div className="hero-agents">
            <span className="meta-label">Supported agents</span>
            <p>{supportedAgentLabels}</p>
          </div>
          <div className="hero-privacy">
            <span className="meta-label">Privacy</span>
            <div className="hero-privacy-copy">
              <p>
                <b>Collects</b> Agent · UTC date · aggregate token total
              </p>
              <p>
                <b>Never collects</b> Prompts · responses · code · transcripts · repos · paths ·
                hostnames · provider identities · credentials · models · costs
              </p>
            </div>
          </div>
        </aside>
      </section>
      <section className="leaderboard" aria-labelledby="leaderboard-title">
        <h2 className="sr-only" id="leaderboard-title">
          Standings
        </h2>
        {rows.length === 0 ? (
          <div className="empty">
            <strong>
              {page === 1 ? "The starting grid is empty." : "No racers on this page."}
            </strong>
            <p>
              {page === 1
                ? "Be the first racer to connect an agent."
                : "Return to the previous page of standings."}
            </p>
          </div>
        ) : (
          <StandingsTable currentHandle={current?.handle} rows={rows} />
        )}
        {page > 1 || hasNextPage ? (
          <nav className="standings-pagination" aria-label="Standings pages">
            {page > 1 ? (
              <Link className="button button-secondary" href={pageHref(page - 1)}>
                Previous 100
              </Link>
            ) : (
              <span />
            )}
            <span>Page {page}</span>
            {hasNextPage ? (
              <Link className="button button-secondary" href={pageHref(page + 1)}>
                Next 100
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </section>
    </main>
  );
}

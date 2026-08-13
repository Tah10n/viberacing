import { connection } from "next/server";
import Link from "next/link";
import { RacerLink } from "./components/racer-link";
import { StandingsTable } from "./components/standings-table";
import {
  currentWeekLabel,
  currentWeekNumber,
  formatCompactTokens,
  formatExactTokens,
  leaderboard,
  publicProfile,
} from "@/lib/leaderboard";
import { viewer } from "@/lib/session";

interface HomePageProps {
  readonly searchParams: Promise<{ page?: string | string[] }>;
}

const leaderboardPageSize = 100;
const maximumPageNumber = Math.floor(Number.MAX_SAFE_INTEGER / leaderboardPageSize);

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
        <div className="hero-copy">
          <h1 id="race-title">The weekly token race</h1>
        </div>
        <div className="user-callout" aria-label="Your weekly position">
          <span className="eyebrow">Your position</span>
          {current === null ? (
            <div className="hero-guest">
              <strong className="user-empty">Your grid is open</strong>
              <a className="button button-secondary" href="/api/auth/github/start">
                Join with GitHub
              </a>
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
        <aside className="hero-summary" aria-label="How Vibe Racing works">
          <div>
            <span>Current race</span>
            <strong>{currentWeekLabel()}</strong>
            <small>Ends Sunday · 23:59 UTC</small>
          </div>
          <div>
            <span>Supported agents</span>
            <strong>Codex · Claude Code</strong>
          </div>
          <div>
            <span>Privacy</span>
            <strong>Aggregates only</strong>
            <small>Daily totals. No code.</small>
          </div>
        </aside>
      </section>
      <section className="leaderboard" aria-labelledby="leaderboard-title">
        <div className="section-heading standings-heading">
          <h2 id="leaderboard-title">Week {currentWeekNumber()} standings</h2>
          <span>{currentWeekLabel()}</span>
        </div>
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
      <section className="privacy-strip">
        <div>
          <strong>Private by default</strong>
          <span>Agent · UTC date · cumulative token count</span>
        </div>
        <p>No prompts, code, paths, keys, models, costs, or repository names.</p>
      </section>
    </main>
  );
}

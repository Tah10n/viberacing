import { connection } from "next/server";
import Link from "next/link";
import {
  currentWeekLabel,
  formatCompactTokens,
  formatExactTokens,
  leaderboard,
} from "@/lib/leaderboard";
import { viewer } from "@/lib/session";

export default async function HomePage() {
  await connection();
  const [rows, current] = await Promise.all([leaderboard(), viewer()]);
  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">WEEKLY TOKEN LEADERBOARD</p>
          <h1>
            See who is setting the <span>pace.</span>
          </h1>
          <p>
            Compare weekly Codex and Claude Code usage. Connect in a minute; only daily totals leave
            your computer.
          </p>
          <a className="button" href={current === null ? "/api/auth/github/start" : "/dashboard"}>
            {current === null ? "Join with GitHub" : "Manage computers"}
          </a>
        </div>
        <aside className="hero-summary" aria-label="How Vibe Racing works">
          <div>
            <span>Current race</span>
            <strong>{currentWeekLabel()}</strong>
          </div>
          <div>
            <span>Supported agents</span>
            <strong>Codex · Claude Code</strong>
          </div>
          <div>
            <span>Privacy</span>
            <strong>Aggregates only</strong>
          </div>
        </aside>
      </section>
      <section className="leaderboard" aria-labelledby="leaderboard-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">LIVE STANDINGS</p>
            <h2 id="leaderboard-title">This week</h2>
          </div>
          <span>
            {rows.length} {rows.length === 1 ? "racer" : "racers"} · {currentWeekLabel()}
          </span>
        </div>
        {rows.length === 0 ? (
          <div className="empty">
            <strong>The starting grid is empty.</strong>
            <p>Be the first racer to connect an agent.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="ranking-table">
              <thead>
                <tr>
                  <th scope="col">Rank</th>
                  <th scope="col">Racer</th>
                  <th scope="col">Agent mix</th>
                  <th scope="col">This week</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.handle}>
                    <td className="rank-cell">#{row.rank}</td>
                    <td className="racer-cell">
                      <Link href={`/u/${row.handle}`}>@{row.handle}</Link>
                      {current?.handle.toLowerCase() === row.handle.toLowerCase() ? (
                        <span className="you-badge">You</span>
                      ) : null}
                    </td>
                    <td>
                      <div className="agent-list">
                        {row.breakdown.map((item) => (
                          <span className="agent-chip" key={item.agent}>
                            {item.label} {formatCompactTokens(item.tokens)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="token-cell" title={`${formatExactTokens(row.total)} tokens`}>
                      <strong>{formatCompactTokens(row.total)}</strong>
                      <span>tokens</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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

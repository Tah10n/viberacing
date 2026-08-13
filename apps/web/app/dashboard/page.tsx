import { connection } from "next/server";
import { redirect } from "next/navigation";
import { agentNames, isSupportedAgent } from "@/lib/agents";
import { publicOrigin } from "@/lib/config";
import { query } from "@/lib/db";
import { viewer } from "@/lib/session";

interface DashboardProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}
interface ConnectionRow {
  id: string;
  name: string;
  agents: string[];
  last_sync_at: Date | null;
}

function agentLabel(agent: string): string {
  return isSupportedAgent(agent) ? agentNames[agent] : agent;
}

function syncLabel(value: Date | null): string {
  if (value === null) return "Waiting for first sync";
  return `${new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(value)} UTC`;
}

export default async function DashboardPage({ searchParams }: DashboardProps) {
  await connection();
  const [current, params] = await Promise.all([viewer(), searchParams]);
  if (current === null) redirect("/api/auth/github/start?next=/dashboard");
  const connections = await query<ConnectionRow>(
    `SELECT id::text, name, agents, last_sync_at
       FROM connections
      WHERE user_id = $1 AND status = 'active'
      ORDER BY created_at DESC`,
    [current.id],
  );
  const agents = [...new Set(connections.flatMap((item) => item.agents))];
  const command = `npx @viberacing/connector connect --origin ${publicOrigin().origin}`;
  const notice =
    params.connected === "1"
      ? "Computer connected. Its first sync is ready."
      : params.disconnected === "1"
        ? "Computer disconnected. Its saved weekly totals remain in the race."
        : params.left === "1"
          ? "You left the leaderboard. Usage totals were deleted and all computers disconnected."
          : null;
  return (
    <main className="dashboard-page">
      <header className="page-heading dashboard-heading">
        <div>
          <p className="eyebrow">RACER CONTROL</p>
          <h1>Your race setup</h1>
          <p>
            Signed in as <strong>@{current.handle}</strong>. Manage every connected computer here.
          </p>
        </div>
        <a className="secondary-button" href={`/u/${current.handle}`}>
          View public profile
        </a>
      </header>

      {notice === null ? null : (
        <p className={params.left === "1" ? "notice warning-notice" : "notice"}>{notice}</p>
      )}

      <section className="summary-grid" aria-label="Connection summary">
        <div>
          <span>Computers</span>
          <strong>{connections.length}</strong>
        </div>
        <div>
          <span>Agents detected</span>
          <strong>{agents.length}</strong>
        </div>
        <div>
          <span>Leaderboard</span>
          <strong>{connections.length > 0 ? "Active" : "Not connected"}</strong>
        </div>
      </section>

      <section className="dashboard-section" aria-labelledby="computers-title">
        <div className="section-heading plain-heading">
          <div>
            <p className="eyebrow">DEVICES</p>
            <h2 id="computers-title">Connected computers</h2>
          </div>
          <span>{connections.length} active</span>
        </div>
        {connections.length === 0 ? (
          <div className="empty-state">
            <h3>No computers connected</h3>
            <p>Run the command below on each computer you want to include.</p>
          </div>
        ) : (
          <div className="device-list">
            {connections.map((item) => (
              <article className="device-card" key={item.id}>
                <div className="device-main">
                  <div className="device-title">
                    <h3>{item.name}</h3>
                    <span className="status-badge">Connected</span>
                  </div>
                  <div className="agent-list">
                    {item.agents.map((agent) => (
                      <span className="agent-chip" key={agent}>
                        {agentLabel(agent)}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="device-meta">
                  <span>Last sync</span>
                  <strong>{syncLabel(item.last_sync_at)}</strong>
                </div>
                <form action="/api/connections/revoke" method="post">
                  <input name="connectionId" type="hidden" value={item.id} />
                  <button className="text-button danger-text" type="submit">
                    Disconnect
                  </button>
                </form>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel connect-panel">
        <div>
          <p className="eyebrow">ADD A COMPUTER</p>
          <h2>Connect Codex or Claude Code</h2>
          <p>
            Run this on another computer. It detects available agents and creates a separate,
            revocable connection.
          </p>
        </div>
        <pre>
          <code>{command}</code>
        </pre>
        <p className="muted">No provider API keys are requested or uploaded.</p>
      </section>

      <div className="settings-grid">
        <section className="panel privacy-panel">
          <p className="eyebrow">PRIVACY</p>
          <h2>Only totals cross the boundary</h2>
          <ul>
            <li>Uploaded: agent, UTC date, cumulative tokens.</li>
            <li>Never uploaded: prompts, code, paths, repositories, credentials, or models.</li>
            <li>Codex account totals are deduplicated; Claude computer totals are combined.</li>
          </ul>
        </section>

        <section className="panel danger-panel">
          <p className="eyebrow">RACE CONTROL</p>
          <h2>Leave the leaderboard</h2>
          <p>
            Delete every usage total and disconnect all computers. Your GitHub sign-in remains so
            you can join again later.
          </p>
          <form action="/api/leaderboard/leave" method="post">
            <label className="confirm-row">
              <input name="confirm" required type="checkbox" value="leave" />
              <span>I understand that my ranking data will be deleted.</span>
            </label>
            <button className="danger-button" type="submit">
              Leave leaderboard
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}

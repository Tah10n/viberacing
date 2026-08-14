import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Badge, PageHeader, Panel } from "../components/ui";
import { agentNames, isSupportedAgent } from "@/lib/agents";
import { publicOrigin } from "@/lib/config";
import { query } from "@/lib/db";
import { currentWeekStart, formatCompactTokens } from "@/lib/leaderboard";
import { viewer } from "@/lib/session";

interface DashboardProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

interface InstallationRow {
  id: string;
  name: string;
  last_sync_at: Date | null;
  source_count: number;
}

interface AccountRow {
  id: string;
  agent_id: string;
  label: string;
  aggregation_mode: "account_max" | "source_sum";
  tokens: string;
  source_count: number;
  installation_count: number;
  last_sync_at: Date | null;
  partial: boolean;
  has_error: boolean;
}

interface SourceRow {
  id: string;
  agent_account_id: string;
  installation_name: string;
  collection_method: string;
  supported_surface: string;
  status: string;
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
  const [installations, accounts, sources] = await Promise.all([
    query<InstallationRow>(
      `SELECT i.id::text, i.name, i.last_sync_at, count(s.id)::int AS source_count
         FROM installations i
         LEFT JOIN installation_sources s
           ON s.installation_id = i.id AND s.status = 'active'
        WHERE i.user_id = $1 AND i.status = 'active'
        GROUP BY i.id
        ORDER BY i.created_at DESC`,
      [current.id],
    ),
    query<AccountRow>(
      `SELECT a.id::text,
              a.agent_id,
              a.label,
              a.aggregation_mode,
              coalesce(usage.tokens, 0)::text AS tokens,
              count(s.id)::int AS source_count,
              count(DISTINCT s.installation_id)::int AS installation_count,
              max(s.last_successful_sync_at) AS last_sync_at,
              coalesce(bool_or(s.last_completeness = 'partial'), false) AS partial,
              coalesce(bool_or(s.last_error_summary IS NOT NULL), false) AS has_error
         FROM agent_accounts a
         LEFT JOIN installation_sources s
           ON s.agent_account_id = a.id AND s.status = 'active'
         LEFT JOIN LATERAL (
           SELECT sum(day.tokens) AS tokens
             FROM (
               SELECT CASE a.aggregation_mode
                        WHEN 'account_max' THEN max(d.total_tokens)
                        ELSE sum(d.total_tokens)
                      END AS tokens
                 FROM installation_sources source_usage
                 JOIN daily_usage d ON d.source_id = source_usage.id
                WHERE source_usage.agent_account_id = a.id
                  AND d.usage_date >= $2::date AND d.usage_date < $2::date + 7
                GROUP BY d.usage_date
             ) day
         ) usage ON true
        WHERE a.user_id = $1
        GROUP BY a.id, usage.tokens
        ORDER BY a.agent_id, lower(a.label), a.created_at`,
      [current.id, currentWeekStart()],
    ),
    query<SourceRow>(
      `SELECT s.id::text, s.agent_account_id::text, i.name AS installation_name,
              s.collection_method, s.supported_surface, s.status
         FROM installation_sources s
         JOIN installations i ON i.id = s.installation_id
        WHERE s.user_id = $1
        ORDER BY i.created_at, s.created_at`,
      [current.id],
    ),
  ]);
  const command = `npx @viberacing/connector connect --origin ${publicOrigin().origin}`;
  const notice =
    params.connected === "1"
      ? "Computer connected. Its first sync is ready."
      : params.disconnected === "1"
        ? "Computer disconnected. Saved totals remain until you delete them."
        : params.left === "1"
          ? "You left the leaderboard. Usage totals were deleted and all computers disconnected."
          : params.accountDeleted === "1"
            ? "Agent account and its stored usage were deleted."
            : params.updated === "1"
              ? "Account mapping updated."
              : null;
  return (
    <main className="dashboard-page">
      <PageHeader
        action={
          <a
            className="button button-secondary"
            href={`https://github.com/${encodeURIComponent(current.handle)}`}
            rel="noreferrer"
            target="_blank"
          >
            Open GitHub profile ↗
          </a>
        }
        description={
          <>
            Signed in as <strong>@{current.handle}</strong>. Manage agent accounts and computers.
          </>
        }
        eyebrow="Racer control"
        title="Your race setup"
      />

      {notice === null ? null : (
        <p className={params.left === "1" ? "notice warning-notice" : "notice"}>{notice}</p>
      )}

      <section className="summary-grid" aria-label="Connection summary">
        <div>
          <span>Computers</span>
          <strong>{installations.length}</strong>
        </div>
        <div>
          <span>Agent accounts</span>
          <strong>{accounts.length}</strong>
        </div>
        <div>
          <span>Leaderboard</span>
          <strong>{installations.length > 0 ? "Active" : "Not connected"}</strong>
        </div>
      </section>

      <section className="dashboard-section" aria-labelledby="accounts-title">
        <div className="section-heading plain-heading">
          <div>
            <p className="eyebrow">AGENT ACCOUNTS</p>
            <h2 id="accounts-title">Accounts in your total</h2>
          </div>
          <span>{accounts.length} configured</span>
        </div>
        {accounts.length === 0 ? (
          <div className="empty-state">
            <h3>No agent accounts yet</h3>
            <p>They are created when you approve detected local sources.</p>
          </div>
        ) : (
          <div className="device-list">
            {accounts.map((account) => (
              <article className="device-card" key={account.id}>
                <div className="device-main">
                  <div className="device-title">
                    <h3>
                      {agentLabel(account.agent_id)} · {account.label}
                    </h3>
                    <Badge
                      tone={account.has_error ? "warning" : account.partial ? "neutral" : "success"}
                    >
                      {account.has_error ? "Error" : account.partial ? "Partial" : "Complete"}
                    </Badge>
                  </div>
                  <div className="agent-list">
                    <span className="agent-chip">{formatCompactTokens(account.tokens)} tokens</span>
                    <span className="agent-chip">
                      {account.source_count} sources · {account.installation_count} computers
                    </span>
                    <span className="agent-chip">
                      {account.aggregation_mode === "account_max" ? "Deduplicated" : "Summed"}
                    </span>
                  </div>
                </div>
                <div className="device-meta">
                  <span>Last sync</span>
                  <strong>{syncLabel(account.last_sync_at)}</strong>
                </div>
                <div className="account-actions">
                  <form action="/api/accounts/rename" method="post">
                    <input name="accountId" type="hidden" value={account.id} />
                    <label>
                      <span className="sr-only">Account label</span>
                      <input defaultValue={account.label} maxLength={40} name="label" required />
                    </label>
                    <button className="text-button" type="submit">
                      Rename
                    </button>
                  </form>
                  {sources
                    .filter((source) => source.agent_account_id === account.id)
                    .map((source) => (
                      <div className="source-row" key={source.id}>
                        <span>
                          {source.installation_name} · {source.collection_method} ·{" "}
                          {source.supported_surface}
                        </span>
                        {source.status === "active" ? (
                          <>
                            <form action="/api/sources/reassign" method="post">
                              <input name="sourceId" type="hidden" value={source.id} />
                              <select
                                aria-label="Move source to account"
                                defaultValue={account.id}
                                name="accountId"
                              >
                                {accounts
                                  .filter((candidate) => candidate.agent_id === account.agent_id)
                                  .map((candidate) => (
                                    <option key={candidate.id} value={candidate.id}>
                                      {candidate.label}
                                    </option>
                                  ))}
                              </select>
                              <button className="text-button" type="submit">
                                Move
                              </button>
                            </form>
                            <form action="/api/sources/disconnect" method="post">
                              <input name="sourceId" type="hidden" value={source.id} />
                              <button className="text-button danger-text" type="submit">
                                Disconnect source
                              </button>
                            </form>
                          </>
                        ) : (
                          <Badge tone="neutral">Disconnected</Badge>
                        )}
                      </div>
                    ))}
                  <form action="/api/accounts/delete" method="post">
                    <input name="accountId" type="hidden" value={account.id} />
                    {sources.some((source) => source.agent_account_id === account.id) ? (
                      <label className="confirm-row">
                        <input name="confirm" required type="checkbox" value="delete" />
                        <span>Delete linked sources and usage</span>
                      </label>
                    ) : null}
                    <button className="text-button danger-text" type="submit">
                      Delete account
                    </button>
                  </form>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="dashboard-section" aria-labelledby="computers-title">
        <div className="section-heading plain-heading">
          <div>
            <p className="eyebrow">INSTALLATIONS</p>
            <h2 id="computers-title">Connected computers</h2>
          </div>
          <span>{installations.length} active</span>
        </div>
        {installations.length === 0 ? (
          <div className="empty-state">
            <h3>No computers connected</h3>
            <p>Run the command below on each computer you want to include.</p>
          </div>
        ) : (
          <div className="device-list">
            {installations.map((item) => (
              <article className="device-card" key={item.id}>
                <div className="device-main">
                  <div className="device-title">
                    <h3>{item.name}</h3>
                    <Badge tone="success">Connected</Badge>
                  </div>
                  <div className="agent-list">
                    <span className="agent-chip">{item.source_count} local sources</span>
                  </div>
                </div>
                <div className="device-meta">
                  <span>Last sync</span>
                  <strong>{syncLabel(item.last_sync_at)}</strong>
                </div>
                <form action="/api/connections/revoke" method="post">
                  <input name="installationId" type="hidden" value={item.id} />
                  <button className="text-button danger-text" type="submit">
                    Disconnect
                  </button>
                </form>
              </article>
            ))}
          </div>
        )}
      </section>

      <Panel className="connect-panel">
        <div>
          <p className="eyebrow">ADD A COMPUTER</p>
          <h2>Connect your coding agents</h2>
          <p>
            Run this on another computer. It detects exact usage sources and lets you map each one
            to a new or existing account.
          </p>
        </div>
        <pre>
          <code>{command}</code>
        </pre>
        <p className="muted">
          Seven agents provide counted exact totals. Cursor awaits authoritative counters. No
          provider API keys are requested or uploaded.
        </p>
      </Panel>

      <div className="settings-grid">
        <Panel className="privacy-panel">
          <p className="eyebrow">PRIVACY &amp; AGGREGATION</p>
          <h2>Only exact totals cross the boundary</h2>
          <ul>
            <li>Account-wide totals are deduplicated across linked computers.</li>
            <li>Machine-local histories are summed; different accounts always sum.</li>
            <li>Prompts, code, paths, repositories, credentials, and models stay local.</li>
          </ul>
        </Panel>

        <Panel className="danger-panel">
          <p className="eyebrow">RACE CONTROL</p>
          <h2>Leave the leaderboard</h2>
          <p>
            Delete every usage total and disconnect all computers. Your GitHub sign-in and empty
            agent-account labels remain so you can join again later.
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
        </Panel>
        <Panel className="danger-panel">
          <p className="eyebrow">ACCOUNT DELETION</p>
          <h2>Delete Vibe Racing account</h2>
          <p>
            Delete the GitHub-linked user, sessions, installations, agent accounts, and all usage.
          </p>
          <form action="/api/account/delete" method="post">
            <label className="confirm-row">
              <input name="confirm" required type="checkbox" value="delete-account" />
              <span>I understand this cannot be undone.</span>
            </label>
            <button className="danger-button" type="submit">
              Delete account
            </button>
          </form>
        </Panel>
      </div>
    </main>
  );
}

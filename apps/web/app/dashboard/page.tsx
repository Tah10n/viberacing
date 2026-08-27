import { headers } from "next/headers";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import {
  connectorConnectCommand,
  connectorRepairCommand,
  connectorUninstallCommand,
} from "@/lib/connector";
import { Badge, PageHeader, PageShell, Panel } from "../components/ui";
import { CopyCommandButton } from "../components/copy-command-button";
import { ConnectorUpdateNotice } from "../components/connector-update-notice";
import { DangerActionForm } from "../components/danger-action-form";
import { SameOriginActionForm } from "../components/same-origin-action-form";
import { UserLocalTime } from "../components/user-local-time";
import {
  AccountControls,
  BrowserSyncProvider,
  InstallationSyncControl,
} from "../components/account-controls";
import { agentNames, agentRegistry, isSupportedAgent } from "@/lib/agents";
import {
  browserSyncInstallationScopeProtocol,
  installedConnectorUpdateRequired,
  maximumSourcesPerInstallation,
  minimumConnectorVersion,
  publicOrigin,
} from "@/lib/config";
import { connectorCommandShell } from "@/lib/command-platform";
import { query } from "@/lib/db";
import { currentWeekStart, formatCompactTokens, formatExactTokens } from "@/lib/leaderboard";
import { localInstallationId, viewer } from "@/lib/session";
import { accountMaxDailyTokensSql, accountMaxObservationIsEligibleSql } from "@/lib/usage-summary";

interface DashboardProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

interface InstallationRow {
  browser_sync_capable: boolean;
  browser_sync_protocol: number;
  installed_connector_version: string | null;
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
  component_tokens: string | null;
  input_tokens: string | null;
  output_tokens: string | null;
  cache_tokens: string | null;
  reasoning_tokens: string | null;
  source_count: number;
  installation_count: number;
  last_sync_at: Date | null;
  partial: boolean;
  has_error: boolean;
  can_browser_sync: boolean;
  shared_profile: boolean;
  new_account_notice_pending: boolean;
}

interface SourceRow {
  id: string;
  agent_account_id: string;
  installation_name: string;
  collection_method: string;
  supported_surface: string;
  status: string;
}

interface DedupEventRow {
  id: string;
  agent_id: string;
  matched_days: number;
  installation_name: string;
  target_label: string;
}

interface DailyUsageRow {
  usage_date: string;
  tokens: string;
}

interface UsageChartDay {
  date: string;
  day: string;
  fullLabel: string;
  level: number;
  tokens: string;
  weekday: string;
}

const usageChartLevels = 20n;
const weekdayFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  timeZone: "UTC",
});
const fullDayFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
  weekday: "long",
});

function agentLabel(agent: string): string {
  return isSupportedAgent(agent) ? agentNames[agent] : agent;
}

function accountTitle(agent: string, label: string): string {
  const displayName = agentLabel(agent);
  return displayName.toLowerCase() === label.trim().toLowerCase()
    ? displayName
    : `${displayName} · ${label}`;
}

function syncUtcFallback(value: Date): string {
  return `${new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(value)} UTC`;
}

function LastSyncTime({ value }: { readonly value: Date | null }) {
  return value === null ? (
    <>Waiting for first sync</>
  ) : (
    <UserLocalTime
      dateTime={value.toISOString()}
      fallback={syncUtcFallback(value)}
      format="timestamp"
    />
  );
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${String(count)} ${count === 1 ? singular : plural}`;
}

function hasReassignmentTarget(accounts: readonly AccountRow[], account: AccountRow): boolean {
  return accounts.some(
    (candidate) => candidate.agent_id === account.agent_id && candidate.id !== account.id,
  );
}

function WeeklyTokenBreakdown({ account }: { readonly account: AccountRow }) {
  if (account.shared_profile)
    return (
      <p className="token-breakdown-note">
        Component breakdown is hidden because this Codex profile has used multiple accounts.
      </p>
    );
  if (
    account.input_tokens === null ||
    account.output_tokens === null ||
    account.cache_tokens === null ||
    account.reasoning_tokens === null
  )
    return null;
  const counters = [
    ["Input", account.input_tokens],
    ["Output", account.output_tokens],
    ["Cached", account.cache_tokens],
    ["Reasoning", account.reasoning_tokens],
  ] as const;
  const componentTotal = account.component_tokens;
  return (
    <>
      <dl aria-label="Weekly token breakdown" className="token-breakdown">
        {counters.map(([label, tokens]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd title={`${formatExactTokens(tokens)} tokens`}>{formatCompactTokens(tokens)}</dd>
          </div>
        ))}
      </dl>
      {componentTotal !== null && BigInt(componentTotal) !== BigInt(account.tokens) ? (
        <p className="token-breakdown-note">
          Local component counters total {formatCompactTokens(componentTotal)} tokens; the
          account-wide provider total above is a separate counter.
        </p>
      ) : null}
    </>
  );
}

function usageChartDays(weekStart: string, usage: readonly DailyUsageRow[]): UsageChartDay[] {
  const totals = new Map(usage.map((entry) => [entry.usage_date, entry.tokens]));
  const start = new Date(`${weekStart}T00:00:00.000Z`);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    const dateKey = date.toISOString().slice(0, 10);
    return {
      date: dateKey,
      day: date.getUTCDate().toString(),
      fullLabel: fullDayFormatter.format(date),
      tokens: totals.get(dateKey) ?? "0",
      weekday: weekdayFormatter.format(date),
    };
  });
  const maximum = days.reduce((value, day) => {
    const tokens = BigInt(day.tokens);
    return tokens > value ? tokens : value;
  }, 0n);
  return days.map((day) => {
    const tokens = BigInt(day.tokens);
    const rounded = maximum === 0n ? 0n : (tokens * usageChartLevels + maximum / 2n) / maximum;
    const level = tokens === 0n ? 0n : rounded > 0n ? rounded : 1n;
    return { ...day, level: Number(level) };
  });
}

export default async function DashboardPage({ searchParams }: DashboardProps) {
  await connection();
  const requestHeaders = await headers();
  const commandShell = connectorCommandShell(
    requestHeaders.get("sec-ch-ua-platform"),
    requestHeaders.get("user-agent"),
  );
  const [current, params, browserInstallationId] = await Promise.all([
    viewer(),
    searchParams,
    localInstallationId(),
  ]);
  if (current === null) redirect("/api/auth/github/start?next=/dashboard");
  const weekStart = currentWeekStart();
  const [installations, accounts, sources, dedupEvents, dailyUsage] = await Promise.all([
    query<InstallationRow>(
      `SELECT i.id::text, i.name, i.installed_connector_version, i.last_sync_at,
              i.browser_sync_capable,
              i.browser_sync_protocol,
              count(s.id)::int AS source_count
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
              a.new_account_notice_pending,
              coalesce(usage.tokens, 0)::text AS tokens,
              usage.component_tokens::text AS component_tokens,
              usage.input_tokens::text AS input_tokens,
              usage.output_tokens::text AS output_tokens,
              usage.cache_tokens::text AS cache_tokens,
              usage.reasoning_tokens::text AS reasoning_tokens,
              count(s.id)::int AS source_count,
              count(DISTINCT s.installation_id)::int AS installation_count,
              max(s.last_successful_sync_at) AS last_sync_at,
              coalesce(bool_or(s.last_completeness = 'partial'), false) AS partial,
              coalesce(bool_or(s.last_error_summary IS NOT NULL), false) AS has_error
              ,coalesce(bool_or(s.installation_id = $3::uuid AND installation.browser_sync_capable), false) AS can_browser_sync,
              coalesce(bool_or(
                s.agent_id = 'codex' AND (
                  SELECT count(*)
                    FROM installation_sources sibling
                   WHERE sibling.installation_id = s.installation_id
                     AND sibling.status = 'active'
                     AND coalesce(sibling.profile_source_id, sibling.id) =
                         coalesce(s.profile_source_id, s.id)
                ) > 1
              ), false) AS shared_profile
         FROM agent_accounts a
         LEFT JOIN installation_sources s
           ON s.agent_account_id = a.id AND s.status = 'active'
         LEFT JOIN installations installation ON installation.id = s.installation_id
         LEFT JOIN LATERAL (
           SELECT sum(day.tokens) AS tokens,
                  CASE WHEN (a.aggregation_mode = 'account_max'
                              AND bool_or(day.components_complete))
                              OR (a.aggregation_mode = 'source_sum'
                              AND bool_and(day.components_complete))
                       THEN sum(day.component_tokens) FILTER (
                         WHERE day.components_complete) END AS component_tokens,
                  CASE WHEN (a.aggregation_mode = 'account_max'
                              AND bool_or(day.components_complete))
                              OR (a.aggregation_mode = 'source_sum'
                              AND bool_and(day.components_complete))
                       THEN sum(day.input_tokens) FILTER (
                         WHERE day.components_complete) END AS input_tokens,
                  CASE WHEN (a.aggregation_mode = 'account_max'
                              AND bool_or(day.components_complete))
                              OR (a.aggregation_mode = 'source_sum'
                              AND bool_and(day.components_complete))
                       THEN sum(day.output_tokens) FILTER (
                         WHERE day.components_complete) END AS output_tokens,
                  CASE WHEN (a.aggregation_mode = 'account_max'
                              AND bool_or(day.components_complete))
                              OR (a.aggregation_mode = 'source_sum'
                              AND bool_and(day.components_complete))
                       THEN sum(day.cache_read_tokens + day.cache_write_tokens) FILTER (
                         WHERE day.components_complete) END AS cache_tokens,
                  CASE WHEN (a.aggregation_mode = 'account_max'
                              AND bool_or(day.components_complete))
                              OR (a.aggregation_mode = 'source_sum'
                              AND bool_and(day.components_complete))
                       THEN sum(day.reasoning_tokens) FILTER (
                         WHERE day.components_complete) END AS reasoning_tokens
             FROM (
               SELECT candidate.usage_date,
                      CASE a.aggregation_mode
                        WHEN 'account_max' THEN ${accountMaxDailyTokensSql}
                        ELSE sum(candidate.total_tokens)
                      END AS tokens,
                      CASE a.aggregation_mode
                        WHEN 'account_max' THEN max(candidate.input_tokens) FILTER (
                          WHERE candidate.component_tokens = candidate.maximum_component_tokens
                            AND candidate.account_max_selected
                            AND candidate.components_available)
                        ELSE sum(candidate.input_tokens)
                      END AS input_tokens,
                      CASE a.aggregation_mode
                        WHEN 'account_max' THEN max(candidate.output_tokens) FILTER (
                          WHERE candidate.component_tokens = candidate.maximum_component_tokens
                            AND candidate.account_max_selected
                            AND candidate.components_available)
                        ELSE sum(candidate.output_tokens)
                      END AS output_tokens,
                      CASE a.aggregation_mode
                        WHEN 'account_max' THEN max(candidate.cache_read_tokens) FILTER (
                          WHERE candidate.component_tokens = candidate.maximum_component_tokens
                            AND candidate.account_max_selected
                            AND candidate.components_available)
                        ELSE sum(candidate.cache_read_tokens)
                      END AS cache_read_tokens,
                      CASE a.aggregation_mode
                        WHEN 'account_max' THEN max(candidate.cache_write_tokens) FILTER (
                          WHERE candidate.component_tokens = candidate.maximum_component_tokens
                            AND candidate.account_max_selected
                            AND candidate.components_available)
                        ELSE sum(candidate.cache_write_tokens)
                      END AS cache_write_tokens,
                      CASE a.aggregation_mode
                        WHEN 'account_max' THEN max(candidate.reasoning_tokens) FILTER (
                          WHERE candidate.component_tokens = candidate.maximum_component_tokens
                            AND candidate.account_max_selected
                            AND candidate.components_available)
                        ELSE sum(candidate.reasoning_tokens)
                      END AS reasoning_tokens,
                      CASE a.aggregation_mode
                        WHEN 'account_max' THEN max(candidate.component_tokens) FILTER (
                          WHERE candidate.account_max_selected)
                        ELSE sum(candidate.component_tokens)
                      END AS component_tokens,
                      CASE a.aggregation_mode
                        WHEN 'account_max' THEN count(DISTINCT ROW(
                          candidate.input_tokens,
                          candidate.output_tokens,
                          candidate.cache_read_tokens,
                          candidate.cache_write_tokens,
                          candidate.reasoning_tokens
                        )) FILTER (
                          WHERE candidate.component_tokens = candidate.maximum_component_tokens
                            AND candidate.account_max_selected
                            AND candidate.components_available) = 1
                        ELSE bool_and(candidate.components_available)
                      END AS components_complete
                 FROM (
                   SELECT precedence.*,
                          ${accountMaxObservationIsEligibleSql} AS account_max_selected,
                          max(precedence.component_tokens) FILTER (
                            WHERE ${accountMaxObservationIsEligibleSql})
                            OVER (PARTITION BY precedence.usage_date)
                            AS maximum_component_tokens
                     FROM (
                       SELECT d.*,
                              CASE WHEN d.input_tokens IS NOT NULL
                                AND d.output_tokens IS NOT NULL
                                AND d.cache_read_tokens IS NOT NULL
                                AND d.cache_write_tokens IS NOT NULL
                                AND d.reasoning_tokens IS NOT NULL
                              THEN d.input_tokens + d.output_tokens + d.cache_read_tokens
                                + d.cache_write_tokens + d.reasoning_tokens END AS component_tokens,
                              max(d.updated_at) FILTER (WHERE d.completeness = 'complete')
                                OVER (PARTITION BY d.usage_date) AS latest_complete_at,
                              d.input_tokens IS NOT NULL
                                AND d.output_tokens IS NOT NULL
                                AND d.cache_read_tokens IS NOT NULL
                                AND d.cache_write_tokens IS NOT NULL
                                AND d.reasoning_tokens IS NOT NULL AS components_available
                         FROM installation_sources source_usage
                         JOIN daily_usage d ON d.source_id = source_usage.id
                        WHERE source_usage.agent_account_id = a.id
                          AND source_usage.user_id = a.user_id
                          AND d.usage_date >= $2::date AND d.usage_date < $2::date + 7
                     ) precedence
                 ) candidate
                GROUP BY candidate.usage_date
             ) day
         ) usage ON true
        WHERE a.user_id = $1 AND a.merged_into_account_id IS NULL
        GROUP BY a.id, usage.tokens, usage.component_tokens, usage.input_tokens, usage.output_tokens,
                 usage.cache_tokens, usage.reasoning_tokens
        ORDER BY a.agent_id, lower(a.label), a.created_at`,
      [current.id, weekStart, browserInstallationId],
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
    query<DedupEventRow>(
      `SELECT event.id::text,
              event.agent_id,
              event.matched_days,
              installation.name AS installation_name,
              target.label AS target_label
         FROM account_dedup_events event
         JOIN installation_sources source ON source.id = event.source_id
         JOIN installations installation ON installation.id = source.installation_id
         JOIN agent_accounts target ON target.id = event.target_account_id
        WHERE event.user_id = $1 AND event.status = 'active'
          AND source.agent_account_id = event.target_account_id
        ORDER BY event.created_at DESC`,
      [current.id],
    ),
    query<DailyUsageRow>(
      `WITH source_days AS (
         SELECT a.id,
                a.aggregation_mode,
                d.usage_date,
                d.total_tokens,
                d.completeness,
                d.updated_at,
                max(d.updated_at) FILTER (WHERE d.completeness = 'complete')
                  OVER (PARTITION BY a.id, d.usage_date) AS latest_complete_at
           FROM agent_accounts a
           JOIN installation_sources s
             ON s.agent_account_id = a.id AND s.user_id = a.user_id
           JOIN daily_usage d ON d.source_id = s.id
          WHERE a.user_id = $1
            AND d.usage_date >= $2::date AND d.usage_date < $2::date + 7
       ), account_daily AS (
         SELECT id,
                usage_date,
                CASE aggregation_mode
                  WHEN 'account_max' THEN ${accountMaxDailyTokensSql}
                  ELSE sum(total_tokens)
                END AS tokens
           FROM source_days
          GROUP BY id, aggregation_mode, usage_date
       )
       SELECT usage_date::text, sum(tokens)::text AS tokens
         FROM account_daily
        GROUP BY usage_date
        ORDER BY usage_date`,
      [current.id, weekStart],
    ),
  ]);
  const chartDays = usageChartDays(weekStart, dailyUsage);
  const origin = publicOrigin().origin;
  const command = connectorConnectCommand(origin);
  const updateCommand = connectorRepairCommand(origin);
  const uninstallCommand = connectorUninstallCommand(origin);
  const minimumVersion = minimumConnectorVersion();
  const canSyncInstallation = (installation: InstallationRow): boolean =>
    installation.id === browserInstallationId &&
    installation.browser_sync_capable &&
    installation.installed_connector_version !== null &&
    installation.source_count > 0 &&
    installation.source_count <= maximumSourcesPerInstallation &&
    installation.browser_sync_protocol >= browserSyncInstallationScopeProtocol;
  const browserSyncEnabled =
    accounts.some((account) => account.can_browser_sync) || installations.some(canSyncInstallation);
  const hasNewCodexAccountNotice = accounts.some((account) => account.new_account_notice_pending);
  const notice =
    params.connected === "1"
      ? "Computer connected. Its first sync is ready."
      : params.sourceDisconnected === "1"
        ? "Source disconnected. Saved totals remain until you delete them."
        : params.disconnected === "1"
          ? "Computer disconnected. Saved totals remain until you delete them."
          : params.left === "1"
            ? "You left the leaderboard. Usage totals were deleted and all computers disconnected."
            : params.accountDeleted === "1"
              ? "Agent account and its stored usage were deleted."
              : params.updated === "1"
                ? "Account mapping updated."
                : params.dedupUndone === "1"
                  ? "Automatic account match undone. These totals are separate again."
                  : params.browserSynced === "1"
                    ? "Sync complete. Latest local totals are loaded."
                    : null;
  return (
    <PageShell className="dashboard-page">
      <PageHeader
        action={
          <a
            className="button button-secondary"
            href={`https://github.com/${encodeURIComponent(current.handle)}`}
            rel="noreferrer"
            target="_blank"
          >
            GitHub profile ↗
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

      {hasNewCodexAccountNotice ? (
        <Panel className="dedup-notice">
          <p>A new Codex account was detected on this computer and added separately.</p>
          <SameOriginActionForm action="/api/accounts/notices/dismiss">
            <button className="text-button" type="submit">
              Dismiss
            </button>
          </SameOriginActionForm>
        </Panel>
      ) : null}

      {dedupEvents.map((event) => (
        <Panel className="dedup-notice" key={event.id}>
          <p className="eyebrow">AUTOMATIC ACCOUNT MATCH</p>
          <h2>
            {agentLabel(event.agent_id)} on {event.installation_name} was combined with{" "}
            {event.target_label}
          </h2>
          <p>
            {event.matched_days} completed daily totals matched exactly. Provider email and
            credentials were not used.
          </p>
          <SameOriginActionForm action="/api/accounts/dedup/undo">
            <input name="eventId" type="hidden" value={event.id} />
            <button className="text-button" type="submit">
              Undo automatic match
            </button>
          </SameOriginActionForm>
        </Panel>
      ))}

      <details
        className="panel connect-disclosure"
        id="connect-computer"
        open={installations.length === 0}
      >
        <summary>
          <span>
            <span className="eyebrow">CONNECT A COMPUTER</span>
            <span className="connect-disclosure-title">Connect your coding agents</span>
          </span>
          <span className="connect-disclosure-action" aria-hidden="true">
            <span className="connect-disclosure-closed">Show command</span>
            <span className="connect-disclosure-open">Hide command</span>
          </span>
        </summary>
        <div className="connect-panel-body">
          <div className="connect-intro">
            <p>Run one command to connect this computer.</p>
            <ol className="connect-steps">
              <li>Copy the command.</li>
              <li>Paste it into {commandShell}.</li>
              <li>Your browser opens — review and approve the detected agents.</li>
              <li>The first token sync runs automatically.</li>
            </ol>
          </div>
          <div className="connect-command">
            <pre>
              <code>{command}</code>
            </pre>
            <CopyCommandButton command={command} />
            <p className="muted">
              No global npm installation is performed. Requires Node.js 24 LTS. npx runs the
              official <code>@viberacing/connector</code>, which keeps its working copy only in the
              local Vibe Racing state. Re-running connect is safe. Prompts, responses, code,
              repositories, paths, provider credentials, model names, and costs are not sent.
            </p>
          </div>
        </div>
      </details>

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

      <section className="dashboard-section" aria-labelledby="usage-chart-title">
        <div className="section-heading plain-heading">
          <div>
            <p className="eyebrow">WEEKLY USAGE</p>
            <h2 id="usage-chart-title">Tokens by day</h2>
          </div>
          <span>UTC · MON–SUN</span>
        </div>
        <figure aria-labelledby="usage-chart-title" className="usage-chart">
          <figcaption className="sr-only">
            {chartDays
              .map((day) => `${day.fullLabel}: ${formatExactTokens(day.tokens)} tokens`)
              .join("; ")}
          </figcaption>
          <div aria-hidden="true" className="usage-chart-plot">
            {chartDays.map((day) => (
              <div className="usage-chart-day" key={day.date}>
                <span
                  className="usage-chart-value"
                  title={`${formatExactTokens(day.tokens)} tokens`}
                >
                  {formatCompactTokens(day.tokens)}
                </span>
                <div className="usage-chart-track">
                  <span
                    className={`usage-chart-bar usage-chart-bar-level-${day.level.toString()}`}
                  />
                </div>
                <time dateTime={day.date}>
                  <strong>{day.weekday}</strong>
                  <span>{day.day}</span>
                </time>
              </div>
            ))}
          </div>
        </figure>
      </section>

      <BrowserSyncProvider enabled={browserSyncEnabled}>
        <details
          aria-labelledby="accounts-title"
          className="dashboard-section account-disclosure"
          open
        >
          <summary className="section-heading plain-heading">
            <div>
              <p className="eyebrow">AGENT ACCOUNTS</p>
              <h2 id="accounts-title">Accounts in your total</h2>
            </div>
            <span className="account-disclosure-action">
              <span className="account-disclosure-count">{accounts.length} configured</span>
              <span aria-hidden="true">
                <span className="account-disclosure-closed">Show accounts</span>
                <span className="account-disclosure-open">Hide accounts</span>
              </span>
            </span>
          </summary>
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
                      <h3>{accountTitle(account.agent_id, account.label)}</h3>
                      <Badge
                        tone={
                          account.has_error ? "warning" : account.partial ? "neutral" : "success"
                        }
                      >
                        {account.has_error ? "Error" : account.partial ? "Partial" : "Complete"}
                      </Badge>
                    </div>
                    <div className="agent-list">
                      <span className="agent-chip">
                        {formatCompactTokens(account.tokens)} tokens
                      </span>
                      <span className="agent-chip">
                        {countLabel(account.source_count, "source")} ·{" "}
                        {countLabel(account.installation_count, "computer")}
                      </span>
                      <span className="agent-chip">
                        {account.aggregation_mode === "account_max" ? "Deduplicated" : "Summed"}
                      </span>
                      {isSupportedAgent(account.agent_id) &&
                      agentRegistry[account.agent_id].accountSwitchMode ===
                        "combined_local_history" ? (
                        <span className="agent-chip">All local accounts in this store</span>
                      ) : null}
                      {isSupportedAgent(account.agent_id) &&
                      agentRegistry[account.agent_id].accountSwitchMode === "explicit_capture" ? (
                        <span className="agent-chip">Explicit capture source</span>
                      ) : null}
                      {account.shared_profile ? (
                        <span className="agent-chip">Shared Codex profile</span>
                      ) : null}
                    </div>
                    <WeeklyTokenBreakdown account={account} />
                  </div>
                  <div className="device-meta">
                    <span>Last sync</span>
                    <strong>
                      <LastSyncTime value={account.last_sync_at} />
                    </strong>
                  </div>
                  <AccountControls accountId={account.id} canSync={account.can_browser_sync}>
                    <SameOriginActionForm action="/api/accounts/rename">
                      <input name="accountId" type="hidden" value={account.id} />
                      <label>
                        <span className="sr-only">Account label</span>
                        <input defaultValue={account.label} maxLength={40} name="label" required />
                      </label>
                      <button className="text-button" type="submit">
                        Rename
                      </button>
                    </SameOriginActionForm>
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
                              {hasReassignmentTarget(accounts, account) ? (
                                <SameOriginActionForm action="/api/sources/reassign">
                                  <input name="sourceId" type="hidden" value={source.id} />
                                  <select
                                    aria-label="Move source to account"
                                    defaultValue={account.id}
                                    name="accountId"
                                  >
                                    {accounts
                                      .filter(
                                        (candidate) => candidate.agent_id === account.agent_id,
                                      )
                                      .map((candidate) => (
                                        <option key={candidate.id} value={candidate.id}>
                                          {candidate.label}
                                        </option>
                                      ))}
                                  </select>
                                  <button className="text-button" type="submit">
                                    Move
                                  </button>
                                </SameOriginActionForm>
                              ) : null}
                              <SameOriginActionForm action="/api/sources/disconnect">
                                <input name="sourceId" type="hidden" value={source.id} />
                                <button className="text-button danger-text" type="submit">
                                  Disconnect source
                                </button>
                              </SameOriginActionForm>
                            </>
                          ) : (
                            <Badge tone="neutral">Disconnected</Badge>
                          )}
                        </div>
                      ))}
                    <SameOriginActionForm
                      action="/api/accounts/delete"
                      className="account-delete-form"
                    >
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
                    </SameOriginActionForm>
                  </AccountControls>
                </article>
              ))}
            </div>
          )}
        </details>

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
                      <span className="agent-chip">
                        {countLabel(item.source_count, "local source")}
                      </span>
                    </div>
                  </div>
                  <div className="device-meta">
                    <span>Last sync</span>
                    <strong>
                      <LastSyncTime value={item.last_sync_at} />
                    </strong>
                  </div>
                  <div className="installation-controls">
                    <InstallationSyncControl canSync={canSyncInstallation(item)} />
                    <SameOriginActionForm action="/api/connections/revoke">
                      <input name="installationId" type="hidden" value={item.id} />
                      <button className="text-button danger-text" type="submit">
                        Disconnect
                      </button>
                    </SameOriginActionForm>
                  </div>
                  {installedConnectorUpdateRequired(
                    item.installed_connector_version,
                    item.browser_sync_protocol,
                    minimumVersion,
                  ) ? (
                    <ConnectorUpdateNotice
                      command={updateCommand}
                      minimumVersion={minimumVersion}
                      scope="computer"
                    />
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>
      </BrowserSyncProvider>

      <div className="settings-grid">
        <Panel className="privacy-panel">
          <p className="eyebrow">PRIVACY &amp; AGGREGATION</p>
          <h2>Only exact aggregate token counters cross the boundary</h2>
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
          <DangerActionForm
            action="/api/leaderboard/leave"
            buttonLabel="Leave leaderboard"
            confirmation="I understand that my ranking data will be deleted."
            confirmValue="leave"
          />
        </Panel>
        <Panel className="danger-panel">
          <p className="eyebrow">ACCOUNT DELETION</p>
          <h2>Delete Vibe Racing account</h2>
          <p>
            Delete the GitHub-linked user, sessions, installations, agent accounts, and all usage.
          </p>
          <details className="account-deletion-cleanup">
            <summary>
              <span className="account-deletion-cleanup-title">Local cleanup required</span>
              <span className="account-deletion-cleanup-action" aria-hidden="true">
                <span className="account-deletion-cleanup-closed">Show command</span>
                <span className="account-deletion-cleanup-open">Hide command</span>
              </span>
            </summary>
            <div className="account-deletion-cleanup-body">
              <p>
                Account deletion cannot uninstall software or hooks from your computers. Run this
                command once for every connector installation before deleting the account. You can
                also run it afterward.
              </p>
              <pre>
                <code>{uninstallCommand}</code>
              </pre>
              <CopyCommandButton
                command={uninstallCommand}
                copiedLabel="Uninstall command copied"
                label="Copy uninstall command"
              />
              <p className="muted">
                If you used <code>VIBERACING_STATE_DIR</code>, set it to the same value before
                running this command. Repeat it for every connector state directory. This removes
                only Vibe Racing hooks, its installed copy, secrets, and local state. Provider usage
                data is not changed. Run this one-line command in {commandShell}; it only performs
                this cleanup.
              </p>
            </div>
          </details>
          <DangerActionForm
            action="/api/account/delete"
            buttonLabel="Delete account"
            confirmation="I understand that server data will be permanently deleted and every local connector installation must be uninstalled separately."
            confirmValue="delete-account"
          />
        </Panel>
      </div>
    </PageShell>
  );
}

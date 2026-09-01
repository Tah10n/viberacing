import { connection } from "next/server";
import Link from "next/link";
import { CopyCommandButton } from "./components/copy-command-button";
import { ConnectorUpdateNotice } from "./components/connector-update-notice";
import { RacerLink } from "./components/racer-link";
import { StandingsTable } from "./components/standings-table";
import { PeriodSelector } from "./components/period-selector";
import {
  formatCompactTokens,
  formatExactTokens,
  leaderboard,
  publicProfile,
} from "@/lib/leaderboard";
import {
  parseUsagePeriod,
  resolveUsagePeriod,
  utcToday,
  usagePeriodRangeLabel,
  usagePeriodSearch,
  usagePeriodTitle,
} from "@/lib/usage-period";
import { hasAccountDeletionReceipt, viewer } from "@/lib/session";
import { agentNames, supportedAgents } from "@/lib/agents";
import { connectorRepairCommand, connectorUninstallCommand } from "@/lib/connector";
import {
  installedConnectorUpdateRequired,
  minimumConnectorVersion,
  publicOrigin,
} from "@/lib/config";
import { query } from "@/lib/db";

interface HomePageProps {
  readonly searchParams: Promise<{
    from?: string | string[];
    page?: string | string[];
    period?: string | string[];
    to?: string | string[];
  }>;
}

interface ConnectorVersionRow {
  browser_sync_protocol: number;
  installed_connector_version: string | null;
}

const leaderboardPageSize = 100;
const maximumPageNumber = Math.floor(Number.MAX_SAFE_INTEGER / leaderboardPageSize);
const supportedAgentLabels = supportedAgents.map((agent) => agentNames[agent]).join(" · ");

function parsePage(value: string | string[] | undefined): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 && page <= maximumPageNumber ? page : 1;
}

function pageHref(page: number, periodSearch: string): string {
  const params = new URLSearchParams(periodSearch);
  if (page > 1) params.set("page", page.toString());
  return `/?${params.toString()}`;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  await connection();
  const now = new Date();
  const params = await searchParams;
  const page = parsePage(params.page);
  const period = parseUsagePeriod(params, now);
  const resolvedPeriod = resolveUsagePeriod(period, now);
  const today = utcToday(now);
  const periodSearch = usagePeriodSearch(period);
  const periodTitle = usagePeriodTitle(period);
  const periodRange = usagePeriodRangeLabel(resolvedPeriod);
  const origin = publicOrigin().origin;
  const minimumVersion = minimumConnectorVersion();
  const updateCommand = connectorRepairCommand(origin);
  const uninstallCommand = connectorUninstallCommand(origin);
  const offset = (page - 1) * leaderboardPageSize;
  const [current, accountDeletionReceipt] = await Promise.all([
    viewer(),
    hasAccountDeletionReceipt(),
  ]);
  const accountDeleted = current === null && accountDeletionReceipt;
  const [pageRows, profile, connectorVersions] = await Promise.all([
    leaderboard({ limit: leaderboardPageSize + 1, offset }, resolvedPeriod),
    current === null ? Promise.resolve(null) : publicProfile(current.handle, resolvedPeriod),
    current === null
      ? Promise.resolve([] as ConnectorVersionRow[])
      : query<ConnectorVersionRow>(
          `SELECT installed_connector_version, browser_sync_protocol
             FROM installations
            WHERE user_id = $1 AND status = 'active'`,
          [current.id],
        ),
  ]);
  const connectorUpdateRequired = connectorVersions.some((installation) =>
    installedConnectorUpdateRequired(
      installation.installed_connector_version,
      installation.browser_sync_protocol,
      minimumVersion,
    ),
  );
  const hasNextPage = pageRows.length > leaderboardPageSize;
  const rows = pageRows.slice(0, leaderboardPageSize);
  return (
    <main className="home-page">
      {connectorUpdateRequired ? (
        <ConnectorUpdateNotice
          command={updateCommand}
          minimumVersion={minimumVersion}
          scope="computers"
        />
      ) : null}
      {accountDeleted ? (
        <section className="account-deleted-cleanup" aria-labelledby="account-deleted-title">
          <p className="eyebrow">ACCOUNT DELETED</p>
          <h2 id="account-deleted-title">Remove the connector from your computers</h2>
          <p>
            Your Vibe Racing server data was permanently deleted. The website cannot uninstall local
            software or hooks, so run this command once for every connector installation that was
            connected.
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
            If you used <code>VIBERACING_STATE_DIR</code>, set it to the same value before running
            this command. Repeat it for every connector state directory. This removes only Vibe
            Racing hooks, its installed copy, secrets, and local state. Provider usage data is not
            changed.
          </p>
        </section>
      ) : null}
      <section className="hero" aria-labelledby="race-title">
        <div className="hero-primary">
          <div className="hero-copy">
            <h1 id="race-title">The coding-agent token race</h1>
          </div>
          <div
            className={`user-callout${current === null ? " user-callout-guest" : ""}`}
            aria-label={`Your ${periodTitle.toLowerCase()} position`}
          >
            <span className="eyebrow meta-label">Your position</span>
            {current === null ? (
              <div className="hero-guest">
                <strong className="meta-value">Your grid is open</strong>
              </div>
            ) : (
              <div className="user-score-line">
                <span className="user-rank">
                  {profile === null || profile.rank === null ? "—" : `#${profile.rank}`}
                </span>
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
            <span className="meta-label">Selected period</span>
            <strong className="meta-value">{periodTitle}</strong>
            <small className="meta-value">{periodRange}</small>
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
                <b>Collects</b> Agent · UTC date · aggregate token counters
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
        <div className="leaderboard-heading">
          <div>
            <h2 id="leaderboard-title">{periodTitle} standings</h2>
            <p>
              {period.kind === "year" ? "Current calendar year · " : ""}
              {periodRange}. Community totals are self-reported, not proof of cost or productivity.
            </p>
          </div>
          <span className="badge">Self-reported</span>
        </div>
        <PeriodSelector basePath="/" period={period} resolved={resolvedPeriod} today={today} />
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
          <StandingsTable
            currentHandle={current?.handle}
            periodLabel={periodTitle}
            periodSearch={periodSearch}
            rows={rows}
          />
        )}
        {page > 1 || hasNextPage ? (
          <nav className="standings-pagination" aria-label="Standings pages">
            {page > 1 ? (
              <Link className="button button-secondary" href={pageHref(page - 1, periodSearch)}>
                Previous 100
              </Link>
            ) : (
              <span />
            )}
            <span>Page {page}</span>
            {hasNextPage ? (
              <Link className="button button-secondary" href={pageHref(page + 1, periodSearch)}>
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

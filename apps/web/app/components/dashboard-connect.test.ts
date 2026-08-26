import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("dashboard connection flow", () => {
  const dashboard = source("../dashboard/page.tsx");

  it("puts the connection action and instructions before account status", () => {
    expect(dashboard).toContain('id="connect-computer"');
    expect(dashboard).not.toContain('href="#connect-computer"');
    expect(dashboard.indexOf('className="panel connect-disclosure"')).toBeLessThan(
      dashboard.indexOf('<section className="summary-grid"'),
    );
    expect(dashboard).toContain("<CopyCommandButton command={command} />");
  });

  it("keeps repeat setup compact while leaving first-time setup open", () => {
    expect(dashboard).toContain('className="panel connect-disclosure"');
    expect(dashboard).toContain("open={installations.length === 0}");
    expect(dashboard).toContain("CONNECT A COMPUTER");
    expect(dashboard).toContain("Connect your coding agents");
    expect(dashboard).toContain('className="connect-disclosure-closed"');
  });

  it("keeps accounts collapsible and gates installation Sync to its installed handler protocol", () => {
    expect(dashboard).toContain('className="dashboard-section account-disclosure"');
    expect(dashboard).toContain("<summary");
    expect(dashboard).toContain("Show accounts");
    expect(dashboard).toContain("Hide accounts");
    expect(dashboard).toContain("browserSyncInstallationScopeProtocol");
    expect(dashboard).toContain(
      "installation.browser_sync_protocol >= browserSyncInstallationScopeProtocol",
    );
    expect(dashboard).toContain("installation.source_count <= maximumSourcesPerInstallation");
    expect(dashboard).toContain("installation.browser_sync_capable");
    expect(dashboard).not.toContain("installationBrowserSyncMinimumVersion");
    expect(dashboard).toContain("<InstallationSyncControl");
  });

  it("does not repeat an account label that matches its agent name", () => {
    expect(dashboard).toContain("function accountTitle");
    expect(dashboard).toContain("displayName.toLowerCase() === label.trim().toLowerCase()");
    expect(dashboard).toContain("<h3>{accountTitle(account.agent_id, account.label)}</h3>");
  });

  it("copies the generated command through the browser clipboard", () => {
    const component = source("./copy-command-button.tsx");
    expect(component).toContain("navigator.clipboard.writeText(command)");
    expect(component).toContain("Copy failed — select the command above.");
  });

  it("uses only centralized connector command helpers", () => {
    const connector = source("../../lib/connector.ts");
    expect(connector).toContain(
      'import connectorPackage from "../../../packages/connector/package.json"',
    );
    expect(connector).toContain("export const bundledConnectorVersion = connectorPackage.version");
    expect(connector).not.toMatch(/bundledConnectorVersion\s*=\s*["']\d+\.\d+\.\d+/);
    expect(dashboard).toContain("connectorConnectCommand(origin)");
    expect(dashboard).toContain("connectorRepairCommand(origin)");
    expect(dashboard).toContain("connectorUninstallCommand(origin)");
    expect(dashboard).not.toContain("/downloads/viberacing-connector");
    expect(dashboard).not.toContain("npx --allow-remote");
    expect(dashboard).toContain("connectorCommandShell");
    expect(dashboard).toContain("No global npm installation is performed");
    expect(dashboard).toContain("@viberacing/connector");
    expect(dashboard).not.toContain("download the connector");
  });

  it("requires repair only below the configured minimum version", () => {
    const connectorUpdate = source("./connector-update-notice.tsx");
    const home = source("../page.tsx");
    expect(dashboard).toContain("i.connector_version");
    expect(dashboard).toContain("minimumConnectorVersion()");
    expect(dashboard).toContain("versionAtLeast(item.connector_version, minimumVersion)");
    expect(dashboard).not.toContain(
      "versionAtLeast(item.connector_version, bundledConnectorVersion)",
    );
    expect(dashboard).toContain("<ConnectorUpdateNotice");
    expect(home).toContain("SELECT connector_version");
    expect(home).toContain("versionAtLeast(installation.connector_version, minimumVersion)");
    expect(home).toContain("<ConnectorUpdateNotice");
    expect(connectorUpdate).toContain("Connector update required");
    expect(connectorUpdate).toContain('label="Copy update command"');
    expect(connectorUpdate).toContain("without collecting or uploading token");
    expect(connectorUpdate).toContain("totals");
  });

  it("requires explicit local cleanup around permanent account deletion", () => {
    const home = source("../page.tsx");
    const deleteRoute = source("../api/account/delete/route.ts");
    const connector = source("../../lib/connector.ts");
    expect(connector).toContain("export function connectorUninstallCommand");
    expect(connector).toContain('"viberacing-connector.tgz"');
    expect(connector).toContain("/downloads/${archive}");
    expect(connector).toContain('"uninstall"');
    expect(dashboard).toContain("Local cleanup required");
    expect(dashboard).toContain('<details className="account-deletion-cleanup">');
    expect(dashboard).toContain("Show command");
    expect(dashboard).toContain("Hide command");
    expect(dashboard).toContain("Account deletion cannot uninstall software or hooks");
    expect(dashboard).toContain("once for every connector installation");
    expect(dashboard).toContain("VIBERACING_STATE_DIR");
    expect(dashboard).toContain("every connector state directory");
    expect(dashboard).toContain('label="Copy uninstall command"');
    expect(dashboard).toContain("connectorUninstallCommand(origin)");
    expect(dashboard).toContain(
      "every local connector installation must be uninstalled separately",
    );
    expect(deleteRoute).toContain("issueAccountDeletionReceipt");
    expect(deleteRoute).toContain("NextResponse.redirect(publicOrigin(), 303)");
    expect(home).toContain("hasAccountDeletionReceipt()");
    expect(home).toContain("current === null && accountDeletionReceipt");
    expect(home).not.toContain("params.accountDeleted");
    expect(home).toContain("Remove the connector from your computers");
    expect(home).toMatch(/The website cannot uninstall local\s+software or hooks/);
    expect(home).toContain("once for every connector installation");
    expect(home).toContain("VIBERACING_STATE_DIR");
    expect(home).toContain('label="Copy uninstall command"');
    expect(home).toContain("connectorUninstallCommand(origin)");
  });

  it("offers source reassignment only when the same agent has another account", () => {
    expect(dashboard).toContain("function hasReassignmentTarget");
    expect(dashboard).toContain("candidate.agent_id === account.agent_id");
    expect(dashboard).toContain("candidate.id !== account.id");
    expect(dashboard).toContain("hasReassignmentTarget(accounts, account) ? (");
    expect(dashboard).toContain('action="/api/sources/reassign"');
    expect(dashboard).toContain('aria-label="Move source to account"');
    expect(dashboard).toContain("<option key={candidate.id} value={candidate.id}>");
  });

  it("explains reversible automatic account-wide matching without provider identity", () => {
    const connect = source("../connect/page.tsx");
    const pairingApproval = source("../api/pairing/approve/route.ts");
    const leaderboardLeave = source("../api/leaderboard/leave/route.ts");
    expect(connect).toContain('aggregationMode === "account_max"');
    expect(connect).toContain("after enough completed");
    expect(connect).toContain("Provider email and credentials");
    expect(dashboard).toContain("AUTOMATIC ACCOUNT MATCH");
    expect(dashboard).toContain('action="/api/accounts/dedup/undo"');
    expect(dashboard).toContain("Undo automatic match");
    expect(pairingApproval).toContain("dedupEventsToSupersede");
    expect(pairingApproval).toContain("UPDATE account_dedup_events");
    expect(pairingApproval).toContain("auto_dedup_decided_at");
    expect(leaderboardLeave).toContain("UPDATE account_dedup_events");
  });

  it("shows an account-wide breakdown only from one largest exact local component tuple", () => {
    expect(dashboard).toContain("candidate.component_tokens = candidate.maximum_component_tokens");
    expect(dashboard).toContain("count(DISTINCT ROW(");
    expect(dashboard).toContain("WHEN 'account_max' THEN max(candidate.input_tokens) FILTER");
    expect(dashboard).toContain("ELSE bool_and(candidate.components_available)");
    expect(dashboard).toContain("Local component counters total");
  });

  it("shares authoritative account-day precedence with ranking summaries", () => {
    const usageSummary = source("../../lib/usage-summary.ts");
    expect(usageSummary).toContain("export const accountMaxObservationIsEligibleSql");
    expect(usageSummary).toContain("export const accountMaxDailyTokensSql");
    expect(usageSummary).toContain("updated_at = latest_complete_at");
    expect(usageSummary).toContain("updated_at > latest_complete_at");
    expect(dashboard.match(/\$\{accountMaxDailyTokensSql\}/g)).toHaveLength(2);
    expect(dashboard.match(/\$\{accountMaxObservationIsEligibleSql\}/g)).toHaveLength(2);
    expect(dashboard).toContain("AND candidate.account_max_selected");
    expect(dashboard).not.toContain("WHEN 'account_max' THEN max(candidate.total_tokens)");
  });
});

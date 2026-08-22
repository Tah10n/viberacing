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
    expect(dashboard).toContain('"Connect another computer"');
    expect(dashboard).toContain('className="connect-disclosure-closed"');
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

  it("installs the connector package from the same Vibe Racing origin", () => {
    const connector = source("../../lib/connector.ts");
    expect(connector).toContain(
      'import connectorPackage from "../../../packages/connector/package.json"',
    );
    expect(connector).toContain("export const bundledConnectorVersion = connectorPackage.version");
    expect(connector).not.toMatch(/bundledConnectorVersion\s*=\s*["']\d+\.\d+\.\d+/);
    expect(dashboard).toContain("${origin}/downloads/${connectorArchiveName()}");
    expect(dashboard).toContain("npx --yes --prefer-online --package");
    expect(dashboard).toContain("-- viberacing connect --origin ${origin}");
    expect(dashboard).not.toContain("npx @viberacing/connector");
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
    expect(connect).toContain("automatically match this account after its first");
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
});

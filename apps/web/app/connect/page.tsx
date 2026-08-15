import { connection } from "next/server";
import { ActionLink, PageHeader, PageShell, Panel } from "../components/ui";
import { SameOriginActionForm } from "../components/same-origin-action-form";
import { agentNames, agentRegistry, isSupportedAgent } from "@/lib/agents";
import { digest, normalizePairingCode } from "@/lib/crypto";
import { query } from "@/lib/db";
import { viewer } from "@/lib/session";

interface ConnectPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

interface PairingRow {
  id: string;
}

interface SourceRow {
  id: string;
  agent_id: string;
  suggested_label: string | null;
  supported_surface: string;
  agent_account_id: string | null;
}

interface AccountRow {
  id: string;
  agent_id: string;
  label: string;
}

interface SupersededSourceRow {
  agent_id: string;
}

function agentLabel(agent: string): string {
  if (!isSupportedAgent(agent)) return agent;
  return agentRegistry[agent].countsExactTokens
    ? agentNames[agent]
    : `${agentNames[agent]} (not counted yet)`;
}

export default async function ConnectPage({ searchParams }: ConnectPageProps) {
  await connection();
  const params = await searchParams;
  const code = normalizePairingCode(typeof params.code === "string" ? params.code : "");
  const [current, rows] = await Promise.all([
    viewer(),
    code.length === 8
      ? query<PairingRow>(
          `SELECT id::text FROM installations
            WHERE pairing_code_hash = $1
              AND pairing_expires_at > now()
              AND status IN ('pending', 'active', 'revoked')
            LIMIT 1`,
          [digest(code)],
        )
      : Promise.resolve([]),
  ]);
  const pairing = rows[0];
  const sources =
    pairing === undefined
      ? []
      : await query<SourceRow>(
          `SELECT id::text, agent_id, suggested_label, supported_surface, agent_account_id::text
             FROM installation_sources
            WHERE installation_id = $1 AND pending_pairing_code_hash = $2
              AND NOT pending_disconnect
            ORDER BY created_at, id`,
          [pairing.id, digest(code)],
        );
  const supersededSources =
    pairing === undefined
      ? []
      : await query<SupersededSourceRow>(
          `SELECT agent_id
             FROM installation_sources
            WHERE installation_id = $1 AND pending_pairing_code_hash = $2
              AND pending_disconnect
            ORDER BY created_at, id`,
          [pairing.id, digest(code)],
        );
  const accounts =
    current === null
      ? []
      : await query<AccountRow>(
          `SELECT id::text, agent_id, label
             FROM agent_accounts
            WHERE user_id = $1
            ORDER BY agent_id, lower(label), created_at`,
          [current.id],
        );
  const returnPath = `/connect?code=${encodeURIComponent(code)}`;
  const limitReached = params.error === "limit";
  return (
    <PageShell className="connect-page" width="narrow">
      <PageHeader
        description="Review each local source and map it to the right agent account."
        eyebrow="Pair connector"
        title="Approve this computer"
      />
      {limitReached ? (
        <Panel className="state-panel state-panel-error">
          <p className="eyebrow">Account limit reached</p>
          <h2>This pairing would exceed your connection limits</h2>
          <p>
            Remove an unused computer, source, or agent account, then approve this pairing again.
          </p>
        </Panel>
      ) : null}
      {pairing === undefined || sources.length === 0 ? (
        <Panel className="state-panel state-panel-error">
          <p className="eyebrow">Connection expired</p>
          <h2>Pairing code expired</h2>
          <p>Run the connect command again to get a fresh link.</p>
          <ActionLink href={current === null ? "/" : "/dashboard"} variant="secondary">
            {current === null ? "Back to leaderboard" : "Back to race setup"}
          </ActionLink>
        </Panel>
      ) : (
        <Panel>
          <dl className="pairing-details">
            <div>
              <dt>Sources detected</dt>
              <dd>{sources.length}</dd>
            </div>
            <div>
              <dt>Code</dt>
              <dd>{code}</dd>
            </div>
          </dl>
          <p>
            Account-wide totals are deduplicated across computers. Machine-local histories are added
            together. Different accounts always add together.
          </p>
          {supersededSources.length > 0 ? (
            <p>
              This connection replaces {supersededSources.length} migrated local source
              {supersededSources.length === 1 ? "" : "s"}. Its duplicated usage history will be
              removed after approval.
            </p>
          ) : null}
          {current === null ? (
            <a
              className="button"
              href={`/api/auth/github/start?next=${encodeURIComponent(returnPath)}`}
            >
              Sign in with GitHub to approve
            </a>
          ) : (
            <SameOriginActionForm action="/api/pairing/approve">
              <input name="code" type="hidden" value={code} />
              <div className="pairing-source-list">
                {sources.map((source, index) => {
                  const compatible = accounts.filter(
                    (account) => account.agent_id === source.agent_id,
                  );
                  const defaultValue =
                    source.agent_account_id !== null &&
                    compatible.some((account) => account.id === source.agent_account_id)
                      ? source.agent_account_id
                      : "new";
                  return (
                    <fieldset className="pairing-source" key={source.id}>
                      <legend>
                        {agentLabel(source.agent_id)} · {source.supported_surface.toUpperCase()}
                      </legend>
                      <label>
                        Agent account
                        <select defaultValue={defaultValue} name={`account_${source.id}`}>
                          <option value="new">Create a new account</option>
                          {compatible.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Label for a new account
                        <input
                          defaultValue={
                            source.suggested_label ?? (index === 0 ? "Personal" : "Work")
                          }
                          maxLength={40}
                          name={`label_${source.id}`}
                          type="text"
                        />
                      </label>
                    </fieldset>
                  );
                })}
              </div>
              <button className="button" type="submit">
                Approve for @{current.handle}
              </button>
            </SameOriginActionForm>
          )}
          <p className="muted">
            Only opaque source IDs and usage totals cross the boundary. Local paths and provider
            identities stay on this computer.
          </p>
        </Panel>
      )}
    </PageShell>
  );
}

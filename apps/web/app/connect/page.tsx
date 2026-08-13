import { connection } from "next/server";
import { ActionLink, PageHeader, Panel } from "../components/ui";
import { agentNames, isSupportedAgent } from "@/lib/agents";
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

function agentLabel(agent: string): string {
  return isSupportedAgent(agent) ? agentNames[agent] : agent;
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
            WHERE installation_id = $1 AND status = 'pending'
            ORDER BY created_at, id`,
          [pairing.id],
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
  return (
    <main className="narrow connect-page">
      <PageHeader
        description="Review each local source and map it to the right agent account."
        eyebrow="Pair connector"
        title="Approve this computer"
      />
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
          {current === null ? (
            <a
              className="button"
              href={`/api/auth/github/start?next=${encodeURIComponent(returnPath)}`}
            >
              Sign in with GitHub to approve
            </a>
          ) : (
            <form action="/api/pairing/approve" method="post">
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
            </form>
          )}
          <p className="muted">
            Only opaque source IDs and usage totals cross the boundary. Local paths and provider
            identities stay on this computer.
          </p>
        </Panel>
      )}
    </main>
  );
}

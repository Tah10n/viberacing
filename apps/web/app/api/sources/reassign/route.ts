import { NextResponse } from "next/server";
import { agentRegistry, type SupportedAgent } from "@/lib/agents";
import { publicOrigin } from "@/lib/config";
import { transaction } from "@/lib/db";
import { isUuid, problem, readBoundedForm, sameOrigin } from "@/lib/http";
import { withRequestLogging } from "@/lib/request-log";
import { viewer } from "@/lib/session";
import { rebuildAgentDailySummaries } from "@/lib/usage-summary";

async function post(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const current = await viewer();
  if (!current) return problem(401, "unauthorized");
  try {
    const form = await readBoundedForm(request);
    const sourceId = form.get("sourceId");
    const accountId = form.get("accountId");
    if (!isUuid(sourceId) || !isUuid(accountId)) return problem(400, "invalid_request");
    const changed = await transaction(async (client) => {
      await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [current.id]);
      const sources = await client.query<{
        agent_id: SupportedAgent;
        agent_account_id: string;
      }>(
        `SELECT agent_id, agent_account_id::text
           FROM installation_sources
          WHERE id = $1 AND user_id = $2
          FOR UPDATE`,
        [sourceId, current.id],
      );
      const source = sources.rows[0];
      if (source === undefined) return false;
      const accounts = await client.query<{ id: string }>(
        `SELECT id::text FROM agent_accounts
          WHERE id = $1 AND user_id = $2 AND agent_id = $3
            AND merged_into_account_id IS NULL
          FOR UPDATE`,
        [accountId, current.id, source.agent_id],
      );
      if (accounts.rows[0] === undefined) return false;
      if (source.agent_account_id === accountId) return true;
      await client.query(
        `UPDATE installation_sources
            SET agent_account_id = $2,
                auto_dedup_decided_at = CASE
                  WHEN $3::boolean THEN coalesce(auto_dedup_decided_at, now())
                  ELSE auto_dedup_decided_at
                END,
                updated_at = now()
          WHERE id = $1`,
        [sourceId, accountId, agentRegistry[source.agent_id].aggregationMode === "account_max"],
      );
      await client.query(
        `UPDATE account_dedup_events
            SET status = 'superseded', updated_at = now()
          WHERE source_id = $1 AND user_id = $2 AND status = 'active'`,
        [sourceId, current.id],
      );
      await rebuildAgentDailySummaries(client, current.id, source.agent_id);
      return true;
    });
    if (!changed) return problem(404, "source_or_account_not_found");
    return NextResponse.redirect(new URL("/dashboard?updated=1", publicOrigin()), 303);
  } catch (error) {
    if (error instanceof RangeError) return problem(413, "body_too_large");
    return error instanceof SyntaxError
      ? problem(400, "invalid_request")
      : problem(500, "server_error", error);
  }
}

export const POST = withRequestLogging("/api/sources/reassign", post);

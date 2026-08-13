import { NextResponse } from "next/server";
import { publicOrigin } from "@/lib/config";
import { transaction } from "@/lib/db";
import { isUuid, problem, readBoundedForm, sameOrigin } from "@/lib/http";
import { viewer } from "@/lib/session";
import { rebuildAgentSummaries } from "@/lib/usage-summary";

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const current = await viewer();
  if (!current) return problem(401, "unauthorized");
  try {
    const form = await readBoundedForm(request);
    const sourceId = form.get("sourceId");
    const accountId = form.get("accountId");
    if (!isUuid(sourceId) || !isUuid(accountId)) return problem(400, "invalid_request");
    const changed = await transaction(async (client) => {
      const result = await client.query<{ agent_id: string }>(
        `UPDATE installation_sources s
            SET agent_account_id = a.id, updated_at = now()
           FROM agent_accounts a
          WHERE s.id = $1 AND a.id = $2
            AND s.user_id = $3 AND a.user_id = $3 AND s.agent_id = a.agent_id
          RETURNING s.agent_id`,
        [sourceId, accountId, current.id],
      );
      if (result.rows[0]) await rebuildAgentSummaries(client, current.id, result.rows[0].agent_id);
      return result.rowCount === 1;
    });
    if (!changed) return problem(404, "source_or_account_not_found");
    return NextResponse.redirect(new URL("/dashboard?updated=1", publicOrigin()), 303);
  } catch (error) {
    return error instanceof RangeError
      ? problem(413, "body_too_large")
      : problem(400, "invalid_request");
  }
}

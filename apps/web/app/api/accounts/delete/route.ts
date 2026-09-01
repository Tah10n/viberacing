import { NextResponse } from "next/server";
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
    const accountId = form.get("accountId");
    if (!isUuid(accountId)) return problem(400, "invalid_request");
    const outcome = await transaction(async (client) => {
      await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [current.id]);
      const account = await client.query<{ agent_id: string }>(
        `SELECT agent_id FROM agent_accounts
          WHERE id = $1 AND user_id = $2 AND merged_into_account_id IS NULL
          FOR UPDATE`,
        [accountId, current.id],
      );
      const row = account.rows[0];
      if (!row) return "missing";
      const profileDependents = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM installation_sources child
           JOIN installation_sources profile
             ON profile.id = child.profile_source_id
            AND profile.installation_id = child.installation_id
          WHERE profile.agent_account_id = $1
            AND child.agent_account_id <> $1`,
        [accountId],
      );
      if ((profileDependents.rows[0]?.count ?? 0) > 0) return "linked_profile";
      const sources = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM installation_sources WHERE agent_account_id = $1",
        [accountId],
      );
      if ((sources.rows[0]?.count ?? 0) > 0 && form.get("confirm") !== "delete")
        return "confirmation";
      await client.query("DELETE FROM agent_accounts WHERE id = $1 AND user_id = $2", [
        accountId,
        current.id,
      ]);
      await rebuildAgentDailySummaries(client, current.id, row.agent_id);
      return "deleted";
    });
    if (outcome === "missing") return problem(404, "account_not_found");
    if (outcome === "linked_profile") return problem(409, "primary_account_has_linked_accounts");
    if (outcome === "confirmation") return problem(400, "confirmation_required");
    return NextResponse.redirect(new URL("/dashboard?accountDeleted=1", publicOrigin()), 303);
  } catch (error) {
    if (error instanceof RangeError) return problem(413, "body_too_large");
    return error instanceof SyntaxError
      ? problem(400, "invalid_request")
      : problem(500, "server_error", error);
  }
}

export const POST = withRequestLogging("/api/accounts/delete", post);

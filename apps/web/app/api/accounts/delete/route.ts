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
    const accountId = form.get("accountId");
    if (!isUuid(accountId)) return problem(400, "invalid_request");
    const outcome = await transaction(async (client) => {
      const account = await client.query<{ agent_id: string }>(
        "SELECT agent_id FROM agent_accounts WHERE id = $1 AND user_id = $2 FOR UPDATE",
        [accountId, current.id],
      );
      const row = account.rows[0];
      if (!row) return "missing";
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
      await rebuildAgentSummaries(client, current.id, row.agent_id);
      return "deleted";
    });
    if (outcome === "missing") return problem(404, "account_not_found");
    if (outcome === "confirmation") return problem(400, "confirmation_required");
    return NextResponse.redirect(new URL("/dashboard?accountDeleted=1", publicOrigin()), 303);
  } catch (error) {
    return error instanceof RangeError
      ? problem(413, "body_too_large")
      : problem(400, "invalid_request");
  }
}

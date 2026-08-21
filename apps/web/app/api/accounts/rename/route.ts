import { NextResponse } from "next/server";
import { publicOrigin } from "@/lib/config";
import { query } from "@/lib/db";
import { isSafeDisplayText, isUuid, problem, readBoundedForm, sameOrigin } from "@/lib/http";
import { withRequestLogging } from "@/lib/request-log";
import { viewer } from "@/lib/session";

async function post(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const current = await viewer();
  if (!current) return problem(401, "unauthorized");
  try {
    const form = await readBoundedForm(request);
    const accountId = form.get("accountId");
    const label = form.get("label")?.trim();
    if (!isUuid(accountId) || !isSafeDisplayText(label, 40)) return problem(400, "invalid_request");
    const changed = await query<{ id: string }>(
      `UPDATE agent_accounts SET label = $1, updated_at = now()
        WHERE id = $2 AND user_id = $3 AND merged_into_account_id IS NULL
        RETURNING id::text`,
      [label, accountId, current.id],
    );
    if (changed.length === 0) return problem(404, "account_not_found");
    return NextResponse.redirect(new URL("/dashboard?updated=1", publicOrigin()), 303);
  } catch (error) {
    if (error instanceof RangeError) return problem(413, "body_too_large");
    return error instanceof SyntaxError
      ? problem(400, "invalid_request")
      : problem(500, "server_error", error);
  }
}

export const POST = withRequestLogging("/api/accounts/rename", post);

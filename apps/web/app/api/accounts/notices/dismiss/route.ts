import { NextResponse } from "next/server";
import { publicOrigin } from "@/lib/config";
import { query } from "@/lib/db";
import { problem, readBoundedForm, sameOrigin } from "@/lib/http";
import { withRequestLogging } from "@/lib/request-log";
import { viewer } from "@/lib/session";

async function post(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const current = await viewer();
  if (!current) return problem(401, "unauthorized");
  try {
    const form = await readBoundedForm(request, 256);
    if ([...form.keys()].length > 0) return problem(400, "invalid_request");
    await query(
      `UPDATE agent_accounts
          SET new_account_notice_pending = false, updated_at = now()
        WHERE user_id = $1 AND new_account_notice_pending`,
      [current.id],
    );
    return NextResponse.redirect(new URL("/dashboard", publicOrigin()), 303);
  } catch (error) {
    if (error instanceof RangeError) return problem(413, "body_too_large");
    return error instanceof SyntaxError
      ? problem(400, "invalid_request")
      : problem(500, "server_error", error);
  }
}

export const POST = withRequestLogging("/api/accounts/notices/dismiss", post);

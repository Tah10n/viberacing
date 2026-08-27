import { NextResponse } from "next/server";
import { publicOrigin } from "@/lib/config";
import { query } from "@/lib/db";
import { isUuid, problem, readBoundedForm, sameOrigin } from "@/lib/http";
import { withRequestLogging } from "@/lib/request-log";
import { viewer } from "@/lib/session";

async function post(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const current = await viewer();
  if (current === null) return problem(401, "unauthorized");
  try {
    const form = await readBoundedForm(request, 256);
    const eventId = form.get("eventId");
    if (
      !isUuid(eventId) ||
      form.getAll("eventId").length !== 1 ||
      [...form.keys()].some((key) => key !== "eventId")
    ) {
      return problem(400, "invalid_request");
    }
    await query(
      `UPDATE account_dedup_events
          SET dismissed_at = now(), updated_at = now()
        WHERE id = $1 AND user_id = $2 AND status = 'active' AND dismissed_at IS NULL`,
      [eventId, current.id],
    );
    return NextResponse.redirect(new URL("/dashboard", publicOrigin()), 303);
  } catch (error) {
    if (error instanceof RangeError) return problem(413, "body_too_large");
    return error instanceof SyntaxError
      ? problem(400, "invalid_request")
      : problem(500, "server_error", error);
  }
}

export const POST = withRequestLogging("/api/accounts/dedup/dismiss", post);

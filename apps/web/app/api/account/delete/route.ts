import { NextResponse } from "next/server";
import { publicOrigin } from "@/lib/config";
import { query } from "@/lib/db";
import { problem, readBoundedForm, sameOrigin } from "@/lib/http";
import { withRequestLogging } from "@/lib/request-log";
import { destroySession, viewer } from "@/lib/session";

async function post(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const current = await viewer();
  if (!current) return problem(401, "unauthorized");
  try {
    const form = await readBoundedForm(request);
    if (form.get("confirm") !== "delete-account") return problem(400, "confirmation_required");
    await query("DELETE FROM users WHERE id = $1", [current.id]);
    await destroySession();
    return NextResponse.redirect(new URL("/?accountDeleted=1", publicOrigin()), 303);
  } catch (error) {
    if (error instanceof RangeError) return problem(413, "body_too_large");
    return error instanceof SyntaxError
      ? problem(400, "invalid_request")
      : problem(500, "server_error", error);
  }
}

export const POST = withRequestLogging("/api/account/delete", post);

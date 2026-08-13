import { NextResponse } from "next/server";
import { publicOrigin } from "@/lib/config";
import { query } from "@/lib/db";
import { isUuid, problem, readBoundedForm, sameOrigin } from "@/lib/http";
import { viewer } from "@/lib/session";

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const current = await viewer();
  if (current === null)
    return NextResponse.redirect(new URL("/api/auth/github/start", publicOrigin()), 303);
  let form: URLSearchParams;
  try {
    form = await readBoundedForm(request);
  } catch (error) {
    return error instanceof RangeError
      ? problem(413, "body_too_large")
      : problem(400, "invalid_request");
  }
  const connectionId = form.get("connectionId");
  if (!isUuid(connectionId)) return problem(400, "invalid_connection");
  await query(
    "UPDATE connections SET status = 'revoked' WHERE id = $1 AND user_id = $2 AND status = 'active'",
    [connectionId, current.id],
  );
  return NextResponse.redirect(new URL("/dashboard?disconnected=1", publicOrigin()), 303);
}

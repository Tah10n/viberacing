import { NextResponse } from "next/server";
import { publicOrigin } from "@/lib/config";
import { query } from "@/lib/db";
import { isUuid, problem, readBoundedForm, sameOrigin } from "@/lib/http";
import { viewer } from "@/lib/session";

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const current = await viewer();
  if (!current) return problem(401, "unauthorized");
  try {
    const form = await readBoundedForm(request);
    const sourceId = form.get("sourceId");
    if (!isUuid(sourceId)) return problem(400, "invalid_request");
    const changed = await query<{ id: string }>(
      "UPDATE installation_sources SET status = 'disconnected', updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING id::text",
      [sourceId, current.id],
    );
    if (changed.length === 0) return problem(404, "source_not_found");
    return NextResponse.redirect(new URL("/dashboard?sourceDisconnected=1", publicOrigin()), 303);
  } catch (error) {
    return error instanceof RangeError
      ? problem(413, "body_too_large")
      : problem(400, "invalid_request");
  }
}

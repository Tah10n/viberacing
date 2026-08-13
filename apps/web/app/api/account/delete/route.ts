import { NextResponse } from "next/server";
import { publicOrigin } from "@/lib/config";
import { query } from "@/lib/db";
import { problem, readBoundedForm, sameOrigin } from "@/lib/http";
import { destroySession, viewer } from "@/lib/session";

export async function POST(request: Request): Promise<Response> {
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
    return error instanceof RangeError
      ? problem(413, "body_too_large")
      : problem(400, "invalid_request");
  }
}

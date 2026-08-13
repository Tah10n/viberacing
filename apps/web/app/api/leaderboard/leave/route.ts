import { NextResponse } from "next/server";
import { publicOrigin } from "@/lib/config";
import { transaction } from "@/lib/db";
import { problem, readBoundedForm, sameOrigin } from "@/lib/http";
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
  if (form.get("confirm") !== "leave") return problem(400, "confirmation_required");
  await transaction(async (client) => {
    await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [current.id]);
    await client.query(
      `UPDATE installations
          SET status = 'revoked', device_token_hash = NULL, revoked_at = now(), updated_at = now()
        WHERE user_id = $1 AND status = 'active'`,
      [current.id],
    );
    await client.query(
      "UPDATE installation_sources SET status = 'disconnected', updated_at = now() WHERE user_id = $1",
      [current.id],
    );
    await client.query(
      `DELETE FROM daily_usage
        WHERE source_id IN (SELECT id FROM installation_sources WHERE user_id = $1)`,
      [current.id],
    );
    await client.query("DELETE FROM weekly_agent_usage WHERE user_id = $1", [current.id]);
  });
  return NextResponse.redirect(new URL("/dashboard?left=1", publicOrigin()), 303);
}

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
    const sourceId = form.get("sourceId");
    if (
      !isUuid(sourceId) ||
      form.getAll("sourceId").length !== 1 ||
      [...form.keys()].some((key) => key !== "sourceId")
    ) {
      return problem(400, "invalid_request");
    }
    await query(
      `UPDATE installation_sources profile
          SET codex_hook_notice_dismissed_at = now(), updated_at = now()
        WHERE profile.id = $1
          AND profile.user_id = $2
          AND profile.agent_id = 'codex'
          AND profile.status = 'active'
          AND profile.profile_source_id IS NULL
          AND profile.codex_hook_notice_dismissed_at IS NULL
          AND EXISTS (
                SELECT 1
                  FROM installation_sources member
                 WHERE member.installation_id = profile.installation_id
                   AND member.user_id = profile.user_id
                   AND member.agent_id = 'codex'
                   AND member.status = 'active'
                   AND coalesce(member.profile_source_id, member.id) = profile.id
                   AND member.last_successful_sync_at IS NOT NULL
              )`,
      [sourceId, current.id],
    );
    return NextResponse.redirect(new URL("/dashboard", publicOrigin()), 303);
  } catch (error) {
    if (error instanceof RangeError) return problem(413, "body_too_large");
    return error instanceof SyntaxError
      ? problem(400, "invalid_request")
      : problem(500, "server_error", error);
  }
}

export const POST = withRequestLogging("/api/installations/codex-hook-notice/dismiss", post);

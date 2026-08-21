import { NextResponse } from "next/server";
import { publicOrigin } from "@/lib/config";
import { query } from "@/lib/db";
import { isUuid, problem, readBoundedForm, sameOrigin } from "@/lib/http";
import { withRequestLogging } from "@/lib/request-log";
import { clearLocalInstallation, localInstallationId, viewer } from "@/lib/session";

async function post(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const current = await viewer();
  if (current === null) return problem(401, "unauthorized");
  let form: URLSearchParams;
  try {
    form = await readBoundedForm(request);
  } catch (error) {
    return error instanceof RangeError
      ? problem(413, "body_too_large")
      : problem(400, "invalid_request");
  }
  const installationId = form.get("installationId");
  if (!isUuid(installationId)) return problem(400, "invalid_installation");
  await query(
    `WITH revoked AS (
       UPDATE installations
          SET status = 'revoked', device_token_hash = NULL, revoked_at = now(), updated_at = now()
        WHERE id = $1 AND user_id = $2 AND status = 'active'
        RETURNING id
     )
     UPDATE installation_sources
        SET status = 'disconnected', updated_at = now()
      WHERE installation_id IN (SELECT id FROM revoked) AND status = 'active'`,
    [installationId, current.id],
  );
  if ((await localInstallationId()) === installationId) await clearLocalInstallation();
  return NextResponse.redirect(new URL("/dashboard?disconnected=1", publicOrigin()), 303);
}

export const POST = withRequestLogging("/api/connections/revoke", post);

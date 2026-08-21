import { query } from "@/lib/db";
import { isUuid, problem } from "@/lib/http";
import { withRequestLogging } from "@/lib/request-log";
import { viewer } from "@/lib/session";

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function get(_request: Request, context: RouteContext): Promise<Response> {
  const current = await viewer();
  if (current === null) return problem(401, "unauthorized");
  const { id } = await context.params;
  if (!isUuid(id)) return problem(400, "invalid_request");
  const rows = await query<{ status: string; result_code: string | null }>(
    `SELECT status, result_code FROM browser_sync_runs
      WHERE id = $1 AND user_id = $2 AND created_at > now() - interval '1 day'`,
    [id, current.id],
  );
  const run = rows[0];
  if (run === undefined) return problem(404, "sync_not_started");
  return Response.json(
    { status: run.status, resultCode: run.result_code },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export const GET = withRequestLogging("/api/accounts/sync/[id]", get);

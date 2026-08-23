import { query } from "@/lib/db";
import { isUuid, problem } from "@/lib/http";
import { consumeRateLimit } from "@/lib/rate-limit";
import { withRequestLogging } from "@/lib/request-log";
import { viewer } from "@/lib/session";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function rateLimited(): Response {
  const response = problem(429, "rate_limited");
  response.headers.set("Retry-After", "60");
  return response;
}

async function get(_request: Request, context: RouteContext): Promise<Response> {
  const current = await viewer();
  if (current === null) return problem(401, "unauthorized");
  const { id } = await context.params;
  if (!isUuid(id)) return problem(400, "invalid_request");
  if (!(await consumeRateLimit("browser_sync_status_user", current.id, 300, 60)))
    return rateLimited();
  if (!(await consumeRateLimit("browser_sync_status_run", `${current.id}:${id}`, 60, 60)))
    return rateLimited();
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

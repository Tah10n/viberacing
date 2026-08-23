import { digest, randomToken } from "@/lib/crypto";
import { isUuid, problem, sameOrigin } from "@/lib/http";
import { query } from "@/lib/db";
import { consumeRateLimit } from "@/lib/rate-limit";
import { withRequestLogging } from "@/lib/request-log";
import { localInstallationId, viewer } from "@/lib/session";

async function post(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const [current, installationId] = await Promise.all([viewer(), localInstallationId()]);
  if (current === null) return problem(401, "unauthorized");
  if (!isUuid(installationId)) return problem(404, "local_connector_unavailable");
  if (!(await consumeRateLimit("browser_sync_grant_user", current.id, 20, 60))) {
    return problem(429, "rate_limited");
  }
  const token = randomToken();
  const rows = await query<{ expires_at: Date | null; rate_limited: boolean }>(
    `WITH expired AS (
       SELECT grant_hash FROM browser_sync_grants
        WHERE expires_at <= now()
        ORDER BY expires_at
        LIMIT 100
     ), cleanup AS (
       DELETE FROM browser_sync_grants WHERE grant_hash IN (SELECT grant_hash FROM expired)
     ), installation AS (
       SELECT i.id, i.user_id
         FROM installations i
        WHERE i.id = $1 AND i.user_id = $2 AND i.status = 'active'
          AND i.browser_sync_capable
          AND EXISTS (
            SELECT 1 FROM installation_sources s
             WHERE s.installation_id = i.id AND s.user_id = i.user_id AND s.status = 'active'
          )
        FOR UPDATE
     ), blocked AS (
       SELECT i.id, i.user_id
         FROM installation i
        WHERE EXISTS (
          SELECT 1 FROM browser_sync_runs run
           WHERE run.installation_id = i.id AND run.user_id = i.user_id
             AND (
               (run.status = 'running' AND run.updated_at > now() - interval '10 minutes')
               OR (
                 run.created_at > now() - interval '60 seconds'
                 AND run.result_code IS DISTINCT FROM 'busy'
               )
             )
        )
     ), eligible AS (
       SELECT i.id, i.user_id
         FROM installation i
        WHERE NOT EXISTS (SELECT 1 FROM blocked)
     ), inserted AS (
       INSERT INTO browser_sync_grants (grant_hash, installation_id, user_id, expires_at)
       SELECT $3, id, user_id, now() + interval '5 minutes' FROM eligible
       RETURNING expires_at
     )
     SELECT expires_at, false AS rate_limited FROM inserted
     UNION ALL
     SELECT NULL::timestamptz, true AS rate_limited FROM blocked`,
    [installationId, current.id, digest(token)],
  );
  const grant = rows[0];
  if (grant === undefined) return problem(404, "local_connector_unavailable");
  if (grant.rate_limited || grant.expires_at === null) {
    const response = problem(429, "sync_rate_limited");
    response.headers.set("Retry-After", "60");
    return response;
  }
  return Response.json(
    { installationId, token, expiresAt: grant.expires_at.toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export const POST = withRequestLogging("/api/accounts/sync/grant", post);

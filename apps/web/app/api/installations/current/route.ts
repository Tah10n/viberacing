import { digest } from "@/lib/crypto";
import { problem } from "@/lib/http";
import { query, transaction } from "@/lib/db";
import { withRequestLogging } from "@/lib/request-log";

function bearer(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice(7);
  return token.length >= 32 && token.length <= 128 ? token : null;
}

async function get(request: Request): Promise<Response> {
  const token = bearer(request);
  if (!token) return problem(401, "unauthorized");
  const rows = await query<{
    id: string;
    status: string;
    connector_version: string;
    last_sync_at: Date | null;
    sources: unknown;
  }>(
    `SELECT i.id::text, i.status, i.connector_version, i.last_sync_at,
            coalesce(jsonb_agg(jsonb_build_object(
              'sourceId', s.id::text,
              'agentId', s.agent_id,
              'status', s.status,
              'collectionMethod', s.collection_method,
              'lastAcceptedSyncSequence', s.last_accepted_sync_sequence::text,
              'lastSuccessfulSyncAt', s.last_successful_sync_at,
              'completeness', s.last_completeness,
              'warning', s.last_warning_summary,
              'error', s.last_error_summary,
              'accountLabel', a.label
            ) ORDER BY s.created_at) FILTER (WHERE s.id IS NOT NULL), '[]'::jsonb) AS sources
       FROM installations i
       LEFT JOIN LATERAL (
         SELECT candidate.*
           FROM installation_sources candidate
          WHERE candidate.installation_id = i.id
          ORDER BY CASE WHEN candidate.status = 'active' THEN 0 ELSE 1 END,
                   candidate.updated_at DESC, candidate.created_at DESC, candidate.id
          LIMIT 64
       ) s ON true
       LEFT JOIN agent_accounts a ON a.id = s.agent_account_id
      WHERE i.device_token_hash = $1 AND i.status = 'active'
      GROUP BY i.id`,
    [digest(token)],
  );
  const installation = rows[0];
  return installation
    ? Response.json(
        {
          status: installation.status,
          connectorVersion: installation.connector_version,
          lastSyncAt: installation.last_sync_at,
          sources: installation.sources,
        },
        { headers: { "Cache-Control": "no-store" } },
      )
    : problem(401, "unauthorized");
}

async function remove(request: Request): Promise<Response> {
  const token = bearer(request);
  if (!token) return problem(401, "unauthorized");
  const changed = await transaction(async (client) => {
    const result = await client.query<{ id: string }>(
      `UPDATE installations
          SET status = 'revoked', device_token_hash = NULL, revoked_at = now(), updated_at = now()
        WHERE device_token_hash = $1 AND status = 'active'
        RETURNING id::text`,
      [digest(token)],
    );
    if (result.rows[0])
      await client.query(
        "UPDATE installation_sources SET status = 'disconnected', updated_at = now() WHERE installation_id = $1 AND status = 'active'",
        [result.rows[0].id],
      );
    return result.rowCount === 1;
  });
  return changed ? new Response(null, { status: 204 }) : problem(401, "unauthorized");
}

export const GET = withRequestLogging("/api/installations/current", get);
export const DELETE = withRequestLogging("/api/installations/current", remove);

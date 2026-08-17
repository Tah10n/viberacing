import { digest } from "@/lib/crypto";
import { isRecord, isUuid, problem, readBoundedJson } from "@/lib/http";
import { query, transaction } from "@/lib/db";
import { consumeRateLimit } from "@/lib/rate-limit";
import { withRequestLogging } from "@/lib/request-log";

function bearer(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice(7);
  return token.length >= 32 && token.length <= 128 ? token : null;
}

function rateLimited(): Response {
  return Response.json(
    { error: "rate_limited" },
    { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
  );
}

async function post(request: Request): Promise<Response> {
  const token = bearer(request);
  if (!token) return problem(401, "unauthorized");
  try {
    if (!(await consumeRateLimit("reconciliation_global", "all", 10_000, 60))) {
      return rateLimited();
    }
    const body = await readBoundedJson(request, 8_192);
    if (
      !isRecord(body) ||
      Object.keys(body).length !== 1 ||
      !Array.isArray(body.sourceIds) ||
      body.sourceIds.length > 100 ||
      !body.sourceIds.every(isUuid) ||
      new Set(body.sourceIds).size !== body.sourceIds.length
    ) {
      return problem(400, "invalid_request");
    }
    const installations = await query<{ id: string }>(
      "SELECT id::text FROM installations WHERE device_token_hash = $1 AND status = 'active' LIMIT 1",
      [digest(token)],
    );
    const installation = installations[0];
    if (!installation) return problem(401, "unauthorized");
    if (!(await consumeRateLimit("reconciliation_installation", installation.id, 60, 60))) {
      return rateLimited();
    }
    const sourceIds = body.sourceIds;
    const rows = await query<{
      source_id: string;
      status: "active" | "disconnected";
      last_accepted_sync_sequence: string;
    }>(
      `SELECT requested.source_id::text,
              CASE WHEN source.status = 'active' THEN 'active' ELSE 'disconnected' END AS status,
              coalesce(source.last_accepted_sync_sequence, 0)::text AS last_accepted_sync_sequence
         FROM unnest($2::uuid[]) WITH ORDINALITY AS requested(source_id, position)
         LEFT JOIN installation_sources source
           ON source.id = requested.source_id
          AND source.installation_id = $1
        ORDER BY requested.position`,
      [installation.id, sourceIds],
    );
    return Response.json(
      {
        sources: rows.map((source) => ({
          sourceId: source.source_id,
          status: source.status,
          lastAcceptedSyncSequence: source.last_accepted_sync_sequence,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return error instanceof SyntaxError || error instanceof RangeError
      ? problem(400, "invalid_request")
      : problem(500, "server_error", error);
  }
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

export const POST = withRequestLogging("/api/installations/current", post);
export const DELETE = withRequestLogging("/api/installations/current", remove);

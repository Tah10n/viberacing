import { digest } from "@/lib/crypto";
import { query, transaction } from "@/lib/db";
import { isRecord, isUuid, problem, readBoundedJson } from "@/lib/http";
import { clientAddress, clientAdmissionLimit, consumeRateLimit } from "@/lib/rate-limit";
import { withRequestLogging } from "@/lib/request-log";

function bearer(request: Request): string | null {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice(7);
  return token.length >= 32 && token.length <= 128 ? token : null;
}

async function post(request: Request): Promise<Response> {
  const token = bearer(request);
  if (token === null) return problem(401, "unauthorized");
  const address = clientAddress(request);
  if (
    !(await consumeRateLimit(
      "browser_sync_claim_pre_auth",
      address.key,
      clientAdmissionLimit(address, 30, 2_000, 10),
      60,
    ))
  ) {
    return problem(429, "rate_limited");
  }
  try {
    const body = await readBoundedJson(request, 2_048);
    if (
      !isRecord(body) ||
      Object.keys(body).length !== 3 ||
      !isUuid(body.requestId) ||
      !isUuid(body.accountId) ||
      typeof body.grant !== "string" ||
      body.grant.length < 32 ||
      body.grant.length > 128
    ) {
      return problem(400, "invalid_request");
    }
    const requestId = body.requestId;
    const accountId = body.accountId;
    const grant = body.grant;
    const tokenHash = digest(token);
    const authenticated = await query<{ id: string }>(
      `SELECT id::text
         FROM installations
        WHERE device_token_hash = $1 AND status = 'active' AND browser_sync_capable
        LIMIT 1`,
      [tokenHash],
    );
    const authenticatedInstallation = authenticated[0];
    if (authenticatedInstallation === undefined) return problem(401, "unauthorized");
    if (
      !(await consumeRateLimit(
        "browser_sync_claim_installation",
        authenticatedInstallation.id,
        10,
        60,
      ))
    ) {
      return problem(429, "rate_limited");
    }
    const outcome = await transaction(async (client) => {
      await client.query(
        "DELETE FROM browser_sync_runs WHERE created_at < now() - interval '1 day'",
      );
      const installations = await client.query<{
        id: string;
        user_id: string;
      }>(
        `SELECT id::text, user_id::text
           FROM installations
          WHERE id = $1 AND device_token_hash = $2
            AND status = 'active' AND browser_sync_capable
          FOR UPDATE`,
        [authenticatedInstallation.id, tokenHash],
      );
      const installation = installations.rows[0];
      if (installation === undefined) return { kind: "unauthorized" as const };
      const consumed = await client.query(
        `DELETE FROM browser_sync_grants
          WHERE grant_hash = $1 AND installation_id = $2 AND user_id = $3
            AND expires_at > now()
        RETURNING grant_hash`,
        [digest(grant), installation.id, installation.user_id],
      );
      if (consumed.rowCount !== 1) return { kind: "expired" as const };
      const sources = await client.query<{ id: string; agent_id: string }>(
        `SELECT id::text, agent_id
           FROM installation_sources
          WHERE installation_id = $1 AND user_id = $2 AND agent_account_id = $3
            AND status = 'active'
          ORDER BY created_at, id`,
        [installation.id, installation.user_id, accountId],
      );
      const first = sources.rows[0];
      if (first === undefined) return { kind: "missing" as const };
      await client.query(
        `INSERT INTO browser_sync_runs
           (id, installation_id, user_id, agent_account_id, agent_id, status)
         VALUES ($1, $2, $3, $4, $5, 'running')`,
        [requestId, installation.id, installation.user_id, accountId, first.agent_id],
      );
      return { kind: "ok" as const, sourceIds: sources.rows.map((source) => source.id) };
    });
    if (outcome.kind === "unauthorized") return problem(401, "unauthorized");
    if (outcome.kind === "expired") return problem(409, "sync_grant_expired");
    if (outcome.kind === "missing") return problem(404, "account_source_not_found");
    return Response.json(
      { requestId, sourceIds: outcome.sourceIds },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return error instanceof SyntaxError || error instanceof RangeError
      ? problem(400, "invalid_request")
      : problem(500, "server_error", error);
  }
}

export const POST = withRequestLogging("/api/installations/current/sync/claim", post);

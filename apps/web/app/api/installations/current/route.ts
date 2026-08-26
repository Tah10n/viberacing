import { digest } from "@/lib/crypto";
import { browserSyncInstallationScopeProtocol, isSemanticVersion } from "@/lib/config";
import { isRecord, isUuid, problem, readBoundedJson } from "@/lib/http";
import { query, transaction } from "@/lib/db";
import {
  clientAddress,
  clientAdmissionLimit,
  consumeAdmissionRateLimit,
  consumeRateLimit,
} from "@/lib/rate-limit";
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

interface ReconciliationBody {
  browserSyncProtocol?: number;
  connectorVersion?: string;
  sourceIds: string[];
}

export function parseReconciliationBody(value: unknown): ReconciliationBody | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value).sort();
  if (
    JSON.stringify(keys) !== JSON.stringify(["sourceIds"]) &&
    JSON.stringify(keys) !== JSON.stringify(["connectorVersion", "sourceIds"]) &&
    JSON.stringify(keys) !==
      JSON.stringify(["browserSyncProtocol", "connectorVersion", "sourceIds"])
  ) {
    return null;
  }
  if (
    !Array.isArray(value.sourceIds) ||
    value.sourceIds.length > 100 ||
    !value.sourceIds.every(isUuid) ||
    new Set(value.sourceIds).size !== value.sourceIds.length
  ) {
    return null;
  }
  if (
    value.connectorVersion !== undefined &&
    (typeof value.connectorVersion !== "string" ||
      value.connectorVersion.length > 40 ||
      !isSemanticVersion(value.connectorVersion))
  ) {
    return null;
  }
  if (
    value.browserSyncProtocol !== undefined &&
    (typeof value.browserSyncProtocol !== "number" ||
      !Number.isSafeInteger(value.browserSyncProtocol) ||
      value.browserSyncProtocol < 0 ||
      value.browserSyncProtocol > browserSyncInstallationScopeProtocol)
  ) {
    return null;
  }
  return {
    sourceIds: value.sourceIds,
    ...(value.connectorVersion === undefined ? {} : { connectorVersion: value.connectorVersion }),
    ...(value.browserSyncProtocol === undefined
      ? {}
      : { browserSyncProtocol: value.browserSyncProtocol }),
  };
}

async function post(request: Request): Promise<Response> {
  const token = bearer(request);
  if (!token) return problem(401, "unauthorized");
  try {
    const address = clientAddress(request);
    if (
      !(
        await consumeAdmissionRateLimit(
          "reconciliation_pre_auth",
          address.key,
          clientAdmissionLimit(address, 120, 10_000, 20),
          10_000,
          60,
        )
      ).allowed
    ) {
      return rateLimited();
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
    if (!(await consumeRateLimit("reconciliation_global", "all", 10_000, 60))) {
      return rateLimited();
    }
    const body = parseReconciliationBody(await readBoundedJson(request, 8_192));
    if (body === null) return problem(400, "invalid_request");
    const rows = await transaction(async (client) => {
      if (body.connectorVersion !== undefined && body.browserSyncProtocol !== undefined) {
        await client.query(
          `UPDATE installations
              SET connector_version = $2,
                  browser_sync_protocol = $3,
                  browser_sync_capable = $3::smallint > 0,
                  updated_at = now()
            WHERE id = $1
              AND status = 'active'
              AND device_token_hash = $4
              AND (
                connector_version IS DISTINCT FROM $2
                OR browser_sync_protocol IS DISTINCT FROM $3
              )`,
          [installation.id, body.connectorVersion, body.browserSyncProtocol, digest(token)],
        );
      } else if (body.connectorVersion !== undefined) {
        await client.query(
          `UPDATE installations
              SET connector_version = $2,
                  updated_at = now()
            WHERE id = $1
              AND status = 'active'
              AND device_token_hash = $3
              AND connector_version IS DISTINCT FROM $2`,
          [installation.id, body.connectorVersion, digest(token)],
        );
      }
      const result = await client.query<{
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
        [installation.id, body.sourceIds],
      );
      return result.rows;
    });
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
  try {
    const address = clientAddress(request);
    if (
      !(
        await consumeAdmissionRateLimit(
          "installation_delete_pre_auth",
          address.key,
          clientAdmissionLimit(address, 30, 2_000, 10),
          2_000,
          60,
        )
      ).allowed
    ) {
      return rateLimited();
    }
    const installations = await query<{ id: string }>(
      "SELECT id::text FROM installations WHERE device_token_hash = $1 AND status = 'active' LIMIT 1",
      [digest(token)],
    );
    const installation = installations[0];
    if (!installation) return problem(401, "unauthorized");
    if (!(await consumeRateLimit("installation_delete", installation.id, 5, 300))) {
      return rateLimited();
    }
    await transaction(async (client) => {
      const result = await client.query<{ id: string }>(
        `UPDATE installations
          SET status = 'revoked',
              device_token_hash = NULL,
              pairing_code_hash = NULL,
              poll_token_hash = NULL,
              pending_device_token_hash = NULL,
              pairing_expires_at = NULL,
              revoked_at = now(),
              updated_at = now()
        WHERE id = $1 AND device_token_hash = $2 AND status = 'active'
        RETURNING id::text`,
        [installation.id, digest(token)],
      );
      if (result.rows[0]) {
        await client.query(
          "DELETE FROM installation_sources WHERE installation_id = $1 AND status = 'pending'",
          [result.rows[0].id],
        );
        await client.query(
          `UPDATE installation_sources
            SET status = CASE WHEN status = 'active' THEN 'disconnected' ELSE status END,
                pending_pairing_code_hash = NULL,
                pending_disconnect = false,
                updated_at = now()
          WHERE installation_id = $1`,
          [result.rows[0].id],
        );
      }
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return problem(500, "server_error", error);
  }
}

export const POST = withRequestLogging("/api/installations/current", post);
export const DELETE = withRequestLogging("/api/installations/current", remove);

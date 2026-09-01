import { digest } from "@/lib/crypto";
import {
  browserSyncInstallationScopeProtocol,
  isSemanticVersion,
  isSupportedConnectorProtocolVersion,
  type SupportedConnectorProtocolVersion,
} from "@/lib/config";
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
  cliVersion?: string;
  connectorVersion?: string;
  handlerAttestation?: HandlerAttestation;
  sourceIds: string[];
  bootstrapSourceIds?: string[];
  protocolVersion?: SupportedConnectorProtocolVersion;
}

interface HandlerAttestation {
  attestationId: string;
  browserSyncProtocol: number;
  installedRuntimeVersion: string | null;
}

function parseHandlerAttestation(value: unknown): HandlerAttestation | null {
  if (!isRecord(value)) return null;
  if (
    JSON.stringify(Object.keys(value).sort()) !==
    JSON.stringify(["attestationId", "browserSyncProtocol", "installedRuntimeVersion"])
  ) {
    return null;
  }
  if (
    !isUuid(value.attestationId) ||
    !(
      value.installedRuntimeVersion === null ||
      (typeof value.installedRuntimeVersion === "string" &&
        value.installedRuntimeVersion.length <= 40 &&
        isSemanticVersion(value.installedRuntimeVersion))
    ) ||
    typeof value.browserSyncProtocol !== "number" ||
    !Number.isSafeInteger(value.browserSyncProtocol) ||
    value.browserSyncProtocol < 0 ||
    value.browserSyncProtocol > browserSyncInstallationScopeProtocol
  ) {
    return null;
  }
  return {
    attestationId: value.attestationId,
    browserSyncProtocol: value.browserSyncProtocol,
    installedRuntimeVersion: value.installedRuntimeVersion,
  };
}

export function parseReconciliationBody(value: unknown): ReconciliationBody | null {
  if (!isRecord(value)) return null;
  const keys = new Set(Object.keys(value));
  if (
    !keys.has("sourceIds") ||
    [...keys].some(
      (key) =>
        ![
          "sourceIds",
          "bootstrapSourceIds",
          "connectorVersion",
          "cliVersion",
          "handlerAttestation",
          "protocolVersion",
        ].includes(key),
    ) ||
    (keys.has("connectorVersion") && keys.has("cliVersion")) ||
    (keys.has("handlerAttestation") && !keys.has("cliVersion"))
  )
    return null;
  if (
    !Array.isArray(value.sourceIds) ||
    value.sourceIds.length > 100 ||
    !value.sourceIds.every(isUuid) ||
    new Set(value.sourceIds).size !== value.sourceIds.length
  ) {
    return null;
  }
  const sourceIds: string[] = value.sourceIds;
  if (
    value.bootstrapSourceIds !== undefined &&
    (!Array.isArray(value.bootstrapSourceIds) ||
      value.bootstrapSourceIds.length > 32 ||
      !value.bootstrapSourceIds.every(isUuid) ||
      new Set(value.bootstrapSourceIds).size !== value.bootstrapSourceIds.length ||
      value.bootstrapSourceIds.some((sourceId) => !sourceIds.includes(sourceId)))
  )
    return null;
  if (
    (value.protocolVersion !== undefined &&
      !isSupportedConnectorProtocolVersion(value.protocolVersion)) ||
    (value.cliVersion !== undefined &&
      (typeof value.cliVersion !== "string" ||
        value.cliVersion.length > 40 ||
        !isSemanticVersion(value.cliVersion)))
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
  const handlerAttestation =
    value.handlerAttestation === undefined
      ? undefined
      : parseHandlerAttestation(value.handlerAttestation);
  if (handlerAttestation === null) return null;
  return {
    sourceIds,
    ...(value.bootstrapSourceIds === undefined
      ? {}
      : { bootstrapSourceIds: value.bootstrapSourceIds }),
    ...(value.cliVersion === undefined ? {} : { cliVersion: value.cliVersion }),
    ...(value.connectorVersion === undefined ? {} : { connectorVersion: value.connectorVersion }),
    ...(handlerAttestation === undefined ? {} : { handlerAttestation }),
    ...(value.protocolVersion === undefined ? {} : { protocolVersion: value.protocolVersion }),
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
    const cliVersion = body.cliVersion ?? body.connectorVersion;
    const result = await transaction(async (client) => {
      if (cliVersion !== undefined && body.handlerAttestation !== undefined) {
        await client.query(
          `UPDATE installations
              SET last_cli_version = $2,
                  installed_connector_version = $3,
                  browser_sync_protocol = $4,
                  browser_sync_capable = $4::smallint > 0,
                  updated_at = now()
            WHERE id = $1
              AND status = 'active'
              AND device_token_hash = $5
              AND (
                last_cli_version IS DISTINCT FROM $2
                OR installed_connector_version IS DISTINCT FROM $3
                OR browser_sync_protocol IS DISTINCT FROM $4
              )`,
          [
            installation.id,
            cliVersion,
            body.handlerAttestation.installedRuntimeVersion,
            body.handlerAttestation.browserSyncProtocol,
            digest(token),
          ],
        );
      } else if (cliVersion !== undefined) {
        await client.query(
          `UPDATE installations
              SET last_cli_version = $2,
                  updated_at = now()
            WHERE id = $1
              AND status = 'active'
              AND device_token_hash = $3
              AND last_cli_version IS DISTINCT FROM $2`,
          [installation.id, cliVersion, digest(token)],
        );
      }
      if (body.protocolVersion !== undefined) {
        await client.query(
          `UPDATE installations
              SET protocol_version = $2, updated_at = now()
            WHERE id = $1 AND status = 'active' AND device_token_hash = $3
              AND protocol_version IS DISTINCT FROM $2`,
          [installation.id, body.protocolVersion, digest(token)],
        );
      }
      const result = await client.query<{
        source_id: string;
        status: "active" | "disconnected";
        last_accepted_sync_sequence: string;
        history_backfill_year: number;
        history_backfill_status: "pending" | "complete" | "partial";
      }>(
        `SELECT requested.source_id::text,
                CASE WHEN source.status = 'active' THEN 'active' ELSE 'disconnected' END AS status,
                coalesce(source.last_accepted_sync_sequence, 0)::text AS last_accepted_sync_sequence,
                coalesce(
                  CASE
                    WHEN source.history_backfill_year =
                      extract(year FROM (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))::integer
                    THEN source.history_backfill_year
                  END,
                  extract(year FROM (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))::integer
                ) AS history_backfill_year,
                CASE
                  WHEN source.history_backfill_year =
                    extract(year FROM (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))::integer
                  THEN coalesce(source.history_backfill_status, 'pending')
                  ELSE 'pending'
                END AS history_backfill_status
           FROM unnest($2::uuid[]) WITH ORDINALITY AS requested(source_id, position)
           LEFT JOIN installation_sources source
             ON source.id = requested.source_id
            AND source.installation_id = $1
          ORDER BY requested.position`,
        [installation.id, body.sourceIds],
      );
      const baselines =
        (body.bootstrapSourceIds?.length ?? 0) === 0
          ? []
          : (
              await client.query<{
                accepted_at: string | null;
                entries: Array<{ date: string; totalTokens: string }>;
                source_id: string;
              }>(
                `SELECT source.id::text AS source_id,
                        source.last_successful_sync_at::text AS accepted_at,
                        coalesce(
                          jsonb_agg(
                            jsonb_build_object(
                              'date', usage.usage_date::text,
                              'totalTokens', usage.total_tokens::text
                            ) ORDER BY usage.usage_date
                          ) FILTER (WHERE usage.usage_date IS NOT NULL),
                          '[]'::jsonb
                        ) AS entries
                   FROM installation_sources source
                   LEFT JOIN daily_usage usage
                     ON usage.source_id = source.id
                    AND usage.usage_date BETWEEN current_date - 30 AND current_date
                  WHERE source.installation_id = $1
                    AND source.id = ANY($2::uuid[])
                    AND source.agent_id = 'opencode'
                  GROUP BY source.id, source.last_successful_sync_at
                  ORDER BY source.id`,
                [installation.id, body.bootstrapSourceIds],
              )
            ).rows;
      return { rows: result.rows, baselines };
    });
    return Response.json(
      {
        sources: result.rows.map((source) => ({
          sourceId: source.source_id,
          status: source.status,
          lastAcceptedSyncSequence: source.last_accepted_sync_sequence,
          ...(body.protocolVersion !== undefined && body.protocolVersion >= 5
            ? {
                historyBackfillYear: source.history_backfill_year,
                historyBackfillStatus: source.history_backfill_status,
              }
            : {}),
        })),
        ...(body.bootstrapSourceIds === undefined
          ? {}
          : {
              sourceBaselines: result.baselines.map((baseline) => ({
                sourceId: baseline.source_id,
                acceptedAt:
                  baseline.accepted_at === null
                    ? null
                    : new Date(baseline.accepted_at).toISOString(),
                entries: baseline.entries,
              })),
            }),
        ...(body.handlerAttestation === undefined
          ? {}
          : { acceptedHandlerAttestationId: body.handlerAttestation.attestationId }),
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

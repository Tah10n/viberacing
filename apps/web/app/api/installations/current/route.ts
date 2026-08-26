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
  cliVersion?: string;
  connectorVersion?: string;
  handlerAttestation?: HandlerAttestation;
  sourceIds: string[];
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
  const keys = Object.keys(value).sort();
  if (
    JSON.stringify(keys) !== JSON.stringify(["sourceIds"]) &&
    JSON.stringify(keys) !== JSON.stringify(["connectorVersion", "sourceIds"]) &&
    JSON.stringify(keys) !== JSON.stringify(["cliVersion", "sourceIds"]) &&
    JSON.stringify(keys) !== JSON.stringify(["cliVersion", "handlerAttestation", "sourceIds"])
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
    value.cliVersion !== undefined &&
    (typeof value.cliVersion !== "string" ||
      value.cliVersion.length > 40 ||
      !isSemanticVersion(value.cliVersion))
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
    sourceIds: value.sourceIds,
    ...(value.cliVersion === undefined ? {} : { cliVersion: value.cliVersion }),
    ...(value.connectorVersion === undefined ? {} : { connectorVersion: value.connectorVersion }),
    ...(handlerAttestation === undefined ? {} : { handlerAttestation }),
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
    const rows = await transaction(async (client) => {
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

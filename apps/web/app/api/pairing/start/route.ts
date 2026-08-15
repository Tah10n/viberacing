import { randomUUID } from "node:crypto";
import { minimumConnectorVersion, publicOrigin, versionAtLeast } from "@/lib/config";
import { deviceTokenFromPollToken, digest, pairingCode, randomToken } from "@/lib/crypto";
import { transaction } from "@/lib/db";
import { isSupportedAgent, isSupportedSource, type SupportedAgent } from "@/lib/agents";
import { isRecord, isUuid, problem, readBoundedJson } from "@/lib/http";
import { clientAddress, consumeRateLimit } from "@/lib/rate-limit";

interface StartBody {
  protocolVersion?: unknown;
  connectorVersion?: unknown;
  installationId?: unknown;
  installationSecret?: unknown;
  sources?: unknown;
  supersededClientSourceIds?: unknown;
}

interface PendingSource {
  clientSourceId?: unknown;
  agentId?: unknown;
  collectionMethod?: unknown;
  suggestedLabel?: unknown;
  supportedSurface?: unknown;
}

interface InstallationRow {
  secret_matches: boolean;
}

const protocolVersion = 2;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const versionPattern = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,39}$/;
const bodyKeys = new Set([
  "protocolVersion",
  "connectorVersion",
  "installationId",
  "installationSecret",
  "sources",
  "supersededClientSourceIds",
]);
const sourceKeys = new Set([
  "clientSourceId",
  "agentId",
  "collectionMethod",
  "suggestedLabel",
  "supportedSurface",
]);

function onlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function parseSources(value: unknown): PendingSource[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) return null;
  const seen = new Set<string>();
  const result: PendingSource[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate) || !onlyKeys(candidate, sourceKeys)) return null;
    const source = candidate as PendingSource;
    if (
      !identifierPattern.test(
        typeof source.clientSourceId === "string" ? source.clientSourceId : "",
      ) ||
      !isSupportedAgent(source.agentId) ||
      typeof source.collectionMethod !== "string" ||
      (source.supportedSurface !== "cli" && source.supportedSurface !== "desktop") ||
      !isSupportedSource(source.agentId, source.collectionMethod, source.supportedSurface) ||
      (source.suggestedLabel !== undefined &&
        (typeof source.suggestedLabel !== "string" ||
          source.suggestedLabel.trim().length < 1 ||
          source.suggestedLabel.trim().length > 40)) ||
      seen.has(source.clientSourceId as string)
    ) {
      return null;
    }
    seen.add(source.clientSourceId as string);
    result.push(source);
  }
  return result;
}

function parseSupersededSourceIds(value: unknown, activeIds: ReadonlySet<string>): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 32) return null;
  const result = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (
      typeof candidate !== "string" ||
      !identifierPattern.test(candidate) ||
      activeIds.has(candidate) ||
      seen.has(candidate)
    ) {
      return null;
    }
    seen.add(candidate);
    result.push(candidate);
  }
  return result;
}

export async function POST(request: Request): Promise<Response> {
  if (!(await consumeRateLimit("pairing_start", clientAddress(request), 6, 60))) {
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
    );
  }
  try {
    const rawBody = await readBoundedJson(request, 16_384);
    if (!isRecord(rawBody) || !onlyKeys(rawBody, bodyKeys)) return problem(400, "invalid_request");
    const body = rawBody as StartBody;
    const sources = parseSources(body.sources);
    const sourceIds = new Set(sources?.map((source) => source.clientSourceId as string) ?? []);
    const supersededClientSourceIds = parseSupersededSourceIds(
      body.supersededClientSourceIds,
      sourceIds,
    );
    if (
      body.protocolVersion !== protocolVersion ||
      !versionPattern.test(
        typeof body.connectorVersion === "string" ? body.connectorVersion : "",
      ) ||
      !isUuid(body.installationId) ||
      typeof body.installationSecret !== "string" ||
      body.installationSecret.length < 32 ||
      body.installationSecret.length > 128 ||
      sources === null ||
      supersededClientSourceIds === null
    ) {
      return problem(400, "invalid_request");
    }
    if (!versionAtLeast(body.connectorVersion as string, minimumConnectorVersion())) {
      return problem(426, "connector_upgrade_required");
    }
    const installationId = body.installationId;
    const installationSecret = body.installationSecret;
    const connectorVersion = body.connectorVersion as string;

    const code = pairingCode();
    const pairingHash = digest(code);
    const pollToken = randomToken();
    const pendingDeviceHash = digest(deviceTokenFromPollToken(pollToken));
    const outcome = await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [installationId]);
      await client.query(
        `DELETE FROM installations
          WHERE id IN (
            SELECT id FROM installations
             WHERE status = 'pending' AND pairing_expires_at <= now()
             ORDER BY pairing_expires_at
             LIMIT 100
          )`,
      );
      const pending = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM installations WHERE status = 'pending'",
      );
      const existing = await client.query<InstallationRow>(
        `SELECT installation_secret_hash = $2 AS secret_matches
           FROM installations WHERE id = $1 FOR UPDATE`,
        [installationId, digest(installationSecret)],
      );
      const installation = existing.rows[0];
      if (installation !== undefined && !installation.secret_matches) return "unauthorized";
      if (installation === undefined && (pending.rows[0]?.count ?? 1_000) >= 1_000) return "busy";

      const currentSources = await client.query<{
        client_source_id: string;
        agent_id: SupportedAgent;
        collection_method: string;
      }>(
        `SELECT client_source_id, agent_id, collection_method
           FROM installation_sources
          WHERE installation_id = $1 AND client_source_id = ANY($2::text[])
          FOR UPDATE`,
        [installationId, sources.map((source) => source.clientSourceId)],
      );
      const currentById = new Map(
        currentSources.rows.map((source) => [source.client_source_id, source]),
      );
      for (const source of sources) {
        const current = currentById.get(source.clientSourceId as string);
        if (
          current !== undefined &&
          (current.agent_id !== source.agentId ||
            current.collection_method !== source.collectionMethod)
        ) {
          return "source_mismatch";
        }
      }

      await client.query(
        "DELETE FROM installation_sources WHERE installation_id = $1 AND status = 'pending'",
        [installationId],
      );
      await client.query(
        `UPDATE installation_sources
            SET pending_pairing_code_hash = NULL, pending_disconnect = false
          WHERE installation_id = $1
            AND (pending_pairing_code_hash IS NOT NULL OR pending_disconnect)`,
        [installationId],
      );

      if (installation === undefined) {
        await client.query(
          `INSERT INTO installations
             (id, status, installation_secret_hash, pairing_code_hash, poll_token_hash,
              pending_device_token_hash, connector_version, protocol_version, pairing_expires_at)
           VALUES ($1, 'pending', $2, $3, $4, $5, $6, $7, now() + interval '10 minutes')`,
          [
            installationId,
            digest(installationSecret),
            pairingHash,
            digest(pollToken),
            pendingDeviceHash,
            connectorVersion,
            body.protocolVersion,
          ],
        );
      } else {
        await client.query(
          `UPDATE installations
              SET status = CASE WHEN status = 'active' THEN 'active' ELSE 'pending' END,
                  pairing_code_hash = $2,
                  poll_token_hash = $3,
                  pending_device_token_hash = $4,
                  pairing_expires_at = now() + interval '10 minutes',
                  connector_version = $5,
                  protocol_version = $6,
                  updated_at = now()
            WHERE id = $1`,
          [
            installationId,
            pairingHash,
            digest(pollToken),
            pendingDeviceHash,
            connectorVersion,
            protocolVersion,
          ],
        );
      }

      for (const source of sources) {
        await client.query(
          `INSERT INTO installation_sources
             (id, installation_id, agent_id, client_source_id, collection_method,
              supported_surface, suggested_label, pending_pairing_code_hash, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
           ON CONFLICT (installation_id, client_source_id) DO UPDATE
             SET supported_surface = EXCLUDED.supported_surface,
                 suggested_label = EXCLUDED.suggested_label,
                 pending_pairing_code_hash = EXCLUDED.pending_pairing_code_hash,
                 updated_at = now()`,
          [
            randomUUID(),
            installationId,
            source.agentId,
            source.clientSourceId,
            source.collectionMethod,
            source.supportedSurface,
            typeof source.suggestedLabel === "string" ? source.suggestedLabel.trim() : null,
            pairingHash,
          ],
        );
      }
      if (supersededClientSourceIds.length > 0) {
        await client.query(
          `UPDATE installation_sources
              SET pending_pairing_code_hash = $2,
                  pending_disconnect = true,
                  updated_at = now()
            WHERE installation_id = $1
              AND client_source_id = ANY($3::text[])
              AND status = 'active'`,
          [installationId, pairingHash, supersededClientSourceIds],
        );
      }
      return "created";
    });

    if (outcome === "unauthorized") return problem(401, "installation_auth_failed");
    if (outcome === "source_mismatch") return problem(409, "source_identity_changed");
    if (outcome === "busy") {
      return Response.json(
        { error: "pairing_busy" },
        { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
      );
    }
    return Response.json(
      {
        installationId,
        code,
        pollToken,
        verificationUrl: new URL(`/connect?code=${code}`, publicOrigin()).href,
        expiresInSeconds: 600,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return error instanceof SyntaxError || error instanceof RangeError
      ? problem(400, "invalid_request")
      : problem(500, "server_error");
  }
}

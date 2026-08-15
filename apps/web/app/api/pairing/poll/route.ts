import { deviceTokenFromPollToken, digest } from "@/lib/crypto";
import { query } from "@/lib/db";
import { annotateResponse, isRecord, isUuid, problem, readBoundedJson } from "@/lib/http";
import { clientAddress, consumeRateLimit } from "@/lib/rate-limit";
import { withRequestLogging } from "@/lib/request-log";

interface PollBody {
  installationId?: unknown;
  pollToken?: unknown;
}

interface PollRow {
  id: string;
  status: "pending" | "active" | "revoked";
  pairing_pending: boolean;
}

interface SourceRow {
  client_source_id: string;
  source_id: string;
  agent_account_id: string;
  agent_id: string;
  account_label: string;
  collection_method: string;
  last_accepted_sync_sequence: string;
}

async function post(request: Request): Promise<Response> {
  try {
    const rawBody = await readBoundedJson(request, 2_048);
    if (!isRecord(rawBody)) return problem(400, "invalid_request");
    const body = rawBody as PollBody;
    if (
      !isUuid(body.installationId) ||
      typeof body.pollToken !== "string" ||
      body.pollToken.length < 32 ||
      body.pollToken.length > 128
    ) {
      return problem(400, "invalid_request");
    }
    if (!(await consumeRateLimit("pairing_poll_pre_auth", clientAddress(request), 120, 60))) {
      return Response.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
      );
    }
    const rows = await query<PollRow>(
      `SELECT id::text,
              status,
              pending_device_token_hash IS NOT NULL AS pairing_pending
         FROM installations
        WHERE id = $1
          AND poll_token_hash = $2
          AND pairing_expires_at > now()
        LIMIT 1`,
      [body.installationId, digest(body.pollToken)],
    );
    const installation = rows[0];
    if (installation === undefined) return problem(404, "pairing_not_found");
    if (!(await consumeRateLimit("pairing_poll", installation.id, 40, 60))) {
      return Response.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
      );
    }
    if (installation.status !== "active" || installation.pairing_pending) {
      const pairingStatus = installation.pairing_pending ? "pending" : installation.status;
      return annotateResponse(
        Response.json({ status: pairingStatus }, { headers: { "Cache-Control": "no-store" } }),
        { pairingStatus },
      );
    }
    const deviceToken = deviceTokenFromPollToken(body.pollToken);
    const mappings = await query<SourceRow>(
      `SELECT s.client_source_id,
              s.id::text AS source_id,
              a.id::text AS agent_account_id,
              s.agent_id,
              a.label AS account_label,
              s.collection_method,
              s.last_accepted_sync_sequence::text
         FROM installation_sources s
         JOIN agent_accounts a ON a.id = s.agent_account_id
         JOIN installations i ON i.id = s.installation_id
        WHERE s.installation_id = $1
          AND s.status = 'active'
          AND i.device_token_hash = $2
        ORDER BY s.created_at, s.id`,
      [body.installationId, digest(deviceToken)],
    );
    if (mappings.length === 0) return problem(404, "pairing_not_found");
    return annotateResponse(
      Response.json(
        {
          status: "active",
          deviceToken,
          sources: mappings.map((source) => ({
            clientSourceId: source.client_source_id,
            sourceId: source.source_id,
            agentAccountId: source.agent_account_id,
            agentId: source.agent_id,
            accountLabel: source.account_label,
            collectionMethod: source.collection_method,
            lastAcceptedSyncSequence: source.last_accepted_sync_sequence,
          })),
          protocol: { version: 2, snapshotDays: 31, maximumSources: 32, maximumEntries: 1_024 },
        },
        { headers: { "Cache-Control": "no-store" } },
      ),
      { pairingStatus: "active", mappingsReturned: mappings.length },
    );
  } catch (error) {
    return error instanceof SyntaxError || error instanceof RangeError
      ? problem(400, "invalid_request")
      : problem(500, "server_error", error);
  }
}

export const POST = withRequestLogging("/api/pairing/poll", post);

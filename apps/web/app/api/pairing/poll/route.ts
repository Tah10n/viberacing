import { isSupportedConnectorProtocolVersion, maximumSourcesPerInstallation } from "@/lib/config";
import { deviceTokenFromPollToken, digest } from "@/lib/crypto";
import { query } from "@/lib/db";
import { annotateResponse, isRecord, isUuid, problem, readBoundedJson } from "@/lib/http";
import {
  clientAddress,
  clientAdmissionLimit,
  consumeAdmissionRateLimit,
  consumeRateLimit,
} from "@/lib/rate-limit";
import { withRequestLogging } from "@/lib/request-log";

interface PollBody {
  installationId?: unknown;
  pollToken?: unknown;
}

interface PollRow {
  id: string;
  status: "pending" | "active" | "revoked";
  pairing_pending: boolean;
  protocol_version: number;
}

interface SourceRow {
  client_source_id: string;
  source_id: string;
  agent_account_id: string;
  agent_id: string;
  account_label: string;
  collection_method: string;
  last_accepted_sync_sequence: string;
  history_backfill_year: number;
  history_backfill_status: "pending" | "complete" | "partial";
}

async function post(request: Request): Promise<Response> {
  try {
    const address = clientAddress(request);
    if (
      !(
        await consumeAdmissionRateLimit(
          "pairing_poll_pre_auth",
          address.key,
          clientAdmissionLimit(address, 120, 10_000, 20),
          10_000,
          60,
        )
      ).allowed
    ) {
      return Response.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
      );
    }
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
    const rows = await query<PollRow>(
      `SELECT id::text,
              status,
              pending_device_token_hash IS NOT NULL AS pairing_pending,
              protocol_version
         FROM installations
        WHERE id = $1
          AND poll_token_hash = $2
          AND pairing_expires_at > now()
        LIMIT 1`,
      [body.installationId, digest(body.pollToken)],
    );
    const installation = rows[0];
    if (installation === undefined) {
      return annotateResponse(problem(404, "pairing_not_found"), {}, "warn");
    }
    if (!(await consumeRateLimit("pairing_poll", installation.id, 40, 60))) {
      return Response.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
      );
    }
    if (!(await consumeRateLimit("pairing_poll_global", "all", 10_000, 60))) {
      return Response.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
      );
    }
    if (installation.status === "revoked") {
      return annotateResponse(
        Response.json({ status: "revoked" }, { headers: { "Cache-Control": "no-store" } }),
        { pairingStatus: "revoked" },
        "warn",
      );
    }
    if (installation.status !== "active" || installation.pairing_pending) {
      const pairingStatus = installation.pairing_pending ? "pending" : installation.status;
      return annotateResponse(
        Response.json({ status: pairingStatus }, { headers: { "Cache-Control": "no-store" } }),
        { pairingStatus },
        pairingStatus === "pending" ? "debug" : "warn",
      );
    }
    if (!isSupportedConnectorProtocolVersion(installation.protocol_version)) {
      throw new Error("Installation has an unsupported connector protocol version");
    }
    const deviceToken = deviceTokenFromPollToken(body.pollToken);
    const currentHistoryYear = new Date().getUTCFullYear();
    const mappings = await query<SourceRow>(
      `SELECT s.client_source_id,
              s.id::text AS source_id,
              a.id::text AS agent_account_id,
              s.agent_id,
              a.label AS account_label,
              s.collection_method,
              s.last_accepted_sync_sequence::text,
              s.history_backfill_year,
              s.history_backfill_status
         FROM installation_sources s
         JOIN agent_accounts a ON a.id = s.agent_account_id
         JOIN installations i ON i.id = s.installation_id
        WHERE s.installation_id = $1
          AND s.status = 'active'
          AND s.profile_source_id IS NULL
          AND i.device_token_hash = $2
        ORDER BY s.created_at, s.id`,
      [body.installationId, digest(deviceToken)],
    );
    if (mappings.length === 0) {
      return annotateResponse(problem(404, "pairing_not_found"), {}, "warn");
    }
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
            ...(installation.protocol_version >= 5
              ? {
                  historyBackfillYear:
                    source.history_backfill_year === currentHistoryYear
                      ? source.history_backfill_year
                      : currentHistoryYear,
                  historyBackfillStatus:
                    source.history_backfill_year === currentHistoryYear
                      ? source.history_backfill_status
                      : "pending",
                }
              : {}),
          })),
          protocol: {
            version: installation.protocol_version,
            snapshotDays: 31,
            maximumSources: maximumSourcesPerInstallation,
            maximumEntries: 1_024,
          },
        },
        { headers: { "Cache-Control": "no-store" } },
      ),
      { pairingStatus: "active", mappingsReturned: mappings.length },
      "info",
    );
  } catch (error) {
    return error instanceof SyntaxError || error instanceof RangeError
      ? problem(400, "invalid_request")
      : problem(500, "server_error", error);
  }
}

export const POST = withRequestLogging("/api/pairing/poll", post);

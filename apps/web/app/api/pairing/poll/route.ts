import { deviceTokenFromPollToken, digest } from "@/lib/crypto";
import { query } from "@/lib/db";
import { isRecord, isUuid, problem, readBoundedJson } from "@/lib/http";
import { consumeRateLimit } from "@/lib/rate-limit";

interface PollBody {
  installationId?: unknown;
  pollToken?: unknown;
}

interface PollRow {
  status: "pending" | "active" | "revoked";
}

interface SourceRow {
  client_source_id: string;
  source_id: string;
  agent_account_id: string;
  agent_id: string;
  account_label: string;
  collection_method: string;
}

export async function POST(request: Request): Promise<Response> {
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
    if (!(await consumeRateLimit("pairing_poll", body.pollToken, 40, 60))) {
      return Response.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
      );
    }
    const rows = await query<PollRow>(
      `SELECT status FROM installations
        WHERE id = $1
          AND poll_token_hash = $2
          AND pairing_expires_at > now()
        LIMIT 1`,
      [body.installationId, digest(body.pollToken)],
    );
    const installation = rows[0];
    if (installation === undefined) return problem(404, "pairing_not_found");
    if (installation.status !== "active") {
      return Response.json(
        { status: installation.status },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const deviceToken = deviceTokenFromPollToken(body.pollToken);
    const mappings = await query<SourceRow>(
      `SELECT s.client_source_id,
              s.id::text AS source_id,
              a.id::text AS agent_account_id,
              s.agent_id,
              a.label AS account_label,
              s.collection_method
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
    return Response.json(
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
        })),
        protocol: { version: 2, snapshotDays: 31, maximumSources: 32, maximumEntries: 1_024 },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return error instanceof SyntaxError || error instanceof RangeError
      ? problem(400, "invalid_request")
      : problem(500, "server_error");
  }
}

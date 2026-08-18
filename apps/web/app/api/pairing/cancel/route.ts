import { deviceTokenFromPollToken, digest } from "@/lib/crypto";
import { transaction } from "@/lib/db";
import { isRecord, isUuid, problem, readBoundedJson } from "@/lib/http";
import { clientAddress, consumeRateLimit } from "@/lib/rate-limit";
import { withRequestLogging } from "@/lib/request-log";

interface CancelBody {
  installationId?: unknown;
  pollToken?: unknown;
}

interface InstallationRow {
  id: string;
  status: "pending" | "active" | "revoked";
  attempt_active: boolean;
}

function rateLimited(): Response {
  return Response.json(
    { error: "rate_limited" },
    { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
  );
}

async function post(request: Request): Promise<Response> {
  if (!(await consumeRateLimit("pairing_cancel_global", "all", 10_000, 60))) {
    return rateLimited();
  }
  const address = clientAddress(request);
  const addressLimit = address === "untrusted-forwarding-headers" ? 10_000 : 120;
  if (!(await consumeRateLimit("pairing_cancel_pre_auth", address, addressLimit, 60))) {
    return rateLimited();
  }
  try {
    const rawBody = await readBoundedJson(request, 2_048);
    const installationId = isRecord(rawBody) ? rawBody.installationId : undefined;
    const pollToken = isRecord(rawBody) ? rawBody.pollToken : undefined;
    if (
      !isRecord(rawBody) ||
      Object.keys(rawBody).length !== 2 ||
      !isUuid(installationId) ||
      typeof pollToken !== "string" ||
      pollToken.length < 32 ||
      pollToken.length > 128
    ) {
      return problem(400, "invalid_request");
    }
    const body: CancelBody & { installationId: string; pollToken: string } = {
      installationId,
      pollToken,
    };
    await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        body.installationId,
      ]);
      const installations = await client.query<InstallationRow>(
        `SELECT id::text,
                status,
                device_token_hash = $3 AS attempt_active
           FROM installations
          WHERE id = $1 AND poll_token_hash = $2
          FOR UPDATE`,
        [
          body.installationId,
          digest(body.pollToken),
          digest(deviceTokenFromPollToken(body.pollToken)),
        ],
      );
      const installation = installations.rows[0];
      if (installation === undefined) return;
      const revoke = installation.status !== "active" || installation.attempt_active;
      await client.query(
        "DELETE FROM installation_sources WHERE installation_id = $1 AND status = 'pending'",
        [installation.id],
      );
      await client.query(
        `UPDATE installation_sources
            SET status = CASE
                  WHEN $2::boolean AND status = 'active' THEN 'disconnected'
                  ELSE status
                END,
                pending_pairing_code_hash = NULL,
                pending_disconnect = false,
                updated_at = now()
          WHERE installation_id = $1`,
        [installation.id, revoke],
      );
      await client.query(
        `UPDATE installations
            SET status = CASE WHEN $2::boolean THEN 'revoked' ELSE status END,
                device_token_hash = CASE WHEN $2::boolean THEN NULL ELSE device_token_hash END,
                pairing_code_hash = NULL,
                poll_token_hash = NULL,
                pending_device_token_hash = NULL,
                pairing_expires_at = NULL,
                revoked_at = CASE WHEN $2::boolean THEN now() ELSE revoked_at END,
                updated_at = now()
          WHERE id = $1`,
        [installation.id, revoke],
      );
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return error instanceof SyntaxError || error instanceof RangeError
      ? problem(400, "invalid_request")
      : problem(500, "server_error", error);
  }
}

export const POST = withRequestLogging("/api/pairing/cancel", post);

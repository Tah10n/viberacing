import { digest } from "@/lib/crypto";
import { query } from "@/lib/db";
import { isRecord, isUuid, problem, readBoundedJson } from "@/lib/http";
import { clientAddress, clientAdmissionLimit, consumeRateLimit } from "@/lib/rate-limit";
import { withRequestLogging } from "@/lib/request-log";

const statuses = new Set(["succeeded", "partial", "failed"]);
const codes = new Set([
  "complete",
  "unchanged",
  "partial",
  "busy",
  "collector_failed",
  "network_failed",
  "authorization_failed",
  "invalid_request",
]);
const resultCodesByStatus = {
  succeeded: new Set(["complete", "unchanged"]),
  partial: new Set(["partial"]),
  failed: new Set([
    "busy",
    "collector_failed",
    "network_failed",
    "authorization_failed",
    "invalid_request",
  ]),
} as const;

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
      "browser_sync_result_pre_auth",
      address.key,
      clientAdmissionLimit(address, 60, 4_000, 20),
      60,
    ))
  ) {
    return problem(429, "rate_limited");
  }
  try {
    const body = await readBoundedJson(request, 1_024);
    if (
      !isRecord(body) ||
      Object.keys(body).length !== 3 ||
      !isUuid(body.requestId) ||
      typeof body.status !== "string" ||
      !statuses.has(body.status) ||
      typeof body.resultCode !== "string" ||
      !codes.has(body.resultCode) ||
      !resultCodesByStatus[body.status as keyof typeof resultCodesByStatus].has(body.resultCode)
    ) {
      return problem(400, "invalid_request");
    }
    const installations = await query<{ id: string }>(
      "SELECT id::text FROM installations WHERE device_token_hash = $1 AND status = 'active' LIMIT 1",
      [digest(token)],
    );
    const installation = installations[0];
    if (installation === undefined) return problem(401, "unauthorized");
    if (!(await consumeRateLimit("browser_sync_result_installation", installation.id, 20, 60))) {
      return problem(429, "rate_limited");
    }
    const rows = await query<{ id: string }>(
      `UPDATE browser_sync_runs run
          SET status = $3, result_code = $4, updated_at = now()
         FROM installations installation
        WHERE run.id = $1 AND run.installation_id = installation.id
          AND installation.device_token_hash = $2 AND installation.status = 'active'
          AND run.status = 'running'
        RETURNING run.id::text`,
      [body.requestId, digest(token), body.status, body.resultCode],
    );
    if (rows[0] === undefined) return problem(404, "sync_run_not_found");
    return new Response(null, { status: 204 });
  } catch (error) {
    return error instanceof SyntaxError || error instanceof RangeError
      ? problem(400, "invalid_request")
      : problem(500, "server_error", error);
  }
}

export const POST = withRequestLogging("/api/installations/current/sync/result", post);

import { digest } from "@/lib/crypto";
import { query, transaction } from "@/lib/db";
import { isUuid, problem } from "@/lib/http";
import { clientAddress, clientAdmissionLimit, consumeRateLimit } from "@/lib/rate-limit";
import { withRequestLogging } from "@/lib/request-log";

async function remove(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const authorization = request.headers.get("authorization");
  if (!isUuid(id) || !authorization?.startsWith("Bearer ")) return problem(401, "unauthorized");
  const token = authorization.slice(7);
  if (token.length < 32 || token.length > 128) return problem(401, "unauthorized");
  const address = clientAddress(request);
  if (
    !(await consumeRateLimit(
      "source_delete_pre_auth",
      address.key,
      clientAdmissionLimit(address, 60, 2_000, 15),
      60,
    ))
  ) {
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
    );
  }
  const installations = await query<{ id: string }>(
    "SELECT id::text FROM installations WHERE device_token_hash = $1 AND status = 'active' LIMIT 1",
    [digest(token)],
  );
  const installation = installations[0];
  if (!installation) return problem(401, "unauthorized");
  if (!(await consumeRateLimit("source_delete", installation.id, 20, 60))) {
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
    );
  }
  const changed = await transaction(async (client) => {
    const result = await client.query(
      `UPDATE installation_sources s
          SET status = 'disconnected', updated_at = now()
         FROM installations i
        WHERE s.id = $1 AND s.installation_id = $2 AND s.installation_id = i.id
          AND i.device_token_hash = $3 AND i.status = 'active' AND s.status = 'active'`,
      [id, installation.id, digest(token)],
    );
    return result.rowCount === 1;
  });
  return changed ? new Response(null, { status: 204 }) : problem(404, "source_not_found");
}

export const DELETE = withRequestLogging("/api/sources/[id]", remove);

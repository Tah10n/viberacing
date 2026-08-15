import { digest } from "@/lib/crypto";
import { transaction } from "@/lib/db";
import { isUuid, problem } from "@/lib/http";
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
  const changed = await transaction(async (client) => {
    const result = await client.query(
      `UPDATE installation_sources s
          SET status = 'disconnected', updated_at = now()
         FROM installations i
        WHERE s.id = $1 AND s.installation_id = i.id
          AND i.device_token_hash = $2 AND i.status = 'active' AND s.status = 'active'`,
      [id, digest(token)],
    );
    return result.rowCount === 1;
  });
  return changed ? new Response(null, { status: 204 }) : problem(404, "source_not_found");
}

export const DELETE = withRequestLogging("/api/sources/[id]", remove);

import { digest } from "@/lib/crypto";
import { query } from "@/lib/db";
import { isRecord, isUuid, problem, readBoundedJson } from "@/lib/http";

interface PollBody {
  connectionId?: unknown;
  pollToken?: unknown;
}
interface PollRow {
  status: string;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const rawBody = await readBoundedJson(request, 2_048);
    if (!isRecord(rawBody)) return problem(400, "invalid_request");
    const body = rawBody as PollBody;
    if (
      !isUuid(body.connectionId) ||
      typeof body.pollToken !== "string" ||
      body.pollToken.length < 32 ||
      body.pollToken.length > 128
    )
      return problem(400, "invalid_request");
    const rows = await query<PollRow>(
      `SELECT status FROM connections
        WHERE id = $1 AND poll_token_hash = $2 AND (status <> 'pending' OR expires_at > now()) LIMIT 1`,
      [body.connectionId, digest(body.pollToken)],
    );
    const row = rows[0];
    return row === undefined
      ? problem(404, "pairing_not_found")
      : Response.json({ status: row.status }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return error instanceof SyntaxError || error instanceof RangeError
      ? problem(400, "invalid_request")
      : problem(500, "server_error");
  }
}

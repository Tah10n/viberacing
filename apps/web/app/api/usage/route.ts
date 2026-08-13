import { isSupportedAgent, type SupportedAgent } from "@/lib/agents";
import { digest } from "@/lib/crypto";
import { query, transaction } from "@/lib/db";
import { isRecord, problem, readBoundedJson } from "@/lib/http";

interface Entry {
  agent?: unknown;
  date?: unknown;
  tokens?: unknown;
}
interface UsageBody {
  entries?: unknown;
}
interface ConnectionRow {
  id: string;
  user_id: string;
  agents: SupportedAgent[];
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const tokenPattern = /^(?:0|[1-9]\d{0,29})$/;

export async function POST(request: Request): Promise<Response> {
  const authorization = request.headers.get("authorization");
  if (authorization === null || !authorization.startsWith("Bearer "))
    return problem(401, "unauthorized");
  try {
    const token = authorization.slice(7);
    if (token.length < 32 || token.length > 128) return problem(401, "unauthorized");
    const connections = await query<ConnectionRow>(
      `SELECT id::text, user_id::text, agents FROM connections
        WHERE device_token_hash = $1 AND status = 'active' LIMIT 1`,
      [digest(token)],
    );
    const connection = connections[0];
    if (connection === undefined) return problem(401, "unauthorized");
    const rawBody = await readBoundedJson(request, 32_768);
    if (!isRecord(rawBody)) return problem(400, "invalid_request");
    const body = rawBody as UsageBody;
    if (!Array.isArray(body.entries) || body.entries.length === 0 || body.entries.length > 62)
      return problem(400, "invalid_entries");
    const seen = new Set<string>();
    const entries: { agent: SupportedAgent; date: string; tokens: string }[] = [];
    const today = new Date();
    const earliest = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 30),
    );
    for (const candidate of body.entries as Entry[]) {
      if (!isSupportedAgent(candidate.agent) || !connection.agents.includes(candidate.agent))
        return problem(400, "unsupported_agent");
      if (typeof candidate.date !== "string" || !datePattern.test(candidate.date))
        return problem(400, "invalid_date");
      if (typeof candidate.tokens !== "string" || !tokenPattern.test(candidate.tokens))
        return problem(400, "invalid_tokens");
      const parsedDate = new Date(`${candidate.date}T00:00:00.000Z`);
      if (
        Number.isNaN(parsedDate.valueOf()) ||
        parsedDate.toISOString().slice(0, 10) !== candidate.date ||
        parsedDate < earliest ||
        parsedDate > today
      )
        return problem(400, "date_out_of_range");
      const key = `${candidate.agent}:${candidate.date}`;
      if (seen.has(key)) return problem(400, "duplicate_entry");
      seen.add(key);
      entries.push({ agent: candidate.agent, date: candidate.date, tokens: candidate.tokens });
    }
    const active = await transaction(async (client) => {
      const locked = await client.query(
        "SELECT 1 FROM connections WHERE id = $1 AND status = 'active' FOR UPDATE",
        [connection.id],
      );
      if (locked.rowCount !== 1) return false;
      for (const entry of entries) {
        await client.query(
          `INSERT INTO daily_usage (connection_id, user_id, agent, usage_date, tokens)
           VALUES ($1, $2, $3, $4::date, $5::numeric)
           ON CONFLICT (connection_id, agent, usage_date) DO UPDATE
             SET tokens = GREATEST(daily_usage.tokens, EXCLUDED.tokens),
                 updated_at = now()`,
          [connection.id, connection.user_id, entry.agent, entry.date, entry.tokens],
        );
      }
      await client.query("UPDATE connections SET last_sync_at = now() WHERE id = $1", [
        connection.id,
      ]);
      return true;
    });
    if (!active) return problem(401, "unauthorized");
    return Response.json(
      { accepted: entries.length },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return error instanceof SyntaxError || error instanceof RangeError
      ? problem(400, "invalid_request")
      : problem(500, "server_error");
  }
}

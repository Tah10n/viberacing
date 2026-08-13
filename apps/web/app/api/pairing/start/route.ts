import { randomUUID } from "node:crypto";
import { publicOrigin } from "@/lib/config";
import { digest, pairingCode, randomToken } from "@/lib/crypto";
import { transaction } from "@/lib/db";
import { isSupportedAgent, type SupportedAgent } from "@/lib/agents";
import { isRecord, problem, readBoundedJson } from "@/lib/http";
import { allowPairingStart, clientAddress } from "@/lib/rate-limit";

interface StartBody {
  agents?: unknown;
  previousDeviceToken?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  if (!allowPairingStart(clientAddress(request))) {
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
    );
  }
  try {
    const rawBody = await readBoundedJson(request, 2_048);
    if (!isRecord(rawBody)) return problem(400, "invalid_request");
    const body = rawBody as StartBody;
    if (!Array.isArray(body.agents)) return problem(400, "agents_required");
    const agents = [...new Set(body.agents.filter(isSupportedAgent))] as SupportedAgent[];
    if (agents.length === 0 || agents.length !== body.agents.length)
      return problem(400, "unsupported_agent");
    if (
      body.previousDeviceToken !== undefined &&
      (typeof body.previousDeviceToken !== "string" ||
        body.previousDeviceToken.length < 32 ||
        body.previousDeviceToken.length > 128)
    )
      return problem(400, "invalid_previous_device");
    const id = randomUUID();
    const code = pairingCode();
    const pollToken = randomToken();
    const deviceToken = randomToken();
    const created = await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(1447641669)");
      await client.query(
        "DELETE FROM connections WHERE status = 'pending' AND expires_at <= now()",
      );
      const pending = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM connections WHERE status = 'pending'",
      );
      if ((pending.rows[0]?.count ?? 1_000) >= 1_000) return false;
      const previous =
        typeof body.previousDeviceToken === "string"
          ? await client.query<{ id: string }>(
              "SELECT id::text FROM connections WHERE device_token_hash = $1 LIMIT 1",
              [digest(body.previousDeviceToken)],
            )
          : null;
      await client.query(
        `INSERT INTO connections
           (id, replaces_connection_id, status, agents, code_hash, poll_token_hash, device_token_hash, expires_at)
         VALUES ($1, $2, 'pending', $3, $4, $5, $6, now() + interval '10 minutes')`,
        [
          id,
          previous?.rows[0]?.id ?? null,
          agents,
          digest(code),
          digest(pollToken),
          digest(deviceToken),
        ],
      );
      return true;
    });
    if (!created)
      return Response.json(
        { error: "pairing_busy" },
        { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
      );
    return Response.json(
      {
        connectionId: id,
        code,
        pollToken,
        deviceToken,
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

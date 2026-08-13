import { NextResponse } from "next/server";
import { publicOrigin } from "@/lib/config";
import { digest, normalizePairingCode } from "@/lib/crypto";
import { transaction } from "@/lib/db";
import { problem, readBoundedForm, sameOrigin } from "@/lib/http";
import { viewer } from "@/lib/session";

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const current = await viewer();
  if (current === null)
    return NextResponse.redirect(new URL("/api/auth/github/start", publicOrigin()), 303);
  let form: URLSearchParams;
  try {
    form = await readBoundedForm(request);
  } catch (error) {
    return error instanceof RangeError
      ? problem(413, "body_too_large")
      : problem(400, "invalid_request");
  }
  const codeValue = form.get("code");
  const code = normalizePairingCode(typeof codeValue === "string" ? codeValue : "");
  const activated = await transaction(async (client) => {
    await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [current.id]);
    const pending = await client.query<{ id: string; replaces_connection_id: string | null }>(
      `SELECT id::text, replaces_connection_id::text
         FROM connections
        WHERE code_hash = $1 AND status = 'pending' AND expires_at > now()
        FOR UPDATE`,
      [digest(code)],
    );
    const connection = pending.rows[0];
    if (connection === undefined) return false;
    let name: string | undefined;
    if (connection.replaces_connection_id !== null) {
      const replaced = await client.query<{ id: string; name: string | null }>(
        `SELECT id::text, name
           FROM connections
          WHERE id = $1 AND user_id = $2 AND status IN ('active', 'revoked')
          FOR UPDATE`,
        [connection.replaces_connection_id, current.id],
      );
      const previous = replaced.rows[0];
      if (previous !== undefined) {
        await client.query("UPDATE daily_usage SET connection_id = $1 WHERE connection_id = $2", [
          connection.id,
          previous.id,
        ]);
        await client.query("DELETE FROM connections WHERE id = $1", [previous.id]);
        name = previous.name ?? undefined;
      }
    }
    if (name === undefined) {
      const result = await client.query<{ position: number }>(
        "SELECT count(*)::int + 1 AS position FROM connections WHERE user_id = $1",
        [current.id],
      );
      name = `Computer ${String(result.rows[0]?.position ?? 1)}`;
    }
    await client.query(
      "UPDATE connections SET user_id = $1, name = $3, status = 'active' WHERE id = $2",
      [current.id, connection.id, name],
    );
    return true;
  });
  return NextResponse.redirect(
    new URL(
      activated ? "/dashboard?connected=1" : `/connect?code=${code}&error=expired`,
      publicOrigin(),
    ),
    303,
  );
}

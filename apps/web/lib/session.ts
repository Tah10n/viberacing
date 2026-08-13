import { cookies } from "next/headers";
import { secureCookies } from "./config";
import { digest, randomToken } from "./crypto";
import { query } from "./db";

const cookieName = "vr_session";
const sessionSeconds = 60 * 60 * 24 * 30;

export interface Viewer {
  readonly id: string;
  readonly handle: string;
}

interface ViewerRow {
  id: string;
  handle: string;
}

export async function viewer(): Promise<Viewer | null> {
  const token = (await cookies()).get(cookieName)?.value;
  if (token === undefined) return null;
  const rows = await query<ViewerRow>(
    `SELECT u.id::text, u.handle
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()
      LIMIT 1`,
    [digest(token)],
  );
  return rows[0] ?? null;
}

export async function createSession(userId: string): Promise<void> {
  const token = randomToken();
  await query(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '30 days')",
    [digest(token), userId],
  );
  (await cookies()).set(cookieName, token, {
    httpOnly: true,
    maxAge: sessionSeconds,
    path: "/",
    sameSite: "lax",
    secure: secureCookies(),
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(cookieName)?.value;
  if (token !== undefined)
    await query("DELETE FROM sessions WHERE token_hash = $1", [digest(token)]);
  store.delete(cookieName);
}

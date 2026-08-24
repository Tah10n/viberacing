import { cookies } from "next/headers";
import { secureCookies } from "./config";
import { digest, randomToken } from "./crypto";
import { query, transaction } from "./db";

const cookieName = "vr_session";
const localInstallationCookieName = "vr_local_installation";
const accountDeletionReceiptCookieName = "vr_account_deleted";
const sessionSeconds = 60 * 60 * 24 * 30;
const localInstallationSeconds = 60 * 60 * 24 * 365;
const accountDeletionReceiptSeconds = 60 * 5;
const maximumActiveSessionsPerUser = 10;

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
  const store = await cookies();
  const previous = store.get(cookieName)?.value;
  await transaction(async (client) => {
    await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
    await client.query(
      `DELETE FROM sessions WHERE token_hash IN (
         SELECT token_hash FROM sessions WHERE expires_at <= now() LIMIT 100
       )`,
    );
    await client.query(
      `DELETE FROM installations WHERE id IN (
         SELECT i.id FROM installations i
          WHERE i.status = 'revoked' AND i.revoked_at < now() - interval '90 days'
            AND NOT EXISTS (
              SELECT 1 FROM installation_sources s
              JOIN daily_usage d ON d.source_id = s.id
              WHERE s.installation_id = i.id
            )
          LIMIT 25
       )`,
    );
    await client.query(
      `DELETE FROM agent_accounts WHERE id IN (
         SELECT a.id FROM agent_accounts a
          WHERE a.created_at < now() - interval '1 day'
            AND NOT EXISTS (SELECT 1 FROM installation_sources s WHERE s.agent_account_id = a.id)
            AND (
              a.merged_into_account_id IS NULL
              OR NOT EXISTS (
                SELECT 1 FROM account_dedup_events event
                 WHERE event.previous_account_id = a.id AND event.status = 'active'
              )
            )
          LIMIT 25
       )`,
    );
    if (previous !== undefined) {
      await client.query("DELETE FROM sessions WHERE token_hash = $1", [digest(previous)]);
    }
    await client.query(
      `DELETE FROM sessions WHERE token_hash IN (
         SELECT token_hash FROM sessions
          WHERE user_id = $1
          ORDER BY created_at DESC, token_hash
          OFFSET $2
       )`,
      [userId, maximumActiveSessionsPerUser - 1],
    );
    await client.query(
      "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '30 days')",
      [digest(token), userId],
    );
  });
  store.set(cookieName, token, {
    httpOnly: true,
    maxAge: sessionSeconds,
    path: "/",
    sameSite: "lax",
    secure: secureCookies(),
  });
  store.delete(accountDeletionReceiptCookieName);
}

export async function hasAccountDeletionReceipt(): Promise<boolean> {
  return (await cookies()).get(accountDeletionReceiptCookieName)?.value === "1";
}

export async function issueAccountDeletionReceipt(): Promise<void> {
  (await cookies()).set(accountDeletionReceiptCookieName, "1", {
    httpOnly: true,
    maxAge: accountDeletionReceiptSeconds,
    path: "/",
    sameSite: "lax",
    secure: secureCookies(),
  });
}

export async function localInstallationId(): Promise<string | null> {
  const value = (await cookies()).get(localInstallationCookieName)?.value;
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

export async function bindLocalInstallation(installationId: string): Promise<void> {
  (await cookies()).set(localInstallationCookieName, installationId, {
    httpOnly: true,
    maxAge: localInstallationSeconds,
    path: "/",
    sameSite: "lax",
    secure: secureCookies(),
  });
}

export async function clearLocalInstallation(): Promise<void> {
  (await cookies()).delete(localInstallationCookieName);
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(cookieName)?.value;
  if (token !== undefined)
    await query("DELETE FROM sessions WHERE token_hash = $1", [digest(token)]);
  store.delete(cookieName);
}

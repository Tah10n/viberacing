import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { publicOrigin, requiredEnv } from "@/lib/config";
import { randomToken } from "@/lib/crypto";
import { transaction } from "@/lib/db";
import { createSession } from "@/lib/session";

interface UserRow {
  id: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function authFailed(): Response {
  return NextResponse.redirect(new URL("/?auth=failed", publicOrigin()));
}

async function githubRequest(
  url: string,
  init: RequestInit,
): Promise<{ ok: boolean; body: unknown }> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  return { ok: response.ok, body: (await response.json()) as unknown };
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("vr_oauth_state")?.value;
  const next = cookieStore.get("vr_oauth_next")?.value ?? "/dashboard";
  cookieStore.delete("vr_oauth_state");
  cookieStore.delete("vr_oauth_next");
  if (code === null || state === null || expectedState === undefined || state !== expectedState) {
    return authFailed();
  }

  let tokenResult: { ok: boolean; body: unknown };
  try {
    tokenResult = await githubRequest("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: requiredEnv("GITHUB_CLIENT_ID"),
        client_secret: requiredEnv("GITHUB_CLIENT_SECRET"),
        code,
        redirect_uri: new URL("/api/auth/github/callback", publicOrigin()).href,
      }),
    });
  } catch {
    return authFailed();
  }
  const token = tokenResult.body;
  if (!tokenResult.ok || !isRecord(token) || typeof token.access_token !== "string") {
    return authFailed();
  }

  let profileResult: { ok: boolean; body: unknown };
  try {
    profileResult = await githubRequest("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token.access_token}`,
        "User-Agent": "viberacing-web",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch {
    return authFailed();
  }
  const profile = profileResult.body;
  if (
    !profileResult.ok ||
    !isRecord(profile) ||
    typeof profile.id !== "number" ||
    !Number.isSafeInteger(profile.id) ||
    typeof profile.login !== "string" ||
    !/^[A-Za-z0-9-]{1,39}$/.test(profile.login)
  ) {
    return authFailed();
  }
  const displacedHandle = `stale-${randomToken(12).replaceAll(/[_-]/g, "x")}`;
  const user = await transaction(async (client) => {
    await client.query(
      "UPDATE users SET handle = $3 WHERE lower(handle) = lower($2) AND github_id <> $1",
      [profile.id, profile.login, displacedHandle],
    );
    const result = await client.query<UserRow>(
      `INSERT INTO users (github_id, handle) VALUES ($1, $2)
       ON CONFLICT (github_id) DO UPDATE SET handle = EXCLUDED.handle
       RETURNING id::text`,
      [profile.id, profile.login],
    );
    return result.rows[0];
  });
  if (user === undefined) throw new Error("GitHub identity upsert returned no user");
  await createSession(user.id);
  return NextResponse.redirect(new URL(next, publicOrigin()));
}

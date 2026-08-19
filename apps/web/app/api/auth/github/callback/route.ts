import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { githubApiOrigin, githubWebOrigin, publicOrigin, requiredEnv } from "@/lib/config";
import { randomToken, secretEqual } from "@/lib/crypto";
import { transaction } from "@/lib/db";
import { markResponse } from "@/lib/http";
import { clientAddress, clientAdmissionLimit, consumeRateLimit } from "@/lib/rate-limit";
import { withRequestLogging } from "@/lib/request-log";
import { createSession } from "@/lib/session";
import { safeReturnPath } from "../return-path";

interface UserRow {
  id: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function authFailed(stage: string, cause?: unknown): Response {
  return markResponse(
    NextResponse.redirect(new URL("/?auth=failed", publicOrigin())),
    `github_oauth_${stage}`,
    cause,
    stage === "state_validation_failed" ? "debug" : undefined,
  );
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

async function get(request: Request): Promise<Response> {
  const address = clientAddress(request);
  if (
    !(await consumeRateLimit(
      "oauth_callback",
      address.key,
      clientAdmissionLimit(address, 20, 2_000, 5),
      60,
    ))
  ) {
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
    );
  }
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("vr_oauth_state")?.value;
  const next = safeReturnPath(cookieStore.get("vr_oauth_next")?.value ?? null, publicOrigin());
  cookieStore.delete("vr_oauth_state");
  cookieStore.delete("vr_oauth_next");
  if (
    code === null ||
    state === null ||
    expectedState === undefined ||
    !secretEqual(state, expectedState)
  ) {
    return authFailed("state_validation_failed");
  }
  let tokenResult: { ok: boolean; body: unknown };
  try {
    tokenResult = await githubRequest(
      new URL("/login/oauth/access_token", githubWebOrigin()).href,
      {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: requiredEnv("GITHUB_CLIENT_ID"),
          client_secret: requiredEnv("GITHUB_CLIENT_SECRET"),
          code,
          redirect_uri: new URL("/api/auth/github/callback", publicOrigin()).href,
        }),
      },
    );
  } catch (error) {
    return authFailed("token_request_failed", error);
  }
  const token = tokenResult.body;
  if (
    !tokenResult.ok ||
    !isRecord(token) ||
    typeof token.access_token !== "string" ||
    token.access_token.length === 0
  ) {
    return authFailed("token_response_invalid");
  }
  if (!(await consumeRateLimit("oauth_callback_global", "all", 500, 60))) {
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
    );
  }

  let profileResult: { ok: boolean; body: unknown };
  try {
    profileResult = await githubRequest(new URL("/user", githubApiOrigin()).href, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token.access_token}`,
        "User-Agent": "viberacing-web",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch (error) {
    return authFailed("profile_request_failed", error);
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
    return authFailed("profile_response_invalid");
  }
  const displacedHandle = `stale-${randomToken(12).replaceAll(/[_-]/g, "x")}`;
  const user = await transaction(async (client) => {
    await client.query(
      "UPDATE users SET handle = $3 WHERE lower(handle) = lower($2) AND github_id <> $1",
      [profile.id, profile.login, displacedHandle],
    );
    const result = await client.query<UserRow>(
      `INSERT INTO users (github_id, handle) VALUES ($1, $2)
       ON CONFLICT (github_id) DO UPDATE SET handle = EXCLUDED.handle, updated_at = now()
       RETURNING id::text`,
      [profile.id, profile.login],
    );
    return result.rows[0];
  });
  if (user === undefined) throw new Error("GitHub identity upsert returned no user");
  await createSession(user.id);
  return NextResponse.redirect(new URL(next, publicOrigin()));
}

export const GET = withRequestLogging("/api/auth/github/callback", get);

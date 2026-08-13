import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { publicOrigin, requiredEnv, secureCookies } from "@/lib/config";
import { randomToken } from "@/lib/crypto";
import { clientAddress, consumeRateLimit } from "@/lib/rate-limit";

function safeNext(value: string | null): string {
  if (value === null || value.length > 500 || !value.startsWith("/")) return "/dashboard";
  const base = publicOrigin();
  const target = new URL(value, base);
  return target.origin === base.origin
    ? `${target.pathname}${target.search}${target.hash}`
    : "/dashboard";
}

export async function GET(request: Request): Promise<Response> {
  if (!(await consumeRateLimit("oauth_start", clientAddress(request), 20, 60))) {
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
    );
  }
  const state = randomToken();
  const next = safeNext(new URL(request.url).searchParams.get("next"));
  const cookieStore = await cookies();
  const secure = secureCookies();
  cookieStore.set("vr_oauth_state", state, {
    httpOnly: true,
    maxAge: 600,
    path: "/",
    sameSite: "lax",
    secure,
  });
  cookieStore.set("vr_oauth_next", next, {
    httpOnly: true,
    maxAge: 600,
    path: "/",
    sameSite: "lax",
    secure,
  });

  const callback = new URL("/api/auth/github/callback", publicOrigin());
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", requiredEnv("GITHUB_CLIENT_ID"));
  authorize.searchParams.set("redirect_uri", callback.href);
  authorize.searchParams.set("scope", "read:user");
  authorize.searchParams.set("state", state);
  return NextResponse.redirect(authorize);
}

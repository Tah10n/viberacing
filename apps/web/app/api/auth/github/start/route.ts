import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { githubWebOrigin, publicOrigin, requiredEnv, secureCookies } from "@/lib/config";
import { randomToken } from "@/lib/crypto";
import { clientAddress, consumeRateLimit } from "@/lib/rate-limit";
import { withRequestLogging } from "@/lib/request-log";
import { safeReturnPath } from "../return-path";

async function get(request: Request): Promise<Response> {
  if (!(await consumeRateLimit("oauth_start_global", "all", 500, 60))) {
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
    );
  }
  const address = clientAddress(request);
  const addressLimit = address === "untrusted-forwarding-headers" ? 500 : 20;
  if (!(await consumeRateLimit("oauth_start", address, addressLimit, 60))) {
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
    );
  }
  const state = randomToken();
  const next = safeReturnPath(new URL(request.url).searchParams.get("next"), publicOrigin());
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
  const authorize = new URL("/login/oauth/authorize", githubWebOrigin());
  authorize.searchParams.set("client_id", requiredEnv("GITHUB_CLIENT_ID"));
  authorize.searchParams.set("redirect_uri", callback.href);
  authorize.searchParams.set("scope", "read:user");
  authorize.searchParams.set("state", state);
  return NextResponse.redirect(authorize);
}

export const GET = withRequestLogging("/api/auth/github/start", get);

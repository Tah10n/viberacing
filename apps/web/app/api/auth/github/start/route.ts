import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { githubWebOrigin, publicOrigin, requiredEnv, secureCookies } from "@/lib/config";
import { randomToken } from "@/lib/crypto";
import { clientAddress, clientAdmissionLimit, consumeRateLimit } from "@/lib/rate-limit";
import { withRequestLogging } from "@/lib/request-log";
import { safeReturnPath } from "../return-path";

async function get(request: Request): Promise<Response> {
  const address = clientAddress(request);
  if (
    !(await consumeRateLimit(
      "oauth_start",
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

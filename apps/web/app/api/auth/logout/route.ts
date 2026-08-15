import { NextResponse } from "next/server";
import { publicOrigin } from "@/lib/config";
import { sameOrigin } from "@/lib/http";
import { withRequestLogging } from "@/lib/request-log";
import { destroySession } from "@/lib/session";

async function post(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  await destroySession();
  return NextResponse.redirect(publicOrigin(), 303);
}

export const POST = withRequestLogging("/api/auth/logout", post);

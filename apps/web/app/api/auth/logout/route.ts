import { NextResponse } from "next/server";
import { publicOrigin } from "@/lib/config";
import { sameOrigin } from "@/lib/http";
import { destroySession } from "@/lib/session";

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  await destroySession();
  return NextResponse.redirect(publicOrigin(), 303);
}

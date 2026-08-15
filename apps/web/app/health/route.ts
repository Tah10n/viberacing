import { withRequestLogging } from "@/lib/request-log";

function get(): Response {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = withRequestLogging("/health", get, { successLevel: "debug" });

import { batchPairingBrowserHttp } from "@/lib/batch-pairing-browser-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return batchPairingBrowserHttp.verify(request);
}

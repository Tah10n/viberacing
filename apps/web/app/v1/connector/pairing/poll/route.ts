import { createPairingHttp } from "@/lib/pairing-http";
import { resolvePairingConfig } from "@/lib/pairing-config";
import { getPairingTransportService } from "@/lib/pairing-transport-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const pairingConfig = resolvePairingConfig();
const http = createPairingHttp({
  enabled: pairingConfig.enabled,
  getService: getPairingTransportService,
});

export function DELETE(request: Request): Response {
  return http.methodNotAllowed(request);
}

export function GET(request: Request): Response {
  return http.methodNotAllowed(request);
}

export function HEAD(request: Request): Response {
  return http.methodNotAllowed(request);
}

export function OPTIONS(request: Request): Response {
  return http.methodNotAllowed(request);
}

export function PATCH(request: Request): Response {
  return http.methodNotAllowed(request);
}

export function POST(request: Request): Promise<Response> {
  return http.poll(request);
}

export function PUT(request: Request): Response {
  return http.methodNotAllowed(request);
}

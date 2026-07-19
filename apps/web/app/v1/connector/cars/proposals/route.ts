import { resolveCarProposalsConfig } from "@/lib/car-proposals-config";
import { createConnectorCarProposalHttp } from "@/lib/connector-car-proposal-http";
import { getConnectorCarProposalService } from "@/lib/connector-car-proposal-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const carProposalsConfig = resolveCarProposalsConfig();
const http = createConnectorCarProposalHttp({
  carProposalsEnabled: carProposalsConfig.enabled,
  getService: getConnectorCarProposalService,
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
  return http.post(request);
}

export function PUT(request: Request): Response {
  return http.methodNotAllowed(request);
}

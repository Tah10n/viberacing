import {
  createConfiguredPublicCommunityRaceStatusStore,
  type ConfiguredPublicCommunityRaceStatusStore,
} from "@/lib/public-community-score-store";
import {
  createPublicCommunityRaceStatusRoute,
  publicCommunityRaceStatusRoutePolicy,
} from "@/lib/public-community-score-route";
import { createPublicRequestId } from "@/lib/public-http-problem";
import { createPublicScoreAdmission } from "@/lib/public-score-admission";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let configuredStore: ConfiguredPublicCommunityRaceStatusStore | undefined;

function readRaceStatus(seasonStart: string): Promise<unknown> {
  configuredStore ??= createConfiguredPublicCommunityRaceStatusStore();
  return configuredStore.read(seasonStart);
}

const route = createPublicCommunityRaceStatusRoute({
  admission: createPublicScoreAdmission(publicCommunityRaceStatusRoutePolicy.admissionLimit),
  createRequestId: createPublicRequestId,
  readRaceStatus,
});

export function DELETE(): Response {
  return route.methodNotAllowed();
}

export async function GET(request: Request): Promise<Response> {
  return route.get(request);
}

export function HEAD(): Response {
  return route.methodNotAllowed();
}

export function OPTIONS(): Response {
  return route.methodNotAllowed();
}

export function PATCH(): Response {
  return route.methodNotAllowed();
}

export function POST(): Response {
  return route.methodNotAllowed();
}

export function PUT(): Response {
  return route.methodNotAllowed();
}

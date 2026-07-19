import {
  createConfiguredPublicCommunityRaceStore,
  type ConfiguredPublicCommunityRaceStore,
} from "@/lib/public-community-score-store";
import {
  createPublicCommunityRaceRoute,
  publicCommunityRaceRoutePolicy,
} from "@/lib/public-community-score-route";
import { createPublicRequestId } from "@/lib/public-http-problem";
import { resolvePublicRankingConfig } from "@/lib/public-ranking-config";
import { createPublicScoreAdmission } from "@/lib/public-score-admission";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let configuredStore: ConfiguredPublicCommunityRaceStore | undefined;
const publicRankingConfig = resolvePublicRankingConfig();

function readRace(seasonStart: string): Promise<unknown> {
  configuredStore ??= createConfiguredPublicCommunityRaceStore();
  return configuredStore.read(seasonStart);
}

const route = createPublicCommunityRaceRoute({
  admission: createPublicScoreAdmission(publicCommunityRaceRoutePolicy.admissionLimit),
  createRequestId: createPublicRequestId,
  enabled: publicRankingConfig.enabled,
  readRace,
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

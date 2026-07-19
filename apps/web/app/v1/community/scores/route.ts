import {
  createConfiguredPublicCommunityScoreStore,
  type ConfiguredPublicCommunityScoreStore,
} from "@/lib/public-community-score-store";
import {
  createPublicCommunityScoreRoute,
  publicCommunityScoreRoutePolicy,
} from "@/lib/public-community-score-route";
import { createPublicRequestId } from "@/lib/public-http-problem";
import { resolvePublicRankingConfig } from "@/lib/public-ranking-config";
import { createPublicScoreAdmission } from "@/lib/public-score-admission";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let configuredStore: ConfiguredPublicCommunityScoreStore | undefined;
const publicRankingConfig = resolvePublicRankingConfig();

function readScores(seasonStart: string): Promise<unknown> {
  configuredStore ??= createConfiguredPublicCommunityScoreStore();
  return configuredStore.read(seasonStart);
}

const route = createPublicCommunityScoreRoute({
  admission: createPublicScoreAdmission(publicCommunityScoreRoutePolicy.admissionLimit),
  createRequestId: createPublicRequestId,
  enabled: publicRankingConfig.enabled,
  readScores,
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

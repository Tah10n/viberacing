import {
  createConfiguredPublicCommunityTokenRaceStatusStore,
  type ConfiguredPublicCommunityTokenRaceStatusStore,
} from "@/lib/public-community-score-store";
import {
  createPublicCommunityTokenRoute,
  publicCommunityTokenRoutePolicy,
} from "@/lib/public-community-score-route";
import { createPublicRequestId } from "@/lib/public-http-problem";
import { createPublicScoreAdmission } from "@/lib/public-score-admission";
import { resolvePublicTokenRankingConfig } from "@/lib/public-token-ranking-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let configuredStore: ConfiguredPublicCommunityTokenRaceStatusStore | undefined;
const tokenRankingConfig = resolvePublicTokenRankingConfig();

function readTokens(seasonStart: string): Promise<unknown> {
  configuredStore ??= createConfiguredPublicCommunityTokenRaceStatusStore();
  return configuredStore.read(seasonStart);
}

const route = createPublicCommunityTokenRoute({
  admission: createPublicScoreAdmission(publicCommunityTokenRoutePolicy.admissionLimit),
  createRequestId: createPublicRequestId,
  enabled: tokenRankingConfig.enabled,
  readTokens,
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

import { createPublicRequestId } from "@/lib/public-http-problem";
import { resolvePublicSnapshotConfig } from "@/lib/public-snapshot-config";
import { createCurrentLeaderboardRoute } from "@/lib/public-snapshot-route";
import {
  publicSnapshotAdmission,
  readCurrentLeaderboardSnapshot,
} from "@/lib/public-snapshot-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const publicSnapshotConfig = resolvePublicSnapshotConfig();
const route = createCurrentLeaderboardRoute({
  admission: publicSnapshotAdmission,
  createRequestId: createPublicRequestId,
  enabled: publicSnapshotConfig.enabled,
  readCurrentLeaderboard: readCurrentLeaderboardSnapshot,
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

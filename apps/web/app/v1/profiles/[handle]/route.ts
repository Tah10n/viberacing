import { createPublicRequestId } from "@/lib/public-http-problem";
import { resolvePublicSnapshotConfig } from "@/lib/public-snapshot-config";
import { createPublicProfileRoute } from "@/lib/public-snapshot-route";
import {
  publicSnapshotAdmission,
  readCurrentPublicProfileSnapshot,
} from "@/lib/public-snapshot-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  readonly params: Promise<{ readonly handle: string }>;
}

const publicSnapshotConfig = resolvePublicSnapshotConfig();
const route = createPublicProfileRoute({
  admission: publicSnapshotAdmission,
  createRequestId: createPublicRequestId,
  enabled: publicSnapshotConfig.enabled,
  readCurrentProfile: readCurrentPublicProfileSnapshot,
});

export function DELETE(): Response {
  return route.methodNotAllowed();
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return route.get(request, context.params);
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

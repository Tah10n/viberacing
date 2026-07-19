import { createEnrollmentAdmission } from "@/lib/enrollment-admission";
import { createEnrollmentHttp } from "@/lib/enrollment-http";
import { getEnrollmentRuntime } from "@/lib/enrollment-runtime";
import { resolvePairingConfig } from "@/lib/pairing-config";
import { resolveSourceCreationConfig } from "@/lib/source-creation-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const pairingConfig = resolvePairingConfig();
const sourceCreationConfig = resolveSourceCreationConfig();
const http = createEnrollmentHttp({
  admission: createEnrollmentAdmission(),
  getRuntime: getEnrollmentRuntime,
  pairingEnabled: pairingConfig.enabled,
  sourceCreationEnabled: sourceCreationConfig.enabled,
});

export function POST(request: Request): Promise<Response> {
  return http.pairingApprovalVerify(request);
}

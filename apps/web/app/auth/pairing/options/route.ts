import { createEnrollmentAdmission } from "@/lib/enrollment-admission";
import { createEnrollmentHttp } from "@/lib/enrollment-http";
import { getEnrollmentRuntime } from "@/lib/enrollment-runtime";
import { resolvePairingConfig } from "@/lib/pairing-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const pairingConfig = resolvePairingConfig();
const http = createEnrollmentHttp({
  admission: createEnrollmentAdmission(),
  getRuntime: getEnrollmentRuntime,
  pairingEnabled: pairingConfig.enabled,
});

export function POST(request: Request): Promise<Response> {
  return http.pairingApprovalOptions(request);
}

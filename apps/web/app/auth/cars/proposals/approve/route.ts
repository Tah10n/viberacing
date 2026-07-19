import { createEnrollmentAdmission } from "@/lib/enrollment-admission";
import { resolveCarProposalsConfig } from "@/lib/car-proposals-config";
import { createEnrollmentHttp } from "@/lib/enrollment-http";
import { getEnrollmentRuntime } from "@/lib/enrollment-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const carProposalsConfig = resolveCarProposalsConfig();
const http = createEnrollmentHttp({
  admission: createEnrollmentAdmission(),
  carProposalsEnabled: carProposalsConfig.enabled,
  getRuntime: getEnrollmentRuntime,
});

export function POST(request: Request): Promise<Response> {
  return http.carRecipeApprove(request);
}

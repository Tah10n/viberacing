import { createEnrollmentAdmission } from "@/lib/enrollment-admission";
import { resolveEnrollmentEnableConfig } from "@/lib/enrollment-enable-config";
import { createEnrollmentHttp } from "@/lib/enrollment-http";
import { getEnrollmentRuntime } from "@/lib/enrollment-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const enrollmentConfig = resolveEnrollmentEnableConfig();
const http = createEnrollmentHttp({
  admission: createEnrollmentAdmission(),
  enrollmentEnabled: enrollmentConfig.enabled,
  getRuntime: getEnrollmentRuntime,
});

export function GET(request: Request): Promise<Response> {
  return http.callback(request);
}

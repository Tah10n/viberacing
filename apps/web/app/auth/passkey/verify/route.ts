import { createEnrollmentAdmission } from "@/lib/enrollment-admission";
import { createEnrollmentHttp } from "@/lib/enrollment-http";
import { getEnrollmentRuntime } from "@/lib/enrollment-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const http = createEnrollmentHttp({
  admission: createEnrollmentAdmission(),
  getRuntime: getEnrollmentRuntime,
});

export function POST(request: Request): Promise<Response> {
  return http.passkeyVerify(request);
}

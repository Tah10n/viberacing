import { NextResponse, type NextRequest } from "next/server";
import { logError, safeErrorFields } from "@/lib/log";
import { allowRequestLog } from "@/lib/metrics";
import { isResourceOverloaded } from "@/lib/overload";
import { contentSecurityPolicy } from "@/lib/csp";
import { clientAddress, clientAdmissionLimit, consumeAdmissionRateLimit } from "@/lib/rate-limit";

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const nonce = crypto.randomUUID();
  const policy = contentSecurityPolicy(nonce, process.env.NODE_ENV === "development");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", policy);
  requestHeaders.set("x-nonce", nonce);

  const pathname = request.nextUrl.pathname;
  if (
    pathname === "/" ||
    pathname.startsWith("/u/") ||
    pathname === "/sitemap.xml" ||
    pathname === "/og"
  ) {
    try {
      const address = clientAddress(request);
      const result = await consumeAdmissionRateLimit(
        "public_read",
        address.key,
        clientAdmissionLimit(address, 120, 10000, 20),
        2000,
        60,
      );
      if (!result.allowed) {
        return new NextResponse("Too many requests", {
          status: 429,
          headers: {
            "Retry-After": "60",
            "Cache-Control": "private, no-store",
            "Content-Security-Policy": policy,
          },
        });
      }
    } catch (error) {
      const requestId = crypto.randomUUID();
      try {
        if (allowRequestLog("error")) {
          const cause = isResourceOverloaded(error) && error instanceof Error ? error.cause : error;
          logError("public_admission_failed", {
            requestId,
            status: 503,
            ...safeErrorFields(cause ?? error),
          });
        }
      } catch {
        // Diagnostics must not prevent the bounded unavailable response.
      }
      return new NextResponse("Temporarily unavailable", {
        status: 503,
        headers: {
          "Retry-After": "1",
          "X-Request-Id": requestId,
          "Cache-Control": "private, no-store",
          "Content-Security-Policy": policy,
        },
      });
    }
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      source:
        "/((?!api(?:/|$)|_next/static(?:/|$)|_next/image(?:/|$)|favicon\\.(?:ico|svg)(?:/|$)|health(?:/|$)|ready(?:/|$)).*)",
    },
  ],
};

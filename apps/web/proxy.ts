import { NextResponse, type NextRequest } from "next/server";
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
    } catch {
      return new NextResponse("Temporarily unavailable", {
        status: 503,
        headers: {
          "Retry-After": "1",
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

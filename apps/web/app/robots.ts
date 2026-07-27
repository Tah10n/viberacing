import type { MetadataRoute } from "next";
import { resolvePublicOrigin } from "@/lib/public-origin";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const publicOrigin = resolvePublicOrigin();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/auth/", "/admin/", "/v1/"] }],
    sitemap: new URL("/sitemap.xml", publicOrigin).href,
  };
}

import type { MetadataRoute } from "next";
import { publicOrigin } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    // Allow crawling private routes so crawlers can read their noindex directives.
    rules: { userAgent: "*", allow: "/" },
    sitemap: new URL("/sitemap.xml", publicOrigin()).href,
  };
}

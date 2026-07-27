import type { MetadataRoute } from "next";
import { resolvePublicOrigin } from "@/lib/public-origin";

export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      changeFrequency: "weekly",
      priority: 1,
      url: resolvePublicOrigin().href,
    },
  ];
}

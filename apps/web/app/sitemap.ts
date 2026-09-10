import type { MetadataRoute } from "next";
import { publicOrigin } from "@/lib/config";
import { publicProfileHandles } from "@/lib/leaderboard";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = publicOrigin();
  const handles = await publicProfileHandles();
  return [
    { url: new URL("/", origin).href },
    ...handles.map((handle) => ({ url: new URL(`/u/${encodeURIComponent(handle)}`, origin).href })),
  ];
}

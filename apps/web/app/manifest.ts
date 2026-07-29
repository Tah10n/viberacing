import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: "#130b2e",
    description:
      "A privacy-first Community vibecode rating and self-reported weekly leaderboard of provider-reported coding-agent tokens.",
    display: "standalone",
    name: "Vibe Racing",
    short_name: "Vibe Racing",
    start_url: "/",
    theme_color: "#130b2e",
  };
}

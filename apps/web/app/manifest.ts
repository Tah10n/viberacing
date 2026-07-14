import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: "#130b2e",
    description: "Privacy-first community coding races in deterministic pixel art.",
    display: "standalone",
    name: "Vibe Racing",
    short_name: "Vibe Racing",
    start_url: "/",
    theme_color: "#130b2e",
  };
}

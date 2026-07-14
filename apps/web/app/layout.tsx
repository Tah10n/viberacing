import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { resolvePublicOrigin } from "@/lib/public-origin";

import "./globals.css";

export const metadata: Metadata = {
  applicationName: "Vibe Racing",
  description:
    "A privacy-first community leaderboard that turns weekly coding activity into a pixel-art race.",
  keywords: ["vibe coding", "community leaderboard", "pixel art", "coding activity"],
  metadataBase: resolvePublicOrigin(),
  robots: { follow: true, index: true },
  title: {
    default: "Vibe Racing — community coding race",
    template: "%s · Vibe Racing",
  },
};

export const viewport: Viewport = {
  colorScheme: "dark light",
  themeColor: [
    { color: "#130b2e", media: "(prefers-color-scheme: dark)" },
    { color: "#f5edda", media: "(prefers-color-scheme: light)" },
  ],
  width: "device-width",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

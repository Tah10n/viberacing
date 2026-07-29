import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { resolvePublicOrigin } from "@/lib/public-origin";

import "./globals.css";

const siteDescription =
  "Vibe Racing is a privacy-first Community vibecode rating: a self-reported weekly leaderboard of provider-reported tokens across supported coding agents.";
const siteTitle = "Vibe Racing — Vibecode rating and token leaderboard";

export const metadata: Metadata = {
  applicationName: "Vibe Racing",
  description: siteDescription,
  keywords: [
    "vibecode rating",
    "vibe code rating",
    "vibe coding rating",
    "coding token leaderboard",
    "coding agents token leaderboard",
    "community leaderboard",
    "pixel art",
  ],
  metadataBase: resolvePublicOrigin(),
  openGraph: {
    alternateLocale: ["ru_RU"],
    description: siteDescription,
    locale: "en_US",
    siteName: "Vibe Racing",
    title: siteTitle,
    type: "website",
  },
  robots: { follow: true, index: true },
  title: {
    default: siteTitle,
    template: "%s · Vibe Racing",
  },
  twitter: {
    card: "summary_large_image",
    description: siteDescription,
    title: siteTitle,
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

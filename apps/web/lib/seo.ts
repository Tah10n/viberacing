import type { Metadata } from "next";
import { publicOrigin } from "./config";
import { usagePeriodSearch, type UsagePeriod } from "./usage-period";

export const siteTitle = "Vibe Racing — AI coding token leaderboard";
export const siteDescription =
  "Compare AI coding token usage across Codex, Claude Code, Cursor and more. Join the community leaderboard with daily totals and private prompts, code and credentials.";

export function publicPageMetadata(title: string, description: string, path?: string): Metadata {
  const origin = publicOrigin();
  const url = path === undefined ? undefined : new URL(path, origin).href;
  const image = {
    url: new URL("/og", origin).href,
    width: 1200,
    height: 630,
    alt: "Vibe Racing — AI coding token leaderboard",
  };
  return {
    metadataBase: origin,
    title,
    description,
    ...(url === undefined ? {} : { alternates: { canonical: url } }),
    openGraph: {
      type: "website",
      siteName: "Vibe Racing",
      locale: "en_US",
      title,
      description,
      ...(url === undefined ? {} : { url }),
      images: [image],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export function standingsCanonical(path: string, period: UsagePeriod, page = 1): string {
  const params = new URLSearchParams(period.kind === "week" ? "" : usagePeriodSearch(period));
  // Different pages contain different racers; never canonicalize them all to page one.
  if (page > 1) params.set("page", page.toString());
  const search = params.toString();
  return search === "" ? path : `${path}?${search}`;
}

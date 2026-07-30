import { afterEach, describe, expect, it, vi } from "vitest";

import { translations } from "@/lib/i18n";

import { metadata } from "./layout";
import manifest from "./manifest";
import robots, { dynamic as robotsDynamic } from "./robots";
import sitemap, { dynamic as sitemapDynamic } from "./sitemap";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("public search discovery", () => {
  it("describes the public site with the exact user-facing search phrase", () => {
    expect(metadata.description).toContain("vibecode rating");
    expect(metadata.keywords).toEqual(
      expect.arrayContaining([
        "vibecode rating",
        "vibe coding rating",
        "coding agents token leaderboard",
      ]),
    );
    expect(metadata.keywords).not.toContain("Codex token leaderboard");
    expect(metadata.title).toBeTypeOf("object");
    if (
      typeof metadata.title !== "object" ||
      metadata.title === null ||
      !("default" in metadata.title) ||
      !("template" in metadata.title)
    ) {
      throw new TypeError("Expected templated site metadata");
    }
    expect(metadata.title.default).toContain("Vibecode rating");
    expect(metadata.title.template).toBe("%s · Vibe Racing");
    expect(metadata.openGraph?.description).toContain("vibecode rating");
    expect(metadata.openGraph?.siteName).toBe("Vibe Racing");
    if (
      metadata.openGraph === null ||
      metadata.openGraph === undefined ||
      !("type" in metadata.openGraph)
    ) {
      throw new TypeError("Expected website Open Graph metadata");
    }
    expect(metadata.openGraph.type).toBe("website");
    if (
      metadata.twitter === null ||
      metadata.twitter === undefined ||
      !("card" in metadata.twitter)
    ) {
      throw new TypeError("Expected card-based Twitter metadata");
    }
    expect(metadata.twitter.card).toBe("summary_large_image");
    expect(metadata.twitter.description).toContain("vibecode rating");
    expect(manifest().description).toContain("vibecode rating");
    expect(translations.en.heroTitle).toBe(
      "All your coding agents. Every account. One GitHub profile.",
    );
    expect(translations.ru.heroTitle).toBe(
      "Все ваши coding agents. Все аккаунты. Один GitHub-профиль.",
    );
    expect(translations.en.noGlobalClaim).toContain("vibecode rating");
    expect(translations.ru.noGlobalClaim).toContain("vibecode rating");
  });

  it("publishes one canonical public URL through robots and the sitemap", () => {
    vi.stubEnv("VIBERACING_PUBLIC_ORIGIN", "https://race.example.com");

    expect(robotsDynamic).toBe("force-dynamic");
    expect(sitemapDynamic).toBe("force-dynamic");
    expect(robots()).toEqual({
      rules: [
        {
          allow: "/",
          disallow: ["/api/", "/auth/", "/admin/", "/v1/"],
          userAgent: "*",
        },
      ],
      sitemap: "https://race.example.com/sitemap.xml",
    });
    expect(sitemap()).toEqual([
      {
        changeFrequency: "weekly",
        priority: 1,
        url: "https://race.example.com/",
      },
    ]);
  });
});

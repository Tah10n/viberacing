import { afterEach, describe, expect, it, vi } from "vitest";
import { publicPageMetadata, standingsCanonical } from "./seo";

afterEach(() => vi.unstubAllEnvs());

describe("public page metadata", () => {
  it("uses the configured origin for canonical and social URLs", () => {
    vi.stubEnv("VIBERACING_PUBLIC_ORIGIN", "https://viberacing.example");
    const metadata = publicPageMetadata("Racer", "Public totals", "/u/Racer?period=month");
    expect(metadata.alternates?.canonical).toBe("https://viberacing.example/u/Racer?period=month");
    expect(metadata.openGraph).toMatchObject({
      url: metadata.alternates?.canonical,
      images: [{ url: "https://viberacing.example/og" }],
    });
    expect(publicPageMetadata("Site", "Description").alternates).toBeUndefined();
  });

  it("keeps distinct periods and pagination while removing the default week alias", () => {
    expect(standingsCanonical("/", { kind: "week" })).toBe("/");
    expect(standingsCanonical("/", { kind: "week" }, 2)).toBe("/?page=2");
    expect(standingsCanonical("/", { kind: "month" }, 2)).toBe("/?period=month&page=2");
    expect(standingsCanonical("/u/Racer", { kind: "year" })).toBe("/u/Racer?period=year");
  });
});

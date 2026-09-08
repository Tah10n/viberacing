import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));
vi.mock("@/lib/db", () => ({ query: queryMock }));
vi.mock("@/lib/session", () => ({
  viewer: () => Promise.resolve({ id: "1", handle: "NewRacer" }),
  hasAccountDeletionReceipt: () => Promise.resolve(false),
}));

import HomePage from "./page";

describe("home personal profile navigation", () => {
  beforeEach(() => {
    vi.stubEnv("VIBERACING_PUBLIC_ORIGIN", "https://viberacing.example");
    vi.stubEnv("VIBERACING_CONNECTOR_DISTRIBUTION", "npm");
    queryMock.mockReset();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("sends an account without a public profile to connection setup", async () => {
    // Both a newly signed-in account and an account that left the leaderboard
    // have no retained usage or active installation and therefore no public profile.
    queryMock.mockResolvedValue([]);
    const markup = renderToStaticMarkup(
      await HomePage({ searchParams: Promise.resolve({ period: "year" }) }),
    );
    expect(markup).toContain('href="/dashboard?period=year#connect-computer"');
    expect(markup).not.toContain('href="/u/NewRacer?period=year"');
  });

  it.each([null, "1"])("keeps an existing profile available with rank %s", async (rank) => {
    queryMock.mockImplementation((sql: string) =>
      Promise.resolve(
        sql.includes("FROM users u LEFT JOIN ranked")
          ? [{ handle: "NewRacer", rank, total: "0", breakdown: null }]
          : [],
      ),
    );
    const markup = renderToStaticMarkup(
      await HomePage({ searchParams: Promise.resolve({ period: "year" }) }),
    );
    expect(markup).toContain('href="/u/NewRacer?period=year"');
    expect(markup).not.toContain("#connect-computer");
  });
});

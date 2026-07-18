import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getSyntheticRacePayload } from "@/lib/race-data";

import { RaceExperience } from "./race-experience";

interface MountedExperience {
  readonly container: HTMLDivElement;
  readonly root: Root;
}

interface MediaController {
  readonly setMatches: (matches: boolean) => void;
}

function installCanvasAndAnimation(): void {
  const context = {
    fillRect: vi.fn(),
    fillStyle: "",
    imageSmoothingEnabled: true,
  } as unknown as CanvasRenderingContext2D;
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: vi.fn(() => context),
  });
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
}

function installMatchMedia(initialMatches: boolean): MediaController {
  class MutableMediaQueryList extends EventTarget implements MediaQueryList {
    readonly media = "(prefers-reduced-motion: reduce)";
    onchange: MediaQueryList["onchange"] = null;
    #matches = initialMatches;

    get matches(): boolean {
      return this.#matches;
    }

    addListener(callback: Parameters<MediaQueryList["addListener"]>[0]): void {
      if (callback !== null) {
        this.addEventListener("change", callback as EventListener);
      }
    }

    removeListener(callback: Parameters<MediaQueryList["removeListener"]>[0]): void {
      if (callback !== null) {
        this.removeEventListener("change", callback as EventListener);
      }
    }

    setMatches(nextMatches: boolean): void {
      this.#matches = nextMatches;
      this.dispatchEvent(new Event("change"));
    }
  }

  const mediaQueryList = new MutableMediaQueryList();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => mediaQueryList),
  );
  return {
    setMatches(nextMatches: boolean) {
      mediaQueryList.setMatches(nextMatches);
    },
  };
}

function mountExperience(
  communitySeasonStart?: string,
  accountSessionAvailable = false,
  profileHandle?: string,
): MountedExperience {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const payload = getSyntheticRacePayload();
  act(() => {
    root.render(
      communitySeasonStart === undefined
        ? createElement(RaceExperience, { accountSessionAvailable, payload, profileHandle })
        : createElement(RaceExperience, {
            accountSessionAvailable,
            communitySeasonStart,
            payload,
            profileHandle,
          }),
    );
  });
  return { container, root };
}

function changeSelect(select: HTMLSelectElement, value: string): void {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function settleCommunityRequest(
  container: HTMLElement,
  expectedSource: "community" | "fallback" = "community",
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const settled =
      expectedSource === "community"
        ? container.querySelector<HTMLElement>(".race-app")?.dataset.scoreSource === "community"
        : container.querySelector(".demo-badge")?.textContent === "Synthetic fallback";
    if (settled) {
      return;
    }
  }
  throw new Error("Community request did not settle");
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  installCanvasAndAnimation();
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("RaceExperience interactions", () => {
  it("replaces enrollment links with the localized account entry for a local session", () => {
    installMatchMedia(false);
    const mounted = mountExperience(undefined, true);
    const navigation = mounted.container.querySelector(".site-nav");
    expect(navigation?.querySelector<HTMLAnchorElement>('a[href="#simulator"]')?.textContent).toBe(
      "Score simulator",
    );
    expect(navigation?.querySelector<HTMLAnchorElement>('a[href="/account"]')?.textContent).toBe(
      "Account",
    );
    expect(navigation?.querySelector('a[href="/login"]')).toBeNull();
    expect(navigation?.querySelector('a[href="/join"]')).toBeNull();

    const localeSelect = mounted.container.querySelectorAll<HTMLSelectElement>("select")[1];
    expect(localeSelect).toBeDefined();
    changeSelect(localeSelect!, "ru");
    expect(navigation?.querySelector<HTMLAnchorElement>('a[href="/account"]')?.textContent).toBe(
      "Аккаунт",
    );

    act(() => {
      mounted.root.unmount();
    });
  });

  it("replaces the preview standings with a validated same-origin Community page", async () => {
    installMatchMedia(false);
    const fetchScore = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            participants: [
              {
                activeDays: 6,
                displayPosition: 1,
                freshnessDays: 0,
                handle: "visible_driver",
                rankPosition: 1,
                scoreVersion: "community_v1",
                seasonEnd: "2026-07-19",
                seasonFinalized: false,
                seasonStart: "2026-07-13",
                sourceCount: 2,
                streakDays: 12,
                weeklyScore: 6123,
              },
              {
                activeDays: 4,
                carRecipe: {
                  schemaVersion: 1,
                  chassis: "rally",
                  nose: "scoop",
                  cockpit: "rally",
                  wing: "low",
                  wheels: "all-terrain",
                  palette: "redline",
                  trail: "grid",
                  seed: 202,
                },
                displayPosition: 2,
                freshnessDays: 1,
                handle: "second_driver",
                rankPosition: 2,
                scoreVersion: "community_v1",
                seasonEnd: "2026-07-19",
                seasonFinalized: false,
                seasonStart: "2026-07-13",
                sourceCount: 1,
                weeklyScore: 4096,
              },
            ],
            schemaVersion: 1,
            selfReported: true,
            trustTier: "community",
          }),
          { headers: { "content-type": "application/json; charset=utf-8" } },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchScore);

    const mounted = mountExperience("2026-07-13", false, "second_driver");
    await settleCommunityRequest(mounted.container);

    const app = mounted.container.querySelector<HTMLElement>(".race-app");
    expect(app?.dataset.scoreSource).toBe("community");
    expect(mounted.container.textContent).toContain("Community standings");
    expect(mounted.container.textContent).toContain("visible_driver");
    expect(mounted.container.textContent).toContain("Visual marker");
    expect(mounted.container.textContent).not.toContain("neon_otter");
    expect(mounted.container.querySelectorAll("tbody tr")).toHaveLength(2);
    const profile = mounted.container.querySelector<HTMLElement>("#profile");
    expect(profile?.textContent).toContain("Community profile");
    expect(profile?.textContent).toContain("second_driver");
    expect(profile?.textContent).toContain("4,096 pts");
    expect(profile?.textContent).toContain("#2");
    expect(profile?.textContent).toContain("1 day");
    expect(profile?.querySelector(".daily-bars")).toBeNull();
    expect(profile?.querySelector('.car-swatch[data-paint="redline"]')).not.toBeNull();

    const secondProfile = Array.from(
      mounted.container.querySelectorAll<HTMLAnchorElement>(".profile-driver-link"),
    ).find((link) => link.textContent === "second_driver");
    expect(secondProfile).toBeDefined();
    expect(secondProfile?.getAttribute("aria-current")).toBe("true");
    expect(secondProfile?.getAttribute("href")).toBe("/?profile=second_driver#profile");

    const firstProfile = Array.from(
      mounted.container.querySelectorAll<HTMLAnchorElement>(".profile-driver-link"),
    ).find((link) => link.textContent === "visible_driver");
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    act(() => {
      firstProfile?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(firstProfile?.getAttribute("aria-current")).toBe("true");
    expect(profile?.textContent).toContain("visible_driver");
    expect(profile?.textContent).toContain("today");
    expect(profile?.textContent).toContain("12d");
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      "/?profile=visible_driver#profile",
    );
    expect(scrollIntoView).toHaveBeenCalled();
    expect(fetchScore).toHaveBeenCalledWith(
      "/v1/community/race/status?seasonStart=2026-07-13",
      expect.objectContaining({ credentials: "omit", method: "GET" }),
    );

    act(() => {
      mounted.root.unmount();
    });

    const missing = mountExperience("2026-07-13", false, "missing_driver");
    await settleCommunityRequest(missing.container);
    const missingProfile = missing.container.querySelector<HTMLElement>("#profile");
    expect(missingProfile?.textContent).toContain("missing_driver");
    expect(missingProfile?.textContent).toContain("not in the current top 32");
    expect(missing.container.querySelector('[aria-current="true"]')).toBeNull();

    act(() => {
      missing.root.unmount();
    });

    const defaultProfile = mountExperience("2026-07-13");
    await settleCommunityRequest(defaultProfile.container);
    expect(defaultProfile.container.querySelector("#profile")?.textContent).toContain(
      "visible_driver",
    );
    expect(
      defaultProfile.container.querySelector<HTMLAnchorElement>('[aria-current="true"]')
        ?.textContent,
    ).toBe("visible_driver");

    act(() => {
      defaultProfile.root.unmount();
    });
  });

  it("labels and preserves the synthetic fallback when Community standings are unavailable", async () => {
    installMatchMedia(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 503 }))),
    );

    const mounted = mountExperience("2026-07-13");
    await settleCommunityRequest(mounted.container, "fallback");

    expect(mounted.container.textContent).toContain("Synthetic fallback");
    expect(mounted.container.textContent).toContain("neon_otter");
    expect(mounted.container.querySelectorAll("tbody tr")).toHaveLength(8);

    act(() => {
      mounted.root.unmount();
    });
  });

  it("renders an explicit empty state for a valid Community week without participants", async () => {
    installMatchMedia(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              participants: [],
              schemaVersion: 1,
              selfReported: true,
              trustTier: "community",
            }),
            { headers: { "content-type": "application/json; charset=utf-8" } },
          ),
        ),
      ),
    );

    const mounted = mountExperience("2026-07-13");
    await settleCommunityRequest(mounted.container);

    expect(mounted.container.textContent).toContain("No Community participants yet.");
    expect(mounted.container.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(mounted.container.querySelector("#profile")?.textContent).not.toContain("demo_driver");

    act(() => {
      mounted.root.unmount();
    });
  });

  it("loads, applies, and persists only non-personal device preferences", () => {
    localStorage.setItem("viberacing.locale", "ru");
    localStorage.setItem("viberacing.theme", "cyber-rally");
    localStorage.setItem("viberacing.motion", "off");
    const media = installMatchMedia(false);
    const mounted = mountExperience();
    const app = mounted.container.querySelector<HTMLElement>(".race-app");
    expect(document.documentElement.lang).toBe("ru");
    expect(app?.dataset.theme).toBe("cyber-rally");
    expect(app?.dataset.motion).toBe("off");
    expect(mounted.container.textContent).toContain("Синтетическое превью");
    expect(mounted.container.querySelector("#simulator-heading")?.textContent).toBe(
      "Симулятор баллов",
    );

    const selects = mounted.container.querySelectorAll<HTMLSelectElement>("select");
    expect(selects).toHaveLength(4);
    changeSelect(selects[0]!, "classic-grand-prix");
    changeSelect(selects[1]!, "en");
    changeSelect(selects[2]!, "system");
    expect(document.documentElement.lang).toBe("en");
    expect(app?.dataset.theme).toBe("classic-grand-prix");
    expect(app?.dataset.motion).toBe("on");
    expect(localStorage.getItem("viberacing.locale")).toBe("en");
    expect(localStorage.getItem("viberacing.theme")).toBe("classic-grand-prix");
    expect(localStorage.getItem("viberacing.motion")).toBe("system");

    act(() => {
      media.setMatches(true);
    });
    expect(app?.dataset.motion).toBe("off");

    const pauseButton = Array.from(mounted.container.querySelectorAll("button")).find(
      (button) => button.getAttribute("aria-pressed") === "false",
    );
    expect(pauseButton).toBeDefined();
    act(() => {
      pauseButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(pauseButton?.getAttribute("aria-pressed")).toBe("true");

    act(() => {
      mounted.root.unmount();
    });
  });

  it("rejects invalid stored values and remains usable when storage is unavailable", () => {
    installMatchMedia(true);
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    getItem.mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    setItem.mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    const mounted = mountExperience();
    const app = mounted.container.querySelector<HTMLElement>(".race-app");
    expect(document.documentElement.lang).toBe("en");
    expect(app?.dataset.theme).toBe("neon-night");
    expect(app?.dataset.motion).toBe("off");
    expect(mounted.container.querySelectorAll("tbody tr")).toHaveLength(8);
    expect(getItem).toHaveBeenCalled();
    expect(setItem).toHaveBeenCalled();

    act(() => {
      mounted.root.unmount();
    });
  });
});

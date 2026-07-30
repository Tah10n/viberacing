import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getSyntheticPublicHomePayload } from "@/lib/race-data";
import type { PublicHomePayload } from "@/lib/race-types";

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
  payload: PublicHomePayload = getSyntheticPublicHomePayload("2026-07-27"),
  accountSessionAvailable = false,
  profileHandle?: string,
): MountedExperience {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(RaceExperience, {
        accountSessionAvailable,
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

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  installCanvasAndAnimation();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("RaceExperience interactions", () => {
  it("keeps account navigation and localizes the honest public copy", () => {
    installMatchMedia(false);
    const mounted = mountExperience(undefined, true);
    const navigation = mounted.container.querySelector(".site-nav");

    expect(navigation?.querySelector<HTMLAnchorElement>('a[href="/account"]')?.textContent).toBe(
      "Account",
    );
    expect(navigation?.querySelector('a[href="/login"]')).toBeNull();
    expect(navigation?.querySelector('a[href="#simulator"]')).toBeNull();

    const localeSelect = mounted.container.querySelectorAll<HTMLSelectElement>("select")[1];
    expect(localeSelect).toBeDefined();
    changeSelect(localeSelect!, "ru");
    expect(mounted.container.querySelector("h1")?.textContent).toContain("Все ваши coding agents");
    expect(mounted.container.querySelector(".metric-disclaimer")?.textContent).toContain(
      "не качества кода",
    );
    expect(navigation?.querySelector<HTMLAnchorElement>('a[href="/account"]')?.textContent).toBe(
      "Аккаунт",
    );

    act(() => {
      mounted.root.unmount();
    });
  });

  it("renders and selects exact token totals without a browser request or Number coercion", () => {
    installMatchMedia(false);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const base = getSyntheticPublicHomePayload("2026-07-27");
    const first = base.leaderboard.participants[0];
    expect(first).toBeDefined();
    const exactTotal = "123456789012345678901234567890123456789012345678901234567890";
    const payload: PublicHomePayload = {
      ...base,
      leaderboard: {
        ...base.leaderboard,
        participants: [
          { ...first!, weeklyTokenTotal: exactTotal },
          ...base.leaderboard.participants.slice(1),
        ],
      },
      source: "community",
    };
    const mounted = mountExperience(payload, false, "loop_lantern");

    expect(mounted.container.querySelector(".race-app")?.getAttribute("data-snapshot-source")).toBe(
      "community",
    );
    expect(mounted.container.textContent).toContain(
      "123,456,789,012,345,678,901,234,567,890,123,456,789,012,345,678,901,234,567,890 tokens",
    );
    expect(fetchSpy).not.toHaveBeenCalled();

    const firstLink = mounted.container.querySelector<HTMLAnchorElement>(
      'a[href="/?profile=neon_otter#profile"]',
    );
    expect(firstLink).not.toBeNull();
    act(() => {
      firstLink?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          button: 0,
          cancelable: true,
        }),
      );
    });
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      "/?profile=neon_otter#profile",
    );
    expect(mounted.container.querySelector("#profile")?.textContent).toContain("neon_otter");
    expect(mounted.container.querySelector("#profile")?.textContent).toContain(
      "123,456,789,012,345,678,901,234,567,890,123,456,789,012,345,678,901,234,567,890",
    );

    act(() => {
      mounted.root.unmount();
    });
  });

  it("honors reduced motion, pause, theme, and delayed race enhancement", () => {
    vi.useFakeTimers();
    const media = installMatchMedia(true);
    const mounted = mountExperience();
    const app = mounted.container.querySelector<HTMLElement>(".race-app");

    expect(app?.dataset.motion).toBe("off");
    expect(mounted.container.querySelector(".race-loading")).not.toBeNull();
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(mounted.container.querySelector(".race-console")?.getAttribute("data-race-ready")).toBe(
      "true",
    );

    const selects = mounted.container.querySelectorAll<HTMLSelectElement>("select");
    changeSelect(selects[0]!, "classic-grand-prix");
    changeSelect(selects[2]!, "on");
    expect(app?.dataset.theme).toBe("classic-grand-prix");
    expect(app?.dataset.motion).toBe("on");

    const pauseButton = mounted.container.querySelector<HTMLButtonElement>(
      ".race-section .pixel-button",
    );
    act(() => {
      pauseButton?.click();
    });
    expect(pauseButton?.getAttribute("aria-pressed")).toBe("true");

    act(() => {
      media.setMatches(false);
    });
    expect(localStorage.getItem("viberacing.theme")).toBe("classic-grand-prix");
    expect(localStorage.getItem("viberacing.motion")).toBe("on");

    act(() => {
      mounted.root.unmount();
    });
  });
});

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

function mountExperience(): MountedExperience {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(RaceExperience, { payload: getSyntheticRacePayload() }));
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
  installCanvasAndAnimation();
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("RaceExperience interactions", () => {
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

    const selects = mounted.container.querySelectorAll<HTMLSelectElement>("select");
    expect(selects).toHaveLength(3);
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

import axe from "axe-core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScoreSimulator } from "./score-simulator";

interface MountedSimulator {
  readonly container: HTMLDivElement;
  readonly root: Root;
}

function mountSimulator(locale: "en" | "ru" = "en"): MountedSimulator {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(ScoreSimulator, { locale }));
  });
  return { container, root };
}

function changeInput(input: HTMLInputElement, value: string): void {
  act(() => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    const setter = descriptor === undefined ? undefined : Reflect.get(descriptor, "set");
    if (typeof setter !== "function") {
      throw new Error("input value setter is unavailable");
    }
    Reflect.apply(setter, input, [value]);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function changeSelect(select: HTMLSelectElement, value: string): void {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ScoreSimulator", () => {
  it("renders a labelled local-only calculator without axe violations", async () => {
    document.documentElement.lang = "en";
    document.title = "Vibe Racing score simulator test";
    document.body.innerHTML = renderToStaticMarkup(createElement(ScoreSimulator, { locale: "en" }));

    const results = await axe.run(document.documentElement, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results.violations).toEqual([]);
    expect(document.querySelector("form")).toBeNull();
    expect(document.querySelector("input")?.hasAttribute("name")).toBe(false);
    expect(document.querySelector("#simulator-heading")?.textContent).toBe("Score simulator");
    expect(document.querySelector(".score-cap")?.textContent).toBe("MAX 7,000 pts");
    expect(document.body.textContent).toContain("Nothing leaves this page");
    expect(document.body.textContent).toContain("865 pts");
  }, 10_000);

  it("updates exact daily and weekly results without network or browser persistence", () => {
    const fetchRequest = vi.fn();
    vi.stubGlobal("fetch", fetchRequest);
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const mounted = mountSimulator();
    const input = mounted.container.querySelector<HTMLInputElement>(".simulator-input");
    const select = mounted.container.querySelector<HTMLSelectElement>("select");
    expect(input).not.toBeNull();
    expect(select).not.toBeNull();
    expect(mounted.container.querySelector(".simulator-results")?.textContent).toContain("173 pts");
    expect(mounted.container.querySelector(".simulator-results")?.textContent).toContain("865 pts");

    changeInput(input!, "100000");
    expect(input?.getAttribute("aria-invalid")).toBe("false");
    expect(mounted.container.querySelector(".simulator-results")?.textContent).toContain("599 pts");
    expect(mounted.container.querySelector(".simulator-results")?.textContent).toContain(
      "2,995 pts",
    );

    changeSelect(select!, "7");
    expect(mounted.container.querySelector(".simulator-results")?.textContent).toContain(
      "4,193 pts",
    );

    changeInput(input!, "9007199254740991");
    expect(mounted.container.querySelector(".simulator-results")?.textContent).toContain(
      "7,000 pts",
    );
    expect(fetchRequest).not.toHaveBeenCalled();
    expect(storageWrite).not.toHaveBeenCalled();

    act(() => {
      mounted.root.unmount();
    });
  });

  it("rejects ambiguous input and localizes the complete surface", () => {
    const mounted = mountSimulator();
    const input = mounted.container.querySelector<HTMLInputElement>(".simulator-input");
    changeInput(input!, "01");
    expect(input?.getAttribute("aria-invalid")).toBe("true");
    expect(mounted.container.querySelector('[role="alert"]')?.textContent).toContain(
      "Enter a whole number",
    );
    expect(mounted.container.querySelector(".simulator-results")?.textContent).toContain("— pts");

    act(() => {
      mounted.root.render(createElement(ScoreSimulator, { locale: "ru" }));
    });
    expect(mounted.container.querySelector("#simulator-heading")?.textContent).toBe(
      "Симулятор баллов",
    );
    expect(mounted.container.textContent).toContain("не покидает страницу");
    expect(mounted.container.textContent).toContain("Баллы за неделю");

    act(() => {
      mounted.root.unmount();
    });
  });
});

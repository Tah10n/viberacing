import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { carCockpits, carPalette, carPalettes, type CarRecipe } from "@/lib/car-recipe";
import { canvasThemes, raceThemeIds } from "@/lib/theme";

import { CarRecipePreview } from "./car-recipe-preview";

const recipe: CarRecipe = Object.freeze({
  schemaVersion: 1,
  chassis: "formula",
  nose: "wedge",
  cockpit: "open",
  wing: "high",
  wheels: "slick",
  palette: "turbo-blue",
  trail: "grid",
  seed: 11,
});

function renderPreview(locale: "en" | "ru"): HTMLElement {
  document.body.innerHTML = renderToStaticMarkup(
    createElement(CarRecipePreview, {
      label: locale === "en" ? "Pending car" : "Предложенный автомобиль",
      locale,
      recipe,
    }),
  );
  const preview = document.body.firstElementChild;
  if (!(preview instanceof HTMLElement)) {
    throw new TypeError("preview did not render");
  }
  return preview;
}

describe("CarRecipePreview", () => {
  it("renders the exact recipe as code-native pixels in all three themes", () => {
    const preview = renderPreview("en");
    const canvases = [...preview.querySelectorAll<HTMLElement>(".car-preview-canvas")];

    expect(canvases).toHaveLength(3);
    expect(canvases.map((canvas) => canvas.getAttribute("aria-label"))).toEqual([
      "Pending car: Neon Night Arcade",
      "Pending car: Classic Grand Prix",
      "Pending car: Cyber Rally",
    ]);
    expect(canvases.map((canvas) => canvas.dataset.theme)).toEqual([
      "neon-night",
      "classic-grand-prix",
      "cyber-rally",
    ]);
    expect(canvases.every((canvas) => canvas.getAttribute("role") === "img")).toBe(true);
    expect(
      canvases.every((canvas) => canvas.querySelectorAll(".car-preview-pixel").length === 176),
    ).toBe(true);
    expect(canvases.every((canvas) => canvas.querySelector(".pixel-b") !== null)).toBe(true);
    expect(preview.getAttribute("data-recipe")).toBe(
      "v1:formula:wedge:open:high:slick:turbo-blue:grid:11",
    );
    expect(preview.textContent).toContain("Classic Grand Prix");
  });

  it("retains localized semantic labels without browser JavaScript", () => {
    const preview = renderPreview("ru");
    const canvases = [...preview.querySelectorAll(".car-preview-canvas")];

    expect(canvases[0]?.getAttribute("aria-label")).toBe(
      "Предложенный автомобиль: Неоновая аркада",
    );
    expect(preview.textContent).toContain("Классический гран-при");
  });

  it("keeps every CSS preview token synchronized with the canonical renderer palettes", () => {
    const style = document.createElement("style");
    style.textContent = readFileSync(resolve(process.cwd(), "app", "globals.css"), "utf8");
    document.head.append(style);
    const preview = document.createElement("div");
    document.body.append(preview);

    for (const theme of raceThemeIds) {
      for (const palette of carPalettes) {
        for (const cockpit of carCockpits) {
          const currentRecipe = { ...recipe, cockpit, palette };
          preview.className =
            `car-preview-canvas car-preview-theme-${theme} ` +
            `car-preview-palette-${palette} car-preview-cockpit-${cockpit}`;
          const computed = getComputedStyle(preview);
          const expected = carPalette(currentRecipe, theme);
          expect(computed.getPropertyValue("--car-body").trim()).toBe(expected.body);
          expect(computed.getPropertyValue("--car-accent").trim()).toBe(expected.accent);
          expect(computed.getPropertyValue("--car-glass").trim()).toBe(expected.glass);
          expect(computed.getPropertyValue("--car-trim").trim()).toBe(expected.trim);
          expect(computed.getPropertyValue("--preview-sky").trim()).toBe(canvasThemes[theme].sky);
          expect(computed.getPropertyValue("--preview-road").trim()).toBe(canvasThemes[theme].road);
          expect(computed.getPropertyValue("--preview-lane").trim()).toBe(canvasThemes[theme].lane);
        }
      }
    }
    preview.remove();
    style.remove();
  });
});

import { describe, expect, it } from "vitest";

import {
  buildCarSprite,
  carBodies,
  carPaints,
  carPalette,
  carRecipeKey,
  isCarRecipe,
  serializeCarSprite,
  type CarRecipe,
} from "./car-recipe";
import { raceThemeIds } from "./theme";

const baseRecipe: CarRecipe = {
  body: "roadster",
  paint: "magenta",
  trim: "chrome",
  spoiler: "none",
};

describe("CarRecipe", () => {
  it("accepts only the four bounded enum fields", () => {
    expect(isCarRecipe(baseRecipe)).toBe(true);
    expect(isCarRecipe({ ...baseRecipe, paint: "javascript:alert(1)" })).toBe(false);
    expect(isCarRecipe({ ...baseRecipe, customColor: "#ffffff" })).toBe(false);
    expect(isCarRecipe({ ...baseRecipe, assetUrl: "https://invalid.example/car.svg" })).toBe(false);
    expect(isCarRecipe(null)).toBe(false);
  });

  it("renders fixed 16 by 8 sprites with a closed pixel alphabet", () => {
    for (const body of carBodies) {
      const sprite = buildCarSprite({ ...baseRecipe, body });
      expect(sprite).toHaveLength(8);
      expect(sprite.every((row) => row.length === 16)).toBe(true);
      expect(sprite.flat().every((pixel) => ".abgtw".includes(pixel))).toBe(true);
    }
  });

  it("keeps readable visual snapshots for every body and spoiler shape", () => {
    expect(serializeCarSprite({ ...baseRecipe, body: "roadster", spoiler: "none" })).toBe(
      [
        "................",
        "................",
        "......ggg.......",
        "....bbgggbb.....",
        "..bbbbabbbbbbb..",
        ".bbttbbbbbbttbb.",
        ".bbwwbbbbbbwwbb.",
        "...ww......ww...",
      ].join("\n"),
    );
    expect(serializeCarSprite({ ...baseRecipe, body: "formula", spoiler: "high" })).toBe(
      [
        "................",
        "............aa..",
        ".......g.....a..",
        "......bgb.......",
        ".aaabbbbbbbbaaa.",
        "...ttbbbbtt.....",
        "..wwbbbbbbww....",
        "..ww......ww....",
      ].join("\n"),
    );
    expect(serializeCarSprite({ ...baseRecipe, body: "rally", spoiler: "low" })).toBe(
      [
        "................",
        "................",
        ".....gggg.......",
        "...bbggggbbb.aa.",
        "..bbbbabbbbbbb..",
        ".bbttbbbbbbttbb.",
        ".bwwwbbbbbbwwwb.",
        "..www......www..",
      ].join("\n"),
    );
  });

  it("maps every theme and paint to repository-owned color tokens", () => {
    for (const theme of raceThemeIds) {
      const observed = new Set<string>();
      for (const paint of carPaints) {
        const palette = carPalette({ ...baseRecipe, paint }, theme);
        const colors: readonly string[] = [
          palette.body,
          palette.accent,
          palette.glass,
          palette.trim,
          palette.wheel,
        ];
        expect(colors.every((color) => /^#[0-9a-f]{6}$/i.test(color))).toBe(true);
        observed.add(palette.body);
      }
      expect(observed.size).toBe(carPaints.length);
    }
  });

  it("derives a deterministic key without accepting free-form content", () => {
    expect(carRecipeKey(baseRecipe)).toBe("roadster:magenta:chrome:none");
  });
});

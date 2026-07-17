import { describe, expect, it } from "vitest";

import { validateCarRecipeV1 } from "@viberacing/contracts";

import {
  buildCarSprite,
  buildCarTrail,
  carChassis,
  carCockpits,
  carNoses,
  carPalette,
  carPalettes,
  carRecipeKey,
  carWheels,
  carWings,
  serializeCarSprite,
  type CarRecipe,
} from "./car-recipe";
import { raceThemeIds } from "./theme";

const baseRecipe: CarRecipe = {
  schemaVersion: 1,
  chassis: "roadster",
  nose: "classic",
  cockpit: "canopy",
  wing: "none",
  wheels: "street",
  palette: "magenta",
  trail: "none",
  seed: 0,
};

describe("CarRecipe", () => {
  it("accepts only the exact versioned bounded fields", () => {
    expect(validateCarRecipeV1(baseRecipe).ok).toBe(true);
    expect(validateCarRecipeV1({ ...baseRecipe, palette: "javascript:alert(1)" }).ok).toBe(false);
    expect(validateCarRecipeV1({ ...baseRecipe, customColor: "#ffffff" }).ok).toBe(false);
    expect(
      validateCarRecipeV1({ ...baseRecipe, assetUrl: "https://invalid.example/car.svg" }).ok,
    ).toBe(false);
    expect(validateCarRecipeV1({ ...baseRecipe, conversation: "make it faster" }).ok).toBe(false);
    expect(validateCarRecipeV1({ ...baseRecipe, schemaVersion: 2 }).ok).toBe(false);
    expect(validateCarRecipeV1({ ...baseRecipe, seed: 65_536 }).ok).toBe(false);
    expect(validateCarRecipeV1({ ...baseRecipe, seed: 1.5 }).ok).toBe(false);
    expect(validateCarRecipeV1(null).ok).toBe(false);
  });

  it("renders every reviewed part axis into fixed 16 by 8 sprites", () => {
    for (const chassis of carChassis) {
      for (const nose of carNoses) {
        for (const cockpit of carCockpits) {
          for (const wing of carWings) {
            for (const wheels of carWheels) {
              const sprite = buildCarSprite({
                ...baseRecipe,
                chassis,
                cockpit,
                nose,
                wheels,
                wing,
              });
              expect(sprite).toHaveLength(8);
              expect(sprite.every((row) => row.length === 16)).toBe(true);
              expect(sprite.flat().every((pixel) => ".abgtw".includes(pixel))).toBe(true);
            }
          }
        }
      }
    }
  });

  it("keeps readable visual snapshots for every body and spoiler shape", () => {
    expect(serializeCarSprite(baseRecipe)).toBe(
      [
        "................",
        "................",
        "......ggg.......",
        "....bbgggbb.....",
        "..abbbabbbbbbb..",
        ".bbttbbbbbbttbb.",
        ".bbwwbbbbbbwwbb.",
        "...ww......ww...",
      ].join("\n"),
    );
    expect(
      serializeCarSprite({
        ...baseRecipe,
        chassis: "formula",
        nose: "wedge",
        cockpit: "open",
        wing: "high",
        wheels: "slick",
        seed: 5,
      }),
    ).toBe(
      [
        "................",
        "............aa..",
        ".............a..",
        "......bgb.....b.",
        ".aaababbbbbbaa..",
        "...ttbbbbtt.....",
        "..wwbbbbbbww....",
        "................",
      ].join("\n"),
    );
    expect(
      serializeCarSprite({
        ...baseRecipe,
        chassis: "rally",
        nose: "scoop",
        cockpit: "rally",
        wing: "low",
        wheels: "all-terrain",
        seed: 10,
      }),
    ).toBe(
      [
        "................",
        "......t..t......",
        ".....gtggt......",
        "...bbggggbbb.aa.",
        "..bbbbabbabbba..",
        ".bbttbbbbbbttbb.",
        ".bwwwbbbbbbwwwb.",
        ".wwwww....wwwww.",
      ].join("\n"),
    );
  });

  it("maps every theme and palette to repository-owned color tokens", () => {
    for (const theme of raceThemeIds) {
      const observed = new Set<string>();
      for (const paletteId of carPalettes) {
        const palette = carPalette({ ...baseRecipe, palette: paletteId }, theme);
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
      expect(observed.size).toBe(carPalettes.length);
    }
  });

  it("keeps an exact reviewable snapshot for the same recipe in every theme", () => {
    const themedRecipe = Object.freeze({ ...baseRecipe, palette: "redline" as const, seed: 19 });
    const key = "v1:roadster:classic:canopy:none:street:redline:none:19";
    const sprite = serializeCarSprite(themedRecipe);
    expect(
      raceThemeIds.map((theme) => ({
        key: carRecipeKey(themedRecipe),
        palette: carPalette(themedRecipe, theme),
        sprite,
        theme,
        trail: buildCarTrail(themedRecipe),
      })),
    ).toEqual([
      {
        key,
        palette: {
          accent: "#ffffff",
          body: "#ff5a67",
          glass: "#77efff",
          trim: "#9ba7c7",
          wheel: "#080a0d",
        },
        sprite,
        theme: "neon-night",
        trail: [],
      },
      {
        key,
        palette: {
          accent: "#fff7e6",
          body: "#c83e37",
          glass: "#c9e6f4",
          trim: "#84909b",
          wheel: "#080a0d",
        },
        sprite,
        theme: "classic-grand-prix",
        trail: [],
      },
      {
        key,
        palette: {
          accent: "#f5ff65",
          body: "#ff5b45",
          glass: "#77efff",
          trim: "#7bb49e",
          wheel: "#080a0d",
        },
        sprite,
        theme: "cyber-rally",
        trail: [],
      },
    ]);
  });

  it("derives deterministic keys and closed trail pixels without free-form content", () => {
    expect(carRecipeKey(baseRecipe)).toBe("v1:roadster:classic:canopy:none:street:magenta:none:0");
    expect(buildCarTrail(baseRecipe)).toEqual([]);
    expect(buildCarTrail({ ...baseRecipe, trail: "spark", seed: 1 })).toEqual([
      { x: -2, y: 4 },
      { x: -4, y: 4 },
      { x: -6, y: 5 },
    ]);
    expect(buildCarTrail({ ...baseRecipe, trail: "grid", seed: 2 })).toEqual([
      { x: -2, y: 4 },
      { x: -4, y: 4 },
      { x: -6, y: 4 },
      { x: -4, y: 2 },
    ]);
  });
});

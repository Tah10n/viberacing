import type { CarRecipeV1 } from "@viberacing/contracts";

import type { RaceThemeId } from "./theme";

export const carChassis = ["formula", "rally", "roadster"] as const;
export const carNoses = ["classic", "scoop", "wedge"] as const;
export const carCockpits = ["canopy", "open", "rally"] as const;
export const carWings = ["high", "low", "none"] as const;
export const carWheels = ["all-terrain", "slick", "street"] as const;
export const carPalettes = ["magenta", "mint", "redline", "sunburst", "turbo-blue"] as const;
export const carTrails = ["grid", "none", "spark"] as const;

export type CarRecipe = CarRecipeV1;
export type CarChassis = CarRecipe["chassis"];
export type CarNose = CarRecipe["nose"];
export type CarCockpit = CarRecipe["cockpit"];
export type CarWing = CarRecipe["wing"];
export type CarWheels = CarRecipe["wheels"];
export type CarPaletteId = CarRecipe["palette"];
export type CarTrail = CarRecipe["trail"];
export type SpritePixel = "." | "a" | "b" | "g" | "t" | "w";

export interface CarPalette {
  readonly body: string;
  readonly accent: string;
  readonly glass: string;
  readonly trim: string;
  readonly wheel: string;
}

const templates: Readonly<Record<CarChassis, readonly string[]>> = {
  roadster: [
    "................",
    "................",
    "......ggg.......",
    "....bbgggbb.....",
    "..bbbbabbbbbbb..",
    ".bbttbbbbbbttbb.",
    ".bbwwbbbbbbwwbb.",
    "...ww......ww...",
  ],
  formula: [
    "................",
    "................",
    ".......g........",
    "......bgb.......",
    ".aaabbbbbbbbaaa.",
    "...ttbbbbtt.....",
    "..wwbbbbbbww....",
    "..ww......ww....",
  ],
  rally: [
    "................",
    "................",
    ".....gggg.......",
    "...bbggggbbb....",
    "..bbbbabbbbbbb..",
    ".bbttbbbbbbttbb.",
    ".bwwwbbbbbbwwwb.",
    "..www......www..",
  ],
};

const palettes: Readonly<
  Record<RaceThemeId, Readonly<Record<CarPaletteId, readonly [string, string]>>>
> = {
  "neon-night": {
    magenta: ["#ff4fc8", "#ffe66d"],
    "turbo-blue": ["#38a7ff", "#55f7ff"],
    sunburst: ["#ff9f43", "#ffe66d"],
    mint: ["#48e5a8", "#c5ff8a"],
    redline: ["#ff5a67", "#ffffff"],
  },
  "classic-grand-prix": {
    magenta: ["#a83972", "#f2c14e"],
    "turbo-blue": ["#2463a5", "#eef6ff"],
    sunburst: ["#dd8a1f", "#fff3bd"],
    mint: ["#2f8f72", "#d9f2e6"],
    redline: ["#c83e37", "#fff7e6"],
  },
  "cyber-rally": {
    magenta: ["#dc4cff", "#8dff79"],
    "turbo-blue": ["#28c7c9", "#b7ff44"],
    sunburst: ["#ff8a3d", "#f5ff65"],
    mint: ["#38d98a", "#d8ff5b"],
    redline: ["#ff5b45", "#f5ff65"],
  },
};

const cockpitTrimColors: Readonly<Record<RaceThemeId, Readonly<Record<CarCockpit, string>>>> = {
  "neon-night": { canopy: "#9ba7c7", open: "#f7f2ff", rally: "#140d25" },
  "classic-grand-prix": { canopy: "#84909b", open: "#fff9e8", rally: "#17212b" },
  "cyber-rally": { canopy: "#7bb49e", open: "#edffe8", rally: "#071c1b" },
};

function setPixel(
  rows: SpritePixel[][],
  rowIndex: number,
  columnIndex: number,
  pixel: SpritePixel,
) {
  const row = rows[rowIndex];
  if (row === undefined) {
    throw new RangeError("car sprite row is outside the fixed template");
  }
  row[columnIndex] = pixel;
}

export function carRecipeKey(recipe: CarRecipe): string {
  return [
    `v${String(recipe.schemaVersion)}`,
    recipe.chassis,
    recipe.nose,
    recipe.cockpit,
    recipe.wing,
    recipe.wheels,
    recipe.palette,
    recipe.trail,
    String(recipe.seed),
  ].join(":");
}

export function buildCarSprite(recipe: CarRecipe): readonly (readonly SpritePixel[])[] {
  const rows = templates[recipe.chassis].map((row) => Array.from(row) as SpritePixel[]);
  if (recipe.nose === "scoop") {
    setPixel(rows, 3, 14, "a");
    setPixel(rows, 4, 13, "a");
  } else if (recipe.nose === "wedge") {
    setPixel(rows, 3, 14, "b");
    setPixel(rows, 4, 14, ".");
  }
  if (recipe.cockpit === "open") {
    for (const row of rows) {
      for (const [columnIndex, pixel] of row.entries()) {
        if (pixel === "g") {
          row[columnIndex] = ".";
        }
      }
    }
    setPixel(rows, 3, 7, "g");
  } else if (recipe.cockpit === "rally") {
    setPixel(rows, 1, 6, "t");
    setPixel(rows, 1, 9, "t");
    setPixel(rows, 2, 6, "t");
    setPixel(rows, 2, 9, "t");
  }
  if (recipe.wing === "low") {
    setPixel(rows, 3, 13, "a");
    setPixel(rows, 3, 14, "a");
  } else if (recipe.wing === "high") {
    setPixel(rows, 1, 12, "a");
    setPixel(rows, 1, 13, "a");
    setPixel(rows, 2, 13, "a");
  }
  if (recipe.wheels === "slick") {
    for (const [columnIndex, pixel] of rows[7]?.entries() ?? []) {
      if (pixel === "w") {
        setPixel(rows, 7, columnIndex, ".");
      }
    }
  } else if (recipe.wheels === "all-terrain") {
    const wheelColumns = [...(rows[7]?.entries() ?? [])]
      .filter(([, pixel]) => pixel === "w")
      .map(([columnIndex]) => columnIndex);
    for (const columnIndex of wheelColumns) {
      if (columnIndex > 0) {
        setPixel(rows, 7, columnIndex - 1, "w");
      }
      if (columnIndex < 15) {
        setPixel(rows, 7, columnIndex + 1, "w");
      }
    }
  }
  const accents = [2, 5, 9, 12] as const;
  setPixel(rows, 4, accents[recipe.seed % accents.length] ?? accents[0], "a");
  return rows;
}

export function carPalette(recipe: CarRecipe, theme: RaceThemeId): CarPalette {
  const [body, accent] = palettes[theme][recipe.palette];
  return {
    body,
    accent,
    glass:
      recipe.cockpit === "open"
        ? cockpitTrimColors[theme].open
        : theme === "classic-grand-prix"
          ? "#c9e6f4"
          : "#77efff",
    trim: cockpitTrimColors[theme][recipe.cockpit],
    wheel: "#080a0d",
  };
}

export interface CarTrailPixel {
  readonly x: number;
  readonly y: number;
}

export function buildCarTrail(recipe: CarRecipe): readonly CarTrailPixel[] {
  if (recipe.trail === "none") {
    return Object.freeze([]);
  }
  const verticalOffset = recipe.seed % 2;
  return recipe.trail === "spark"
    ? Object.freeze([
        Object.freeze({ x: -2, y: 5 - verticalOffset }),
        Object.freeze({ x: -4, y: 3 + verticalOffset }),
        Object.freeze({ x: -6, y: 5 }),
      ])
    : Object.freeze([
        Object.freeze({ x: -2, y: 4 }),
        Object.freeze({ x: -4, y: 4 }),
        Object.freeze({ x: -6, y: 4 }),
        Object.freeze({ x: -4, y: 2 + verticalOffset }),
      ]);
}

export function serializeCarSprite(recipe: CarRecipe): string {
  return buildCarSprite(recipe)
    .map((row) => row.join(""))
    .join("\n");
}

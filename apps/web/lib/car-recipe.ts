import type { RaceThemeId } from "./theme";

export const carBodies = ["roadster", "formula", "rally"] as const;
export const carPaints = ["magenta", "turbo-blue", "sunburst", "mint", "redline"] as const;
export const carTrims = ["light", "dark", "chrome"] as const;
export const carSpoilers = ["none", "low", "high"] as const;

export type CarBody = (typeof carBodies)[number];
export type CarPaint = (typeof carPaints)[number];
export type CarTrim = (typeof carTrims)[number];
export type CarSpoiler = (typeof carSpoilers)[number];
export type SpritePixel = "." | "a" | "b" | "g" | "t" | "w";

export interface CarRecipe {
  readonly body: CarBody;
  readonly paint: CarPaint;
  readonly trim: CarTrim;
  readonly spoiler: CarSpoiler;
}

export interface CarPalette {
  readonly body: string;
  readonly accent: string;
  readonly glass: string;
  readonly trim: string;
  readonly wheel: string;
}

const templates: Readonly<Record<CarBody, readonly string[]>> = {
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

const paints: Readonly<Record<RaceThemeId, Readonly<Record<CarPaint, readonly [string, string]>>>> =
  {
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

const trimColors: Readonly<Record<RaceThemeId, Readonly<Record<CarTrim, string>>>> = {
  "neon-night": { light: "#f7f2ff", dark: "#140d25", chrome: "#9ba7c7" },
  "classic-grand-prix": { light: "#fff9e8", dark: "#17212b", chrome: "#84909b" },
  "cyber-rally": { light: "#edffe8", dark: "#071c1b", chrome: "#7bb49e" },
};

function isEnumValue<const T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

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

export function isCarRecipe(value: unknown): value is CarRecipe {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).sort().join(",") === "body,paint,spoiler,trim" &&
    isEnumValue(carBodies, candidate.body) &&
    isEnumValue(carPaints, candidate.paint) &&
    isEnumValue(carTrims, candidate.trim) &&
    isEnumValue(carSpoilers, candidate.spoiler)
  );
}

export function carRecipeKey(recipe: CarRecipe): string {
  return `${recipe.body}:${recipe.paint}:${recipe.trim}:${recipe.spoiler}`;
}

export function buildCarSprite(recipe: CarRecipe): readonly (readonly SpritePixel[])[] {
  const rows = templates[recipe.body].map((row) => Array.from(row) as SpritePixel[]);
  if (recipe.spoiler === "low") {
    setPixel(rows, 3, 13, "a");
    setPixel(rows, 3, 14, "a");
  } else if (recipe.spoiler === "high") {
    setPixel(rows, 1, 12, "a");
    setPixel(rows, 1, 13, "a");
    setPixel(rows, 2, 13, "a");
  }
  return rows;
}

export function carPalette(recipe: CarRecipe, theme: RaceThemeId): CarPalette {
  const [body, accent] = paints[theme][recipe.paint];
  return {
    body,
    accent,
    glass: theme === "classic-grand-prix" ? "#c9e6f4" : "#77efff",
    trim: trimColors[theme][recipe.trim],
    wheel: "#080a0d",
  };
}

export function serializeCarSprite(recipe: CarRecipe): string {
  return buildCarSprite(recipe)
    .map((row) => row.join(""))
    .join("\n");
}

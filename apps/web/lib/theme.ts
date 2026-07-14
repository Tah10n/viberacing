export const raceThemeIds = ["neon-night", "classic-grand-prix", "cyber-rally"] as const;

export type RaceThemeId = (typeof raceThemeIds)[number];

export interface CanvasTheme {
  readonly sky: string;
  readonly skyline: string;
  readonly window: string;
  readonly road: string;
  readonly lane: string;
  readonly shoulder: string;
  readonly foreground: string;
}

export const canvasThemes: Readonly<Record<RaceThemeId, CanvasTheme>> = {
  "neon-night": {
    sky: "#130b2e",
    skyline: "#241448",
    window: "#55f7ff",
    road: "#201a38",
    lane: "#ffe66d",
    shoulder: "#ff4fc8",
    foreground: "#f7f2ff",
  },
  "classic-grand-prix": {
    sky: "#b9dcff",
    skyline: "#e6d6b8",
    window: "#fff8d8",
    road: "#424750",
    lane: "#fff4b8",
    shoulder: "#d7473f",
    foreground: "#17212b",
  },
  "cyber-rally": {
    sky: "#071c1b",
    skyline: "#123c36",
    window: "#8dff79",
    road: "#172a27",
    lane: "#b7ff44",
    shoulder: "#ff8a3d",
    foreground: "#edffe8",
  },
};

export function isRaceThemeId(value: unknown): value is RaceThemeId {
  return typeof value === "string" && raceThemeIds.includes(value as RaceThemeId);
}

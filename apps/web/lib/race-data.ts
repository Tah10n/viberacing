import "server-only";

import type { CarRecipe } from "./car-recipe";
import type { DemoProfile, PublicRaceParticipant, SyntheticRacePayload } from "./race-types";
import { rankWeeklyScores } from "./scoring";

interface SyntheticFixture {
  readonly car: CarRecipe;
  readonly dailyTokens: readonly number[];
  readonly deviceCount: number;
  readonly freshnessDays: number;
  readonly handle: string;
  readonly id: string;
  readonly sourceCount: number;
  readonly streakDays: number | null;
}

const fixtures: readonly SyntheticFixture[] = [
  {
    id: "neon-otter",
    handle: "neon_otter",
    dailyTokens: [128_000, 141_000, 116_000, 154_000, 133_000, 161_000, 148_000],
    sourceCount: 3,
    deviceCount: 2,
    freshnessDays: 0,
    streakDays: 13,
    car: { body: "formula", paint: "magenta", trim: "chrome", spoiler: "high" },
  },
  {
    id: "syntax-spark",
    handle: "syntax_spark",
    dailyTokens: [105_000, 119_000, 97_000, 131_000, 122_000, 138_000, 127_000],
    sourceCount: 2,
    deviceCount: 1,
    freshnessDays: 0,
    streakDays: 8,
    car: { body: "roadster", paint: "sunburst", trim: "dark", spoiler: "low" },
  },
  {
    id: "demo-driver",
    handle: "demo_driver",
    dailyTokens: [92_000, 111_000, 104_000, 0, 126_000, 139_000, 118_000],
    sourceCount: 2,
    deviceCount: 2,
    freshnessDays: 0,
    streakDays: 3,
    car: { body: "rally", paint: "turbo-blue", trim: "light", spoiler: "high" },
  },
  {
    id: "loop-lantern",
    handle: "loop_lantern",
    dailyTokens: [92_000, 111_000, 104_000, 0, 126_000, 139_000, 118_000],
    sourceCount: 1,
    deviceCount: 1,
    freshnessDays: 1,
    streakDays: null,
    car: { body: "roadster", paint: "mint", trim: "dark", spoiler: "none" },
  },
  {
    id: "pixel-pulse",
    handle: "pixel_pulse",
    dailyTokens: [73_000, 89_000, 0, 95_000, 101_000, 84_000, 110_000],
    sourceCount: 3,
    deviceCount: 2,
    freshnessDays: 0,
    streakDays: 4,
    car: { body: "formula", paint: "redline", trim: "chrome", spoiler: "low" },
  },
  {
    id: "stack-rover",
    handle: "stack_rover",
    dailyTokens: [65_000, 78_000, 82_000, 0, 0, 96_000, 88_000],
    sourceCount: 1,
    deviceCount: 1,
    freshnessDays: 2,
    streakDays: null,
    car: { body: "rally", paint: "sunburst", trim: "light", spoiler: "high" },
  },
  {
    id: "cache-comet",
    handle: "cache_comet",
    dailyTokens: [48_000, 0, 57_000, 61_000, 0, 72_000, 69_000],
    sourceCount: 2,
    deviceCount: 1,
    freshnessDays: 1,
    streakDays: 2,
    car: { body: "roadster", paint: "magenta", trim: "dark", spoiler: "none" },
  },
  {
    id: "debug-dash",
    handle: "debug_dash",
    dailyTokens: [31_000, 44_000, 0, 38_000, 52_000, 0, 55_000],
    sourceCount: 1,
    deviceCount: 1,
    freshnessDays: 3,
    streakDays: null,
    car: { body: "formula", paint: "mint", trim: "chrome", spoiler: "low" },
  },
];

export function getSyntheticRacePayload(): SyntheticRacePayload {
  const scores = rankWeeklyScores(fixtures);
  const fixturesById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const participants: PublicRaceParticipant[] = scores.map((score) => {
    const fixture = fixturesById.get(score.id);
    if (!fixture) {
      throw new Error("synthetic fixture and score identifiers diverged");
    }
    return {
      id: fixture.id,
      handle: fixture.handle,
      car: fixture.car,
      sourceCount: fixture.sourceCount,
      freshnessDays: fixture.freshnessDays,
      streakDays: fixture.streakDays,
      weeklyScore: score.weeklyScore,
      activeDays: score.activeDays,
      rank: score.rank,
    };
  });
  const demo = participants.find((participant) => participant.id === "demo-driver");
  const demoScore = scores.find((score) => score.id === "demo-driver");
  const demoFixture = fixturesById.get("demo-driver");
  if (!demo || !demoScore || !demoFixture) {
    throw new Error("synthetic demo profile is missing");
  }
  const profile: DemoProfile = {
    handle: demo.handle,
    car: demo.car,
    dailyScores: demoScore.dailyScores,
    weeklyScore: demo.weeklyScore,
    sourceCount: demo.sourceCount,
    deviceCount: demoFixture.deviceCount,
  };
  return { participants, profile };
}

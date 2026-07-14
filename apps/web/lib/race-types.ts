import type { CarRecipe } from "./car-recipe";

export interface PublicRaceParticipant {
  readonly activeDays: number;
  readonly car: CarRecipe;
  readonly freshnessDays: number;
  readonly handle: string;
  readonly id: string;
  readonly rank: number;
  readonly sourceCount: number;
  readonly streakDays: number | null;
  readonly weeklyScore: number;
}

export interface DemoProfile {
  readonly car: CarRecipe;
  readonly dailyScores: readonly number[];
  readonly deviceCount: number;
  readonly handle: string;
  readonly sourceCount: number;
  readonly weeklyScore: number;
}

export interface SyntheticRacePayload {
  readonly participants: readonly PublicRaceParticipant[];
  readonly profile: DemoProfile;
}

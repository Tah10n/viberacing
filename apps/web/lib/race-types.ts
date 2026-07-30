import type { LeaderboardSnapshotV1, PublicProfileSummaryV1 } from "@viberacing/contracts";

import type { CarRecipe } from "./car-recipe";

export type PublicLeaderboardParticipant = LeaderboardSnapshotV1["participants"][number];

export type PublicProfileState = "none" | "not-found" | "ready" | "unavailable";

export interface PublicHomePayload {
  readonly leaderboard: LeaderboardSnapshotV1;
  readonly profile: PublicProfileSummaryV1 | null;
  readonly profileState: PublicProfileState;
  readonly source: "community" | "fallback";
}

export interface RaceVisualParticipant {
  readonly car: CarRecipe;
  readonly displayPosition: number;
  readonly handle: string;
  readonly rankPosition: number;
}

import "server-only";

import type { LeaderboardSnapshotV1, PublicProfileSummaryV1 } from "@viberacing/contracts";

import { fallbackCarRecipes } from "./race-visual";
import type { PublicHomePayload, PublicLeaderboardParticipant } from "./race-types";
import { isCommunitySeasonStart } from "./public-season";

const fixtureRows = [
  ["neon_otter", "1081000", 1, 1, 0],
  ["syntax_spark", "939000", 2, 2, 0],
  ["demo_driver", "690000", 3, 3, 0],
  ["loop_lantern", "690000", 3, 4, 1],
  ["pixel_pulse", "552000", 5, 5, 0],
  ["stack_rover", "409000", 6, 6, 2],
  ["cache_comet", "307000", 7, 7, 1],
  ["debug_dash", "220000", 8, 8, 3],
] as const;

function seasonEnd(seasonStart: string): string {
  const date = new Date(`${seasonStart}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 6);
  return date.toISOString().slice(0, 10);
}

function syntheticParticipants(): readonly PublicLeaderboardParticipant[] {
  return Object.freeze(
    fixtureRows.map(
      ([handle, weeklyTokenTotal, rankPosition, displayPosition, freshnessDays], index) =>
        Object.freeze({
          carRecipe: fallbackCarRecipes[index % fallbackCarRecipes.length] ?? fallbackCarRecipes[0],
          displayPosition,
          freshnessDays,
          handle,
          rankPosition,
          weeklyTokenTotal,
        }),
    ),
  );
}

function profileFromParticipant(
  participant: PublicLeaderboardParticipant,
  leaderboard: LeaderboardSnapshotV1,
): PublicProfileSummaryV1 {
  return Object.freeze({
    carRecipe: participant.carRecipe ?? null,
    freshnessDays: participant.freshnessDays,
    handle: participant.handle,
    participantCount: leaderboard.participantCount,
    rankPosition: participant.rankPosition,
    schemaVersion: 1,
    season: Object.freeze({
      seasonEnd: leaderboard.seasonEnd,
      seasonStart: leaderboard.seasonStart,
      seasonState: leaderboard.seasonState,
    }),
    trustTier: "community",
    weeklyTokenTotal: participant.weeklyTokenTotal,
  });
}

export function getSyntheticPublicHomePayload(
  seasonStart: string,
  requestedProfileHandle?: string,
): PublicHomePayload {
  if (!isCommunitySeasonStart(seasonStart)) {
    throw new RangeError("synthetic season must be one canonical UTC Monday");
  }
  const participants = syntheticParticipants();
  const leaderboard: LeaderboardSnapshotV1 = Object.freeze({
    generatedAt: `${seasonStart}T12:00:00.000000Z`,
    metricVersion: "provider_reported_tokens_v1",
    nextPage: null,
    page: 1,
    pageSize: 100,
    participantCount: participants.length,
    participants,
    schemaVersion: 1,
    seasonEnd: seasonEnd(seasonStart),
    seasonStart,
    seasonState: "open",
    snapshotRevision: 1,
    trustTier: "community",
  });
  if (requestedProfileHandle === undefined) {
    return Object.freeze({
      leaderboard,
      profile: null,
      profileState: "none",
      source: "fallback",
    });
  }
  const participant = participants.find((candidate) => candidate.handle === requestedProfileHandle);
  return Object.freeze({
    leaderboard,
    profile: participant === undefined ? null : profileFromParticipant(participant, leaderboard),
    profileState: participant === undefined ? "not-found" : "ready",
    source: "fallback",
  });
}

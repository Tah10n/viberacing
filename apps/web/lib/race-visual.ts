import type { CarRecipe } from "./car-recipe";
import type { PublicLeaderboardParticipant, RaceVisualParticipant } from "./race-types";

export const fallbackCarRecipes = Object.freeze([
  Object.freeze({
    schemaVersion: 1,
    chassis: "formula",
    nose: "wedge",
    cockpit: "canopy",
    wing: "high",
    wheels: "slick",
    palette: "magenta",
    trail: "spark",
    seed: 1101,
  }),
  Object.freeze({
    schemaVersion: 1,
    chassis: "roadster",
    nose: "classic",
    cockpit: "open",
    wing: "low",
    wheels: "street",
    palette: "sunburst",
    trail: "grid",
    seed: 2202,
  }),
  Object.freeze({
    schemaVersion: 1,
    chassis: "rally",
    nose: "scoop",
    cockpit: "rally",
    wing: "high",
    wheels: "all-terrain",
    palette: "turbo-blue",
    trail: "spark",
    seed: 3303,
  }),
  Object.freeze({
    schemaVersion: 1,
    chassis: "roadster",
    nose: "wedge",
    cockpit: "canopy",
    wing: "none",
    wheels: "street",
    palette: "mint",
    trail: "none",
    seed: 4404,
  }),
] as const satisfies readonly CarRecipe[]);

export function toRaceVisualParticipants(
  participants: readonly PublicLeaderboardParticipant[],
): readonly RaceVisualParticipant[] {
  return Object.freeze(
    participants.slice(0, 32).map((participant, index) =>
      Object.freeze({
        car:
          participant.carRecipe ??
          fallbackCarRecipes[index % fallbackCarRecipes.length] ??
          fallbackCarRecipes[0],
        displayPosition: participant.displayPosition,
        handle: participant.handle,
        rankPosition: participant.rankPosition,
      }),
    ),
  );
}

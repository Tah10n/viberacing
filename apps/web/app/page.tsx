import { connection } from "next/server";

import { RaceExperience } from "@/components/race-experience";
import { currentCommunitySeasonStart } from "@/lib/public-community-race";
import { getSyntheticRacePayload } from "@/lib/race-data";

export default async function HomePage() {
  await connection();
  const payload = getSyntheticRacePayload();
  const communitySeasonStart = currentCommunitySeasonStart(new Date());
  return communitySeasonStart === undefined ? (
    <RaceExperience payload={payload} />
  ) : (
    <RaceExperience communitySeasonStart={communitySeasonStart} payload={payload} />
  );
}

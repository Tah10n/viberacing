import { connection } from "next/server";

import { RaceExperience } from "@/components/race-experience";
import { readEnrollmentPageSession } from "@/lib/enrollment-page-session";
import { currentCommunitySeasonStart } from "@/lib/public-community-race";
import { getSyntheticRacePayload } from "@/lib/race-data";

export default async function HomePage() {
  await connection();
  const session = await readEnrollmentPageSession();
  const payload = getSyntheticRacePayload();
  const communitySeasonStart = currentCommunitySeasonStart(new Date());
  return communitySeasonStart === undefined ? (
    <RaceExperience
      accountSessionAvailable={session?.passkeyRegistered === true}
      payload={payload}
    />
  ) : (
    <RaceExperience
      accountSessionAvailable={session?.passkeyRegistered === true}
      communitySeasonStart={communitySeasonStart}
      payload={payload}
    />
  );
}

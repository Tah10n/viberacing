import { connection } from "next/server";

import { RaceExperience } from "@/components/race-experience";
import { readEnrollmentPageSession } from "@/lib/enrollment-page-session";
import { currentCommunitySeasonStart, isPublicCommunityHandle } from "@/lib/public-community-race";
import { getSyntheticRacePayload } from "@/lib/race-data";

interface HomePageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  await connection();
  const [session, parameters] = await Promise.all([readEnrollmentPageSession(), searchParams]);
  const payload = getSyntheticRacePayload();
  const communitySeasonStart = currentCommunitySeasonStart(new Date());
  const profileHandle = isPublicCommunityHandle(parameters.profile)
    ? parameters.profile
    : undefined;
  return communitySeasonStart === undefined ? (
    <RaceExperience
      accountSessionAvailable={session?.passkeyRegistered === true}
      payload={payload}
      profileHandle={profileHandle}
    />
  ) : (
    <RaceExperience
      accountSessionAvailable={session?.passkeyRegistered === true}
      communitySeasonStart={communitySeasonStart}
      payload={payload}
      profileHandle={profileHandle}
    />
  );
}

import type { Metadata } from "next";
import { connection } from "next/server";

import { RaceExperience } from "@/components/race-experience";
import { readEnrollmentPageSession } from "@/lib/enrollment-page-session";
import { currentCommunitySeasonStart, isPublicSnapshotHandle } from "@/lib/public-snapshot-client";
import { getSyntheticRacePayload } from "@/lib/race-data";

interface HomePageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default async function HomePage({ searchParams }: HomePageProps) {
  await connection();
  const [session, parameters] = await Promise.all([readEnrollmentPageSession(), searchParams]);
  const payload = getSyntheticRacePayload();
  const communitySeasonStart = currentCommunitySeasonStart(new Date());
  const profileHandle = isPublicSnapshotHandle(parameters.profile) ? parameters.profile : undefined;
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

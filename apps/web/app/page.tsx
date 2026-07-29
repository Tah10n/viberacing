import type { Metadata } from "next";
import { connection } from "next/server";

import { RaceExperience } from "@/components/race-experience";
import { readEnrollmentPageSession } from "@/lib/enrollment-page-session";
import { loadConfiguredPublicHomeSnapshot } from "@/lib/public-home-snapshot";
import { currentCommunitySeasonStart, isPublicSnapshotHandle } from "@/lib/public-season";
import { getSyntheticPublicHomePayload } from "@/lib/race-data";

interface HomePageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default async function HomePage({ searchParams }: HomePageProps) {
  await connection();
  const [session, parameters] = await Promise.all([readEnrollmentPageSession(), searchParams]);
  const communitySeasonStart = currentCommunitySeasonStart(new Date());
  const profileHandle = isPublicSnapshotHandle(parameters.profile) ? parameters.profile : undefined;
  const fallbackSeasonStart = communitySeasonStart ?? "1999-12-27";
  const payload =
    communitySeasonStart === undefined
      ? undefined
      : await loadConfiguredPublicHomeSnapshot(communitySeasonStart, profileHandle);
  return (
    <RaceExperience
      accountSessionAvailable={session?.passkeyRegistered === true}
      payload={payload ?? getSyntheticPublicHomePayload(fallbackSeasonStart, profileHandle)}
      profileHandle={profileHandle}
    />
  );
}

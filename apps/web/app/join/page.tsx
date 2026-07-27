import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { JoinExperience } from "@/components/join-experience";
import { resolveEnrollmentEnableConfig } from "@/lib/enrollment-enable-config";
import { readEnrollmentPageSession } from "@/lib/enrollment-page-session";

export const metadata: Metadata = {
  description: "Join the self-reported Vibe Racing Community leaderboard with an invite.",
  robots: { follow: false, index: false },
  title: "Join",
};

const enrollmentConfig = resolveEnrollmentEnableConfig();

interface JoinPageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}

export default async function JoinPage({ searchParams }: JoinPageProps) {
  const session = await readEnrollmentPageSession();
  if (session?.passkeyRegistered) {
    redirect("/account");
  }
  if (session !== undefined) {
    redirect("/join/passkey");
  }
  const errorValue = (await searchParams).error;
  const error = errorValue === "invalid" || errorValue === "unavailable" ? errorValue : undefined;
  return error === undefined ? (
    <JoinExperience enrollmentEnabled={enrollmentConfig.enabled} />
  ) : (
    <JoinExperience enrollmentEnabled={enrollmentConfig.enabled} error={error} />
  );
}

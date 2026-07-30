import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { JoinExperience } from "@/components/join-experience";
import { resolveEnrollmentEnableConfig } from "@/lib/enrollment-enable-config";
import { readEnrollmentPageSession } from "@/lib/enrollment-page-session";
import { resolveInviteGateConfig } from "@/lib/invite-gate-config";

export const metadata: Metadata = {
  description:
    "Join the self-reported Vibe Racing Community leaderboard with GitHub and a passkey.",
  robots: { follow: false, index: false },
  title: "Join",
};

const enrollmentConfig = resolveEnrollmentEnableConfig();
const inviteGateConfig = resolveInviteGateConfig();

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
    <JoinExperience
      enrollmentEnabled={enrollmentConfig.enabled}
      inviteGateEnabled={inviteGateConfig.enabled}
    />
  ) : (
    <JoinExperience
      enrollmentEnabled={enrollmentConfig.enabled}
      error={error}
      inviteGateEnabled={inviteGateConfig.enabled}
    />
  );
}

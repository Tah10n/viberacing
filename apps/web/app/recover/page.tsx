import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RecoveryExperience } from "@/components/passkey-setup";
import { readEnrollmentPageSession } from "@/lib/enrollment-page-session";

export const metadata: Metadata = {
  description: "Recover a Vibe Racing profile by registering a replacement passkey.",
  title: "Recover profile | Vibe Racing",
};

export default async function RecoveryPage() {
  const session = await readEnrollmentPageSession();
  if (session?.passkeyRegistered) {
    redirect("/account");
  }
  if (session !== undefined) {
    redirect("/join/passkey");
  }
  return <RecoveryExperience />;
}

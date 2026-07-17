import type { Metadata } from "next";

import { ConnectExperience } from "@/components/connect-experience";
import { readEnrollmentPageSession } from "@/lib/enrollment-page-session";

export const metadata: Metadata = {
  description: "Review and approve one Vibe Racing connector device with a passkey.",
  title: "Connect a device | Vibe Racing",
};

export default async function ConnectPage() {
  const session = await readEnrollmentPageSession();
  return (
    <ConnectExperience
      initialLocale={session?.locale ?? "en"}
      signedIn={session?.passkeyRegistered === true}
    />
  );
}

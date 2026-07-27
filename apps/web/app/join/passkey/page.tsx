import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PasskeySetup } from "@/components/passkey-setup";
import { resolveEnrollmentEnableConfig } from "@/lib/enrollment-enable-config";
import { readEnrollmentPageSession } from "@/lib/enrollment-page-session";

export const metadata: Metadata = {
  description: "Protect a Vibe Racing profile with a WebAuthn passkey.",
  robots: { follow: false, index: false },
  title: "Create passkey",
};

const enrollmentConfig = resolveEnrollmentEnableConfig();

export default async function PasskeyPage() {
  const session = await readEnrollmentPageSession();
  if (session === undefined) {
    redirect("/join?error=unavailable");
  }
  if (session.passkeyRegistered) {
    redirect("/account");
  }
  return (
    <PasskeySetup
      enrollmentEnabled={enrollmentConfig.enabled}
      handle={session.handle}
      locale={session.locale}
    />
  );
}

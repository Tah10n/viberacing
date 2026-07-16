import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PasskeySetup } from "@/components/passkey-setup";
import { readEnrollmentPageSession } from "@/lib/enrollment-page-session";

export const metadata: Metadata = {
  description: "Protect a Vibe Racing profile with a WebAuthn passkey.",
  title: "Create passkey | Vibe Racing",
};

export default async function PasskeyPage() {
  const session = await readEnrollmentPageSession();
  if (session === undefined) {
    redirect("/join?error=unavailable");
  }
  if (session.passkeyRegistered) {
    redirect("/account");
  }
  return <PasskeySetup handle={session.handle} locale={session.locale} />;
}

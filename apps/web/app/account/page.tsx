import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AccountExperience } from "@/components/account-experience";
import { readEnrollmentPageAccount } from "@/lib/enrollment-page-session";

export const metadata: Metadata = {
  description: "Manage a protected Vibe Racing Community profile.",
  title: "Account | Vibe Racing",
};

export default async function AccountPage() {
  const account = await readEnrollmentPageAccount();
  if (!account?.session.passkeyRegistered) {
    redirect("/login?error=unavailable");
  }
  const { passkeys, session } = account;
  return <AccountExperience handle={session.handle} locale={session.locale} passkeys={passkeys} />;
}

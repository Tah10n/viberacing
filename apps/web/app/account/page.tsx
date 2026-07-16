import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AccountExperience } from "@/components/account-experience";
import { readEnrollmentPageAccount } from "@/lib/enrollment-page-session";

export const metadata: Metadata = {
  description: "Manage a protected Vibe Racing Community profile.",
  title: "Account | Vibe Racing",
};

interface AccountPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AccountPage({ searchParams }: AccountPageProps) {
  const account = await readEnrollmentPageAccount();
  if (!account?.session.passkeyRegistered) {
    redirect("/login?error=unavailable");
  }
  const parameters = await searchParams;
  const { activeDeviceInventory, passkeys, session, visibility } = account;
  return (
    <AccountExperience
      actionUnavailable={parameters.error === "unavailable"}
      activeDeviceInventory={activeDeviceInventory}
      handle={session.handle}
      locale={session.locale}
      passkeys={passkeys}
      visibility={visibility}
    />
  );
}

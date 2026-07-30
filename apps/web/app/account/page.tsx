import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AccountExperience } from "@/components/account-experience";
import { resolveCarProposalsConfig } from "@/lib/car-proposals-config";
import { readEnrollmentPageAccount } from "@/lib/enrollment-page-session";

export const metadata: Metadata = {
  description: "Manage a protected Vibe Racing Community profile.",
  robots: { follow: false, index: false },
  title: "Account",
};

const carProposalsConfig = resolveCarProposalsConfig();

interface AccountPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AccountPage({ searchParams }: AccountPageProps) {
  const account = await readEnrollmentPageAccount();
  if (!account?.session.passkeyRegistered) {
    redirect("/login?error=unavailable");
  }
  const parameters = await searchParams;
  const { carRecipeState, dashboard, passkeys, session } = account;
  return (
    <AccountExperience
      actionUnavailable={parameters.error === "unavailable"}
      carProposalsEnabled={carProposalsConfig.enabled}
      carRecipeState={carRecipeState}
      dashboard={dashboard}
      handle={session.handle}
      locale={session.locale}
      passkeys={passkeys}
    />
  );
}

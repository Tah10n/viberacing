import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PasskeyLogin } from "@/components/passkey-setup";
import { readEnrollmentPageSession } from "@/lib/enrollment-page-session";

export const metadata: Metadata = {
  description: "Sign in to Vibe Racing with a registered passkey.",
  robots: { follow: false, index: false },
  title: "Sign in",
};

interface LoginPageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}

function loginReturnTo(value: string | string[] | undefined): string {
  return typeof value === "string" &&
    /^\/connect\?code=[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}$/.test(value)
    ? value
    : "/account";
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const [session, parameters] = await Promise.all([readEnrollmentPageSession(), searchParams]);
  const returnTo = loginReturnTo(parameters.returnTo);
  if (session?.passkeyRegistered) {
    redirect(returnTo);
  }
  if (session !== undefined) {
    redirect("/join/passkey");
  }
  return <PasskeyLogin initialError={parameters.error === "unavailable"} returnTo={returnTo} />;
}

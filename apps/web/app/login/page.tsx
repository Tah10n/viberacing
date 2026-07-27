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

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await readEnrollmentPageSession();
  if (session?.passkeyRegistered) {
    redirect("/account");
  }
  if (session !== undefined) {
    redirect("/join/passkey");
  }
  const error = (await searchParams).error === "unavailable";
  return <PasskeyLogin initialError={error} />;
}

import type { Metadata } from "next";

import { ConnectExperience } from "@/components/connect-experience";
import { readEnrollmentPageConnect } from "@/lib/enrollment-page-session";

export const metadata: Metadata = {
  description:
    "Review one Vibe Racing connector installation and approve its discovered agent accounts.",
  robots: { follow: false, index: false },
  title: "Connect a device",
};

interface ConnectPageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}

export default async function ConnectPage({ searchParams }: ConnectPageProps) {
  const [connect, parameters] = await Promise.all([readEnrollmentPageConnect(), searchParams]);
  const code = parameters.code;
  const initialCode =
    typeof code === "string" && /^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}$/.test(code)
      ? code
      : undefined;
  return (
    <ConnectExperience
      {...(initialCode === undefined ? {} : { initialCode })}
      initialLocale={connect?.session.locale ?? "en"}
      signedIn={connect?.session.passkeyRegistered === true}
    />
  );
}

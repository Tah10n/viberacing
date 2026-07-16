import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { readEnrollmentPageSession } from "@/lib/enrollment-page-session";
import { joinTranslations } from "@/lib/join-i18n";

export const metadata: Metadata = {
  description: "Manage a protected Vibe Racing Community profile.",
  title: "Account | Vibe Racing",
};

export default async function AccountPage() {
  const session = await readEnrollmentPageSession();
  if (!session?.passkeyRegistered) {
    redirect("/login?error=unavailable");
  }
  const copy = joinTranslations[session.locale];
  return (
    <main className="auth-shell" lang={session.locale}>
      <section aria-labelledby="account-title" className="auth-card">
        <Link className="auth-brand" href="/">
          <span aria-hidden="true">▰</span> {copy.brand}
        </Link>
        <p className="eyebrow">Community · self-reported</p>
        <h1 id="account-title">{copy.accountTitle}</h1>
        <p className="account-handle">@{session.handle}</p>
        <p>{copy.accountCopy}</p>
        <form action="/auth/logout" method="post">
          <button className="secondary-action" type="submit">
            {copy.logout}
          </button>
        </form>
        <Link href="/">← {copy.backToRace}</Link>
      </section>
    </main>
  );
}

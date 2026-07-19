"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { connectTranslations } from "@/lib/connect-i18n";
import type { Locale } from "@/lib/i18n";

import { PairingApprovalForm, type PairingExistingSourceChoice } from "./passkey-setup";

interface ConnectExperienceProps {
  readonly existingSources?: readonly PairingExistingSourceChoice[];
  readonly initialLocale: Locale;
  readonly signedIn: boolean;
  readonly sourceCreationEnabled: boolean;
}

export function ConnectExperience({
  existingSources,
  initialLocale,
  signedIn,
  sourceCreationEnabled,
}: ConnectExperienceProps) {
  const [locale, setLocale] = useState(initialLocale);
  const copy = connectTranslations[locale];

  useEffect(() => {
    try {
      const stored = localStorage.getItem("viberacing.locale");
      if (stored === "en" || stored === "ru") {
        setLocale(stored);
      }
    } catch {
      // The page keeps its server-selected locale when device preferences are unavailable.
    }
  }, []);

  function selectLocale(nextLocale: Locale): void {
    setLocale(nextLocale);
    try {
      localStorage.setItem("viberacing.locale", nextLocale);
    } catch {
      // Locale switching remains usable without device persistence.
    }
  }

  return (
    <main className="auth-shell" lang={locale}>
      <section aria-labelledby="connect-title" className="auth-card">
        <Link className="auth-brand" href="/">
          <span aria-hidden="true">▰</span> {copy.brand}
        </Link>
        <div aria-label={copy.language} className="auth-language" role="group">
          {(["en", "ru"] as const).map((value) => (
            <button
              aria-pressed={locale === value}
              key={value}
              onClick={() => {
                selectLocale(value);
              }}
              type="button"
            >
              {value === "en" ? "English" : "Русский"}
            </button>
          ))}
        </div>
        <p className="eyebrow">Community · self-reported</p>
        <h1 id="connect-title">{copy.title}</h1>
        <p>{copy.copy}</p>
        <ol className="connect-steps">
          <li>{copy.stepCode}</li>
          <li>{copy.stepReview}</li>
          <li>{copy.stepVerify}</li>
        </ol>
        <p className="auth-error" role="note">
          {copy.noRelease}
        </p>
        {signedIn ? (
          <PairingApprovalForm
            {...(existingSources === undefined ? {} : { existingSources })}
            locale={locale}
            sourceCreationEnabled={sourceCreationEnabled}
          />
        ) : (
          <section aria-labelledby="pairing-sign-in-title" className="account-security">
            <h2 id="pairing-sign-in-title">{copy.signIn}</h2>
            <p>{copy.signedOut}</p>
            <Link href="/login">{copy.signIn}</Link>
          </section>
        )}
        <nav aria-label={copy.backToRace} className="connect-links">
          {signedIn ? <Link href="/account">← {copy.backToAccount}</Link> : null}
          <Link href="/">← {copy.backToRace}</Link>
        </nav>
      </section>
    </main>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { isLocale, type Locale } from "@/lib/i18n";
import { joinTranslations } from "@/lib/join-i18n";

interface JoinExperienceProps {
  readonly enrollmentEnabled?: boolean;
  readonly error?: "invalid" | "unavailable";
  readonly inviteGateEnabled?: boolean;
}

export function JoinExperience({
  enrollmentEnabled = false,
  error,
  inviteGateEnabled = false,
}: JoinExperienceProps) {
  const [locale, setLocale] = useState<Locale>("en");
  const copy = joinTranslations[locale];

  useEffect(() => {
    try {
      const storedLocale = localStorage.getItem("viberacing.locale");
      if (isLocale(storedLocale)) {
        setLocale(storedLocale);
      }
    } catch {
      // The form has safe defaults when device-local preferences are blocked.
    }
  }, []);

  function selectLocale(nextLocale: Locale): void {
    setLocale(nextLocale);
    try {
      localStorage.setItem("viberacing.locale", nextLocale);
    } catch {
      // Locale persistence is optional.
    }
  }

  return (
    <main className="auth-shell" lang={locale}>
      <section aria-labelledby="join-title" className="auth-card">
        <Link className="auth-brand" href="/">
          <span aria-hidden="true">▰</span> {copy.brand}
        </Link>
        <div aria-label={copy.language} className="auth-language">
          <button
            aria-pressed={locale === "en"}
            onClick={() => {
              selectLocale("en");
            }}
            type="button"
          >
            {copy.english}
          </button>
          <button
            aria-pressed={locale === "ru"}
            onClick={() => {
              selectLocale("ru");
            }}
            type="button"
          >
            {copy.russian}
          </button>
        </div>
        <p className="eyebrow">Community · self-reported</p>
        <h1 id="join-title">{copy.joinTitle}</h1>
        <p>{inviteGateEnabled ? copy.joinInviteCopy : copy.joinCopy}</p>
        {error === undefined ? null : (
          <p className="auth-error" role="alert">
            {copy.genericError}
          </p>
        )}
        {enrollmentEnabled ? (
          <form action="/auth/github/start" className="auth-form" method="post">
            <input name="locale" type="hidden" value={locale} />
            {inviteGateEnabled ? (
              <label>
                <span>{copy.inviteLabel}</span>
                <input
                  autoComplete="one-time-code"
                  maxLength={84}
                  minLength={84}
                  name="inviteCode"
                  required
                  spellCheck={false}
                />
                <small>{copy.inviteHint}</small>
              </label>
            ) : null}
            <button className="primary-action" type="submit">
              {copy.continueGithub}
            </button>
          </form>
        ) : (
          <p className="auth-status" role="status">
            {copy.enrollmentUnavailable}
          </p>
        )}
        <p>
          {copy.alreadyRacing} <Link href="/login">{copy.signIn}</Link>
        </p>
        <p className="auth-privacy">{copy.privacyNote}</p>
        <Link href="/">← {copy.backToRace}</Link>
      </section>
    </main>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { isLocale, type Locale } from "@/lib/i18n";
import { joinTranslations } from "@/lib/join-i18n";
import { isRaceThemeId, type RaceThemeId } from "@/lib/theme";

type MotionPreference = "off" | "on" | "system";

interface JoinExperienceProps {
  readonly enrollmentEnabled?: boolean;
  readonly error?: "invalid" | "unavailable";
}

function isMotionPreference(value: unknown): value is MotionPreference {
  return value === "off" || value === "on" || value === "system";
}

export function JoinExperience({ enrollmentEnabled = false, error }: JoinExperienceProps) {
  const [locale, setLocale] = useState<Locale>("en");
  const [theme, setTheme] = useState<RaceThemeId>("neon-night");
  const [motion, setMotion] = useState<MotionPreference>("system");
  const copy = joinTranslations[locale];

  useEffect(() => {
    try {
      const storedLocale = localStorage.getItem("viberacing.locale");
      const storedTheme = localStorage.getItem("viberacing.theme");
      const storedMotion = localStorage.getItem("viberacing.motion");
      if (isLocale(storedLocale)) {
        setLocale(storedLocale);
      }
      if (isRaceThemeId(storedTheme)) {
        setTheme(storedTheme);
      }
      if (isMotionPreference(storedMotion)) {
        setMotion(storedMotion);
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
        <p>{copy.joinCopy}</p>
        {error === undefined ? null : (
          <p className="auth-error" role="alert">
            {copy.genericError}
          </p>
        )}
        {enrollmentEnabled ? (
          <form action="/auth/github/start" className="auth-form" method="post">
            <input name="locale" type="hidden" value={locale} />
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
            <label>
              <span>{copy.handleLabel}</span>
              <input
                autoComplete="nickname"
                maxLength={24}
                minLength={3}
                name="handle"
                pattern="[a-z0-9][a-z0-9_-]{1,22}[a-z0-9]"
                required
                spellCheck={false}
              />
              <small>{copy.handleHint}</small>
            </label>
            <label>
              <span>{copy.theme}</span>
              <select
                name="theme"
                onChange={(event) => {
                  setTheme(event.target.value as RaceThemeId);
                }}
                value={theme}
              >
                <option value="neon-night">{copy.themeNeon}</option>
                <option value="classic-grand-prix">{copy.themeClassic}</option>
                <option value="cyber-rally">{copy.themeCyber}</option>
              </select>
            </label>
            <label>
              <span>{copy.motion}</span>
              <select
                name="motionPreference"
                onChange={(event) => {
                  setMotion(event.target.value as MotionPreference);
                }}
                value={motion}
              >
                <option value="system">{copy.motionSystem}</option>
                <option value="on">{copy.motionOn}</option>
                <option value="off">{copy.motionOff}</option>
              </select>
            </label>
            <label>
              <span>{copy.streakVisibility}</span>
              <select defaultValue="false" name="streakVisible">
                <option value="false">{copy.streakHidden}</option>
                <option value="true">{copy.streakVisible}</option>
              </select>
            </label>
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

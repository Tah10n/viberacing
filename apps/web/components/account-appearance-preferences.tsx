"use client";

import { useEffect, useState } from "react";

import type { Locale } from "@/lib/i18n";
import { joinTranslations } from "@/lib/join-i18n";
import { isRaceThemeId, raceThemeIds, type RaceThemeId } from "@/lib/theme";

type MotionPreference = "system" | "on" | "off";

const storageKeys = {
  motion: "viberacing.motion",
  theme: "viberacing.theme",
} as const;

function isMotionPreference(value: unknown): value is MotionPreference {
  return value === "system" || value === "on" || value === "off";
}

interface AccountAppearancePreferencesProps {
  readonly locale: Locale;
}

export function AccountAppearancePreferences({ locale }: AccountAppearancePreferencesProps) {
  const copy = joinTranslations[locale];
  const [theme, setTheme] = useState<RaceThemeId>("neon-night");
  const [motion, setMotion] = useState<MotionPreference>("system");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const storedTheme = localStorage.getItem(storageKeys.theme);
      const storedMotion = localStorage.getItem(storageKeys.motion);
      if (isRaceThemeId(storedTheme)) {
        setTheme(storedTheme);
      }
      if (isMotionPreference(storedMotion)) {
        setMotion(storedMotion);
      }
    } catch {
      // Device-local preferences are optional.
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) {
      return;
    }
    try {
      localStorage.setItem(storageKeys.theme, theme);
      localStorage.setItem(storageKeys.motion, motion);
    } catch {
      // Rendering does not depend on storage availability.
    }
  }, [loaded, motion, theme]);

  const themeLabels: Readonly<Record<RaceThemeId, string>> = {
    "classic-grand-prix": copy.themeClassic,
    "cyber-rally": copy.themeCyber,
    "neon-night": copy.themeNeon,
  };
  const motionLabels: Readonly<Record<MotionPreference, string>> = {
    off: copy.motionOff,
    on: copy.motionOn,
    system: copy.motionSystem,
  };

  return (
    <div className="account-preferences">
      <h3>{copy.deviceLocalAppearanceTitle}</h3>
      <p>{copy.deviceLocalAppearanceCopy}</p>
      <label>
        <span>{copy.theme}</span>
        <select
          onChange={(event) => {
            if (isRaceThemeId(event.currentTarget.value)) {
              setTheme(event.currentTarget.value);
            }
          }}
          value={theme}
        >
          {raceThemeIds.map((themeId) => (
            <option key={themeId} value={themeId}>
              {themeLabels[themeId]}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{copy.motion}</span>
        <select
          onChange={(event) => {
            if (isMotionPreference(event.currentTarget.value)) {
              setMotion(event.currentTarget.value);
            }
          }}
          value={motion}
        >
          {(["system", "on", "off"] as const).map((preference) => (
            <option key={preference} value={preference}>
              {motionLabels[preference]}
            </option>
          ))}
        </select>
      </label>
      <p aria-live="polite" className="sr-only">
        {themeLabels[theme]}; {motionLabels[motion]}
      </p>
    </div>
  );
}

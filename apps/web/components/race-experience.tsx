"use client";

import { useEffect, useId, useState } from "react";

import { PixelRaceCanvas } from "@/components/pixel-race-canvas";
import { carRecipeKey } from "@/lib/car-recipe";
import {
  dayLabels,
  formatCarPart,
  formatDayCount,
  formatFreshness,
  formatScore,
  isLocale,
  translations,
  type Locale,
} from "@/lib/i18n";
import { loadPublicCommunityRace } from "@/lib/public-community-race";
import type { PublicRaceParticipant, SyntheticRacePayload } from "@/lib/race-types";
import { isRaceThemeId, raceThemeIds, type RaceThemeId } from "@/lib/theme";

type MotionPreference = "system" | "on" | "off";
type ScoreSource = "community" | "fallback" | "synthetic";

type ScoreState =
  | Readonly<{ participants: readonly PublicRaceParticipant[]; source: "community" }>
  | Readonly<{ source: Exclude<ScoreSource, "community"> }>;

interface RaceExperienceProps {
  readonly communitySeasonStart?: string;
  readonly payload: SyntheticRacePayload;
}

const storageKeys = {
  locale: "viberacing.locale",
  motion: "viberacing.motion",
  theme: "viberacing.theme",
} as const;

function isMotionPreference(value: unknown): value is MotionPreference {
  return value === "system" || value === "on" || value === "off";
}

export function RaceExperience({ communitySeasonStart, payload }: RaceExperienceProps) {
  const [locale, setLocale] = useState<Locale>("en");
  const [theme, setTheme] = useState<RaceThemeId>("neon-night");
  const [motionPreference, setMotionPreference] = useState<MotionPreference>("system");
  const [systemReducedMotion, setSystemReducedMotion] = useState(false);
  const [racePaused, setRacePaused] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [scoreState, setScoreState] = useState<ScoreState>({ source: "synthetic" });
  const controlGroupId = useId();
  const translation = translations[locale];

  useEffect(() => {
    try {
      const storedLocale = localStorage.getItem(storageKeys.locale);
      const storedTheme = localStorage.getItem(storageKeys.theme);
      const storedMotion = localStorage.getItem(storageKeys.motion);
      if (isLocale(storedLocale)) {
        setLocale(storedLocale);
      }
      if (isRaceThemeId(storedTheme)) {
        setTheme(storedTheme);
      }
      if (isMotionPreference(storedMotion)) {
        setMotionPreference(storedMotion);
      }
    } catch {
      // Device-local preferences are optional; the privacy-safe defaults remain usable.
    }

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => {
      setSystemReducedMotion(media.matches);
    };
    updateMotion();
    media.addEventListener("change", updateMotion);
    setSettingsLoaded(true);
    return () => {
      media.removeEventListener("change", updateMotion);
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    if (!settingsLoaded) {
      return;
    }
    try {
      localStorage.setItem(storageKeys.locale, locale);
      localStorage.setItem(storageKeys.theme, theme);
      localStorage.setItem(storageKeys.motion, motionPreference);
    } catch {
      // Rendering never depends on storage availability.
    }
  }, [locale, motionPreference, settingsLoaded, theme]);

  useEffect(() => {
    if (communitySeasonStart === undefined) {
      return undefined;
    }
    const controller = new AbortController();
    void loadPublicCommunityRace(communitySeasonStart, controller.signal).then((participants) => {
      if (controller.signal.aborted) {
        return;
      }
      setScoreState(
        participants === undefined ? { source: "fallback" } : { participants, source: "community" },
      );
    });
    return () => {
      controller.abort();
    };
  }, [communitySeasonStart]);

  const motionEnabled =
    motionPreference === "on" || (motionPreference === "system" && !systemReducedMotion);
  const canvasAnimated = motionEnabled && !racePaused;
  const participants =
    scoreState.source === "community" ? scoreState.participants : payload.participants;
  const rankCounts = new Map<number, number>();
  for (const participant of participants) {
    rankCounts.set(participant.rank, (rankCounts.get(participant.rank) ?? 0) + 1);
  }
  const themeLabels: Record<RaceThemeId, string> = {
    "classic-grand-prix": translation.themeClassic,
    "cyber-rally": translation.themeCyber,
    "neon-night": translation.themeNeon,
  };
  const motionLabels: Record<MotionPreference, string> = {
    off: translation.motionOff,
    on: translation.motionOn,
    system: translation.motionSystem,
  };
  const days = dayLabels(locale);
  const scoreSourceLabels: Record<ScoreSource, string> = {
    community: translation.communityDataBadge,
    fallback: translation.fallbackBadge,
    synthetic: translation.demoBadge,
  };
  const weekLabel =
    scoreState.source === "community" ? translation.communityWeek : translation.currentWeek;

  return (
    <div
      className="race-app"
      data-motion={motionEnabled ? "on" : "off"}
      data-score-source={scoreState.source === "community" ? "community" : "synthetic"}
      data-theme={theme}
    >
      <a className="skip-link" href="#leaderboard">
        {translation.viewLeaderboard}
      </a>

      <header className="site-header">
        <a aria-label={translation.brand} className="brand-lockup" href="#top">
          <span aria-hidden="true" className="brand-pixels">
            VR
          </span>
          <span>{translation.brand}</span>
        </a>
        <span aria-live="polite" className="demo-badge">
          {scoreSourceLabels[scoreState.source]}
        </span>
        <nav aria-label={translation.primaryNavigation} className="site-nav">
          <a href="#race">{translation.liveRace}</a>
          <a href="#leaderboard">{translation.leaderboard}</a>
          <a href="#profile">{translation.profile}</a>
          <a href="/join">{translation.joinRace}</a>
        </nav>
      </header>

      <main id="top">
        <section aria-labelledby="hero-title" className="hero-section">
          <div className="hero-copy">
            <p className="eyebrow">{weekLabel}</p>
            <h1 id="hero-title">{translation.heroTitle}</h1>
            <p className="hero-lede">{translation.heroCopy}</p>
            <div className="hero-actions">
              <a className="primary-action" href="#leaderboard">
                {translation.viewLeaderboard}
              </a>
              <span>{translation.noRawTokens}</span>
            </div>
          </div>
          <aside aria-label={translation.communityNotice} className="trust-banner">
            <strong>{translation.communityNotice}</strong>
            <p>{translation.communityDetail}</p>
            <p>{translation.noGlobalClaim}</p>
          </aside>
        </section>

        <section aria-labelledby="race-heading" className="race-section" id="race">
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">{weekLabel}</p>
              <h2 id="race-heading">{translation.liveRace}</h2>
            </div>
            <button
              aria-pressed={racePaused}
              className="pixel-button"
              onClick={() => {
                setRacePaused((paused) => !paused);
              }}
              type="button"
            >
              {racePaused ? translation.resumeRace : translation.pauseRace}
            </button>
          </div>

          <div className="race-console">
            <PixelRaceCanvas
              animate={canvasAnimated}
              description={`${translation.liveRace}. ${translation.communityDetail}`}
              participants={participants}
              theme={theme}
            />
            <div aria-labelledby={controlGroupId} className="race-controls">
              <h3 id={controlGroupId}>{translation.privacyByDefault}</h3>
              <p>{translation.exactTokensPrivate}</p>
              <label>
                <span>{translation.theme}</span>
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
                <span>{translation.language}</span>
                <select
                  onChange={(event) => {
                    if (isLocale(event.currentTarget.value)) {
                      setLocale(event.currentTarget.value);
                    }
                  }}
                  value={locale}
                >
                  <option value="en">English</option>
                  <option value="ru">Русский</option>
                </select>
              </label>
              <label>
                <span>{translation.motion}</span>
                <select
                  onChange={(event) => {
                    if (isMotionPreference(event.currentTarget.value)) {
                      setMotionPreference(event.currentTarget.value);
                    }
                  }}
                  value={motionPreference}
                >
                  {(["system", "on", "off"] as const).map((preference) => (
                    <option key={preference} value={preference}>
                      {motionLabels[preference]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <p aria-live="polite" className="sr-only">
            {themeLabels[theme]}; {motionLabels[motionPreference]}
          </p>
        </section>

        <section
          aria-labelledby="leaderboard-heading"
          className="leaderboard-section"
          id="leaderboard"
        >
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">{translation.communityNotice}</p>
              <h2 id="leaderboard-heading">{translation.leaderboard}</h2>
            </div>
            <span className="score-cap">MAX 7,000 {translation.points}</span>
          </div>
          <div className="table-region" tabIndex={0}>
            <table>
              <caption className="sr-only">
                {translation.communityNotice}: {translation.leaderboard}.{" "}
                {translation.communityDetail}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{translation.rank}</th>
                  <th scope="col">{translation.driver}</th>
                  <th scope="col">{translation.car}</th>
                  <th scope="col">{translation.score}</th>
                  <th scope="col">{translation.activeDays}</th>
                  <th scope="col">{translation.streak}</th>
                  <th scope="col">{translation.freshness}</th>
                  <th scope="col">{translation.sourceCount}</th>
                </tr>
              </thead>
              <tbody>
                {participants.map((participant) => {
                  const sharedRank = (rankCounts.get(participant.rank) ?? 0) > 1;
                  return (
                    <tr
                      className={participant.id === "demo-driver" ? "current-driver" : undefined}
                      key={participant.id}
                    >
                      <td>
                        <span aria-hidden="true">#{participant.rank}</span>
                        <span className="sr-only">
                          {participant.rank}. {sharedRank ? translation.sharedRank : ""}
                        </span>
                      </td>
                      <th scope="row">{participant.handle}</th>
                      <td>
                        {scoreState.source === "community" ? (
                          translation.visualMarker
                        ) : (
                          <span className="car-swatch" data-paint={participant.car.paint}>
                            <span aria-hidden="true">■</span>{" "}
                            {formatCarPart(participant.car.body, locale)}
                          </span>
                        )}
                      </td>
                      <td className="numeric-cell">
                        {formatScore(participant.weeklyScore, locale)} {translation.points}
                      </td>
                      <td>{participant.activeDays}/7</td>
                      <td>
                        {participant.streakDays === null
                          ? translation.streakUnavailable
                          : formatDayCount(participant.streakDays, locale)}
                      </td>
                      <td>{formatFreshness(participant.freshnessDays, locale)}</td>
                      <td>{participant.sourceCount}</td>
                    </tr>
                  );
                })}
                {participants.length === 0 ? (
                  <tr>
                    <td colSpan={8}>{translation.noParticipants}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="profile-heading" className="profile-section" id="profile">
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">{translation.demoBadge}</p>
              <h2 id="profile-heading">{translation.demoProfile}</h2>
            </div>
            <strong>{payload.profile.handle}</strong>
          </div>

          <div className="profile-grid">
            <article className="score-panel">
              <h3>{translation.score}</h3>
              <strong className="large-score">
                {formatScore(payload.profile.weeklyScore, locale)} {translation.points}
              </strong>
              <div className="daily-bars">
                {payload.profile.dailyScores.map((score, index) => {
                  const day = days[index] ?? String(index + 1);
                  return (
                    <label key={day}>
                      <span>{day}</span>
                      <progress
                        aria-label={`${day}: ${formatScore(score, locale)} ${translation.points}`}
                        max={1_000}
                        value={score}
                      />
                      <small>{formatScore(score, locale)}</small>
                    </label>
                  );
                })}
              </div>
            </article>

            <article className="garage-panel">
              <h3>{translation.carProposal}</h3>
              <p className="recipe-code">{carRecipeKey(payload.profile.car)}</p>
              <dl className="recipe-list">
                <div>
                  <dt>{translation.carBody}</dt>
                  <dd>{formatCarPart(payload.profile.car.body, locale)}</dd>
                </div>
                <div>
                  <dt>{translation.carPaint}</dt>
                  <dd>{formatCarPart(payload.profile.car.paint, locale)}</dd>
                </div>
                <div>
                  <dt>{translation.carTrim}</dt>
                  <dd>{formatCarPart(payload.profile.car.trim, locale)}</dd>
                </div>
                <div>
                  <dt>{translation.carSpoiler}</dt>
                  <dd>{formatCarPart(payload.profile.car.spoiler, locale)}</dd>
                </div>
              </dl>
            </article>

            <article className="source-panel">
              <h3>{translation.sourceCount}</h3>
              <dl className="stat-pair">
                <div>
                  <dt>{translation.sourceCount}</dt>
                  <dd>{payload.profile.sourceCount}</dd>
                </div>
                <div>
                  <dt>{translation.deviceCount}</dt>
                  <dd>{payload.profile.deviceCount}</dd>
                </div>
              </dl>
              <p>{translation.sourcesAggregated}</p>
            </article>

            <article className="verified-panel">
              <h3>{translation.verified}</h3>
              <p>{translation.verifiedCopy}</p>
              <button className="pixel-button" disabled type="button">
                {translation.unavailable}
              </button>
            </article>
          </div>
        </section>

        <section aria-label={translation.dataControl} className="method-grid">
          <article>
            <h2>{translation.methodology}</h2>
            <p>{translation.methodologyCopy}</p>
            <p>{translation.noGlobalClaim}</p>
          </article>
          <article>
            <h2>{translation.dataControl}</h2>
            <p>{translation.dataControlCopy}</p>
            <p>
              {scoreState.source === "community"
                ? translation.communityDataSecurityNote
                : translation.securityNote}
            </p>
          </article>
        </section>
      </main>

      <footer className="site-footer">
        <strong>{translation.brand}</strong>
        <span>{translation.exactTokensPrivate}</span>
        <span>Apache-2.0 · Open source</span>
      </footer>
    </div>
  );
}

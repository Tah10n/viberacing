"use client";

import { lazy, Suspense, useEffect, useId, useState } from "react";

import { CarRecipePreview } from "@/components/car-recipe-preview";
import {
  formatExactTokenTotal,
  formatFreshness,
  isLocale,
  translations,
  type Locale,
} from "@/lib/i18n";
import { toRaceVisualParticipants } from "@/lib/race-visual";
import type { PublicHomePayload, PublicLeaderboardParticipant } from "@/lib/race-types";
import { isRaceThemeId, raceThemeIds, type RaceThemeId } from "@/lib/theme";
import type { PublicProfileSummaryV1 } from "@viberacing/contracts";

const LazyPixelRaceCanvas = lazy(
  async () =>
    await import("@/components/pixel-race-canvas").then((module) => ({
      default: module.PixelRaceCanvas,
    })),
);

type MotionPreference = "system" | "on" | "off";

interface RaceExperienceProps {
  readonly accountSessionAvailable?: boolean;
  readonly payload: PublicHomePayload;
  readonly profileHandle?: string | undefined;
}

const storageKeys = {
  locale: "viberacing.locale",
  motion: "viberacing.motion",
  theme: "viberacing.theme",
} as const;

function isMotionPreference(value: unknown): value is MotionPreference {
  return value === "system" || value === "on" || value === "off";
}

function RaceLoading({ label }: Readonly<{ label: string }>) {
  return (
    <div className="race-loading" role="status">
      <span aria-hidden="true">▰ ▰ ▰</span>
      <p>{label}</p>
    </div>
  );
}

function profileFromParticipant(
  participant: PublicLeaderboardParticipant,
  payload: PublicHomePayload,
): PublicProfileSummaryV1 {
  return {
    carRecipe: participant.carRecipe ?? null,
    freshnessDays: participant.freshnessDays,
    handle: participant.handle,
    participantCount: payload.leaderboard.participantCount,
    rankPosition: participant.rankPosition,
    schemaVersion: 1,
    season: {
      seasonEnd: payload.leaderboard.seasonEnd,
      seasonStart: payload.leaderboard.seasonStart,
      seasonState: payload.leaderboard.seasonState,
    },
    trustTier: "community",
    weeklyTokenTotal: participant.weeklyTokenTotal,
    ...(participant.providerBreakdown === undefined
      ? {}
      : { providerBreakdown: participant.providerBreakdown }),
  };
}

export function RaceExperience({
  accountSessionAvailable = false,
  payload,
  profileHandle,
}: RaceExperienceProps) {
  const [locale, setLocale] = useState<Locale>("en");
  const [theme, setTheme] = useState<RaceThemeId>("neon-night");
  const [motionPreference, setMotionPreference] = useState<MotionPreference>("system");
  const [systemReducedMotion, setSystemReducedMotion] = useState(false);
  const [racePaused, setRacePaused] = useState(false);
  const [raceReady, setRaceReady] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [selectedProfileHandle, setSelectedProfileHandle] = useState(
    profileHandle ?? payload.leaderboard.participants[0]?.handle,
  );
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
    const timeout = window.setTimeout(() => {
      setRaceReady(true);
    }, 0);
    return () => {
      window.clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    setSelectedProfileHandle(profileHandle ?? payload.leaderboard.participants[0]?.handle);
  }, [payload.leaderboard.participants, profileHandle]);

  const motionEnabled =
    motionPreference === "on" || (motionPreference === "system" && !systemReducedMotion);
  const canvasAnimated = motionEnabled && !racePaused;
  const participants = payload.leaderboard.participants;
  const raceParticipants = toRaceVisualParticipants(participants);
  const selectedParticipant = participants.find(
    (participant) => participant.handle === selectedProfileHandle,
  );
  const selectedProfile =
    selectedProfileHandle === profileHandle &&
    payload.profileState === "ready" &&
    payload.profile !== null
      ? payload.profile
      : selectedParticipant === undefined
        ? null
        : profileFromParticipant(selectedParticipant, payload);
  const selectedProfileState =
    selectedProfile !== null
      ? "ready"
      : selectedProfileHandle === undefined
        ? "none"
        : selectedProfileHandle === profileHandle
          ? payload.profileState
          : "not-found";
  const rankCounts = new Map<number, number>();
  for (const participant of participants) {
    rankCounts.set(participant.rankPosition, (rankCounts.get(participant.rankPosition) ?? 0) + 1);
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
  const sourceLabel =
    payload.source === "community" ? translation.communityDataBadge : translation.fallbackBadge;
  const seasonLabel = `${payload.leaderboard.seasonStart} — ${payload.leaderboard.seasonEnd}`;

  return (
    <div
      className="race-app"
      data-motion={motionEnabled ? "on" : "off"}
      data-ranking-metric="provider_reported_tokens_v1"
      data-snapshot-source={payload.source}
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
        <span className="demo-badge">{sourceLabel}</span>
        <nav aria-label={translation.primaryNavigation} className="site-nav">
          <a href="#leaderboard">{translation.leaderboard}</a>
          <a href="#race">{translation.liveRace}</a>
          <a href="#profile">{translation.profile}</a>
          <a href="#methodology">{translation.howRankingWorks}</a>
          {accountSessionAvailable ? (
            <a href="/account">{translation.account}</a>
          ) : (
            <a href="/login">{translation.signIn}</a>
          )}
        </nav>
      </header>

      <main id="top">
        <section aria-labelledby="hero-title" className="hero-section">
          <div className="hero-copy">
            <p className="eyebrow">{translation.communityDetail}</p>
            <h1 id="hero-title">{translation.heroTitle}</h1>
            <p className="hero-lede">{translation.heroCopy}</p>
            <p className="metric-disclaimer">{translation.tokenQualityDisclaimer}</p>
            <div className="hero-actions">
              <a className="primary-action" href="/join">
                {translation.continueWithGithub}
              </a>
              <a className="secondary-action" href="#methodology">
                {translation.howRankingWorks}
              </a>
            </div>
          </div>
          <aside aria-label={translation.communityNotice} className="trust-banner">
            <strong>{translation.communityDetail}</strong>
            <p>{translation.tokenQualityDisclaimer}</p>
            <p>{translation.noGlobalClaim}</p>
          </aside>
        </section>

        <section
          aria-labelledby="leaderboard-heading"
          className="leaderboard-section"
          id="leaderboard"
          tabIndex={-1}
        >
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">{translation.communityDetail}</p>
              <h2 id="leaderboard-heading">{translation.leaderboard}</h2>
              <p className="section-copy">
                {seasonLabel} · {translation.tokenQualityDisclaimer}
              </p>
            </div>
            <span className="snapshot-badge">{sourceLabel}</span>
          </div>
          <div className="table-region" tabIndex={0}>
            <table className="semantic-leaderboard">
              <caption className="sr-only">
                {`${translation.communityDetail}. ${translation.tokenQualityDisclaimer}`}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{translation.rank}</th>
                  <th scope="col">{translation.coder}</th>
                  <th scope="col">{translation.weeklyTokens}</th>
                  <th scope="col">{translation.change}</th>
                </tr>
              </thead>
              <tbody>
                {participants.map((participant) => {
                  const sharedRank = (rankCounts.get(participant.rankPosition) ?? 0) > 1;
                  const selected = participant.handle === selectedProfileHandle;
                  return (
                    <tr
                      className={selected ? "current-driver" : undefined}
                      key={participant.handle}
                    >
                      <td>
                        <span aria-hidden="true">#{participant.rankPosition}</span>
                        <span className="sr-only">
                          {participant.rankPosition}. {sharedRank ? translation.sharedRank : ""}
                        </span>
                      </td>
                      <th scope="row">
                        <a
                          aria-current={selected ? "true" : undefined}
                          aria-label={`${translation.viewProfile}: ${participant.handle}`}
                          className="profile-driver-link"
                          href={`/?profile=${participant.handle}#profile`}
                          onClick={(event) => {
                            if (
                              event.button !== 0 ||
                              event.altKey ||
                              event.ctrlKey ||
                              event.metaKey ||
                              event.shiftKey
                            ) {
                              return;
                            }
                            event.preventDefault();
                            window.history.replaceState(
                              window.history.state,
                              "",
                              event.currentTarget.href,
                            );
                            setSelectedProfileHandle(participant.handle);
                            document.getElementById("profile")?.scrollIntoView();
                          }}
                        >
                          {participant.handle}
                        </a>
                      </th>
                      <td className="numeric-cell">
                        {formatExactTokenTotal(participant.weeklyTokenTotal, locale)}{" "}
                        {translation.tokens}
                      </td>
                      <td>
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">{translation.rankMovementUnavailable}</span>
                      </td>
                    </tr>
                  );
                })}
                {participants.length === 0 ? (
                  <tr>
                    <td colSpan={4}>{translation.noParticipants}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="race-heading" className="race-section" id="race">
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">{translation.communityDetail}</p>
              <h2 id="race-heading">{translation.liveRace}</h2>
              <p className="section-copy">Top 32 · {translation.raceAlternative}</p>
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

          <details className="race-alternative">
            <summary>{translation.raceAlternative}</summary>
            <ol>
              {participants.slice(0, 5).map((participant) => (
                <li key={participant.handle}>
                  <strong>#{participant.rankPosition}</strong> {participant.handle} ·{" "}
                  {formatExactTokenTotal(participant.weeklyTokenTotal, locale)} {translation.tokens}
                </li>
              ))}
            </ol>
          </details>

          <div className="race-console" data-race-ready={raceReady}>
            {raceReady ? (
              <Suspense fallback={<RaceLoading label={translation.raceLoading} />}>
                <LazyPixelRaceCanvas
                  animate={canvasAnimated}
                  description={`${translation.liveRace}. ${translation.communityDetail}`}
                  participants={raceParticipants}
                  theme={theme}
                />
              </Suspense>
            ) : (
              <RaceLoading label={translation.raceLoading} />
            )}
            <div aria-labelledby={controlGroupId} className="race-controls">
              <h3 id={controlGroupId}>{translation.privacyByDefault}</h3>
              <p>{translation.tokenMethodologyCopy}</p>
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

        <section aria-labelledby="profile-heading" className="profile-section" id="profile">
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">{translation.communityDetail}</p>
              <h2 id="profile-heading">{translation.communityProfile}</h2>
            </div>
            <strong aria-live="polite">{selectedProfileHandle ?? "—"}</strong>
          </div>

          {selectedProfileState !== "ready" || selectedProfile === null ? (
            <div className="profile-grid">
              <article className="ranking-panel">
                <p role="status">
                  {selectedProfileState === "unavailable"
                    ? translation.profileUnavailable
                    : selectedProfileState === "none"
                      ? translation.noParticipants
                      : translation.profileNotFound}
                </p>
              </article>
            </div>
          ) : (
            <div className="profile-grid public-profile-grid">
              <article className="ranking-panel">
                <h3>{translation.weeklyTokens}</h3>
                <strong className="large-token-total">
                  {formatExactTokenTotal(selectedProfile.weeklyTokenTotal, locale)}{" "}
                  {translation.tokens}
                </strong>
                <dl className="stat-pair">
                  <div>
                    <dt>{translation.rank}</dt>
                    <dd>#{selectedProfile.rankPosition}</dd>
                  </div>
                  <div>
                    <dt>{translation.freshness}</dt>
                    <dd>{formatFreshness(selectedProfile.freshnessDays, locale)}</dd>
                  </div>
                  <div>
                    <dt>{translation.communityNotice}</dt>
                    <dd>{selectedProfile.trustTier}</dd>
                  </div>
                  <div>
                    <dt>{translation.communityWeek}</dt>
                    <dd>
                      <time dateTime={selectedProfile.season.seasonStart}>
                        {selectedProfile.season.seasonStart}
                      </time>{" "}
                      —{" "}
                      <time dateTime={selectedProfile.season.seasonEnd}>
                        {selectedProfile.season.seasonEnd}
                      </time>
                    </dd>
                  </div>
                </dl>
                <p>{translation.communityProfilePrivacy}</p>
              </article>

              <article className="garage-panel">
                <h3>{translation.car}</h3>
                {selectedProfile.carRecipe === null ? (
                  <p>{translation.noApprovedCar}</p>
                ) : (
                  <CarRecipePreview
                    label={`${selectedProfile.handle}: ${translation.car}`}
                    locale={locale}
                    recipe={selectedProfile.carRecipe}
                  />
                )}
              </article>

              <article className="provider-panel">
                <h3>{translation.providerBreakdown}</h3>
                {selectedProfile.providerBreakdown === undefined ? (
                  <p>{translation.unavailable}</p>
                ) : (
                  <dl className="provider-breakdown">
                    {selectedProfile.providerBreakdown.map((provider) => (
                      <div key={provider.provider}>
                        <dt>{provider.provider}</dt>
                        <dd>{provider.percentage}%</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </article>
            </div>
          )}
        </section>

        <section aria-label={translation.dataControl} className="method-grid" id="methodology">
          <article>
            <p className="eyebrow">{translation.howRankingWorks}</p>
            <h2>{translation.methodology}</h2>
            <p>{translation.tokenMethodologyCopy}</p>
            <p>{translation.tokenQualityDisclaimer}</p>
          </article>
          <article>
            <p className="eyebrow">{translation.privacyByDefault}</p>
            <h2>{translation.dataControl}</h2>
            <p>{translation.communityDataSecurityNote}</p>
            <p>{translation.noGlobalClaim}</p>
          </article>
          <article className="verified-panel">
            <p className="eyebrow">{translation.unavailable}</p>
            <h2>{translation.verified}</h2>
            <p>{translation.verifiedCopy}</p>
          </article>
        </section>
      </main>

      <footer className="site-footer">
        <strong>{translation.brand}</strong>
        <span>{translation.communityDetail}</span>
        <span>Apache-2.0 · Open source</span>
      </footer>
    </div>
  );
}

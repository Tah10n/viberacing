"use client";

import { useState } from "react";

import { formatScore, translations, type Locale } from "@/lib/i18n";
import {
  maximumSimulatorWeeklyScore,
  parseSimulatorTokenCount,
  simulateScore,
} from "@/lib/score-simulator";

interface ScoreSimulatorProps {
  readonly locale: Locale;
}

const activeDayOptions = [1, 2, 3, 4, 5, 6, 7] as const;

export function ScoreSimulator({ locale }: ScoreSimulatorProps) {
  const [tokenInput, setTokenInput] = useState("10000");
  const [activeDays, setActiveDays] = useState(5);
  const tokenCount = parseSimulatorTokenCount(tokenInput);
  const simulation = tokenCount === undefined ? undefined : simulateScore(tokenCount, activeDays);
  const translation = translations[locale];

  return (
    <section aria-labelledby="simulator-heading" className="simulator-section" id="simulator">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">{translation.methodology}</p>
          <h2 id="simulator-heading">{translation.simulator}</h2>
          <p className="simulator-copy" id="simulator-copy">
            {translation.simulatorCopy}
          </p>
        </div>
        <span className="score-cap">
          MAX {formatScore(maximumSimulatorWeeklyScore, locale)} {translation.points}
        </span>
      </div>

      <div className="simulator-panel">
        <div className="simulator-controls">
          <label>
            <span>{translation.simulatorTokenLabel}</span>
            <input
              aria-describedby={
                tokenCount === undefined ? "simulator-copy simulator-error" : "simulator-copy"
              }
              aria-invalid={tokenCount === undefined}
              autoComplete="off"
              className="simulator-input"
              inputMode="numeric"
              maxLength={16}
              onChange={(event) => {
                setTokenInput(event.currentTarget.value);
              }}
              spellCheck={false}
              type="text"
              value={tokenInput}
            />
          </label>
          <label>
            <span>{translation.simulatorActiveDays}</span>
            <select
              onChange={(event) => {
                setActiveDays(Number(event.currentTarget.value));
              }}
              value={activeDays}
            >
              {activeDayOptions.map((option) => (
                <option key={option} value={option}>
                  {String(option)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {tokenCount === undefined ? (
          <p className="simulator-error" id="simulator-error" role="alert">
            {translation.simulatorInvalidInput}
          </p>
        ) : null}

        <dl aria-atomic="true" aria-live="polite" className="simulator-results">
          <div>
            <dt>{translation.simulatorDailyResult}</dt>
            <dd>
              {simulation === undefined ? "—" : formatScore(simulation.dailyScore, locale)}{" "}
              {translation.points}
            </dd>
          </div>
          <div>
            <dt>{translation.simulatorWeeklyResult}</dt>
            <dd>
              {simulation === undefined ? "—" : formatScore(simulation.weeklyScore, locale)}{" "}
              {translation.points}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

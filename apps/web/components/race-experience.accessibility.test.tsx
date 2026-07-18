import axe from "axe-core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getSyntheticRacePayload } from "@/lib/race-data";

import { RaceExperience } from "./race-experience";

describe("RaceExperience accessibility", () => {
  it("renders a semantic non-canvas equivalent with no automated violations", async () => {
    document.documentElement.lang = "en";
    document.title = "Vibe Racing accessibility test";
    document.body.innerHTML = renderToStaticMarkup(
      createElement(RaceExperience, { payload: getSyntheticRacePayload() }),
    );

    const results = await axe.run(document.documentElement, {
      rules: {
        "color-contrast": { enabled: false },
      },
    });
    expect(results.violations).toEqual([]);
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(document.querySelector<HTMLAnchorElement>(".skip-link")?.hash).toBe("#leaderboard");
    expect(document.querySelector<HTMLElement>("#leaderboard")?.tabIndex).toBe(-1);
    expect(document.querySelector("table caption")?.textContent).toBe(
      "Community leaderboard: Leaderboard. Scores are self-reported by participating users. " +
        "They are not audited or endorsed by OpenAI.",
    );
    expect(document.querySelector('canvas[role="img"]')).not.toBeNull();
    expect(document.querySelector("#simulator-heading")?.textContent).toBe("Score simulator");
    expect(document.querySelector(".simulator-input")?.hasAttribute("name")).toBe(false);
    expect(document.querySelector("button:disabled")?.textContent).toContain("Unavailable");
    expect(document.body.textContent).toContain("Synthetic preview");
    expect(document.body.textContent).toContain("not audited or endorsed by OpenAI");
  }, 10_000);
});

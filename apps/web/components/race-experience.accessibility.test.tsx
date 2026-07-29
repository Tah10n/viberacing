import axe from "axe-core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getSyntheticPublicHomePayload } from "@/lib/race-data";

import { RaceExperience } from "./race-experience";

describe("RaceExperience accessibility", () => {
  it("server-renders the semantic ranking before any canvas or JavaScript enhancement", async () => {
    document.documentElement.lang = "en";
    document.title = "Vibe Racing accessibility test";
    document.body.innerHTML = renderToStaticMarkup(
      createElement(RaceExperience, {
        payload: getSyntheticPublicHomePayload("2026-07-27"),
      }),
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
    expect(document.querySelectorAll("table thead th")).toHaveLength(4);
    expect(document.querySelector("table caption")?.textContent).toContain(
      "Community · self-reported by connected devices",
    );
    expect(document.querySelector('canvas[role="img"]')).toBeNull();
    expect(document.querySelector(".race-loading")?.textContent).toContain(
      "loads after the semantic leaderboard",
    );
    expect(document.querySelector("#simulator-heading")).toBeNull();
    expect(document.body.textContent).toContain(
      "All your coding agents. Every account. One GitHub profile.",
    );
    expect(document.body.textContent).toContain("This measures token usage, not code quality.");
    expect(document.body.textContent).not.toContain("Weekly score");
    expect(document.body.textContent).not.toContain("Active days");
    expect(document.body.textContent).not.toContain("Sources");
  }, 10_000);
});

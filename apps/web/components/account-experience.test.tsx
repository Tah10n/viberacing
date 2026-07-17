import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AccountExperience } from "./account-experience";

describe("AccountExperience CarRecipe controls", () => {
  it("renders a bounded all-theme proposal preview and explicit opaque decisions", () => {
    document.body.innerHTML = renderToStaticMarkup(
      createElement(AccountExperience, {
        activeDeviceInventory: [],
        carRecipeState: {
          active: null,
          proposal: {
            control: "opaque-session-bound-proposal-control",
            recipe: {
              schemaVersion: 1,
              chassis: "rally",
              nose: "scoop",
              cockpit: "rally",
              wing: "low",
              wheels: "all-terrain",
              palette: "sunburst",
              trail: "spark",
              seed: 42,
            },
          },
        },
        handle: "pixel_driver",
        locale: "en",
        passkeys: [],
        score: null,
        visibility: "public",
      }),
    );

    const proposal = document.querySelector("#car-proposal");
    expect(proposal).not.toBeNull();
    expect(proposal?.querySelectorAll(".car-preview-canvas")).toHaveLength(3);
    expect(proposal?.querySelector(".car-preview-grid")?.getAttribute("data-recipe")).toBe(
      "v1:rally:scoop:rally:low:all-terrain:sunburst:spark:42",
    );
    expect(
      proposal
        ?.querySelector('form[action="/auth/cars/proposals/approve"] input')
        ?.getAttribute("value"),
    ).toBe("opaque-session-bound-proposal-control");
    expect(
      proposal
        ?.querySelector('form[action="/auth/cars/proposals/reject"] input')
        ?.getAttribute("value"),
    ).toBe("opaque-session-bound-proposal-control");
    const form = proposal?.querySelector('form[action="/auth/cars/proposals"]');
    expect(form?.querySelectorAll("select")).toHaveLength(7);
    expect(form?.querySelector('input[name="seed"]')?.getAttribute("max")).toBe("65535");
    expect(form?.querySelector('input[name="schemaVersion"]')?.getAttribute("value")).toBe("1");
    expect(document.body.textContent).not.toContain("00000000-0000-4000-8000-000000000701");
  });

  it("keeps the editor unavailable when the protected state is missing", () => {
    const markup = renderToStaticMarkup(
      createElement(AccountExperience, {
        activeDeviceInventory: [],
        handle: "pixel_driver",
        locale: "en",
        passkeys: [],
        visibility: "hidden",
      }),
    );
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain('action="/auth/cars/proposals"');
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AccountExperience } from "./account-experience";

describe("AccountExperience CarRecipe controls", () => {
  it("renders a bounded all-theme proposal preview and explicit opaque decisions", () => {
    document.body.innerHTML = renderToStaticMarkup(
      createElement(AccountExperience, {
        activeDeviceInventory: [],
        carProposalsEnabled: true,
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

  it("keeps private review and rejection available while creation and approval are disabled", () => {
    const carRecipeState = {
      active: null,
      proposal: {
        control: "opaque-session-bound-proposal-control",
        recipe: {
          schemaVersion: 1 as const,
          chassis: "rally" as const,
          nose: "scoop" as const,
          cockpit: "rally" as const,
          wing: "low" as const,
          wheels: "all-terrain" as const,
          palette: "sunburst" as const,
          trail: "spark" as const,
          seed: 42,
        },
      },
    };
    for (const [locale, unavailable] of [
      ["en", "Creating or approving car proposals is temporarily unavailable"],
      ["ru", "Создание и одобрение предложений машины временно недоступны"],
    ] as const) {
      const markup = renderToStaticMarkup(
        createElement(AccountExperience, {
          activeDeviceInventory: [],
          carProposalsEnabled: false,
          carRecipeState,
          handle: "pixel_driver",
          locale,
          passkeys: [],
          score: null,
          visibility: "public",
        }),
      );

      expect(markup).toContain(unavailable);
      expect(markup).not.toContain('action="/auth/cars/proposals"');
      expect(markup).not.toContain('action="/auth/cars/proposals/approve"');
      expect(markup).toContain('action="/auth/cars/proposals/reject"');
      expect(markup).toContain("opaque-session-bound-proposal-control");
      expect(markup.match(/car-preview-canvas/g)).toHaveLength(3);
    }
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

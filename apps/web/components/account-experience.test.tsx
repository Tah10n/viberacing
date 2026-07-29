import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AccountDashboard } from "@/lib/enrollment-service";

import { AccountExperience } from "./account-experience";

function dashboardFixture(): AccountDashboard {
  return {
    accounts: [
      {
        accountingRevision: 1,
        connectedDeviceCount: 1,
        control: "opaque-account-control",
        expectedReaderVersion: "1.0.0",
        identityAssurance: "community_local",
        lastSuccessfulSyncDate: "2026-07-28",
        observedReaderVersion: "1.0.0",
        privateLabel: "Personal account",
        provider: "codex",
        quarantineReason: null,
        state: "active",
        status: "connected",
        todayTokenTotal: "9007199254740993",
        weeklyTokenTotal: "999999999999999999999999999999999999999999999999999999999999",
      },
    ],
    installations: [
      {
        accounts: [
          {
            deviceControl: "opaque-device-control",
            deviceState: "active",
            privateLabel: "Personal account",
          },
        ],
        architecture: "x86_64",
        connectedDate: "2026-07-20",
        connectorVersion: "0.0.0",
        control: "opaque-installation-control",
        label: "Studio PC",
        lastSeenDate: "2026-07-28",
        osFamily: "windows",
        state: "active",
      },
    ],
    ranking: {
      participantCount: 18,
      providerBreakdownVisible: false,
      publicVisibility: "public",
      rankPosition: 3,
      seasonEnd: "2026-08-02",
      seasonStart: "2026-07-27",
      seasonState: "open",
      snapshotGeneratedAt: "2026-07-29T09:42Z",
      weeklyTokenTotal: "999999999999999999999999999999999999999999999999999999999999",
    },
  };
}

describe("AccountExperience", () => {
  it("renders the private agent-account dashboard without raw identifiers or rounded totals", () => {
    const markup = renderToStaticMarkup(
      <AccountExperience
        dashboard={dashboardFixture()}
        handle="pixel_driver"
        locale="en"
        passkeys={[]}
      />,
    );

    expect(markup).toContain("Current ranking");
    expect(markup).toContain("Connected agents and accounts");
    expect(markup).toContain("Sync health");
    expect(markup).toContain(
      "999,999,999,999,999,999,999,999,999,999,999,999,999,999,999,999,999,999",
    );
    expect(markup).toContain("9,007,199,254,740,993");
    expect(markup).toContain("Personal account");
    expect(markup).toContain("Studio PC");
    expect(markup).toContain('action="/auth/accounts/pause"');
    expect(markup).toContain("Unlink account permanently");
    expect(markup).toContain("Revoke installation");
    expect(markup).toContain("Revoke device");
    expect(markup).not.toContain("Source 1");
    expect(markup).not.toContain("acc_");
    expect(markup).not.toContain("dev_");
    expect(markup).not.toContain("ins_");
  });

  it("labels a season without a published snapshot as pending", () => {
    const dashboard = dashboardFixture();
    const markup = renderToStaticMarkup(
      <AccountExperience
        dashboard={{
          ...dashboard,
          ranking: {
            ...dashboard.ranking,
            participantCount: null,
            rankPosition: null,
            seasonState: "pending",
            snapshotGeneratedAt: null,
            weeklyTokenTotal: null,
          },
        }}
        handle="pixel_driver"
        locale="en"
        passkeys={[]}
      />,
    );

    expect(markup).toContain("Pending snapshot");
    expect(markup).not.toContain(">Open<");
  });

  it("renders a bounded all-theme proposal preview and explicit opaque decisions", () => {
    document.body.innerHTML = renderToStaticMarkup(
      createElement(AccountExperience, {
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
        dashboard: dashboardFixture(),
        handle: "pixel_driver",
        locale: "en",
        passkeys: [],
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
  });

  it("keeps private review and rejection available while creation and approval are disabled", () => {
    const markup = renderToStaticMarkup(
      <AccountExperience
        carProposalsEnabled={false}
        carRecipeState={{
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
        }}
        dashboard={dashboardFixture()}
        handle="pixel_driver"
        locale="en"
        passkeys={[]}
      />,
    );

    expect(markup).toContain("Creating or approving car proposals is temporarily unavailable");
    expect(markup).not.toContain('action="/auth/cars/proposals"');
    expect(markup).not.toContain('action="/auth/cars/proposals/approve"');
    expect(markup).toContain('action="/auth/cars/proposals/reject"');
  });

  it("fails closed when protected dashboard and recipe state are unavailable", () => {
    const markup = renderToStaticMarkup(
      <AccountExperience
        dashboard={undefined}
        handle="pixel_driver"
        locale="en"
        passkeys={undefined}
      />,
    );
    expect(markup).toContain("Private ranking details are temporarily unavailable");
    expect(markup).toContain("Connected account details are temporarily unavailable");
    expect(markup).not.toContain('action="/auth/accounts/pause"');
    expect(markup).not.toContain('action="/auth/cars/proposals"');
  });
});

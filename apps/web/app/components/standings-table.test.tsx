import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RacerProfileDialog, StandingsTable } from "./standings-table";

describe("standings table profile contract", () => {
  it("opens the selected-period profile from the nickname and keeps a quick view", () => {
    const markup = renderToStaticMarkup(
      <StandingsTable
        currentHandle="Tah10n"
        periodLabel="This year"
        periodSearch="period=year"
        rows={[
          {
            handle: "Tah10n",
            rank: "1",
            total: "2600000",
            breakdown: [{ agent: "codex", label: "Codex", tokens: "2600000" }],
          },
        ]}
      />,
    );

    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('href="/u/Tah10n?period=year"');
    expect(markup).toContain('aria-label="Quick view for @Tah10n"');
    expect(markup).toContain('class="racer-profile-dialog"');
    expect(markup).toContain('class="leaderboard-profile-link"');
    expect(markup).not.toContain(">View profile<");
    expect(markup).toContain("Tokens · This year");
  });

  it("keeps full leaderboard profile navigation inside the dialog", () => {
    const markup = renderToStaticMarkup(
      <RacerProfileDialog
        currentHandle="Tah10n"
        onClose={() => undefined}
        periodLabel="This year"
        periodSearch="period=year"
        row={{
          handle: "Tah10n",
          rank: "1",
          total: "2600000",
          breakdown: [{ agent: "codex", label: "Codex", tokens: "2600000" }],
        }}
      />,
    );
    expect(markup).toContain('href="/u/Tah10n?period=year"');
    expect(markup).toContain(">View leaderboard profile<");
    expect(markup).toContain('href="https://github.com/Tah10n"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noreferrer"');
    expect(markup.indexOf('href="/u/Tah10n?period=year"')).toBeLessThan(
      markup.indexOf('href="https://github.com/Tah10n"'),
    );
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StandingsTable } from "./standings-table";

describe("standings table profile contract", () => {
  it("renders an interactive row and keeps the nickname as a direct GitHub link", () => {
    const markup = renderToStaticMarkup(
      <StandingsTable
        currentHandle="Tah10n"
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
    expect(markup).toContain('href="https://github.com/Tah10n"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noreferrer"');
    expect(markup).toContain('class="racer-profile-dialog"');
  });
});

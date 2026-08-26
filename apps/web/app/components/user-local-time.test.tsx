import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatUserLocalTime, UserLocalTime } from "./user-local-time";

describe("user-local time", () => {
  it("formats an absolute timestamp in the requested browser time zone", () => {
    expect(formatUserLocalTime("2026-08-26T08:30:00.000Z", "timestamp", "Europe/Belgrade")).toMatch(
      /^26 Aug, 10:30 (?:CEST|GMT\+2)$/,
    );
  });

  it("lets a UTC race boundary display on the user's local day", () => {
    expect(formatUserLocalTime("2026-08-30T23:59:59.999Z", "race-end", "America/New_York")).toMatch(
      /^Ends Sun,? 30 Aug, 19:59 (?:EDT|GMT-4)$/,
    );
  });

  it("keeps an explicit UTC fallback for server rendering and no-JavaScript clients", () => {
    const markup = renderToStaticMarkup(
      <UserLocalTime
        dateTime="2026-08-26T08:30:00.000Z"
        fallback="26 Aug, 08:30 UTC"
        format="timestamp"
      />,
    );

    expect(markup).toContain('dateTime="2026-08-26T08:30:00.000Z"');
    expect(markup).toContain("26 Aug, 08:30 UTC");
  });
});

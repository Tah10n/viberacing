import { describe, expect, it } from "vitest";
import { connectorCommandShell } from "./command-platform";

describe("connectorCommandShell", () => {
  it.each([
    ['"Windows"', null, "Windows PowerShell"],
    ['"macOS"', null, "macOS Terminal"],
    ['"Linux"', null, "Linux terminal"],
    [null, "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Windows PowerShell"],
    [null, "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "macOS Terminal"],
    [null, "Mozilla/5.0 (X11; Linux x86_64)", "Linux terminal"],
  ])("maps %s / %s to %s", (platformHint, userAgent, expected) => {
    expect(connectorCommandShell(platformHint, userAgent)).toBe(expected);
  });

  it.each([
    [null, "Mozilla/5.0 (iPhone)"],
    ['"Android"', "Mozilla/5.0 (Linux; Android 16)"],
    [
      null,
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
    ],
    [null, "Unknown browser"],
  ])("falls back to the connector computer for %s / %s", (platformHint, userAgent) => {
    expect(connectorCommandShell(platformHint, userAgent)).toBe(
      "Terminal or Windows PowerShell on the computer running the connector",
    );
  });
});

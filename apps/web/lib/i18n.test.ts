import { describe, expect, it } from "vitest";

import {
  dayLabels,
  formatCarPart,
  formatDayCount,
  formatFreshness,
  formatScore,
  isLocale,
  translations,
} from "./i18n";

describe("localization", () => {
  it("keeps English and Russian keys in exact parity", () => {
    expect(Object.keys(translations.ru).sort()).toEqual(Object.keys(translations.en).sort());
    expect(Object.values(translations.en).every((value) => value.trim().length > 0)).toBe(true);
    expect(Object.values(translations.ru).every((value) => value.trim().length > 0)).toBe(true);
  });

  it("rejects unsupported locale values", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("ru")).toBe(true);
    expect(isLocale("../../private")).toBe(false);
  });

  it("formats scores, days, freshness, and closed car enums for each locale", () => {
    expect(formatScore(1234, "en")).toBe("1,234");
    expect(formatScore(1234, "ru")).toMatch(/^1[\s\u00a0]234$/);
    expect(formatFreshness(0, "en")).toBe("today");
    expect(formatFreshness(2, "ru")).toBe("2 дня");
    expect(formatDayCount(11, "ru")).toBe("11 дн.");
    expect(formatCarPart("turbo-blue", "en")).toBe("Turbo blue");
    expect(formatCarPart("turbo-blue", "ru")).toBe("Турбо-синий");
    expect(dayLabels("en")).toHaveLength(7);
    expect(dayLabels("ru")).toHaveLength(7);
  });
});

import { describe, expect, it } from "vitest";

import {
  formatCarChassis,
  formatExactTokenTotal,
  formatFreshness,
  isLocale,
  translations,
} from "./i18n";
import { joinTranslations } from "./join-i18n";

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

  it("does not turn reader eligibility into a current provider-support claim", () => {
    expect(translations.en.heroCopy).not.toContain("supported coding agents");
    expect(translations.ru.heroCopy).not.toContain("поддерживаемых");
    expect(joinTranslations.en.expectedReaderVersion).toBe("Expected reader");
    expect(joinTranslations.ru.expectedReaderVersion).toBe("Ожидаемый reader");
    expect(joinTranslations.en.syncHealthCopy).toContain("server-selected reader revision");
    expect(joinTranslations.ru.syncHealthCopy).toContain("выбранной сервером ревизией reader");
  });

  it("formats exact token totals, freshness, and closed car enums for each locale", () => {
    expect(formatExactTokenTotal("123456789012345678901234567890", "en")).toBe(
      "123,456,789,012,345,678,901,234,567,890",
    );
    expect(formatExactTokenTotal("1234567", "ru")).toBe("1\u00a0234\u00a0567");
    expect(() => formatExactTokenTotal("01", "en")).toThrow(RangeError);
    expect(formatFreshness(0, "en")).toBe("today");
    expect(formatFreshness(2, "ru")).toBe("2 дня");
    expect(formatFreshness(null, "en")).toBe("—");
    expect(formatCarChassis("roadster", "en")).toBe("Roadster");
    expect(formatCarChassis("roadster", "ru")).toBe("Родстер");
  });
});

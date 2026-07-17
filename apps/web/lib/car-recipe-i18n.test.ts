import { describe, expect, it } from "vitest";

import { carRecipeFieldLabels, formatCarPart } from "./car-recipe-i18n";

describe("CarRecipe localization", () => {
  it("keeps every closed editor field and enum readable in English and Russian", () => {
    expect(Object.keys(carRecipeFieldLabels.en).sort()).toEqual(
      Object.keys(carRecipeFieldLabels.ru).sort(),
    );
    expect(formatCarPart("turbo-blue", "en")).toBe("Turbo blue");
    expect(formatCarPart("turbo-blue", "ru")).toBe("Турбо-синий");
    expect(formatCarPart("all-terrain", "en")).toBe("All-terrain");
    expect(formatCarPart("all-terrain", "ru")).toBe("Внедорожные");
  });
});

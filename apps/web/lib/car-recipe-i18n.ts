import type {
  CarChassis,
  CarCockpit,
  CarNose,
  CarPaletteId,
  CarTrail,
  CarWheels,
  CarWing,
} from "./car-recipe";
import type { Locale } from "./i18n";

type CarPart = CarChassis | CarCockpit | CarNose | CarPaletteId | CarTrail | CarWheels | CarWing;

export const carRecipeFieldLabels: Readonly<
  Record<
    Locale,
    Readonly<
      Record<
        "chassis" | "cockpit" | "nose" | "palette" | "seed" | "trail" | "wheels" | "wing",
        string
      >
    >
  >
> = {
  en: {
    chassis: "Chassis",
    cockpit: "Cockpit",
    nose: "Nose",
    palette: "Palette",
    seed: "Seed",
    trail: "Trail",
    wheels: "Wheels",
    wing: "Wing",
  },
  ru: {
    chassis: "Шасси",
    cockpit: "Кокпит",
    nose: "Нос",
    palette: "Палитра",
    seed: "Вариант",
    trail: "След",
    wheels: "Колёса",
    wing: "Крыло",
  },
};

const carPartLabels: Readonly<Record<Locale, Readonly<Record<CarPart, string>>>> = {
  en: {
    "all-terrain": "All-terrain",
    canopy: "Canopy",
    classic: "Classic",
    formula: "Formula",
    grid: "Grid",
    high: "High",
    low: "Low",
    magenta: "Magenta",
    mint: "Mint",
    none: "None",
    open: "Open",
    rally: "Rally",
    redline: "Redline",
    roadster: "Roadster",
    scoop: "Scoop",
    slick: "Slick",
    spark: "Spark",
    street: "Street",
    sunburst: "Sunburst",
    "turbo-blue": "Turbo blue",
    wedge: "Wedge",
  },
  ru: {
    "all-terrain": "Внедорожные",
    canopy: "Фонарь",
    classic: "Классический",
    formula: "Формула",
    grid: "Сетка",
    high: "Высокий",
    low: "Низкий",
    magenta: "Маджента",
    mint: "Мятный",
    none: "Нет",
    open: "Открытый",
    rally: "Ралли",
    redline: "Красный",
    roadster: "Родстер",
    scoop: "Воздухозаборник",
    slick: "Слики",
    spark: "Искры",
    street: "Дорожные",
    sunburst: "Солнечный",
    "turbo-blue": "Турбо-синий",
    wedge: "Клиновидный",
  },
};

export function formatCarPart(value: CarPart, locale: Locale): string {
  return carPartLabels[locale][value];
}

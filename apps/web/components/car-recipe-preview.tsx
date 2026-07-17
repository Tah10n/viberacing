import {
  buildCarSprite,
  buildCarTrail,
  carRecipeKey,
  type CarRecipe,
  type SpritePixel,
} from "@/lib/car-recipe";
import { translations, type Locale } from "@/lib/i18n";
import { raceThemeIds, type RaceThemeId } from "@/lib/theme";

interface CarRecipePreviewProps {
  readonly label: string;
  readonly locale: Locale;
  readonly recipe: CarRecipe;
}

interface PreviewCanvasProps extends CarRecipePreviewProps {
  readonly theme: RaceThemeId;
}

const spriteColumnOffset = 6;
const previewColumns = 22;
const previewRows = 8;

function previewPixels(recipe: CarRecipe): readonly SpritePixel[] {
  const sprite = buildCarSprite(recipe);
  const trail = new Set(
    buildCarTrail(recipe).map((pixel) => `${String(pixel.x)},${String(pixel.y)}`),
  );
  return Object.freeze(
    Array.from({ length: previewRows }, (_, rowIndex) =>
      Array.from({ length: previewColumns }, (_, columnIndex): SpritePixel => {
        const relativeColumn = columnIndex - spriteColumnOffset;
        if (trail.has(`${String(relativeColumn)},${String(rowIndex)}`)) {
          return "a";
        }
        return relativeColumn >= 0 ? (sprite[rowIndex]?.[relativeColumn] ?? ".") : ".";
      }),
    ).flat(),
  );
}

function PreviewCanvas({ label, locale, recipe, theme }: PreviewCanvasProps) {
  const copy = translations[locale];
  const themeLabel =
    theme === "neon-night"
      ? copy.themeNeon
      : theme === "classic-grand-prix"
        ? copy.themeClassic
        : copy.themeCyber;

  return (
    <figure className="car-preview-card">
      <div
        aria-label={`${label}: ${themeLabel}`}
        className={`car-preview-canvas car-preview-theme-${theme} car-preview-palette-${recipe.palette} car-preview-cockpit-${recipe.cockpit}`}
        data-theme={theme}
        role="img"
      >
        {previewPixels(recipe).map((pixel, index) => (
          <span
            aria-hidden="true"
            className={pixel === "." ? "car-preview-pixel" : `car-preview-pixel pixel-${pixel}`}
            key={index}
          />
        ))}
      </div>
      <figcaption>{themeLabel}</figcaption>
    </figure>
  );
}

export function CarRecipePreview({ label, locale, recipe }: CarRecipePreviewProps) {
  return (
    <div className="car-preview-grid" data-recipe={carRecipeKey(recipe)}>
      {raceThemeIds.map((theme) => (
        <PreviewCanvas key={theme} label={label} locale={locale} recipe={recipe} theme={theme} />
      ))}
    </div>
  );
}

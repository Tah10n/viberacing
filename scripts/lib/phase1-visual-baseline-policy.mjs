export const phase1BaselineLocales = Object.freeze(["en", "ru"]);
export const phase1BaselineThemes = Object.freeze([
  "classic-grand-prix",
  "cyber-rally",
  "neon-night",
]);
export const phase1BaselineViewports = Object.freeze([
  Object.freeze({ height: 720, id: "desktop", width: 1280 }),
  Object.freeze({ height: 844, id: "mobile", width: 390 }),
  Object.freeze({ height: 568, id: "compact", width: 320 }),
]);

export const phase1BaselineRoot = "docs/testing/phase1-visual-baselines";

const sensitivePageRequestHeaders = new Set(["authorization", "cookie", "proxy-authorization"]);

export function phase1BaselineFileName(viewport, locale, theme) {
  return `${viewport.id}-${viewport.width}x${viewport.height}-${locale}-${theme}.png`;
}

export function expectedPhase1BaselineEntries() {
  return phase1BaselineViewports
    .flatMap((viewport) =>
      phase1BaselineLocales.flatMap((locale) =>
        phase1BaselineThemes.map((theme) =>
          Object.freeze({
            file: phase1BaselineFileName(viewport, locale, theme),
            height: viewport.height,
            locale,
            theme,
            viewport: viewport.id,
            width: viewport.width,
          }),
        ),
      ),
    )
    .sort((left, right) => left.file.localeCompare(right.file));
}

export function isAllowedPhase1PageRequest(request, expectedOrigin) {
  if (
    request === null ||
    typeof request !== "object" ||
    Array.isArray(request) ||
    typeof request.url !== "string" ||
    request.headers === null ||
    typeof request.headers !== "object" ||
    Array.isArray(request.headers)
  ) {
    return false;
  }
  let requested;
  let origin;
  try {
    requested = new URL(request.url);
    origin = new URL(expectedOrigin);
  } catch {
    return false;
  }
  return (
    requested.origin === origin.origin &&
    requested.username === "" &&
    requested.password === "" &&
    !Object.keys(request.headers).some((name) =>
      sensitivePageRequestHeaders.has(name.toLowerCase()),
    )
  );
}

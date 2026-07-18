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
export const phase1MaximumCaptureBytes = 2 * 1024 * 1024;
export const phase1MaximumMatrixBytes = 12 * 1024 * 1024;

const sensitivePageRequestHeaders = new Set(["authorization", "cookie", "proxy-authorization"]);
const pixelComparisonKeys = [
  "baselineHeight",
  "baselineWidth",
  "changedPixels",
  "maxChannelDelta",
  "renderedHeight",
  "renderedWidth",
  "totalChannelDelta",
  "totalPixels",
];

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
    .sort((left, right) => (left.file < right.file ? -1 : left.file > right.file ? 1 : 0));
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

export function isMatchingPhase1VerificationEnvironment(snapshot, browserProduct, capturePlatform) {
  return (
    snapshot !== null &&
    typeof snapshot === "object" &&
    !Array.isArray(snapshot) &&
    typeof snapshot.browserProduct === "string" &&
    typeof snapshot.capturePlatform === "string" &&
    browserProduct === snapshot.browserProduct &&
    capturePlatform === snapshot.capturePlatform
  );
}

export function classifyPhase1PixelComparison(comparison, width, height) {
  if (
    comparison === null ||
    typeof comparison !== "object" ||
    Array.isArray(comparison) ||
    !Number.isSafeInteger(width) ||
    width <= 0 ||
    !Number.isSafeInteger(height) ||
    height <= 0 ||
    Object.keys(comparison).sort().join(",") !== [...pixelComparisonKeys].sort().join(",") ||
    !pixelComparisonKeys.every((key) => Number.isSafeInteger(comparison[key]))
  ) {
    return "invalid";
  }
  const totalPixels = width * height;
  const maximumTotalChannelDelta = totalPixels * 4 * 255;
  if (!Number.isSafeInteger(totalPixels) || !Number.isSafeInteger(maximumTotalChannelDelta)) {
    return "invalid";
  }
  if (
    comparison.baselineWidth !== width ||
    comparison.baselineHeight !== height ||
    comparison.renderedWidth !== width ||
    comparison.renderedHeight !== height ||
    comparison.totalPixels !== totalPixels ||
    comparison.changedPixels < 0 ||
    comparison.changedPixels > totalPixels ||
    comparison.maxChannelDelta < 0 ||
    comparison.maxChannelDelta > 255 ||
    comparison.totalChannelDelta < comparison.maxChannelDelta ||
    comparison.totalChannelDelta > comparison.changedPixels * 4 * 255 ||
    comparison.totalChannelDelta > maximumTotalChannelDelta ||
    (comparison.changedPixels === 0) !==
      (comparison.maxChannelDelta === 0 && comparison.totalChannelDelta === 0)
  ) {
    return "invalid";
  }
  return comparison.changedPixels === 0 ? "exact" : "different";
}

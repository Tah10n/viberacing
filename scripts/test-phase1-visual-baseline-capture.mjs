import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  classifyPhase1AccessibilityTree,
  classifyPhase1ForcedColorsAudit,
  classifyPhase1KeyboardAudit,
  classifyPhase1WebVitalsAudit,
  phase1KeyboardFocusSelectors,
  phase1RequiredAccessibilityNodes,
  phase1WebVitalsBudgets,
  phase1WebVitalsModes,
  phase1WebVitalsSampleCount,
} from "./lib/phase1-browser-evidence-policy.mjs";
import {
  classifyPhase1PixelComparison,
  isAllowedPhase1PageRequest,
  isMatchingPhase1VerificationEnvironment,
} from "./lib/phase1-visual-baseline-policy.mjs";

const capture = resolve(import.meta.dirname, "capture-phase1-visual-baselines.mjs");
const temporaryRoot = mkdtempSync(join(tmpdir(), "viberacing-phase1-capture-check-"));
let caseCount = 0;

function run(arguments_) {
  try {
    return {
      output: execFileSync(process.execPath, [capture, ...arguments_], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
      status: 0,
    };
  } catch (error) {
    return {
      output: `${error.stdout?.toString() ?? ""}${error.stderr?.toString() ?? ""}`,
      status: error.status ?? 1,
    };
  }
}

function expectFailure(name, arguments_, expected, status = 1) {
  caseCount += 1;
  const result = run(arguments_);
  assert.equal(result.status, status, `${name}: ${result.output}`);
  assert.match(result.output, expected);
  return result;
}

const browserArguments = ["--browser", process.execPath, "--write"];

const allowedRequest = {
  headers: { Accept: "text/html" },
  url: "http://127.0.0.1:3317/_next/static/example.js",
};
assert.equal(isAllowedPhase1PageRequest(allowedRequest, "http://127.0.0.1:3317"), true);
assert.equal(
  isAllowedPhase1PageRequest(
    {
      ...allowedRequest,
      url: "http://127.0.0.1:3317/v1/community/race/status?seasonStart=2026-07-13",
    },
    "http://127.0.0.1:3317",
  ),
  true,
);
for (const request of [
  { ...allowedRequest, url: "https://example.com/asset.js" },
  { ...allowedRequest, url: "http://127.0.0.1:3318/asset.js" },
  { ...allowedRequest, url: "not a URL" },
  { ...allowedRequest, url: "http://user:password@127.0.0.1:3317/asset.js" },
  { ...allowedRequest, headers: { Cookie: "private=value" } },
  { ...allowedRequest, headers: { AUTHORIZATION: "Bearer private" } },
  { ...allowedRequest, headers: { "Proxy-Authorization": "private" } },
  { headers: null, url: allowedRequest.url },
]) {
  assert.equal(isAllowedPhase1PageRequest(request, "http://127.0.0.1:3317"), false);
}

const verificationSnapshot = {
  browserProduct: "Chrome/150.0.7871.129",
  capturePlatform: "win32-x64",
};
assert.equal(
  isMatchingPhase1VerificationEnvironment(
    verificationSnapshot,
    "Chrome/150.0.7871.129",
    "win32-x64",
  ),
  true,
);
assert.equal(
  isMatchingPhase1VerificationEnvironment(
    verificationSnapshot,
    "Chrome/150.0.7871.130",
    "win32-x64",
  ),
  false,
);
assert.equal(
  isMatchingPhase1VerificationEnvironment(
    verificationSnapshot,
    "Chrome/150.0.7871.129",
    "linux-x64",
  ),
  false,
);
assert.equal(
  isMatchingPhase1VerificationEnvironment(null, "Chrome/150.0.7871.129", "win32-x64"),
  false,
);

const exactPixelComparison = {
  baselineHeight: 568,
  baselineWidth: 320,
  changedPixels: 0,
  maxChannelDelta: 0,
  renderedHeight: 568,
  renderedWidth: 320,
  totalChannelDelta: 0,
  totalPixels: 320 * 568,
};
assert.equal(classifyPhase1PixelComparison(exactPixelComparison, 320, 568), "exact");
assert.equal(
  classifyPhase1PixelComparison(
    { ...exactPixelComparison, changedPixels: 1, maxChannelDelta: 4, totalChannelDelta: 7 },
    320,
    568,
  ),
  "different",
);
assert.equal(
  classifyPhase1PixelComparison({ ...exactPixelComparison, renderedWidth: 319 }, 320, 568),
  "invalid",
);
assert.equal(
  classifyPhase1PixelComparison({ ...exactPixelComparison, unexpected: 1 }, 320, 568),
  "invalid",
);
assert.equal(
  classifyPhase1PixelComparison({ ...exactPixelComparison, changedPixels: 1 }, 320, 568),
  "invalid",
);
assert.equal(
  classifyPhase1PixelComparison(exactPixelComparison, Number.MAX_SAFE_INTEGER, 2),
  "invalid",
);

const keyboardAudit = {
  backwardFocus: phase1KeyboardFocusSelectors.at(-2),
  focusIndicatorsVisible: true,
  focusableCount: phase1KeyboardFocusSelectors.length,
  focusedElementsVisible: true,
  forwardFocus: [...phase1KeyboardFocusSelectors],
  pausePressedStates: ["false", "true", "false"],
  skipTargetFocused: true,
  skipVisible: true,
};
assert.equal(classifyPhase1KeyboardAudit(keyboardAudit), "valid");
assert.equal(
  classifyPhase1KeyboardAudit({
    ...keyboardAudit,
    forwardFocus: keyboardAudit.forwardFocus.slice(1),
  }),
  "invalid",
);
assert.equal(classifyPhase1KeyboardAudit({ ...keyboardAudit, unexpected: true }), "invalid");
assert.equal(
  classifyPhase1KeyboardAudit({
    ...keyboardAudit,
    focusableCount: phase1KeyboardFocusSelectors.length - 1,
  }),
  "invalid",
);
assert.equal(
  classifyPhase1KeyboardAudit({ ...keyboardAudit, pausePressedStates: ["false", "true", "true"] }),
  "invalid",
);

const accessibilityNodes = [
  ...phase1RequiredAccessibilityNodes.map((node) => ({ ...node })),
  ...[
    "View standings",
    "Vibe Racing",
    "Weekly race",
    "Score simulator",
    "Leaderboard",
    "Profile",
    "Sign in",
    "Join with invite",
    "VIEW STANDINGS",
  ].map((name) => ({ disabled: false, name, pressed: null, role: "link" })),
];
assert.equal(classifyPhase1AccessibilityTree(accessibilityNodes), "valid");
assert.equal(classifyPhase1AccessibilityTree(accessibilityNodes.slice(1)), "invalid");
assert.equal(
  classifyPhase1AccessibilityTree(
    accessibilityNodes.map((node) =>
      node.role === "link" && node.name === "Vibe Racing" ? { ...node, name: "" } : node,
    ),
  ),
  "invalid",
);
assert.equal(
  classifyPhase1AccessibilityTree([
    ...accessibilityNodes,
    { disabled: false, name: "", pressed: null, role: "main" },
  ]),
  "invalid",
);
assert.equal(
  classifyPhase1AccessibilityTree(
    accessibilityNodes.map((node, index) => (index === 0 ? { ...node, unexpected: true } : node)),
  ),
  "invalid",
);
assert.equal(
  classifyPhase1AccessibilityTree([
    ...accessibilityNodes,
    { disabled: true, name: "", pressed: null, role: "checkbox" },
  ]),
  "invalid",
);

const forcedColorsAudit = {
  active: true,
  canvasAlternativePresent: true,
  canvasPixelsPreserved: true,
  focusIndicatorsVisible: true,
  focusedElementsVisible: true,
  forwardFocus: [...phase1KeyboardFocusSelectors],
  horizontalBounds: true,
  reviewedBordersVisible: true,
};
assert.equal(classifyPhase1ForcedColorsAudit(forcedColorsAudit), "valid");
assert.equal(classifyPhase1ForcedColorsAudit({ ...forcedColorsAudit, active: false }), "invalid");
assert.equal(
  classifyPhase1ForcedColorsAudit({ ...forcedColorsAudit, forwardFocus: [] }),
  "invalid",
);
assert.equal(
  classifyPhase1ForcedColorsAudit({ ...forcedColorsAudit, canvasPixelsPreserved: false }),
  "invalid",
);
assert.equal(
  classifyPhase1ForcedColorsAudit({ ...forcedColorsAudit, focusedElementsVisible: false }),
  "invalid",
);

const webVitalsSample = {
  cumulativeLayoutShift: 0,
  interactionToNextPaintMilliseconds: 32,
  largestContentfulPaintMilliseconds: 400,
};
const webVitalsAudit = phase1WebVitalsModes.map((mode) => ({
  entryTypesSupported: true,
  interactionApplied: true,
  mode,
  samples: Array.from({ length: phase1WebVitalsSampleCount }, () => ({ ...webVitalsSample })),
}));
function replaceFirstWebVitalsSample(replacement) {
  return webVitalsAudit.map((modeAudit, modeIndex) => ({
    ...modeAudit,
    samples: modeAudit.samples.map((sample, sampleIndex) =>
      modeIndex === 0 && sampleIndex === 0 ? { ...sample, ...replacement } : { ...sample },
    ),
  }));
}
assert.equal(classifyPhase1WebVitalsAudit(webVitalsAudit), "valid");
assert.equal(classifyPhase1WebVitalsAudit(webVitalsAudit.slice(1)), "invalid");
assert.equal(classifyPhase1WebVitalsAudit([...webVitalsAudit].reverse()), "invalid");
assert.equal(
  classifyPhase1WebVitalsAudit([
    { ...webVitalsAudit[0], samples: webVitalsAudit[0].samples.slice(1) },
    webVitalsAudit[1],
  ]),
  "invalid",
);
assert.equal(
  classifyPhase1WebVitalsAudit([
    { ...webVitalsAudit[0], entryTypesSupported: false },
    webVitalsAudit[1],
  ]),
  "invalid",
);
assert.equal(
  classifyPhase1WebVitalsAudit([
    { ...webVitalsAudit[0], interactionApplied: false },
    webVitalsAudit[1],
  ]),
  "invalid",
);
assert.equal(
  classifyPhase1WebVitalsAudit(
    replaceFirstWebVitalsSample({
      cumulativeLayoutShift: phase1WebVitalsBudgets.cumulativeLayoutShift + 0.001,
    }),
  ),
  "invalid",
);
assert.equal(
  classifyPhase1WebVitalsAudit(
    replaceFirstWebVitalsSample({
      interactionToNextPaintMilliseconds:
        phase1WebVitalsBudgets.interactionToNextPaintMilliseconds + 1,
    }),
  ),
  "invalid",
);
assert.equal(
  classifyPhase1WebVitalsAudit(
    replaceFirstWebVitalsSample({
      largestContentfulPaintMilliseconds:
        phase1WebVitalsBudgets.largestContentfulPaintMilliseconds + 1,
    }),
  ),
  "invalid",
);
assert.equal(
  classifyPhase1WebVitalsAudit(replaceFirstWebVitalsSample({ cumulativeLayoutShift: -0.001 })),
  "invalid",
);
assert.equal(
  classifyPhase1WebVitalsAudit(
    replaceFirstWebVitalsSample({ interactionToNextPaintMilliseconds: 0 }),
  ),
  "invalid",
);
assert.equal(
  classifyPhase1WebVitalsAudit(
    replaceFirstWebVitalsSample({ largestContentfulPaintMilliseconds: 0 }),
  ),
  "invalid",
);
assert.equal(
  classifyPhase1WebVitalsAudit(
    replaceFirstWebVitalsSample({ largestContentfulPaintMilliseconds: Number.NaN }),
  ),
  "invalid",
);
assert.equal(
  classifyPhase1WebVitalsAudit(replaceFirstWebVitalsSample({ unexpected: true })),
  "invalid",
);

try {
  const nonExecutableBrowser = resolve(temporaryRoot, "not-a-browser.txt");
  writeFileSync(nonExecutableBrowser, "synthetic non-executable fixture\n");
  expectFailure("missing arguments", [], /Usage:/, 2);
  expectFailure(
    "missing explicit mode",
    ["--origin", "http://127.0.0.1:3317/", "--browser", process.execPath],
    /Usage:/,
    2,
  );
  expectFailure(
    "ambiguous write and verify modes",
    ["--origin", "http://127.0.0.1:3317/", "--browser", process.execPath, "--write", "--verify"],
    /Usage:/,
    2,
  );
  expectFailure(
    "repeated package-manager separator",
    ["--", "--", "--origin", "http://127.0.0.1:3317/", ...browserArguments],
    /Usage:/,
    2,
  );
  expectFailure(
    "duplicate origin",
    [
      "--origin",
      "http://127.0.0.1:3317/",
      "--origin",
      "http://127.0.0.1:3318/",
      ...browserArguments,
    ],
    /Usage:/,
    2,
  );
  expectFailure(
    "public origin",
    ["--origin", "https://example.com/", ...browserArguments],
    /exact credential-free loopback HTTP origin/,
  );
  expectFailure(
    "credentialed origin",
    ["--origin", "http://user:password@127.0.0.1:3317/", ...browserArguments],
    /exact credential-free loopback HTTP origin/,
  );
  expectFailure(
    "origin path",
    ["--origin", "http://127.0.0.1:3317/private", ...browserArguments],
    /exact credential-free loopback HTTP origin/,
  );
  expectFailure(
    "privileged port",
    ["--origin", "http://127.0.0.1:80/", ...browserArguments],
    /exact credential-free loopback HTTP origin/,
  );
  expectFailure(
    "relative browser",
    ["--origin", "http://127.0.0.1:3317/", "--browser", "chromium", "--write"],
    /Chromium path must be absolute/,
  );
  expectFailure(
    "browser directory",
    ["--origin", "http://127.0.0.1:3317/", "--browser", temporaryRoot, "--write"],
    /regular non-symbolic-link file/,
  );
  expectFailure(
    "missing browser",
    [
      "--origin",
      "http://127.0.0.1:3317/",
      "--browser",
      resolve(temporaryRoot, "missing-browser"),
      "--write",
    ],
    /one readable regular file/,
  );
  expectFailure(
    "non-browser executable",
    ["--", "--origin", "http://localhost:3317/", ...browserArguments],
    /exited before opening DevTools/,
  );
  expectFailure(
    "verify mode with non-browser executable",
    ["--origin", "http://127.0.0.1:3317/", "--browser", process.execPath, "--verify"],
    /exited before opening DevTools/,
  );
  const launchFailure = expectFailure(
    "non-executable browser file",
    ["--origin", "http://127.0.0.1:3317/", "--browser", nonExecutableBrowser, "--write"],
    /exited before opening DevTools/,
  );
  assert.equal(launchFailure.output.includes(temporaryRoot), false);
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}

console.log(
  `Phase 1 visual-baseline capture guardrail tests passed (${caseCount} CLI cases, ` +
    "10 request-policy, 4 environment-policy, 6 pixel-policy, 5 keyboard-policy, " +
    "6 accessibility-tree-policy, 5 forced-colors-policy, and 14 web-vitals-policy assertions).",
);

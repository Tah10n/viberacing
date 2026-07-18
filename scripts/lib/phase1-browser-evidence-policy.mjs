// Closed classifiers for the explicit local Phase 1 Chrome evidence gate.
// cspell:ignore contentful contentinfo menuitemcheckbox menuitemradio spinbutton

export const phase1KeyboardFocusSelectors = Object.freeze([
  ".skip-link",
  ".brand-lockup",
  '.site-nav a[href="#race"]',
  '.site-nav a[href="#simulator"]',
  '.site-nav a[href="#leaderboard"]',
  '.site-nav a[href="#profile"]',
  '.site-nav a[href="/login"]',
  '.site-nav a[href="/join"]',
  ".primary-action",
  ".race-section .pixel-button",
  ".race-controls label:nth-of-type(1) select",
  ".race-controls label:nth-of-type(2) select",
  ".race-controls label:nth-of-type(3) select",
  ".simulator-input",
  ".simulator-controls label:nth-of-type(2) select",
  ".table-region",
]);

export const phase1WebVitalsBudgets = Object.freeze({
  cumulativeLayoutShift: 0.1,
  interactionToNextPaintMilliseconds: 200,
  largestContentfulPaintMilliseconds: 2_500,
});
export const phase1WebVitalsModes = Object.freeze(["animation-on", "reduced-motion"]);
export const phase1WebVitalsSampleCount = 3;

export const phase1RequiredAccessibilityNodes = Object.freeze([
  Object.freeze({
    disabled: false,
    name: "Vibe Racing — community coding race",
    pressed: null,
    role: "RootWebArea",
  }),
  Object.freeze({ disabled: false, name: "", pressed: null, role: "banner" }),
  Object.freeze({ disabled: false, name: "Primary navigation", pressed: null, role: "navigation" }),
  Object.freeze({ disabled: false, name: "", pressed: null, role: "main" }),
  Object.freeze({
    disabled: false,
    name: "BUILD FAST. RACE FAIR.",
    pressed: null,
    role: "heading",
  }),
  Object.freeze({
    disabled: false,
    name:
      "Weekly race. Scores are self-reported by participating users. " +
      "They are not audited or endorsed by OpenAI.",
    pressed: null,
    role: "image",
  }),
  Object.freeze({ disabled: false, name: "PAUSE RACE", pressed: "false", role: "button" }),
  Object.freeze({ disabled: false, name: "THEME", pressed: null, role: "combobox" }),
  Object.freeze({ disabled: false, name: "LANGUAGE", pressed: null, role: "combobox" }),
  Object.freeze({ disabled: false, name: "MOTION", pressed: null, role: "combobox" }),
  Object.freeze({
    disabled: false,
    name: "ACTIVE DAYS THIS WEEK",
    pressed: null,
    role: "combobox",
  }),
  Object.freeze({
    disabled: false,
    name: "HYPOTHETICAL TOKENS PER ACTIVE DAY",
    pressed: null,
    role: "textbox",
  }),
  Object.freeze({
    disabled: false,
    name:
      "Community leaderboard: Leaderboard. Scores are self-reported by participating users. " +
      "They are not audited or endorsed by OpenAI.",
    pressed: null,
    role: "table",
  }),
  Object.freeze({ disabled: true, name: "UNAVAILABLE", pressed: null, role: "button" }),
  Object.freeze({ disabled: false, name: "", pressed: null, role: "contentinfo" }),
]);

const exactInteractiveCounts = Object.freeze({ button: 2, combobox: 4, link: 9, textbox: 1 });
const exactInteractiveNodes = Object.freeze([
  Object.freeze({ disabled: false, name: "PAUSE RACE", pressed: "false", role: "button" }),
  Object.freeze({ disabled: true, name: "UNAVAILABLE", pressed: null, role: "button" }),
  Object.freeze({ disabled: false, name: "THEME", pressed: null, role: "combobox" }),
  Object.freeze({ disabled: false, name: "LANGUAGE", pressed: null, role: "combobox" }),
  Object.freeze({ disabled: false, name: "MOTION", pressed: null, role: "combobox" }),
  Object.freeze({
    disabled: false,
    name: "ACTIVE DAYS THIS WEEK",
    pressed: null,
    role: "combobox",
  }),
  Object.freeze({
    disabled: false,
    name: "HYPOTHETICAL TOKENS PER ACTIVE DAY",
    pressed: null,
    role: "textbox",
  }),
  Object.freeze({ disabled: false, name: "View standings", pressed: null, role: "link" }),
  Object.freeze({ disabled: false, name: "Vibe Racing", pressed: null, role: "link" }),
  Object.freeze({ disabled: false, name: "Weekly race", pressed: null, role: "link" }),
  Object.freeze({ disabled: false, name: "Score simulator", pressed: null, role: "link" }),
  Object.freeze({ disabled: false, name: "Leaderboard", pressed: null, role: "link" }),
  Object.freeze({ disabled: false, name: "Profile", pressed: null, role: "link" }),
  Object.freeze({ disabled: false, name: "Sign in", pressed: null, role: "link" }),
  Object.freeze({ disabled: false, name: "Join with invite", pressed: null, role: "link" }),
  Object.freeze({ disabled: false, name: "VIEW STANDINGS", pressed: null, role: "link" }),
]);
const exactStructuralCounts = Object.freeze({
  RootWebArea: 1,
  banner: 1,
  contentinfo: 1,
  image: 1,
  main: 1,
  navigation: 1,
  table: 1,
});
const reviewedInteractiveRoles = new Set(Object.keys(exactInteractiveCounts));
const unreviewedInteractiveRoles = new Set([
  "checkbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "treeitem",
]);

function isPlainRecord(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasExactKeys(value, expectedKeys) {
  return (
    isPlainRecord(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expectedKeys].sort())
  );
}

function isExactNode(node, expected) {
  return (
    node.disabled === expected.disabled &&
    node.name === expected.name &&
    node.pressed === expected.pressed &&
    node.role === expected.role
  );
}

function nodeKey(node) {
  return JSON.stringify([node.role, node.name, node.disabled, node.pressed]);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function classifyPhase1KeyboardAudit(value) {
  if (
    !hasExactKeys(value, [
      "backwardFocus",
      "focusIndicatorsVisible",
      "focusableCount",
      "forwardFocus",
      "focusedElementsVisible",
      "pausePressedStates",
      "skipTargetFocused",
      "skipVisible",
    ]) ||
    value.backwardFocus !== phase1KeyboardFocusSelectors.at(-2) ||
    value.focusIndicatorsVisible !== true ||
    value.focusableCount !== phase1KeyboardFocusSelectors.length ||
    JSON.stringify(value.forwardFocus) !== JSON.stringify(phase1KeyboardFocusSelectors) ||
    value.focusedElementsVisible !== true ||
    JSON.stringify(value.pausePressedStates) !== JSON.stringify(["false", "true", "false"]) ||
    value.skipTargetFocused !== true ||
    value.skipVisible !== true
  ) {
    return "invalid";
  }
  return "valid";
}

export function classifyPhase1AccessibilityTree(nodes) {
  if (!Array.isArray(nodes) || nodes.length < 20 || nodes.length > 2_048) {
    return "invalid";
  }
  for (const node of nodes) {
    if (
      !hasExactKeys(node, ["disabled", "name", "pressed", "role"]) ||
      typeof node.disabled !== "boolean" ||
      typeof node.name !== "string" ||
      node.name.length > 1_000 ||
      (node.pressed !== null && typeof node.pressed !== "string") ||
      typeof node.role !== "string" ||
      node.role.length === 0 ||
      node.role.length > 80
    ) {
      return "invalid";
    }
  }

  if (
    phase1RequiredAccessibilityNodes.some(
      (expected) => !nodes.some((node) => isExactNode(node, expected)),
    )
  ) {
    return "invalid";
  }

  for (const [role, expectedCount] of Object.entries(exactInteractiveCounts)) {
    const roleNodes = nodes.filter((node) => node.role === role);
    if (roleNodes.length !== expectedCount || roleNodes.some((node) => node.name.trim() === "")) {
      return "invalid";
    }
  }
  const actualInteractiveNodes = nodes
    .filter((node) => reviewedInteractiveRoles.has(node.role))
    .map(nodeKey)
    .sort();
  const expectedInteractiveNodes = exactInteractiveNodes.map(nodeKey).sort();
  if (JSON.stringify(actualInteractiveNodes) !== JSON.stringify(expectedInteractiveNodes)) {
    return "invalid";
  }
  for (const [role, expectedCount] of Object.entries(exactStructuralCounts)) {
    if (nodes.filter((node) => node.role === role).length !== expectedCount) {
      return "invalid";
    }
  }
  if (
    nodes.some(
      (node) =>
        (reviewedInteractiveRoles.has(node.role) && node.name.trim() === "") ||
        unreviewedInteractiveRoles.has(node.role),
    )
  ) {
    return "invalid";
  }
  return "valid";
}

export function classifyPhase1ForcedColorsAudit(value) {
  if (
    !hasExactKeys(value, [
      "active",
      "canvasAlternativePresent",
      "canvasPixelsPreserved",
      "focusIndicatorsVisible",
      "focusedElementsVisible",
      "forwardFocus",
      "horizontalBounds",
      "reviewedBordersVisible",
    ]) ||
    value.active !== true ||
    value.canvasAlternativePresent !== true ||
    value.canvasPixelsPreserved !== true ||
    value.focusIndicatorsVisible !== true ||
    value.focusedElementsVisible !== true ||
    JSON.stringify(value.forwardFocus) !== JSON.stringify(phase1KeyboardFocusSelectors) ||
    value.horizontalBounds !== true ||
    value.reviewedBordersVisible !== true
  ) {
    return "invalid";
  }
  return "valid";
}

export function classifyPhase1WebVitalsAudit(value) {
  if (!Array.isArray(value) || value.length !== phase1WebVitalsModes.length) {
    return "invalid";
  }
  for (const [index, modeAudit] of value.entries()) {
    if (
      !hasExactKeys(modeAudit, ["entryTypesSupported", "interactionApplied", "mode", "samples"]) ||
      modeAudit.entryTypesSupported !== true ||
      modeAudit.interactionApplied !== true ||
      modeAudit.mode !== phase1WebVitalsModes[index] ||
      !Array.isArray(modeAudit.samples) ||
      modeAudit.samples.length !== phase1WebVitalsSampleCount
    ) {
      return "invalid";
    }
    for (const sample of modeAudit.samples) {
      if (
        !hasExactKeys(sample, [
          "cumulativeLayoutShift",
          "interactionToNextPaintMilliseconds",
          "largestContentfulPaintMilliseconds",
        ]) ||
        !isFiniteNumber(sample.cumulativeLayoutShift) ||
        sample.cumulativeLayoutShift < 0 ||
        sample.cumulativeLayoutShift > phase1WebVitalsBudgets.cumulativeLayoutShift ||
        !isFiniteNumber(sample.interactionToNextPaintMilliseconds) ||
        sample.interactionToNextPaintMilliseconds <= 0 ||
        sample.interactionToNextPaintMilliseconds >
          phase1WebVitalsBudgets.interactionToNextPaintMilliseconds ||
        !isFiniteNumber(sample.largestContentfulPaintMilliseconds) ||
        sample.largestContentfulPaintMilliseconds <= 0 ||
        sample.largestContentfulPaintMilliseconds >
          phase1WebVitalsBudgets.largestContentfulPaintMilliseconds
      ) {
        return "invalid";
      }
    }
  }
  return "valid";
}

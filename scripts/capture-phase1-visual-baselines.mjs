import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import {
  classifyPhase1AccessibilityTree,
  classifyPhase1ForcedColorsAudit,
  classifyPhase1KeyboardAudit,
  classifyPhase1WebVitalsAudit,
  phase1KeyboardFocusSelectors,
  phase1WebVitalsModes,
  phase1WebVitalsSampleCount,
} from "./lib/phase1-browser-evidence-policy.mjs";
import { verifyPhase1BaselineDirectory } from "./lib/phase1-visual-baseline-integrity.mjs";
import {
  classifyPhase1PixelComparison,
  expectedPhase1BaselineEntries,
  isAllowedPhase1PageRequest,
  isMatchingPhase1VerificationEnvironment,
  phase1BaselineRoot,
  phase1MaximumCaptureBytes,
  phase1MaximumMatrixBytes,
} from "./lib/phase1-visual-baseline-policy.mjs";
import { inspectPublicPng, readPngDimensions } from "./lib/png-content-policy.mjs";

// cspell:ignore breakpad contentful describedby lede WINDIR

const repositoryRoot = resolve(import.meta.dirname, "..");
const outputRoot = resolve(repositoryRoot, phase1BaselineRoot);
const expectedEntries = expectedPhase1BaselineEntries();
const commandTimeoutMilliseconds = 15_000;

function usage() {
  console.error(
    "Usage: node scripts/capture-phase1-visual-baselines.mjs " +
      "--origin <loopback-url> --browser <absolute-chromium-path> (--write|--verify)",
  );
  process.exit(2);
}

function parseArguments() {
  const parsed = { browser: undefined, mode: undefined, origin: undefined };
  let separatorSeen = false;
  for (let index = 2; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (argument === "--" && !separatorSeen) {
      separatorSeen = true;
      continue;
    }
    if ((argument === "--write" || argument === "--verify") && parsed.mode === undefined) {
      parsed.mode = argument.slice(2);
      continue;
    }
    if ((argument === "--browser" || argument === "--origin") && process.argv[index + 1]) {
      const key = argument.slice(2);
      if (parsed[key] !== undefined) {
        usage();
      }
      parsed[key] = process.argv[index + 1];
      index += 1;
      continue;
    }
    usage();
  }
  if (!parsed.browser || !parsed.origin || !parsed.mode) {
    usage();
  }
  return parsed;
}

function assertLoopbackOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("capture origin is not a URL");
  }
  const port = Number(url.port);
  if (
    url.protocol !== "http:" ||
    !new Set(["127.0.0.1", "localhost"]).has(url.hostname) ||
    !Number.isSafeInteger(port) ||
    port < 1024 ||
    port > 65_535 ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("capture origin must be one exact credential-free loopback HTTP origin");
  }
  return url;
}

async function assertBrowserPath(value) {
  if (!isAbsolute(value)) {
    throw new Error("Chromium path must be absolute");
  }
  let stats;
  try {
    stats = await lstat(value);
  } catch {
    throw new Error("Chromium path must identify one readable regular file");
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error("Chromium path must identify one regular non-symbolic-link file");
  }
  return value;
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function withTimeout(promise, label, milliseconds = commandTimeoutMilliseconds) {
  let timeout;
  return Promise.race([
    promise.finally(() => clearTimeout(timeout)),
    new Promise((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error(`${label} exceeded its fixed deadline`)),
        milliseconds,
      );
    }),
  ]);
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  await withTimeout(
    new Promise((resolveOpen, rejectOpen) => {
      socket.addEventListener("open", resolveOpen, { once: true });
      socket.addEventListener("error", () => rejectOpen(new Error("CDP WebSocket failed")), {
        once: true,
      });
    }),
    "CDP connection",
  );

  let nextId = 1;
  let closed = false;
  const pending = new Map();
  const eventWaiters = new Set();
  const observers = new Set();

  function rejectOutstanding(error) {
    if (closed) {
      return;
    }
    closed = true;
    for (const { reject } of pending.values()) {
      reject(error);
    }
    pending.clear();
    for (const waiter of eventWaiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    eventWaiters.clear();
  }

  socket.addEventListener("close", () => rejectOutstanding(new Error("CDP WebSocket closed")));
  socket.addEventListener("error", () => rejectOutstanding(new Error("CDP WebSocket failed")));
  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      rejectOutstanding(new Error("CDP returned malformed JSON"));
      return;
    }
    if (message.id !== undefined) {
      const request = pending.get(message.id);
      if (!request) {
        return;
      }
      pending.delete(message.id);
      clearTimeout(request.timeout);
      if (message.error) {
        request.reject(new Error(`CDP ${request.method} failed`));
      } else {
        request.resolve(message.result ?? {});
      }
      return;
    }
    for (const observer of observers) {
      observer(message);
    }
    for (const waiter of eventWaiters) {
      if (waiter.method === message.method && waiter.sessionId === message.sessionId) {
        eventWaiters.delete(waiter);
        clearTimeout(waiter.timeout);
        waiter.resolve(message.params ?? {});
      }
    }
  });

  function send(method, params = {}, sessionId = undefined) {
    if (closed) {
      return Promise.reject(new Error("CDP WebSocket is closed"));
    }
    const id = nextId;
    nextId += 1;
    return new Promise((resolveRequest, rejectRequest) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        rejectRequest(new Error(`CDP ${method} exceeded its fixed deadline`));
      }, commandTimeoutMilliseconds);
      pending.set(id, { method, reject: rejectRequest, resolve: resolveRequest, timeout });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  function waitForEvent(method, sessionId) {
    return new Promise((resolveEvent, rejectEvent) => {
      const waiter = {
        method,
        reject: rejectEvent,
        resolve: resolveEvent,
        sessionId,
        timeout: undefined,
      };
      waiter.timeout = setTimeout(() => {
        eventWaiters.delete(waiter);
        rejectEvent(new Error(`CDP event ${method} exceeded its fixed deadline`));
      }, commandTimeoutMilliseconds);
      eventWaiters.add(waiter);
    });
  }

  return Object.freeze({
    close() {
      rejectOutstanding(new Error("CDP connection closed by capture harness"));
      socket.close();
    },
    observe(observer) {
      observers.add(observer);
      return () => observers.delete(observer);
    },
    send,
    waitForEvent,
  });
}

async function waitForDevTools(profilePath, child, browserLaunchFailed) {
  const activePortPath = resolve(profilePath, "DevToolsActivePort");
  const deadline = Date.now() + commandTimeoutMilliseconds;
  while (Date.now() < deadline) {
    if (browserLaunchFailed() || child.exitCode !== null) {
      throw new Error("isolated Chromium exited before opening DevTools");
    }
    try {
      const [portText, browserPath] = (await readFile(activePortPath, "utf8"))
        .trim()
        .split(/\r?\n/);
      const port = Number(portText);
      if (
        Number.isSafeInteger(port) &&
        port >= 1024 &&
        port <= 65_535 &&
        /^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(browserPath)
      ) {
        return `ws://127.0.0.1:${port}${browserPath}`;
      }
    } catch {
      // The file is created atomically after the isolated browser starts listening.
    }
    await delay(50);
  }
  throw new Error("isolated Chromium did not expose DevTools before the fixed deadline");
}

async function evaluate(connection, sessionId, expression) {
  const response = await connection.send(
    "Runtime.evaluate",
    { awaitPromise: true, expression, returnByValue: true },
    sessionId,
  );
  if (response.exceptionDetails || response.result?.subtype === "error") {
    throw new Error("browser evaluation failed without exposing page detail");
  }
  return response.result?.value;
}

async function reload(connection, sessionId) {
  const loaded = connection.waitForEvent("Page.loadEventFired", sessionId);
  await Promise.all([loaded, connection.send("Page.reload", { ignoreCache: true }, sessionId)]);
}

async function dispatchKey(
  connection,
  sessionId,
  key,
  code,
  virtualKeyCode,
  modifiers = 0,
  text = undefined,
) {
  const common = {
    code,
    key,
    modifiers,
    nativeVirtualKeyCode: virtualKeyCode,
    windowsVirtualKeyCode: virtualKeyCode,
  };
  await connection.send(
    "Input.dispatchKeyEvent",
    {
      ...common,
      ...(text === undefined ? {} : { text, unmodifiedText: text }),
      type: "keyDown",
    },
    sessionId,
  );
  await connection.send("Input.dispatchKeyEvent", { ...common, type: "keyUp" }, sessionId);
  await delay(25);
}

async function dispatchTab(connection, sessionId, backwards = false) {
  await dispatchKey(connection, sessionId, "Tab", "Tab", 9, backwards ? 8 : 0);
}

async function dispatchEnter(connection, sessionId) {
  await dispatchKey(connection, sessionId, "Enter", "Enter", 13, 0, "\r");
}

async function dispatchPrimaryClick(connection, sessionId, point) {
  const common = {
    button: "left",
    clickCount: 1,
    x: point.x,
    y: point.y,
  };
  await connection.send("Input.dispatchMouseEvent", { ...common, type: "mousePressed" }, sessionId);
  await connection.send(
    "Input.dispatchMouseEvent",
    { ...common, type: "mouseReleased" },
    sessionId,
  );
  await delay(25);
}

async function dispatchSpace(connection, sessionId) {
  await dispatchKey(connection, sessionId, " ", "Space", 32, 0, " ");
}

async function clearDocumentFocus(connection, sessionId, clearHash = false) {
  const cleared = await evaluate(
    connection,
    sessionId,
    `(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      if (${clearHash ? "true" : "false"} && location.hash !== "") {
        history.replaceState(history.state, "", location.pathname + location.search);
      }
      window.scrollTo(0, 0);
      return document.activeElement === document.body;
    })()`,
  );
  if (cleared !== true) {
    throw new Error("isolated browser could not reset document focus");
  }
}

async function inspectFocusedElement(connection, sessionId) {
  const selectors = JSON.stringify(phase1KeyboardFocusSelectors);
  return evaluate(
    connection,
    sessionId,
    `(() => {
      const selectors = ${selectors};
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return null;
      const style = getComputedStyle(active);
      const rect = active.getBoundingClientRect();
      const outlineWidth = Number.parseFloat(style.outlineWidth);
      const outlineOffset = Number.parseFloat(style.outlineOffset);
      const outlineExtent = outlineWidth + Math.max(outlineOffset, 0);
      const outlineColor = style.outlineColor;
      return {
        focusIndicator:
          active.matches(":focus-visible") &&
          style.outlineStyle !== "none" &&
          outlineWidth >= 2 &&
          outlineColor !== "transparent" &&
          outlineColor !== "rgba(0, 0, 0, 0)",
        inViewport:
          rect.width > 0 &&
          rect.height > 0 &&
          rect.left - outlineExtent >= 0 &&
          rect.top - outlineExtent >= 0 &&
          rect.right + outlineExtent <= window.innerWidth &&
          rect.bottom + outlineExtent <= window.innerHeight,
        selector: selectors.find((selector) => active.matches(selector)) ?? null,
        skipBounds:
          !active.matches(".skip-link") ||
          (rect.top >= 0 && rect.left >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight)
      };
    })()`,
  );
}

async function runPhase1KeyboardAudit(connection, sessionId, expected) {
  await clearDocumentFocus(connection, sessionId, true);
  const focusableCount = await evaluate(
    connection,
    sessionId,
    `(() => {
      return Array.from(document.querySelectorAll("*")).filter((element) => {
        if (!(element instanceof HTMLElement) || element.tabIndex < 0) return false;
        if ("disabled" in element && element.disabled === true) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      }).length;
    })()`,
  );

  await dispatchTab(connection, sessionId);
  const skipFocus = await inspectFocusedElement(connection, sessionId);
  await dispatchEnter(connection, sessionId);
  const skipTargetFocused = await evaluate(
    connection,
    sessionId,
    'location.hash === "#leaderboard" && document.activeElement?.id === "leaderboard"',
  );

  await clearDocumentFocus(connection, sessionId, true);
  await reload(connection, sessionId);
  await waitForStableState(connection, sessionId, expected);
  await clearDocumentFocus(connection, sessionId);
  const forwardFocus = [];
  let focusIndicatorsVisible = true;
  let focusedElementsVisible = true;
  let pausePressedStates;
  const pauseButtonIndex = phase1KeyboardFocusSelectors.indexOf(".race-section .pixel-button");
  if (pauseButtonIndex < 0) {
    throw new Error("closed Phase 1 focus inventory has no pause control");
  }
  for (let index = 0; index < phase1KeyboardFocusSelectors.length; index += 1) {
    await dispatchTab(connection, sessionId);
    const focused = await inspectFocusedElement(connection, sessionId);
    forwardFocus.push(focused?.selector ?? null);
    focusIndicatorsVisible &&= focused?.focusIndicator === true;
    focusedElementsVisible &&= focused?.inViewport === true;

    if (index === pauseButtonIndex) {
      const before = await evaluate(
        connection,
        sessionId,
        'document.activeElement?.getAttribute("aria-pressed")',
      );
      await dispatchSpace(connection, sessionId);
      const pressed = await evaluate(
        connection,
        sessionId,
        'document.activeElement?.getAttribute("aria-pressed")',
      );
      await dispatchSpace(connection, sessionId);
      const restored = await evaluate(
        connection,
        sessionId,
        'document.activeElement?.getAttribute("aria-pressed")',
      );
      pausePressedStates = [before, pressed, restored];
    }
  }

  await dispatchTab(connection, sessionId, true);
  const backward = await inspectFocusedElement(connection, sessionId);
  const audit = {
    backwardFocus: backward?.selector ?? null,
    focusIndicatorsVisible,
    focusableCount,
    focusedElementsVisible,
    forwardFocus,
    pausePressedStates,
    skipTargetFocused,
    skipVisible:
      skipFocus?.selector === phase1KeyboardFocusSelectors[0] &&
      skipFocus.focusIndicator === true &&
      skipFocus.inViewport === true &&
      skipFocus.skipBounds === true,
  };
  if (classifyPhase1KeyboardAudit(audit) !== "valid") {
    throw new Error("keyboard traversal violates the closed Phase 1 accessibility policy");
  }
}

async function runPhase1AccessibilityTreeAudit(connection, sessionId) {
  const tree = await connection.send("Accessibility.getFullAXTree", {}, sessionId);
  if (!Array.isArray(tree.nodes)) {
    throw new Error("isolated browser did not return an accessibility tree");
  }
  const nodes = tree.nodes
    .filter((node) => node?.ignored !== true && typeof node?.role?.value === "string")
    .map((node) => {
      const properties = new Map(
        Array.isArray(node.properties)
          ? node.properties.map((property) => [property.name, property.value?.value])
          : [],
      );
      const pressed = properties.get("pressed");
      return {
        disabled: properties.get("disabled") === true,
        name: typeof node.name?.value === "string" ? node.name.value : "",
        pressed: pressed === undefined ? null : String(pressed),
        role: node.role.value,
      };
    });
  if (classifyPhase1AccessibilityTree(nodes) !== "valid") {
    throw new Error("accessibility tree violates the closed Phase 1 semantic policy");
  }
}

async function waitForLazyRace(connection, sessionId) {
  const deadline = Date.now() + commandTimeoutMilliseconds;
  while (Date.now() < deadline) {
    const ready = await evaluate(
      connection,
      sessionId,
      `(() => {
        const canvas = document.querySelector(".race-canvas");
        const description = canvas?.getAttribute("aria-describedby");
        return (
          canvas instanceof HTMLCanvasElement &&
          canvas.getAttribute("role") === "img" &&
          Boolean(canvas.getAttribute("aria-label")) &&
          Boolean(description && document.getElementById(description)?.textContent?.trim())
        );
      })()`,
    );
    if (ready === true) {
      return;
    }
    await delay(50);
  }
  throw new Error("lazy race did not expose its semantic alternative before the fixed deadline");
}

async function runPhase1ForcedColorsAudit(connection, sessionId) {
  await clearDocumentFocus(connection, sessionId);
  const forwardFocus = [];
  let focusIndicatorsVisible = true;
  let focusedElementsVisible = true;
  for (let index = 0; index < phase1KeyboardFocusSelectors.length; index += 1) {
    await dispatchTab(connection, sessionId);
    const focused = await inspectFocusedElement(connection, sessionId);
    forwardFocus.push(focused?.selector ?? null);
    focusIndicatorsVisible &&= focused?.focusIndicator === true;
    focusedElementsVisible &&= focused?.inViewport === true;
  }
  const rendered = await evaluate(
    connection,
    sessionId,
    `(() => {
      const reviewedBorders = [
        ".brand-pixels",
        ".demo-badge",
        ".primary-action",
        ".secondary-action",
        ".pixel-button:not(:disabled)",
        ".trust-banner",
        ".race-alternative",
        ".race-console",
        ".race-canvas",
        ".table-region",
        ".profile-grid article",
        ".method-grid article"
      ];
      const bordersVisible = reviewedBorders.every((selector) => {
        const elements = [...document.querySelectorAll(selector)];
        return elements.length > 0 && elements.every((element) => {
          if (!(element instanceof HTMLElement)) return false;
          const style = getComputedStyle(element);
          return (
            style.borderTopStyle !== "none" &&
            Number.parseFloat(style.borderTopWidth) >= 2 &&
            style.borderTopColor !== "transparent" &&
            style.borderTopColor !== "rgba(0, 0, 0, 0)"
          );
        });
      });
      const canvas = document.querySelector(".race-canvas");
      const description = canvas?.getAttribute("aria-describedby");
      return {
        active: matchMedia("(forced-colors: active)").matches,
        canvasAlternativePresent:
          canvas?.getAttribute("role") === "img" &&
          Boolean(canvas.getAttribute("aria-label")) &&
          Boolean(description && document.getElementById(description)?.textContent?.trim()),
        canvasPixelsPreserved:
          canvas instanceof HTMLCanvasElement && getComputedStyle(canvas).forcedColorAdjust === "none",
        horizontalBounds: document.documentElement.scrollWidth <= window.innerWidth,
        reviewedBordersVisible: bordersVisible
      };
    })()`,
  );
  const audit = {
    ...rendered,
    focusIndicatorsVisible,
    focusedElementsVisible,
    forwardFocus,
  };
  if (classifyPhase1ForcedColorsAudit(audit) !== "valid") {
    throw new Error("forced-colors rendering violates the closed Phase 1 accessibility policy");
  }
}

function createPhase1WebVitalsInitializer(motion) {
  return `(() => {
    localStorage.setItem("viberacing.theme", "classic-grand-prix");
    localStorage.setItem("viberacing.locale", "en");
    localStorage.setItem("viberacing.motion", ${JSON.stringify(motion)});
    const requiredEntryTypes = ["event", "first-input", "largest-contentful-paint", "layout-shift"];
    const supportedEntryTypes = PerformanceObserver.supportedEntryTypes ?? [];
    const state = {
      cumulativeLayoutShift: 0,
      entryTypesSupported: requiredEntryTypes.every((type) => supportedEntryTypes.includes(type)),
      firstInputDurationMilliseconds: null,
      interactions: Object.create(null),
      largestContentfulPaintMilliseconds: null,
      layoutShiftWindowLastTime: null,
      layoutShiftWindowStartTime: null,
      layoutShiftWindowValue: 0,
      observers: []
    };
    Object.defineProperty(window, "__viberacingPhase1WebVitals", { value: state });
    if (!state.entryTypesSupported) return;

    const layoutShiftObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput === true) continue;
        const startsNewWindow =
          state.layoutShiftWindowLastTime === null ||
          entry.startTime - state.layoutShiftWindowLastTime > 1000 ||
          entry.startTime - state.layoutShiftWindowStartTime > 5000;
        if (startsNewWindow) {
          state.layoutShiftWindowStartTime = entry.startTime;
          state.layoutShiftWindowValue = entry.value;
        } else {
          state.layoutShiftWindowValue += entry.value;
        }
        state.layoutShiftWindowLastTime = entry.startTime;
        state.cumulativeLayoutShift = Math.max(
          state.cumulativeLayoutShift,
          state.layoutShiftWindowValue
        );
      }
    });
    layoutShiftObserver.observe({ buffered: true, type: "layout-shift" });

    const largestContentfulPaintObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const latest = entries.at(-1);
      if (latest) state.largestContentfulPaintMilliseconds = latest.startTime;
    });
    largestContentfulPaintObserver.observe({ buffered: true, type: "largest-contentful-paint" });

    const firstInputObserver = new PerformanceObserver((list) => {
      const first = list.getEntries().at(0);
      if (first) state.firstInputDurationMilliseconds = first.duration;
    });
    firstInputObserver.observe({ buffered: true, type: "first-input" });

    const eventObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!Number.isSafeInteger(entry.interactionId) || entry.interactionId <= 0) continue;
        const key = String(entry.interactionId);
        state.interactions[key] = Math.max(state.interactions[key] ?? 0, entry.duration);
      }
    });
    eventObserver.observe({ buffered: true, durationThreshold: 16, type: "event" });
    state.observers.push(
      layoutShiftObserver,
      largestContentfulPaintObserver,
      firstInputObserver,
      eventObserver
    );
  })()`;
}

async function waitForPhase1WebVitalsSample(connection, sessionId) {
  const deadline = Date.now() + commandTimeoutMilliseconds;
  let lastResult;
  while (Date.now() < deadline) {
    const result = await evaluate(
      connection,
      sessionId,
      `(() => {
        const state = window.__viberacingPhase1WebVitals;
        const durations = state ? Object.values(state.interactions).filter(Number.isFinite) : [];
        const interactionToNextPaint =
          durations.length > 0
            ? Math.max(...durations)
            : state?.firstInputDurationMilliseconds;
        const pause = document.querySelector(".race-section .pixel-button");
        return {
          entryTypesSupported: state?.entryTypesSupported === true,
          interactionApplied: pause?.getAttribute("aria-pressed") === "true",
          sample: {
            cumulativeLayoutShift:
              typeof state?.cumulativeLayoutShift === "number" ? state.cumulativeLayoutShift : null,
            interactionToNextPaintMilliseconds:
              typeof interactionToNextPaint === "number" ? interactionToNextPaint : null,
            largestContentfulPaintMilliseconds:
              typeof state?.largestContentfulPaintMilliseconds === "number"
                ? state.largestContentfulPaintMilliseconds
                : null
          }
        };
      })()`,
    );
    lastResult = result;
    if (result?.entryTypesSupported !== true) {
      throw new Error("isolated browser lacks the reviewed Web Vitals performance entry types");
    }
    if (
      result.interactionApplied === true &&
      Number.isFinite(result.sample?.cumulativeLayoutShift) &&
      Number.isFinite(result.sample?.interactionToNextPaintMilliseconds) &&
      Number.isFinite(result.sample?.largestContentfulPaintMilliseconds)
    ) {
      return result;
    }
    await delay(50);
  }
  throw new Error(
    "isolated browser did not produce the closed Web Vitals sample before deadline " +
      `(${JSON.stringify({
        cumulativeLayoutShift: Number.isFinite(lastResult?.sample?.cumulativeLayoutShift),
        entryTypesSupported: lastResult?.entryTypesSupported === true,
        interactionApplied: lastResult?.interactionApplied === true,
        interactionToNextPaint: Number.isFinite(
          lastResult?.sample?.interactionToNextPaintMilliseconds,
        ),
        largestContentfulPaint: Number.isFinite(
          lastResult?.sample?.largestContentfulPaintMilliseconds,
        ),
      })})`,
  );
}

async function runPhase1WebVitalsAudit(connection, sessionId, settleRequestActions) {
  await connection.send("Network.enable", {}, sessionId);
  await connection.send("Network.setCacheDisabled", { cacheDisabled: true }, sessionId);
  await connection.send(
    "Emulation.setDeviceMetricsOverride",
    {
      deviceScaleFactor: 1,
      height: 720,
      mobile: false,
      screenHeight: 720,
      screenWidth: 1280,
      width: 1280,
    },
    sessionId,
  );

  const audits = [];
  for (const mode of phase1WebVitalsModes) {
    const motion = mode === "animation-on" ? "on" : "off";
    const reducedMotion = mode === "reduced-motion" ? "reduce" : "no-preference";
    const samples = [];
    let entryTypesSupported = true;
    let interactionApplied = true;
    for (let index = 0; index < phase1WebVitalsSampleCount; index += 1) {
      await connection.send(
        "Emulation.setEmulatedMedia",
        { features: [{ name: "prefers-reduced-motion", value: reducedMotion }], media: "screen" },
        sessionId,
      );
      await connection.send("Network.clearBrowserCache", {}, sessionId);
      const initializer = await connection.send(
        "Page.addScriptToEvaluateOnNewDocument",
        { source: createPhase1WebVitalsInitializer(motion) },
        sessionId,
      );
      if (typeof initializer.identifier !== "string") {
        throw new Error("isolated browser did not register the Web Vitals initializer");
      }
      await reload(connection, sessionId);
      await connection.send(
        "Page.removeScriptToEvaluateOnNewDocument",
        { identifier: initializer.identifier },
        sessionId,
      );
      await waitForStableState(connection, sessionId, {
        file: `phase1-web-vitals-${mode}-${index + 1}`,
        height: 720,
        locale: "en",
        motion,
        theme: "classic-grand-prix",
        width: 1280,
      });
      await waitForLazyRace(connection, sessionId);
      await settleRequestActions();
      const pauseTarget = await evaluate(
        connection,
        sessionId,
        `(() => {
          const pause = document.querySelector(".race-section .pixel-button");
          if (!(pause instanceof HTMLButtonElement) || pause.disabled) return null;
          pause.focus();
          const bounds = pause.getBoundingClientRect();
          if (
            document.activeElement !== pause ||
            pause.getAttribute("aria-pressed") !== "false" ||
            bounds.width <= 0 ||
            bounds.height <= 0 ||
            bounds.top < 0 ||
            bounds.left < 0 ||
            bounds.bottom > window.innerHeight ||
            bounds.right > window.innerWidth
          ) return null;
          return {
            x: bounds.left + bounds.width / 2,
            y: bounds.top + bounds.height / 2
          };
        })()`,
      );
      if (
        !Number.isFinite(pauseTarget?.x) ||
        !Number.isFinite(pauseTarget?.y) ||
        pauseTarget.x <= 0 ||
        pauseTarget.y <= 0
      ) {
        throw new Error("isolated browser could not prepare the Web Vitals interaction target");
      }
      await dispatchPrimaryClick(connection, sessionId, pauseTarget);
      await evaluate(
        connection,
        sessionId,
        `(async () => {
          await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
          return true;
        })()`,
      );
      const result = await waitForPhase1WebVitalsSample(connection, sessionId);
      entryTypesSupported &&= result.entryTypesSupported === true;
      interactionApplied &&= result.interactionApplied === true;
      samples.push(result.sample);
    }
    audits.push({ entryTypesSupported, interactionApplied, mode, samples });
  }
  if (classifyPhase1WebVitalsAudit(audits) !== "valid") {
    throw new Error("Web Vitals samples violate the closed Phase 1 performance policy");
  }
  return audits;
}

function formatPhase1WebVitalsMaxima(audits) {
  return audits
    .map((audit) => {
      const largestContentfulPaint = Math.max(
        ...audit.samples.map((sample) => sample.largestContentfulPaintMilliseconds),
      );
      const cumulativeLayoutShift = Math.max(
        ...audit.samples.map((sample) => sample.cumulativeLayoutShift),
      );
      const interactionToNextPaint = Math.max(
        ...audit.samples.map((sample) => sample.interactionToNextPaintMilliseconds),
      );
      return (
        `${audit.mode} LCP ${largestContentfulPaint.toFixed(1)} ms, ` +
        `CLS ${cumulativeLayoutShift.toFixed(3)}, interaction ${interactionToNextPaint.toFixed(1)} ms`
      );
    })
    .join("; ");
}

async function compareDecodedPngPixels(
  connection,
  sessionId,
  baselineBuffer,
  renderedBuffer,
  expected,
) {
  const baselineBase64 = JSON.stringify(baselineBuffer.toString("base64"));
  const renderedBase64 = JSON.stringify(renderedBuffer.toString("base64"));
  const comparison = await evaluate(
    connection,
    sessionId,
    `(async () => {
      const decode = async (base64) => {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("canvas context unavailable");
        context.drawImage(bitmap, 0, 0);
        const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
        const result = { height: bitmap.height, pixels, width: bitmap.width };
        bitmap.close();
        return result;
      };
      const [baseline, rendered] = await Promise.all([
        decode(${baselineBase64}),
        decode(${renderedBase64})
      ]);
      let changedPixels = 0;
      let maxChannelDelta = 0;
      let totalChannelDelta = 0;
      const comparableLength = Math.min(baseline.pixels.length, rendered.pixels.length);
      for (let offset = 0; offset < comparableLength; offset += 4) {
        let pixelChanged = false;
        for (let channel = 0; channel < 4; channel += 1) {
          const delta = Math.abs(baseline.pixels[offset + channel] - rendered.pixels[offset + channel]);
          totalChannelDelta += delta;
          maxChannelDelta = Math.max(maxChannelDelta, delta);
          pixelChanged ||= delta !== 0;
        }
        changedPixels += pixelChanged ? 1 : 0;
      }
      return {
        baselineHeight: baseline.height,
        baselineWidth: baseline.width,
        changedPixels,
        maxChannelDelta,
        renderedHeight: rendered.height,
        renderedWidth: rendered.width,
        totalChannelDelta,
        totalPixels: baseline.width * baseline.height
      };
    })()`,
  );
  const outcome = classifyPhase1PixelComparison(comparison, expected.width, expected.height);
  if (outcome === "invalid") {
    throw new Error("isolated browser returned an out-of-policy semantic pixel comparison");
  }
  const totalPixels = expected.width * expected.height;
  if (outcome === "different") {
    throw new Error(
      `${expected.file} differs from the committed decoded pixels ` +
        `(${comparison.changedPixels} of ${totalPixels} pixels changed; ` +
        `maximum channel delta ${comparison.maxChannelDelta})`,
    );
  }
}

async function waitForStableState(connection, sessionId, expected) {
  const expectedMotion = expected.motion ?? "off";
  const deadline = Date.now() + commandTimeoutMilliseconds;
  let lastState;
  while (Date.now() < deadline) {
    const state = await evaluate(
      connection,
      sessionId,
      `(() => {
        const app = document.querySelector(".race-app");
        const controls = Array.from(document.querySelectorAll(".race-controls select"));
        const horizontalElements = Array.from(document.querySelectorAll(
          ".brand-lockup, .demo-badge, .site-nav, .site-nav a, .hero-section, " +
          ".hero-copy, .hero-copy h1, .hero-lede, .hero-actions, .trust-banner"
        ));
        const horizontalOverflows = horizontalElements
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.left < -0.5 || rect.right > window.innerWidth + 0.5;
          })
          .map((element) =>
            element.matches(".site-nav a")
              ? "site-nav:" + element.getAttribute("href")
              : element.tagName.toLowerCase() + "." + String(element.className)
          );
        return {
          appMotion: app?.getAttribute("data-motion") ?? null,
          appTheme: app?.getAttribute("data-theme") ?? null,
          controls: controls.map((control) => control.value),
          dataSource: app?.getAttribute("data-score-source") ?? null,
          documentWidth: document.documentElement.scrollWidth,
          horizontalBounds: horizontalOverflows.length === 0,
          horizontalOverflows,
          innerHeight: window.innerHeight,
          innerWidth: window.innerWidth,
          lang: document.documentElement.lang,
          ready: document.readyState === "complete"
        };
      })()`,
    );
    lastState = state;
    if (
      state?.ready === true &&
      state.appTheme === expected.theme &&
      state.appMotion === expectedMotion &&
      state.lang === expected.locale &&
      state.dataSource === "fallback" &&
      JSON.stringify(state.controls) ===
        JSON.stringify([expected.theme, expected.locale, expectedMotion])
    ) {
      if (
        state.innerWidth !== expected.width ||
        state.innerHeight !== expected.height ||
        state.documentWidth > expected.width ||
        state.horizontalBounds !== true
      ) {
        throw new Error(
          `${expected.file} has horizontal layout outside its canonical viewport ` +
            `(${JSON.stringify({
              documentWidth: state.documentWidth,
              horizontalOverflows: state.horizontalOverflows,
              innerHeight: state.innerHeight,
              innerWidth: state.innerWidth,
            })})`,
        );
      }
      const settledViewport = await evaluate(
        connection,
        sessionId,
        `(async () => {
          window.scrollTo(0, 0);
          if (document.fonts) await document.fonts.ready;
          await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
          return { scrollX: window.scrollX, scrollY: window.scrollY };
        })()`,
      );
      if (settledViewport?.scrollX !== 0 || settledViewport?.scrollY !== 0) {
        throw new Error(`${expected.file} did not settle at the top-left page viewport`);
      }
      return;
    }
    await delay(50);
  }
  throw new Error(
    `${expected.file} did not reach the closed synthetic capture state ` +
      `(${JSON.stringify(lastState ?? null)})`,
  );
}

function minimalBrowserEnvironment(profilePath) {
  const environment = {
    HOME: profilePath,
    NO_PROXY: "127.0.0.1,localhost",
    TEMP: profilePath,
    TMP: profilePath,
    no_proxy: "127.0.0.1,localhost",
  };
  for (const key of ["SystemRoot", "WINDIR", "LANG", "LC_ALL"]) {
    if (process.env[key]) {
      environment[key] = process.env[key];
    }
  }
  return environment;
}

async function stopChild(child) {
  if (child.exitCode !== null || child.pid === undefined) {
    return;
  }
  child.kill();
  await Promise.race([new Promise((resolveExit) => child.once("exit", resolveExit)), delay(2_000)]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await Promise.race([
      new Promise((resolveExit) => child.once("exit", resolveExit)),
      delay(2_000),
    ]);
  }
}

async function removeTemporaryProfile(profilePath) {
  try {
    await rm(profilePath, {
      force: true,
      maxRetries: 10,
      recursive: true,
      retryDelay: 100,
    });
  } catch {
    throw new Error("temporary browser profile cleanup failed after fixed retries");
  }
}

async function ensureOutputBoundary() {
  await mkdir(outputRoot, { recursive: true });
  const stats = await lstat(outputRoot);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("visual-baseline output must be a regular repository directory");
  }
  const realRepositoryRoot = await realpath(repositoryRoot);
  const realOutputRoot = await realpath(outputRoot);
  const outputFromRepository = relative(realRepositoryRoot, realOutputRoot);
  if (
    outputFromRepository === ".." ||
    outputFromRepository.startsWith(`..${sep}`) ||
    isAbsolute(outputFromRepository)
  ) {
    throw new Error("visual-baseline output resolves outside the repository");
  }
  const allowed = new Set(["manifest.json", ...expectedEntries.map(({ file }) => file)]);
  for (const entry of await readdir(outputRoot, { withFileTypes: true })) {
    if (!entry.isFile() || entry.isSymbolicLink() || !allowed.has(entry.name)) {
      throw new Error(`visual-baseline output contains an unexpected entry: ${entry.name}`);
    }
  }
}

async function main() {
  const arguments_ = parseArguments();
  const origin = assertLoopbackOrigin(arguments_.origin);
  const browserPath = await assertBrowserPath(arguments_.browser);
  const capturePlatform = `${process.platform}-${process.arch}`;
  if (!/^(?:darwin|linux|win32)-(?:arm64|x64)$/.test(capturePlatform)) {
    throw new Error("capture platform is outside the reviewed operating-system matrix");
  }
  const verificationSnapshot =
    arguments_.mode === "verify" ? verifyPhase1BaselineDirectory(outputRoot) : undefined;
  const temporaryParent = await realpath(tmpdir());
  const profilePath = await mkdtemp(join(temporaryParent, "viberacing-phase1-capture-"));
  if (
    dirname(profilePath) !== temporaryParent ||
    !basename(profilePath).startsWith("viberacing-phase1-capture-")
  ) {
    throw new Error("temporary browser profile escaped the verified temporary parent");
  }

  let child;
  let connection;
  let browserLaunchFailed = false;
  let browserStderrObserved = false;
  try {
    try {
      child = spawn(
        browserPath,
        [
          "--headless=new",
          "--disable-background-networking",
          "--disable-breakpad",
          "--disable-component-update",
          "--disable-crash-reporter",
          "--disable-default-apps",
          "--disable-domain-reliability",
          "--disable-extensions",
          "--disable-features=AutofillServerCommunication,MediaRouter,OptimizationHints,Translate",
          "--disable-gpu",
          "--disable-sync",
          "--force-device-scale-factor=1",
          "--hide-scrollbars",
          "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
          "--lang=en-US",
          "--metrics-recording-only",
          "--no-default-browser-check",
          "--no-first-run",
          "--no-proxy-server",
          "--password-store=basic",
          "--remote-debugging-address=127.0.0.1",
          "--remote-debugging-port=0",
          `--user-data-dir=${profilePath}`,
          "--use-mock-keychain",
          "about:blank",
        ],
        {
          env: minimalBrowserEnvironment(profilePath),
          stdio: ["ignore", "ignore", "pipe"],
          windowsHide: true,
        },
      );
    } catch {
      throw new Error("isolated Chromium exited before opening DevTools");
    }
    child.once("error", () => {
      browserLaunchFailed = true;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", () => {
      browserStderrObserved = true;
    });

    const debuggerUrl = await waitForDevTools(profilePath, child, () => browserLaunchFailed);
    connection = await connectCdp(debuggerUrl);
    const version = await connection.send("Browser.getVersion");
    if (!/^(?:Chrome|Chromium)\/\d+(?:\.\d+){3}$/.test(version.product ?? "")) {
      throw new Error("isolated browser did not report one exact Chromium product version");
    }
    if (
      verificationSnapshot &&
      !isMatchingPhase1VerificationEnvironment(
        verificationSnapshot,
        version.product,
        capturePlatform,
      )
    ) {
      throw new Error(
        "verification browser product and platform must exactly match the committed manifest",
      );
    }

    const { targetId } = await connection.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await connection.send("Target.attachToTarget", {
      flatten: true,
      targetId,
    });
    if (typeof targetId !== "string" || typeof sessionId !== "string") {
      throw new Error("isolated browser did not create one bounded page target");
    }
    await connection.send("Page.enable", {}, sessionId);
    await connection.send("Runtime.enable", {}, sessionId);
    await connection.send(
      "Emulation.setEmulatedMedia",
      { features: [{ name: "prefers-reduced-motion", value: "reduce" }], media: "screen" },
      sessionId,
    );

    const requestActions = new Set();
    let blockedPageRequest = false;
    let interceptionFailure = false;
    function queueRequestAction(method, params) {
      const action = connection
        .send(method, params, sessionId)
        .catch(() => {
          interceptionFailure = true;
        })
        .finally(() => requestActions.delete(action));
      requestActions.add(action);
    }
    async function settleRequestActions() {
      while (requestActions.size > 0) {
        await Promise.all([...requestActions]);
      }
      if (interceptionFailure) {
        throw new Error("isolated browser request interception failed closed");
      }
      if (blockedPageRequest) {
        throw new Error("isolated browser page attempted a request outside the loopback policy");
      }
    }
    const stopObserving = connection.observe((message) => {
      if (message.sessionId !== sessionId || message.method !== "Fetch.requestPaused") {
        return;
      }
      const requestId = message.params?.requestId;
      const request = message.params?.request;
      if (typeof requestId !== "string" || typeof request?.url !== "string") {
        interceptionFailure = true;
        return;
      }
      if (isAllowedPhase1PageRequest(request, origin.origin)) {
        queueRequestAction("Fetch.continueRequest", { requestId });
      } else {
        blockedPageRequest = true;
        queueRequestAction("Fetch.failRequest", { errorReason: "BlockedByClient", requestId });
      }
    });
    await connection.send(
      "Fetch.enable",
      { patterns: [{ requestStage: "Request", urlPattern: "*" }] },
      sessionId,
    );

    const firstLoad = connection.waitForEvent("Page.loadEventFired", sessionId);
    const [, navigation] = await Promise.all([
      firstLoad,
      connection.send("Page.navigate", { url: origin.href }, sessionId),
    ]);
    if (navigation.errorText) {
      throw new Error("isolated browser could not navigate to the loopback production build");
    }

    const captures = [];
    let totalCaptureBytes = 0;
    let webVitalsAudits;
    for (let index = 0; index < expectedEntries.length; index += 1) {
      const expected = expectedEntries[index];
      await connection.send(
        "Emulation.setDeviceMetricsOverride",
        {
          deviceScaleFactor: 1,
          height: expected.height,
          mobile: false,
          screenHeight: expected.height,
          screenWidth: expected.width,
          width: expected.width,
        },
        sessionId,
      );
      const preferenceScript = await connection.send(
        "Page.addScriptToEvaluateOnNewDocument",
        {
          source:
            `localStorage.setItem("viberacing.theme", ${JSON.stringify(expected.theme)});` +
            `localStorage.setItem("viberacing.locale", ${JSON.stringify(expected.locale)});` +
            'localStorage.setItem("viberacing.motion", "off");',
        },
        sessionId,
      );
      if (typeof preferenceScript.identifier !== "string") {
        throw new Error("isolated browser did not register the closed preference initializer");
      }
      await reload(connection, sessionId);
      await connection.send(
        "Page.removeScriptToEvaluateOnNewDocument",
        { identifier: preferenceScript.identifier },
        sessionId,
      );
      await waitForStableState(connection, sessionId, expected);
      await settleRequestActions();
      const screenshot = await connection.send(
        "Page.captureScreenshot",
        { captureBeyondViewport: false, format: "png", fromSurface: true },
        sessionId,
      );
      if (typeof screenshot.data !== "string" || screenshot.data.length === 0) {
        throw new Error(`${expected.file} did not return PNG bytes`);
      }
      const buffer = Buffer.from(screenshot.data, "base64");
      totalCaptureBytes += buffer.length;
      if (
        buffer.length > phase1MaximumCaptureBytes ||
        totalCaptureBytes > phase1MaximumMatrixBytes
      ) {
        throw new Error(`${expected.file} exceeds the reviewed visual-baseline byte limits`);
      }
      const findings = inspectPublicPng(buffer);
      if (findings.length > 0) {
        throw new Error(`${expected.file} violates the public PNG policy: ${findings[0]}`);
      }
      const dimensions = readPngDimensions(buffer);
      if (dimensions.width !== expected.width || dimensions.height !== expected.height) {
        throw new Error(`${expected.file} raster dimensions do not match its viewport`);
      }
      if (verificationSnapshot) {
        await compareDecodedPngPixels(
          connection,
          sessionId,
          verificationSnapshot.entries[index].buffer,
          buffer,
          expected,
        );
      } else {
        captures.push({
          buffer,
          entry: {
            ...expected,
            bytes: buffer.length,
            sha256: createHash("sha256").update(buffer).digest("hex"),
          },
        });
      }
    }

    if (verificationSnapshot) {
      const accessibilityState = {
        file: "phase1-browser-accessibility-audit",
        height: 720,
        locale: "en",
        theme: "classic-grand-prix",
        width: 1280,
      };
      await connection.send(
        "Emulation.setDeviceMetricsOverride",
        {
          deviceScaleFactor: 1,
          height: accessibilityState.height,
          mobile: false,
          screenHeight: accessibilityState.height,
          screenWidth: accessibilityState.width,
          width: accessibilityState.width,
        },
        sessionId,
      );
      await connection.send(
        "Emulation.setEmulatedMedia",
        { features: [{ name: "prefers-reduced-motion", value: "reduce" }], media: "screen" },
        sessionId,
      );
      const preferenceScript = await connection.send(
        "Page.addScriptToEvaluateOnNewDocument",
        {
          source:
            'localStorage.setItem("viberacing.theme", "classic-grand-prix");' +
            'localStorage.setItem("viberacing.locale", "en");' +
            'localStorage.setItem("viberacing.motion", "off");',
        },
        sessionId,
      );
      if (typeof preferenceScript.identifier !== "string") {
        throw new Error(
          "isolated browser did not register the accessibility preference initializer",
        );
      }
      await reload(connection, sessionId);
      await connection.send(
        "Page.removeScriptToEvaluateOnNewDocument",
        { identifier: preferenceScript.identifier },
        sessionId,
      );
      await waitForStableState(connection, sessionId, accessibilityState);
      await waitForLazyRace(connection, sessionId);
      await settleRequestActions();
      await connection.send("Target.activateTarget", { targetId });
      await connection.send("Accessibility.enable", {}, sessionId);
      await runPhase1AccessibilityTreeAudit(connection, sessionId);
      await runPhase1KeyboardAudit(connection, sessionId, accessibilityState);
      await settleRequestActions();

      await connection.send(
        "Emulation.setEmulatedMedia",
        {
          features: [
            { name: "prefers-reduced-motion", value: "reduce" },
            { name: "forced-colors", value: "active" },
          ],
          media: "screen",
        },
        sessionId,
      );
      await reload(connection, sessionId);
      await waitForStableState(connection, sessionId, accessibilityState);
      await waitForLazyRace(connection, sessionId);
      await settleRequestActions();
      await runPhase1ForcedColorsAudit(connection, sessionId);
      webVitalsAudits = await runPhase1WebVitalsAudit(connection, sessionId, settleRequestActions);
    }
    stopObserving();
    await settleRequestActions();

    if (verificationSnapshot) {
      console.log(
        `Verified ${expectedEntries.length} page-only re-renders against the committed decoded ` +
          `pixels with ${version.product}; keyboard, accessibility-tree, and forced-colors audits ` +
          `passed; Web Vitals lab maxima across ${phase1WebVitalsSampleCount} cold-cache samples ` +
          `per mode: ${formatPhase1WebVitalsMaxima(webVitalsAudits)}; no baseline files were written.`,
      );
    } else {
      await ensureOutputBoundary();
      for (const capture of captures) {
        await writeFile(resolve(outputRoot, capture.entry.file), capture.buffer);
      }
      const manifest = {
        browserProduct: version.product,
        captureMethod: "isolated-headless-cdp",
        capturePlatform,
        capturedAt: new Date().toISOString().slice(0, 10),
        content: "synthetic-fallback",
        entries: captures.map(({ entry }) => entry),
        motion: "off",
        pageOnly: true,
        schemaVersion: 1,
      };
      await writeFile(
        resolve(outputRoot, "manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
      console.log(
        `Captured ${captures.length} page-only synthetic PNG baselines with ${version.product}; ` +
          "review every rendered diff before staging.",
      );
    }
  } catch (error) {
    if (child && child.exitCode !== null && browserStderrObserved) {
      throw new Error(`${error.message}; isolated Chromium exited before capture completed`);
    }
    throw error;
  } finally {
    try {
      connection?.close();
    } finally {
      try {
        if (child) {
          await stopChild(child);
        }
      } finally {
        await removeTemporaryProfile(profilePath);
      }
    }
  }
}

main().catch((error) => {
  console.error(`Phase 1 visual-baseline capture failed: ${error.message}`);
  process.exit(1);
});

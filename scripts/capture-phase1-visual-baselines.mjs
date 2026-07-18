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
  expectedPhase1BaselineEntries,
  isAllowedPhase1PageRequest,
  phase1BaselineRoot,
} from "./lib/phase1-visual-baseline-policy.mjs";
import { inspectPublicPng, readPngDimensions } from "./lib/png-content-policy.mjs";

// cspell:ignore breakpad lede WINDIR

const repositoryRoot = resolve(import.meta.dirname, "..");
const outputRoot = resolve(repositoryRoot, phase1BaselineRoot);
const expectedEntries = expectedPhase1BaselineEntries();
const commandTimeoutMilliseconds = 15_000;

function usage() {
  console.error(
    "Usage: node scripts/capture-phase1-visual-baselines.mjs " +
      "--origin <loopback-url> --browser <absolute-chromium-path> --write",
  );
  process.exit(2);
}

function parseArguments() {
  const parsed = { browser: undefined, origin: undefined, write: false };
  for (let index = 2; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (argument === "--write" && !parsed.write) {
      parsed.write = true;
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
  if (!parsed.browser || !parsed.origin || !parsed.write) {
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

async function waitForStableState(connection, sessionId, expected) {
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
      state.appMotion === "off" &&
      state.lang === expected.locale &&
      state.dataSource === "synthetic" &&
      JSON.stringify(state.controls) === JSON.stringify([expected.theme, expected.locale, "off"])
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
    for (const expected of expectedEntries) {
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
      const findings = inspectPublicPng(buffer);
      if (findings.length > 0) {
        throw new Error(`${expected.file} violates the public PNG policy: ${findings[0]}`);
      }
      const dimensions = readPngDimensions(buffer);
      if (dimensions.width !== expected.width || dimensions.height !== expected.height) {
        throw new Error(`${expected.file} raster dimensions do not match its viewport`);
      }
      captures.push({
        buffer,
        entry: {
          ...expected,
          bytes: buffer.length,
          sha256: createHash("sha256").update(buffer).digest("hex"),
        },
      });
    }
    stopObserving();
    await settleRequestActions();

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
    await writeFile(resolve(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(
      `Captured ${captures.length} page-only synthetic PNG baselines with ${version.product}; ` +
        "review every rendered diff before staging.",
    );
  } catch (error) {
    if (child && child.exitCode !== null && browserStderrObserved) {
      throw new Error(`${error.message}; isolated Chromium exited before capture completed`);
    }
    throw error;
  } finally {
    connection?.close();
    if (child) {
      await stopChild(child);
    }
    await rm(profilePath, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(`Phase 1 visual-baseline capture failed: ${error.message}`);
  process.exit(1);
});

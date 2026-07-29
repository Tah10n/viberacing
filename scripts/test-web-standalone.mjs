import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, lstat, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const repositoryRoot = resolve(import.meta.dirname, "..");
const buildRoot = resolve(repositoryRoot, "apps", "web", ".next");
const runtimeRoot = resolve(buildRoot, "standalone", "apps", "web");
const entrypoint = resolve(runtimeRoot, "server.js");
const staticSource = resolve(buildRoot, "static");
const staticTarget = resolve(runtimeRoot, ".next", "static");
const expectedOrigin = "https://staging.example.com";
const maximumOutputBytes = 32 * 1024;
const startupTimeoutMilliseconds = 20_000;
const requestTimeoutMilliseconds = 3_000;
const shutdownTimeoutMilliseconds = 5_000;

function fail(message) {
  throw new Error(message);
}

async function requirePath(path, type) {
  const stats = await lstat(path);
  if (stats.isSymbolicLink() || (type === "file" ? !stats.isFile() : !stats.isDirectory())) {
    fail(`required ${type} is missing or unsafe`);
  }
}

function reserveLoopbackPort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("loopback port reservation failed"));
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolvePort(address.port);
        }
      });
    });
  });
}

function captureOutput(stream, state, key) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    const nextBytes = Buffer.byteLength(state[key]) + Buffer.byteLength(chunk);
    if (nextBytes > maximumOutputBytes) {
      state.overflow = true;
      return;
    }
    state[key] += chunk;
  });
}

async function fetchBounded(url) {
  return fetch(url, {
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(requestTimeoutMilliseconds),
  });
}

async function waitForHome(origin, child, processState) {
  const deadline = Date.now() + startupTimeoutMilliseconds;
  while (Date.now() < deadline) {
    if (processState.spawnError !== undefined) {
      throw processState.spawnError;
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      fail("standalone process exited before becoming ready");
    }
    try {
      const response = await fetchBounded(`${origin}/`);
      if (response.status === 200) {
        return response;
      }
    } catch {
      // A refused connection is expected while Next.js starts.
    }
    await delay(100);
  }
  fail("standalone process did not become ready before the deadline");
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return true;
  }
  child.kill("SIGTERM");
  const settled = await Promise.race([
    once(child, "exit").then(() => true),
    delay(shutdownTimeoutMilliseconds, false),
  ]);
  if (settled) {
    return true;
  }
  child.kill("SIGKILL");
  await once(child, "exit");
  return false;
}

let child;
let copiedStatic = false;
let failureStage = "invocation";
let failureMessage = "closed failure";
let passed = false;
const processState = {
  overflow: false,
  spawnError: undefined,
  stderr: "",
  stdout: "",
};

try {
  if (process.argv.length !== 2) {
    fail("unexpected arguments");
  }

  failureStage = "build artifact";
  await requirePath(entrypoint, "file");
  await requirePath(staticSource, "directory");
  try {
    await lstat(staticTarget);
    fail("standalone static target must not exist before packaging");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  failureStage = "runtime packaging";
  await cp(staticSource, staticTarget, {
    errorOnExist: true,
    force: false,
    recursive: true,
  });
  copiedStatic = true;
  await requirePath(staticTarget, "directory");

  failureStage = "runtime startup";
  const port = await reserveLoopbackPort();
  const origin = `http://127.0.0.1:${port}`;
  const environment = {
    HOSTNAME: "127.0.0.1",
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_ENV: "production",
    PORT: String(port),
    VIBERACING_CAR_PROPOSALS_ENABLED: "false",
    VIBERACING_ENROLLMENT_ENABLED: "false",
    VIBERACING_PAIRING_ENABLED: "false",
    VIBERACING_PUBLIC_ORIGIN: expectedOrigin,
    VIBERACING_PUBLIC_SNAPSHOTS_ENABLED: "false",
    VIBERACING_SOURCE_CREATION_ENABLED: "false",
  };
  for (const key of ["ComSpec", "SystemRoot"]) {
    if (process.env[key] !== undefined) {
      environment[key] = process.env[key];
    }
  }
  child = spawn(process.execPath, [entrypoint], {
    cwd: runtimeRoot,
    env: environment,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.once("error", (error) => {
    processState.spawnError = error;
  });
  captureOutput(child.stdout, processState, "stdout");
  captureOutput(child.stderr, processState, "stderr");

  const homeResponse = await waitForHome(origin, child, processState);
  const html = await homeResponse.text();
  const normalizedHtml = html.toLowerCase();
  const semanticTableIndex = html.indexOf('class="semantic-leaderboard"');
  const raceLoadingIndex = html.indexOf('class="race-loading"');
  const canonicalTag = html.match(/<link\b[^>]*\brel="canonical"[^>]*>/u)?.[0];
  const canonicalHref = canonicalTag?.match(/\bhref="(?<href>[^"]+)"/u)?.groups?.href;
  const failedHomeContracts = [
    [!processState.overflow, "output budget"],
    [homeResponse.headers.get("content-type")?.startsWith("text/html") === true, "content type"],
    [
      homeResponse.headers.get("strict-transport-security") ===
        "max-age=63072000; includeSubDomains; preload",
      "strict transport security",
    ],
    [homeResponse.headers.get("content-security-policy") !== null, "content security policy"],
    [html.includes(expectedOrigin), "public origin"],
    [normalizedHtml.includes("vibecode rating"), "search phrase"],
    [html.includes("All your coding agents. Every account. One GitHub profile."), "exact hero"],
    [semanticTableIndex >= 0, "semantic leaderboard"],
    [raceLoadingIndex > semanticTableIndex, "semantic leaderboard before lazy race enhancement"],
    [!normalizedHtml.includes("<canvas"), "no server-rendered race canvas"],
    [!normalizedHtml.includes("score simulator"), "removed score simulator"],
    [!normalizedHtml.includes("weekly score"), "removed score terminology"],
    [canonicalHref === expectedOrigin || canonicalHref === `${expectedOrigin}/`, "root canonical"],
  ]
    .filter(([passedContract]) => !passedContract)
    .map(([, contractName]) => contractName);
  if (failedHomeContracts.length > 0) {
    fail(
      `home response did not preserve the production runtime contract (${failedHomeContracts.join(", ")})`,
    );
  }

  failureStage = "search discovery";
  const [robotsResponse, sitemapResponse, manifestResponse] = await Promise.all([
    fetchBounded(`${origin}/robots.txt`),
    fetchBounded(`${origin}/sitemap.xml`),
    fetchBounded(`${origin}/manifest.webmanifest`),
  ]);
  const [robotsText, sitemapText, manifestBody] = await Promise.all([
    robotsResponse.text(),
    sitemapResponse.text(),
    manifestResponse.json(),
  ]);
  if (
    robotsResponse.status !== 200 ||
    !robotsResponse.headers.get("content-type")?.startsWith("text/plain") ||
    !robotsText.includes(`Sitemap: ${expectedOrigin}/sitemap.xml`) ||
    sitemapResponse.status !== 200 ||
    !sitemapResponse.headers.get("content-type")?.includes("xml") ||
    !sitemapText.includes(`<loc>${expectedOrigin}/</loc>`) ||
    manifestResponse.status !== 200 ||
    !manifestResponse.headers.get("content-type")?.includes("json") ||
    typeof manifestBody?.description !== "string" ||
    !manifestBody.description.toLowerCase().includes("vibecode rating")
  ) {
    fail("search discovery endpoints did not preserve the canonical public contract");
  }

  failureStage = "static asset";
  const assetPath = html.match(/(?:src|href)="(?<path>\/_next\/static\/[^"]+\.(?:css|js))"/u)
    ?.groups?.path;
  if (assetPath === undefined) {
    fail("home response did not reference a bounded static asset");
  }
  const assetResponse = await fetchBounded(`${origin}${assetPath}`);
  if (assetResponse.status !== 200 || assetResponse.headers.get("content-type") === null) {
    fail("packaged static asset was not served");
  }
  await assetResponse.arrayBuffer();

  failureStage = "default-off boundary";
  for (const path of [
    "/v1/leaderboards/current?trustTier=community&page=1",
    "/v1/leaderboards/2026-07-20?trustTier=community&page=1",
    "/v1/profiles/demo_driver?trustTier=community",
  ]) {
    const disabledResponse = await fetchBounded(`${origin}${path}`);
    const disabledBody = await disabledResponse.json();
    if (
      disabledResponse.status !== 503 ||
      !disabledResponse.headers.get("content-type")?.startsWith("application/problem+json") ||
      disabledBody?.schemaVersion !== 1 ||
      disabledBody?.errorCode !== "temporarily_unavailable" ||
      disabledBody?.retryable !== true
    ) {
      fail(`default-off public snapshot boundary did not fail closed for ${path}`);
    }
  }

  for (const path of [
    "/v1/community/scores?seasonStart=2026-07-20",
    "/v1/community/race?seasonStart=2026-07-20",
    "/v1/community/race/status?seasonStart=2026-07-20",
    "/v1/community/tokens?seasonStart=2026-07-20",
  ]) {
    const removedResponse = await fetchBounded(`${origin}${path}`);
    if (removedResponse.status !== 404) {
      fail(`removed legacy public route remained reachable for ${path}`);
    }
  }

  passed = true;
} catch (error) {
  failureMessage = error instanceof Error ? error.message : "closed failure";
} finally {
  if (child !== undefined) {
    try {
      if (!(await stopChild(child))) {
        passed = false;
        failureStage = "runtime shutdown";
        failureMessage = "standalone process required forced termination";
      }
    } catch {
      passed = false;
      failureStage = "runtime shutdown";
      failureMessage = "standalone process did not terminate";
    }
  }
  if (copiedStatic) {
    try {
      await rm(staticTarget, { force: true, recursive: true });
      try {
        await lstat(staticTarget);
        passed = false;
        failureStage = "runtime cleanup";
        failureMessage = "packaged static target remained after cleanup";
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
      }
    } catch {
      passed = false;
      failureStage = "runtime cleanup";
      failureMessage = "packaged static target could not be removed";
    }
  }
}

if (!passed) {
  console.error(`Web standalone smoke failed during ${failureStage}: ${failureMessage}.`);
  process.exit(1);
}

console.log(
  "Web standalone smoke passed (exact hero, SSR-first semantic leaderboard, lazy race boundary, search metadata, discovery endpoints, static asset, production headers, three final default-off snapshot routes, and four absent legacy routes).",
);

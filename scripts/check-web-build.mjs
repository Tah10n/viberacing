import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { isAbsolute, relative, resolve, sep } from "node:path";
import process from "node:process";

const repositoryRoot = resolve(import.meta.dirname, "..");
const rootArgument = process.argv.indexOf("--root");
const buildRoot =
  rootArgument === -1
    ? resolve(repositoryRoot, "apps", "web", ".next")
    : resolve(process.argv[rootArgument + 1] ?? "");
const policyPath = resolve(repositoryRoot, "config", "web-performance-budget.json");
const hardCeilings = {
  maximumApplicationChunkGzipBytes: 25_000,
  maximumInitialAssetCount: 12,
  maximumInitialRouteGzipBytes: 250_000,
  maximumInitialRouteRawBytes: 1_000_000,
  maximumStylesheetGzipBytes: 10_000,
};

function fail(message) {
  console.error(`Web production build check failed: ${message}`);
  process.exit(1);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${label} is missing or invalid JSON: ${error.message}`);
  }
}

function validatePolicy(policy) {
  const expectedKeys = ["schemaVersion", ...Object.keys(hardCeilings)].sort();
  if (
    policy?.schemaVersion !== 1 ||
    Object.keys(policy ?? {})
      .sort()
      .join(",") !== expectedKeys.join(",")
  ) {
    fail("performance policy must use schemaVersion 1 and the exact reviewed budget keys");
  }
  for (const [key, hardCeiling] of Object.entries(hardCeilings)) {
    const value = policy[key];
    if (!Number.isSafeInteger(value) || value <= 0 || value > hardCeiling) {
      fail(`${key} must be a positive integer no greater than the hard ceiling ${hardCeiling}`);
    }
  }
}

function parseClientManifest() {
  const path = resolve(buildRoot, "server", "app", "page_client-reference-manifest.js");
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    fail(`page client-reference manifest is missing: ${error.message}`);
  }
  const marker = 'globalThis.__RSC_MANIFEST["/page"] = ';
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) {
    fail("page client-reference manifest does not contain the expected /page assignment");
  }
  const serialized = text.slice(markerIndex + marker.length).trim();
  if (!serialized.endsWith(";")) {
    fail("page client-reference manifest assignment is not terminated");
  }
  try {
    return JSON.parse(serialized.slice(0, -1));
  } catch (error) {
    fail(`page client-reference manifest payload is invalid JSON: ${error.message}`);
  }
}

function assertSafeAssetPath(asset) {
  if (
    typeof asset !== "string" ||
    asset.length === 0 ||
    isAbsolute(asset) ||
    asset.includes("\\") ||
    asset.split("/").includes("..") ||
    !/^static\/[A-Za-z0-9_./-]+\.(?:css|js)$/.test(asset)
  ) {
    fail(`unsafe or unsupported client asset path: ${String(asset)}`);
  }
  const absolutePath = resolve(buildRoot, asset);
  const pathFromRoot = relative(buildRoot, absolutePath);
  if (pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === "..") {
    fail(`client asset escapes the build root: ${asset}`);
  }
  if (!existsSync(absolutePath)) {
    fail(`referenced client asset is missing: ${asset}`);
  }
  const stats = lstatSync(absolutePath);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    fail(`referenced client asset must be a regular file: ${asset}`);
  }
  if (stats.size > policy.maximumInitialRouteRawBytes) {
    fail(
      `client asset ${asset} is ${stats.size} raw bytes; per-asset safety ceiling is ` +
        `${policy.maximumInitialRouteRawBytes}`,
    );
  }
  return absolutePath;
}

function matchingEntries(record, suffix) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    fail("client manifest entry map is invalid");
  }
  const matches = Object.entries(record).filter(([key]) => key.endsWith(suffix));
  if (matches.length !== 1) {
    fail(`client manifest must contain exactly one ${suffix} entry`);
  }
  return matches[0][1];
}

function listFilesRecursively(path) {
  if (!existsSync(path)) {
    return [];
  }
  const files = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(child));
    } else if (entry.isFile()) {
      files.push(child);
    }
  }
  return files;
}

const policy = readJson(policyPath, "web performance policy");
validatePolicy(policy);
if (!existsSync(buildRoot) || !statSync(buildRoot).isDirectory()) {
  fail("production .next directory is missing; run the web build first");
}

const buildManifest = readJson(resolve(buildRoot, "build-manifest.json"), "build manifest");
const clientManifest = parseClientManifest();
const layoutJs = matchingEntries(clientManifest.entryJSFiles, "/apps/web/app/layout");
const pageJs = matchingEntries(clientManifest.entryJSFiles, "/apps/web/app/page");
const layoutCss = matchingEntries(clientManifest.entryCSSFiles, "/apps/web/app/layout").map(
  (entry) => entry?.path,
);
const pageCss = matchingEntries(clientManifest.entryCSSFiles, "/apps/web/app/page").map(
  (entry) => entry?.path,
);
for (const collection of [
  buildManifest.polyfillFiles,
  buildManifest.rootMainFiles,
  layoutJs,
  pageJs,
  layoutCss,
  pageCss,
]) {
  if (!Array.isArray(collection) || collection.some((entry) => typeof entry !== "string")) {
    fail("build manifests contain an invalid client asset collection");
  }
}

const initialAssets = new Set([
  ...buildManifest.polyfillFiles,
  ...buildManifest.rootMainFiles,
  ...layoutJs,
  ...pageJs,
  ...layoutCss,
  ...pageCss,
]);
if (initialAssets.size > policy.maximumInitialAssetCount) {
  fail(
    `initial route uses ${initialAssets.size} assets; budget is ${policy.maximumInitialAssetCount}`,
  );
}

let rawBytes = 0;
let gzipBytes = 0;
let stylesheetGzipBytes = 0;
const gzipByAsset = new Map();
for (const asset of initialAssets) {
  const content = readFileSync(assertSafeAssetPath(asset));
  const compressedBytes = gzipSync(content, { level: 9 }).length;
  rawBytes += content.length;
  gzipBytes += compressedBytes;
  gzipByAsset.set(asset, compressedBytes);
  if (asset.endsWith(".css")) {
    stylesheetGzipBytes += compressedBytes;
  }
}

const applicationAssets = pageJs.filter((asset) => !layoutJs.includes(asset));
if (applicationAssets.length === 0) {
  fail("page has no independently budgeted application client chunk");
}
const applicationGzipBytes = applicationAssets.reduce(
  (total, asset) => total + (gzipByAsset.get(asset) ?? 0),
  0,
);

for (const [observed, maximum, label] of [
  [rawBytes, policy.maximumInitialRouteRawBytes, "initial raw bytes"],
  [gzipBytes, policy.maximumInitialRouteGzipBytes, "initial gzip bytes"],
  [stylesheetGzipBytes, policy.maximumStylesheetGzipBytes, "stylesheet gzip bytes"],
  [applicationGzipBytes, policy.maximumApplicationChunkGzipBytes, "application gzip bytes"],
]) {
  if (observed > maximum) {
    fail(`${label} are ${observed}; budget is ${maximum}`);
  }
}

const staticSourceMaps = listFilesRecursively(resolve(buildRoot, "static")).filter((path) =>
  path.endsWith(".map"),
);
if (staticSourceMaps.length > 0) {
  fail("production browser source maps must remain disabled");
}

const fontManifest = readJson(
  resolve(buildRoot, "server", "next-font-manifest.json"),
  "Next.js font manifest",
);
if (
  Object.keys(fontManifest.app ?? {}).length > 0 ||
  Object.keys(fontManifest.pages ?? {}).length > 0 ||
  fontManifest.appUsingSizeAdjust !== false ||
  fontManifest.pagesUsingSizeAdjust !== false
) {
  fail("remote or generated Next.js font assets are outside the current privacy boundary");
}

const standaloneEntry = resolve(buildRoot, "standalone", "apps", "web", "server.js");
const standaloneStats = existsSync(standaloneEntry) ? lstatSync(standaloneEntry) : undefined;
if (
  standaloneStats === undefined ||
  standaloneStats.isSymbolicLink() ||
  !standaloneStats.isFile()
) {
  fail("standalone application entrypoint is missing");
}

console.log(
  `Web production build check passed (${initialAssets.size} assets, ${rawBytes} raw bytes, ` +
    `${gzipBytes} gzip bytes, ${applicationGzipBytes} application gzip bytes, ` +
    `${stylesheetGzipBytes} stylesheet gzip bytes).`,
);

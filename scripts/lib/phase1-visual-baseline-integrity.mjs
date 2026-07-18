import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  expectedPhase1BaselineEntries,
  phase1MaximumCaptureBytes,
  phase1MaximumMatrixBytes,
} from "./phase1-visual-baseline-policy.mjs";
import { inspectPublicPng, readPngDimensions } from "./png-content-policy.mjs";

function fail(message) {
  throw new Error(message);
}

function exactKeys(value, expected, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join(",") !== wanted.join(",")) {
    fail(`${label} must contain exactly ${wanted.join(", ")}`);
  }
}

function readManifest(baselineRoot) {
  try {
    return JSON.parse(readFileSync(resolve(baselineRoot, "manifest.json"), "utf8"));
  } catch {
    fail("manifest.json is missing or invalid JSON");
  }
}

function isRealIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function assertSafeCapturePath(baselineRoot, file) {
  if (
    typeof file !== "string" ||
    !/^[a-z0-9-]+\.png$/.test(file) ||
    isAbsolute(file) ||
    file.includes("/") ||
    file.includes("\\")
  ) {
    fail(`capture path is unsafe or unsupported: ${String(file)}`);
  }
  const path = resolve(baselineRoot, file);
  const fromRoot = relative(baselineRoot, path);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
    fail(`capture path escapes the baseline directory: ${file}`);
  }
  return path;
}

export function verifyPhase1BaselineDirectory(baselineRoot) {
  if (typeof baselineRoot !== "string" || !isAbsolute(baselineRoot)) {
    fail("baseline root must be an absolute directory path");
  }
  if (!existsSync(baselineRoot)) {
    fail("baseline directory is missing");
  }
  const baselineStats = lstatSync(baselineRoot);
  if (baselineStats.isSymbolicLink() || !baselineStats.isDirectory()) {
    fail("baseline root must be a regular non-symbolic-link directory");
  }

  const manifest = readManifest(baselineRoot);
  exactKeys(
    manifest,
    [
      "browserProduct",
      "capturePlatform",
      "captureMethod",
      "capturedAt",
      "content",
      "entries",
      "motion",
      "pageOnly",
      "schemaVersion",
    ],
    "manifest",
  );
  if (manifest.schemaVersion !== 1) {
    fail("manifest schemaVersion must be 1");
  }
  if (!isRealIsoDate(manifest.capturedAt)) {
    fail("capturedAt must be one real ISO calendar date");
  }
  if (!/^(?:Chrome|Chromium)\/\d+(?:\.\d+){3}$/.test(manifest.browserProduct)) {
    fail("browserProduct must identify one exact Chromium build");
  }
  if (!/^(?:darwin|linux|win32)-(?:arm64|x64)$/.test(manifest.capturePlatform)) {
    fail("capturePlatform must identify one bounded operating-system and architecture pair");
  }
  if (
    manifest.captureMethod !== "isolated-headless-cdp" ||
    manifest.content !== "synthetic-fallback" ||
    manifest.motion !== "off" ||
    manifest.pageOnly !== true
  ) {
    fail(
      "capture policy must remain page-only isolated CDP with synthetic fallback and motion off",
    );
  }

  const expectedEntries = expectedPhase1BaselineEntries();
  if (!Array.isArray(manifest.entries) || manifest.entries.length !== expectedEntries.length) {
    fail(`manifest must contain exactly ${expectedEntries.length} capture entries`);
  }

  const directoryEntries = readdirSync(baselineRoot, { withFileTypes: true });
  const expectedFiles = new Set(["manifest.json", ...expectedEntries.map(({ file }) => file)]);
  for (const entry of directoryEntries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !expectedFiles.has(entry.name)) {
      fail(`baseline directory contains an unexpected entry: ${entry.name}`);
    }
  }
  if (directoryEntries.length !== expectedFiles.size) {
    fail("baseline directory does not contain the exact manifest and capture file set");
  }

  let totalBytes = 0;
  const verifiedEntries = [];
  for (let index = 0; index < expectedEntries.length; index += 1) {
    const expected = expectedEntries[index];
    const entry = manifest.entries[index];
    exactKeys(
      entry,
      ["bytes", "file", "height", "locale", "sha256", "theme", "viewport", "width"],
      `entry ${index + 1}`,
    );
    for (const key of ["file", "height", "locale", "theme", "viewport", "width"]) {
      if (entry[key] !== expected[key]) {
        fail(`entry ${index + 1} does not match the canonical matrix field ${key}`);
      }
    }
    if (
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes <= 0 ||
      entry.bytes > phase1MaximumCaptureBytes
    ) {
      fail(`${entry.file} byte count is outside the reviewed per-capture limit`);
    }
    if (typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      fail(`${entry.file} SHA-256 is malformed`);
    }

    const path = assertSafeCapturePath(baselineRoot, entry.file);
    if (!existsSync(path)) {
      fail(`${entry.file} is missing`);
    }
    const stats = lstatSync(path);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      fail(`${entry.file} must be a regular non-symbolic-link file`);
    }
    const buffer = readFileSync(path);
    if (buffer.length !== entry.bytes || stats.size !== entry.bytes) {
      fail(`${entry.file} byte count does not match the manifest`);
    }
    const actualDigest = createHash("sha256").update(buffer).digest("hex");
    if (actualDigest !== entry.sha256) {
      fail(`${entry.file} SHA-256 does not match the manifest`);
    }
    const pngFindings = inspectPublicPng(buffer);
    if (pngFindings.length > 0) {
      fail(`${entry.file} violates the public PNG policy: ${pngFindings[0]}`);
    }
    const dimensions = readPngDimensions(buffer);
    if (dimensions.width !== expected.width || dimensions.height !== expected.height) {
      fail(`${entry.file} dimensions do not match its canonical viewport`);
    }
    totalBytes += buffer.length;
    verifiedEntries.push(Object.freeze({ ...entry, buffer }));
  }

  if (totalBytes > phase1MaximumMatrixBytes) {
    fail(`capture matrix is ${totalBytes} bytes; reviewed limit is ${phase1MaximumMatrixBytes}`);
  }

  return Object.freeze({
    browserProduct: manifest.browserProduct,
    capturePlatform: manifest.capturePlatform,
    capturedAt: manifest.capturedAt,
    entries: Object.freeze(verifiedEntries),
    totalBytes,
  });
}

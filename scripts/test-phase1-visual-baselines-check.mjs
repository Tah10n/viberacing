import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { expectedPhase1BaselineEntries } from "./lib/phase1-visual-baseline-policy.mjs";

const checker = resolve(import.meta.dirname, "check-phase1-visual-baselines.mjs");
const temporaryRoot = mkdtempSync(join(tmpdir(), "viberacing-phase1-baseline-check-"));
let caseCount = 0;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBuffer.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return output;
}

function png(width, height, extraChunks = []) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.alloc(1 + width * 3);
  const pixels = Buffer.alloc(row.length * height);
  for (let offset = 0; offset < pixels.length; offset += row.length) {
    row.copy(pixels, offset);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    ...extraChunks,
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND"),
  ]);
}

function digest(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function writeManifest(root, manifest) {
  writeFileSync(resolve(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function createFixture(name) {
  const root = resolve(temporaryRoot, name);
  mkdirSync(root, { recursive: true });
  const buffers = new Map();
  const entries = expectedPhase1BaselineEntries().map((entry) => {
    const key = `${entry.width}x${entry.height}`;
    const buffer = buffers.get(key) ?? png(entry.width, entry.height);
    buffers.set(key, buffer);
    writeFileSync(resolve(root, entry.file), buffer);
    return { ...entry, bytes: buffer.length, sha256: digest(buffer) };
  });
  const manifest = {
    browserProduct: "Chrome/150.0.7871.129",
    captureMethod: "isolated-headless-cdp",
    capturePlatform: "win32-x64",
    capturedAt: "2026-07-18",
    content: "synthetic-fallback",
    entries,
    motion: "off",
    pageOnly: true,
    schemaVersion: 1,
  };
  writeManifest(root, manifest);
  return { manifest, root };
}

function run(root) {
  try {
    return {
      output: execFileSync(process.execPath, [checker, "--root", root], {
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

function expectPass(name) {
  caseCount += 1;
  const { root } = createFixture(name);
  const result = run(root);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /18 page-only PNGs/);
}

function expectFailure(name, mutate, expected) {
  caseCount += 1;
  const fixture = createFixture(name);
  mutate(fixture);
  const result = run(fixture.root);
  assert.notEqual(result.status, 0, `${name} unexpectedly passed`);
  assert.match(result.output, expected);
}

function refreshEntry(fixture, index, buffer) {
  const entry = fixture.manifest.entries[index];
  writeFileSync(resolve(fixture.root, entry.file), buffer);
  fixture.manifest.entries[index] = {
    ...entry,
    bytes: buffer.length,
    sha256: digest(buffer),
  };
  writeManifest(fixture.root, fixture.manifest);
}

try {
  expectPass("valid");
  expectFailure(
    "missing-capture",
    ({ manifest, root }) => unlinkSync(resolve(root, manifest.entries[0].file)),
    /does not contain the exact manifest and capture file set/,
  );
  expectFailure(
    "digest-drift",
    (fixture) => {
      fixture.manifest.entries[0].sha256 = "0".repeat(64);
      writeManifest(fixture.root, fixture.manifest);
    },
    /SHA-256 does not match/,
  );
  expectFailure(
    "metadata",
    (fixture) => {
      const entry = fixture.manifest.entries[0];
      const buffer = readFileSync(resolve(fixture.root, entry.file));
      const withText = Buffer.concat([
        buffer.subarray(0, 33),
        chunk("tEXt", Buffer.from("local metadata", "utf8")),
        buffer.subarray(33),
      ]);
      refreshEntry(fixture, 0, withText);
    },
    /PNG chunk.*tEXt.*not allowed/,
  );
  expectFailure(
    "wrong-pixels",
    (fixture) => refreshEntry(fixture, 0, png(1279, 720)),
    /dimensions do not match/,
  );
  expectFailure(
    "unexpected-file",
    ({ root }) => writeFileSync(resolve(root, "notes.txt"), "not part of the baseline\n"),
    /unexpected entry/,
  );
  expectFailure(
    "browser-version",
    (fixture) => {
      fixture.manifest.browserProduct = "current browser";
      writeManifest(fixture.root, fixture.manifest);
    },
    /exact Chromium build/,
  );
  expectFailure(
    "entry-order",
    (fixture) => {
      fixture.manifest.entries.reverse();
      writeManifest(fixture.root, fixture.manifest);
    },
    /canonical matrix field file/,
  );
  expectFailure(
    "manifest-widening",
    (fixture) => {
      fixture.manifest.profilePath = "not allowed";
      writeManifest(fixture.root, fixture.manifest);
    },
    /manifest must contain exactly/,
  );
  expectFailure(
    "invalid-calendar-date",
    (fixture) => {
      fixture.manifest.capturedAt = "2026-99-99";
      writeManifest(fixture.root, fixture.manifest);
    },
    /real ISO calendar date/,
  );
  expectFailure(
    "capture-policy-widening",
    (fixture) => {
      fixture.manifest.motion = "system";
      writeManifest(fixture.root, fixture.manifest);
    },
    /capture policy must remain/,
  );
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}

console.log(`Phase 1 visual-baseline checker tests passed (${caseCount} cases).`);

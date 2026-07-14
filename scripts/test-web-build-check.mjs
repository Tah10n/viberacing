import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const checker = resolve(import.meta.dirname, "check-web-build.mjs");
const temporaryRoot = mkdtempSync(join(tmpdir(), "viberacing-web-build-check-"));
let caseCount = 0;

function write(path, content) {
  const absolutePath = resolve(path);
  mkdirSync(resolve(absolutePath, ".."), { recursive: true });
  writeFileSync(absolutePath, content);
}

function createFixture(name) {
  const root = resolve(temporaryRoot, name);
  const buildManifest = {
    polyfillFiles: ["static/chunks/polyfill.js"],
    rootMainFiles: ["static/chunks/framework.js"],
  };
  const clientManifest = {
    entryCSSFiles: {
      "[project]/apps/web/app/layout": [{ path: "static/chunks/application.css", inlined: false }],
      "[project]/apps/web/app/page": [{ path: "static/chunks/application.css", inlined: false }],
    },
    entryJSFiles: {
      "[project]/apps/web/app/layout": ["static/chunks/common.js"],
      "[project]/apps/web/app/page": ["static/chunks/common.js", "static/chunks/application.js"],
    },
  };
  write(resolve(root, "build-manifest.json"), JSON.stringify(buildManifest));
  write(
    resolve(root, "server", "app", "page_client-reference-manifest.js"),
    `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\n` +
      `globalThis.__RSC_MANIFEST["/page"] = ${JSON.stringify(clientManifest)};\n`,
  );
  write(
    resolve(root, "server", "next-font-manifest.json"),
    JSON.stringify({ app: {}, appUsingSizeAdjust: false, pages: {}, pagesUsingSizeAdjust: false }),
  );
  write(resolve(root, "standalone", "apps", "web", "server.js"), "export {};\n");
  for (const asset of ["polyfill.js", "framework.js", "common.js", "application.js"]) {
    write(resolve(root, "static", "chunks", asset), `export const fixture = "${asset}";\n`);
  }
  write(resolve(root, "static", "chunks", "application.css"), "body { color: black; }\n");
  return root;
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
  const result = run(createFixture(name));
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Web production build check passed/);
}

function expectFailure(name, mutate, expected) {
  caseCount += 1;
  const root = createFixture(name);
  mutate(root);
  const result = run(root);
  assert.notEqual(result.status, 0, `${name} unexpectedly passed`);
  assert.match(result.output, expected);
}

try {
  expectPass("valid");
  expectFailure(
    "missing-asset",
    (root) => unlinkSync(resolve(root, "static", "chunks", "application.js")),
    /referenced client asset is missing/,
  );
  expectFailure(
    "traversal",
    (root) => {
      const path = resolve(root, "build-manifest.json");
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      manifest.rootMainFiles = ["../escape.js"];
      write(path, JSON.stringify(manifest));
    },
    /unsafe or unsupported client asset path/,
  );
  expectFailure(
    "source-map",
    (root) => write(resolve(root, "static", "chunks", "application.js.map"), "{}"),
    /browser source maps must remain disabled/,
  );
  expectFailure(
    "missing-standalone",
    (root) => unlinkSync(resolve(root, "standalone", "apps", "web", "server.js")),
    /standalone application entrypoint is missing/,
  );
  expectFailure(
    "route-budget",
    (root) => write(resolve(root, "static", "chunks", "framework.js"), randomBytes(220_000)),
    /initial gzip bytes/,
  );
  expectFailure(
    "per-asset-safety-ceiling",
    (root) => write(resolve(root, "static", "chunks", "framework.js"), Buffer.alloc(1_000_001)),
    /per-asset safety ceiling/,
  );
  expectFailure(
    "application-budget",
    (root) => write(resolve(root, "static", "chunks", "application.js"), randomBytes(12_000)),
    /application gzip bytes/,
  );
  expectFailure(
    "font-boundary",
    (root) =>
      write(
        resolve(root, "server", "next-font-manifest.json"),
        JSON.stringify({
          app: { "/page": ["generated-font.woff2"] },
          appUsingSizeAdjust: true,
          pages: {},
          pagesUsingSizeAdjust: false,
        }),
      ),
    /font assets are outside/,
  );
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}

console.log(`Web production build checker tests passed (${caseCount} cases).`);

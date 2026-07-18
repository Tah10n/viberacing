import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isAllowedPhase1PageRequest } from "./lib/phase1-visual-baseline-policy.mjs";

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

try {
  const nonExecutableBrowser = resolve(temporaryRoot, "not-a-browser.txt");
  writeFileSync(nonExecutableBrowser, "synthetic non-executable fixture\n");
  expectFailure("missing arguments", [], /Usage:/, 2);
  expectFailure(
    "missing explicit write",
    ["--origin", "http://127.0.0.1:3317/", "--browser", process.execPath],
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
    ["--origin", "http://localhost:3317/", ...browserArguments],
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
    "10 request-policy assertions).",
);

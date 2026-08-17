import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { openBrowser } from "../lib/browser.mjs";

test("keeps pairing alive when the system browser launcher is unavailable", async () => {
  const previousPath = process.env.PATH;
  process.env.PATH = "/viberacing-browser-launcher-does-not-exist";
  try {
    const child = openBrowser("https://viberacing.example/connect");
    const [error] = await once(child, "error");
    assert.equal(error.code, "ENOENT");
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }
});

test("rejects non-web schemes and does not use the Windows command shell", async () => {
  assert.throws(() => openBrowser("file:///tmp/attacker"), /HTTP/);
  const source = await readFile(new URL("../lib/browser.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /[\"']cmd(?:\.exe)?[\"']|[\"']\/c[\"']/i);
  assert.match(source, /explorer\.exe/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
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

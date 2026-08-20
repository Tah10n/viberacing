import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOrigin } from "../lib/origin.mjs";

test("normalizes only credential-free HTTP(S) origins", () => {
  assert.equal(normalizeOrigin("https://example.com"), "https://example.com");
  assert.equal(normalizeOrigin("https://example.com:8443"), "https://example.com:8443");
  assert.equal(normalizeOrigin("http://localhost:3000"), "http://localhost:3000");
  assert.equal(normalizeOrigin("http://127.0.0.1"), "http://127.0.0.1");
  assert.equal(normalizeOrigin("http://[::1]:3000"), "http://[::1]:3000");
  for (const value of [
    "http://example.com",
    "https://user@example.com",
    "https://user:secret@example.com",
    "https://example.com/path",
    "https://example.com/?query=1",
    "https://example.com/#hash",
    "ftp://example.com",
    "not a url",
  ])
    assert.throws(() => normalizeOrigin(value), /origin|HTTPS/);
});

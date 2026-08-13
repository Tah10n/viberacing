import { describe, expect, it } from "vitest";
import { deviceTokenFromPollToken, digest, pairingCode, randomToken, secretEqual } from "./crypto";

describe("credential helpers", () => {
  it("creates URL-safe high-entropy tokens", () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  });

  it("hashes credentials before persistence", () => {
    expect(digest("secret").toString("hex")).toBe(
      "2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b",
    );
  });

  it("creates a readable pairing code", () => {
    expect(pairingCode()).toMatch(/^[A-Z2-9]{8}$/);
  });

  it("derives a stable URL-safe device token without storing plaintext", () => {
    expect(deviceTokenFromPollToken("poll-secret")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(deviceTokenFromPollToken("poll-secret")).toBe(deviceTokenFromPollToken("poll-secret"));
  });

  it("compares secrets by fixed-size digests", () => {
    expect(secretEqual("same", "same")).toBe(true);
    expect(secretEqual("same", "different")).toBe(false);
  });
});

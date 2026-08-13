import { describe, expect, it } from "vitest";
import { clientAddress, consumeRateLimit } from "./rate-limit";

describe("database-backed rate limits", () => {
  it("rejects invalid bucket configuration before touching the database", async () => {
    await expect(consumeRateLimit("Bad Scope", "client", 2, 60)).rejects.toThrow(
      "Invalid rate-limit scope",
    );
    await expect(consumeRateLimit("pairing", "client", 0, 60)).rejects.toThrow(
      "Invalid rate-limit limit",
    );
  });

  it("uses Railway's trusted client-address header", () => {
    const request = new Request("https://viberacing.example", {
      headers: {
        "x-forwarded-for": "spoofed, 203.0.113.7",
        "x-real-ip": "203.0.113.9",
      },
    });
    expect(clientAddress(request)).toBe("203.0.113.9");
  });
});

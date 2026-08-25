import { describe, expect, it } from "vitest";
import { applicationHeaders } from "../next.config";

describe("application security headers", () => {
  it("adds a production-only HSTS policy without unreviewed subdomain or preload scope", () => {
    expect(
      applicationHeaders(false).find((header) => header.key === "Strict-Transport-Security"),
    ).toBeUndefined();
    expect(
      applicationHeaders(true).find((header) => header.key === "Strict-Transport-Security"),
    ).toEqual({ key: "Strict-Transport-Security", value: "max-age=31536000" });
  });
});

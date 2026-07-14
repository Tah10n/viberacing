import { describe, expect, it } from "vitest";
import { parsePublicOrigin, resolvePublicOrigin } from "./public-origin";

describe("public metadata origin", () => {
  it("accepts and normalizes a public HTTPS origin", () => {
    expect(parsePublicOrigin("https://race.example.com/").href).toBe("https://race.example.com/");
  });

  it("accepts loopback HTTP with a development port", () => {
    expect(parsePublicOrigin("http://127.0.0.1:3000").href).toBe("http://127.0.0.1:3000/");
    expect(parsePublicOrigin("http://localhost:3000").href).toBe("http://localhost:3000/");
  });

  it("uses reserved defaults without reading workstation identity", () => {
    expect(resolvePublicOrigin(undefined, "development").href).toBe("http://127.0.0.1:3000/");
    expect(resolvePublicOrigin(undefined, "production").href).toBe("https://viberacing.example/");
  });

  it("rejects public cleartext HTTP", () => {
    expect(() => parsePublicOrigin("http://race.example.com")).toThrow(/HTTP only for loopback/);
  });

  it("rejects embedded credentials without echoing their values", () => {
    expect(() => parsePublicOrigin("https://user:password@example.com")).toThrow(
      "must not contain credentials",
    );
  });

  it.each([
    "https://race.example.com/path",
    "https://race.example.com?source=test",
    "https://race.example.com#section",
  ])("rejects URL components outside an origin: %s", (value) => {
    expect(() => parsePublicOrigin(value)).toThrow(/must not contain a path, query, or fragment/);
  });

  it.each(["https://192.0.2.1", "https://race.example.com:8443"])(
    "rejects a non-domain or non-default public endpoint: %s",
    (value) => {
      expect(() => parsePublicOrigin(value)).toThrow(/must (?:use a DNS hostname|not use)/);
    },
  );

  it.each(["", " https://race.example.com", "not a URL", `https://${"a".repeat(257)}`])(
    "rejects malformed or ambiguous configuration",
    (value) => {
      expect(() => parsePublicOrigin(value)).toThrow(/VIBERACING_PUBLIC_ORIGIN/);
    },
  );
});

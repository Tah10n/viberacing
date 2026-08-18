import { describe, expect, it } from "vitest";
import { isRecord, isSafeDisplayText, isUuid, readBoundedForm, readBoundedJson } from "./http";

describe("request value validation", () => {
  it("accepts plain objects but rejects null and arrays", () => {
    expect(isRecord({ value: "ok" })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
  });

  it("accepts canonical UUIDs only", () => {
    expect(isUuid("616e2e21-d41f-48cf-8b2e-38ad1b90faba")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
  });

  it("rejects terminal control characters in display text", () => {
    expect(isSafeDisplayText("Safe label", 40)).toBe(true);
    expect(isSafeDisplayText("Unsafe\u001b[2J label", 40)).toBe(false);
    expect(isSafeDisplayText("line\nbreak", 40)).toBe(false);
  });
});

describe("bounded request bodies", () => {
  it("parses JSON within the byte limit", async () => {
    const request = new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ value: "ok" }),
    });
    await expect(readBoundedJson(request, 32)).resolves.toEqual({ value: "ok" });
  });

  it("rejects a streaming body as soon as it exceeds the byte limit", async () => {
    const request = new Request("http://localhost/api", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"value":"'));
          controller.enqueue(new TextEncoder().encode("too large"));
          controller.enqueue(new TextEncoder().encode('"}'));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    await expect(readBoundedJson(request, 12)).rejects.toThrow(RangeError);
  });

  it("accepts only a small URL-encoded form", async () => {
    const request = new Request("http://localhost/api", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "code=ABCDEFGH",
    });
    await expect(readBoundedForm(request, 32)).resolves.toEqual(
      new URLSearchParams("code=ABCDEFGH"),
    );
  });
});

import { describe, expect, it } from "vitest";
import { holdPublicResponse } from "./public-response.mjs";

function fixture() {
  const headers = new Map();
  return {
    statusCode: 200,
    setHeader: (name, value) => headers.set(name, value),
    removeHeader: (name) => headers.delete(name),
    writeHead() {},
    write() {},
    end(body) {
      this.body = body;
    },
    headers,
  };
}
describe("bounded public HTTP responses", () => {
  it("discards partial HTML on a downstream database overload", () => {
    const response = fixture();
    const state = { overloaded: false };
    holdPublicResponse(response, state);
    response.write("partial HTML");
    state.overloaded = true;
    response.end("Next error page");
    expect(response.statusCode).toBe(503);
    expect(response.body).toBe("Temporarily overloaded");
    expect(response.headers.get("Retry-After")).toBe("1");
  });
  it("supports all 50000 sitemap URLs with the separate bounded allowance", () => {
    const response = fixture();
    holdPublicResponse(response, { overloaded: false }, 32 * 1024 * 1024);
    const xml = Array.from(
      { length: 50000 },
      (_, i) => `<url><loc>https://viberacing.dev/u/user-${i}</loc></url>`,
    ).join("");
    response.end(xml);
    expect(response.statusCode).toBe(200);
    expect(response.body.toString()).toBe(xml);
  });
  it("fails closed without retaining an oversized public body", () => {
    const response = fixture();
    holdPublicResponse(response, { overloaded: false }, 8);
    response.write("123456789");
    response.end();
    expect(response.statusCode).toBe(503);
    expect(response.body).toBe("Temporarily overloaded");
  });
});

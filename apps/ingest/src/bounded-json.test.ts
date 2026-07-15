import { describe, expect, it } from "vitest";

import {
  BoundedJsonError,
  type BoundedJsonErrorCode,
  parseBoundedCommunitySyncJson,
} from "./bounded-json";
import { maximumCommunitySyncBodyBytes } from "./protocol";

function parse(source: string): unknown {
  return parseBoundedCommunitySyncJson(Buffer.from(source, "utf8"));
}

function expectFailure(body: Uint8Array | string, code: BoundedJsonErrorCode): void {
  try {
    parseBoundedCommunitySyncJson(typeof body === "string" ? Buffer.from(body, "utf8") : body);
  } catch (error) {
    expect(error).toBeInstanceOf(BoundedJsonError);
    expect(error).toMatchObject({ code, message: "Community sync JSON is invalid." });
    return;
  }
  throw new Error("Expected bounded JSON parsing to fail.");
}

describe("bounded Community sync JSON parsing", () => {
  it("parses the complete JSON value grammar into safe objects", () => {
    const parsed = parse(
      String.raw`{"emptyObject":{},"emptyArray":[],"values":[true,false,null,0,-1,12,1.5,1e2,1E+2,1e-2],"escaped":"\"\\\/\b\f\n\r\t\u0041"}`,
    );
    expect(parsed).toEqual({
      emptyObject: {},
      emptyArray: [],
      values: [true, false, null, 0, -1, 12, 1.5, 100, 100, 0.01],
      escaped: '"\\/\b\f\n\r\tA',
    });
    expect(Object.getPrototypeOf(parsed as object)).toBeNull();
  });

  it("accepts JSON whitespace and protects the __proto__ key", () => {
    const parsed = parse(' \r\n\t { "__proto__" : { "polluted" : true } } \n') as object;
    expect(Object.getPrototypeOf(parsed)).toBeNull();
    expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("accepts the maximum nesting and node budgets", () => {
    expect(parse(`${"[".repeat(8)}0${"]".repeat(8)}`)).toBeDefined();
    const entries = Array.from({ length: 63 }, (_, index) => `"k${String(index)}":[0]`);
    entries.push('"last":0');
    expect(parse(`{${entries.join(",")}}`)).toBeDefined();
  });

  it("rejects a body larger than the raw byte ceiling", () => {
    expectFailure(Buffer.alloc(maximumCommunitySyncBodyBytes + 1, 0x20), "body_too_large");
  });

  it("rejects a UTF-8 BOM and malformed UTF-8", () => {
    expectFailure(Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]), "invalid_encoding");
    expectFailure(Buffer.from([0xc3, 0x28]), "invalid_encoding");
  });

  it("rejects an escape marker at end of input", () => {
    expectFailure(Buffer.from([0x22, 0x5c]), "invalid_syntax");
  });

  it("rejects direct and escaped duplicate object keys", () => {
    expectFailure('{"a":1,"a":2}', "duplicate_key");
    expectFailure('{"a":1,"\\u0061":2}', "duplicate_key");
  });

  it("rejects nesting beyond eight containers", () => {
    expectFailure(`${"[".repeat(9)}0${"]".repeat(9)}`, "depth_exceeded");
  });

  it("rejects more than 128 parsed value nodes", () => {
    const entries = Array.from({ length: 64 }, (_, index) => `"k${String(index)}":[0]`);
    expectFailure(`{${entries.join(",")}}`, "node_limit_exceeded");
  });

  it("rejects decoded strings above the parser ceiling", () => {
    expectFailure(`{"value":"${"a".repeat(257)}"}`, "string_limit_exceeded");
  });

  it("rejects object and array fan-out beyond their local ceilings", () => {
    const objectEntries = Array.from({ length: 65 }, (_, index) => `"k${String(index)}":0`);
    expectFailure(`{${objectEntries.join(",")}}`, "invalid_syntax");
    expectFailure(`[${Array.from({ length: 65 }, () => "0").join(",")}]`, "invalid_syntax");
  });

  it.each([
    "",
    " ",
    "?",
    "tru",
    "fals",
    "nul",
    "{",
    '{"a"}',
    '{"a":}',
    '{"a":1',
    '{"a":1,}',
    "[",
    "[1",
    "[1,]",
    "{} trailing",
    '{"a":"unterminated}',
    '{"a":"line\nfeed"}',
    '{"a":"\\q"}',
    '{"a":"\\u12"}',
    '{"a":"\\u12xz"}',
    "-",
    "01",
    "1.",
    "1e",
    "1e+",
    "1e999",
    "1".repeat(65),
  ])("rejects malformed JSON syntax without reflecting it: %s", (source) => {
    expectFailure(source, "invalid_syntax");
  });
});

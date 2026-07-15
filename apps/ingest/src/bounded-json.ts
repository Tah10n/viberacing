import {
  maximumCommunitySyncBodyBytes,
  maximumCommunitySyncJsonArrayItems,
  maximumCommunitySyncJsonDepth,
  maximumCommunitySyncJsonNodes,
  maximumCommunitySyncJsonNumberCharacters,
  maximumCommunitySyncJsonObjectMembers,
  maximumCommunitySyncJsonStringCodeUnits,
} from "./protocol.js";

export type BoundedJsonErrorCode =
  | "body_too_large"
  | "depth_exceeded"
  | "duplicate_key"
  | "invalid_encoding"
  | "invalid_syntax"
  | "node_limit_exceeded"
  | "string_limit_exceeded";

export class BoundedJsonError extends Error {
  readonly code: BoundedJsonErrorCode;

  constructor(code: BoundedJsonErrorCode) {
    super("Community sync JSON is invalid.");
    this.name = "BoundedJsonError";
    this.code = code;
  }
}

function fail(code: BoundedJsonErrorCode): never {
  throw new BoundedJsonError(code);
}

function isDigit(value: string | undefined): boolean {
  return value !== undefined && value >= "0" && value <= "9";
}

function isNonZeroDigit(value: string | undefined): boolean {
  return value !== undefined && value >= "1" && value <= "9";
}

class BoundedJsonParser {
  readonly #text: string;
  #index = 0;
  #nodes = 0;

  constructor(text: string) {
    this.#text = text;
  }

  parse(): unknown {
    this.#skipWhitespace();
    const value = this.#parseValue(1);
    this.#skipWhitespace();
    if (this.#index !== this.#text.length) {
      fail("invalid_syntax");
    }
    return value;
  }

  #current(): string | undefined {
    return this.#text[this.#index];
  }

  #advance(): string | undefined {
    const value = this.#current();
    this.#index += 1;
    return value;
  }

  #skipWhitespace(): void {
    while (
      this.#current() === " " ||
      this.#current() === "\t" ||
      this.#current() === "\n" ||
      this.#current() === "\r"
    ) {
      this.#index += 1;
    }
  }

  #expect(expected: string): void {
    if (this.#advance() !== expected) {
      fail("invalid_syntax");
    }
  }

  #countNode(): void {
    this.#nodes += 1;
    if (this.#nodes > maximumCommunitySyncJsonNodes) {
      fail("node_limit_exceeded");
    }
  }

  #parseValue(depth: number): unknown {
    this.#countNode();
    const current = this.#current();
    if (current === "{") {
      return this.#parseObject(depth);
    }
    if (current === "[") {
      return this.#parseArray(depth);
    }
    if (current === '"') {
      return this.#parseString();
    }
    if (current === "t") {
      return this.#parseLiteral("true", true);
    }
    if (current === "f") {
      return this.#parseLiteral("false", false);
    }
    if (current === "n") {
      return this.#parseLiteral("null", null);
    }
    if (current === "-" || isDigit(current)) {
      return this.#parseNumber();
    }
    fail("invalid_syntax");
  }

  #checkDepth(depth: number): void {
    if (depth > maximumCommunitySyncJsonDepth) {
      fail("depth_exceeded");
    }
  }

  #parseObject(depth: number): object {
    this.#checkDepth(depth);
    this.#expect("{");
    this.#skipWhitespace();
    const result = Object.create(null) as Record<string, unknown>;
    const keys = new Set<string>();
    if (this.#current() === "}") {
      this.#index += 1;
      return result;
    }

    for (;;) {
      if (this.#current() !== '"' || keys.size >= maximumCommunitySyncJsonObjectMembers) {
        fail("invalid_syntax");
      }
      const key = this.#parseString();
      if (keys.has(key)) {
        fail("duplicate_key");
      }
      keys.add(key);
      this.#skipWhitespace();
      this.#expect(":");
      this.#skipWhitespace();
      const value = this.#parseValue(depth + 1);
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      });
      this.#skipWhitespace();
      const separator = this.#advance();
      if (separator === "}") {
        return result;
      }
      if (separator !== ",") {
        fail("invalid_syntax");
      }
      this.#skipWhitespace();
    }
  }

  #parseArray(depth: number): unknown[] {
    this.#checkDepth(depth);
    this.#expect("[");
    this.#skipWhitespace();
    const result: unknown[] = [];
    if (this.#current() === "]") {
      this.#index += 1;
      return result;
    }

    for (;;) {
      if (result.length >= maximumCommunitySyncJsonArrayItems) {
        fail("invalid_syntax");
      }
      result.push(this.#parseValue(depth + 1));
      this.#skipWhitespace();
      const separator = this.#advance();
      if (separator === "]") {
        return result;
      }
      if (separator !== ",") {
        fail("invalid_syntax");
      }
      this.#skipWhitespace();
    }
  }

  #parseString(): string {
    this.#expect('"');
    let result = "";
    for (;;) {
      const current = this.#advance();
      if (current === undefined || current < " ") {
        fail("invalid_syntax");
      }
      if (current === '"') {
        if (result.length > maximumCommunitySyncJsonStringCodeUnits) {
          fail("string_limit_exceeded");
        }
        return result;
      }
      if (current !== "\\") {
        result += current;
        continue;
      }

      const escaped = this.#advance();
      const simpleEscapes: Readonly<Record<string, string>> = {
        '"': '"',
        "/": "/",
        "\\": "\\",
        b: "\b",
        f: "\f",
        n: "\n",
        r: "\r",
        t: "\t",
      };
      const simpleEscape = escaped === undefined ? undefined : simpleEscapes[escaped];
      if (simpleEscape !== undefined) {
        result += simpleEscape;
        continue;
      }
      if (escaped !== "u") {
        fail("invalid_syntax");
      }
      const hexadecimal = this.#text.slice(this.#index, this.#index + 4);
      if (!/^[0-9A-Fa-f]{4}$/.test(hexadecimal)) {
        fail("invalid_syntax");
      }
      this.#index += 4;
      result += String.fromCharCode(Number.parseInt(hexadecimal, 16));
    }
  }

  #parseLiteral<T>(source: string, value: T): T {
    if (!this.#text.startsWith(source, this.#index)) {
      fail("invalid_syntax");
    }
    this.#index += source.length;
    return value;
  }

  #parseNumber(): number {
    const start = this.#index;
    if (this.#current() === "-") {
      this.#index += 1;
    }
    if (this.#current() === "0") {
      this.#index += 1;
      if (isDigit(this.#current())) {
        fail("invalid_syntax");
      }
    } else if (isNonZeroDigit(this.#current())) {
      while (isDigit(this.#current())) {
        this.#index += 1;
      }
    } else {
      fail("invalid_syntax");
    }

    if (this.#current() === ".") {
      this.#index += 1;
      if (!isDigit(this.#current())) {
        fail("invalid_syntax");
      }
      while (isDigit(this.#current())) {
        this.#index += 1;
      }
    }

    if (this.#current() === "e" || this.#current() === "E") {
      this.#index += 1;
      if (this.#current() === "+" || this.#current() === "-") {
        this.#index += 1;
      }
      if (!isDigit(this.#current())) {
        fail("invalid_syntax");
      }
      while (isDigit(this.#current())) {
        this.#index += 1;
      }
    }

    const source = this.#text.slice(start, this.#index);
    if (source.length > maximumCommunitySyncJsonNumberCharacters) {
      fail("invalid_syntax");
    }
    const value = Number(source);
    if (!Number.isFinite(value)) {
      fail("invalid_syntax");
    }
    return value;
  }
}

export function parseBoundedCommunitySyncJson(body: Uint8Array): unknown {
  if (body.length > maximumCommunitySyncBodyBytes) {
    fail("body_too_large");
  }
  if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) {
    fail("invalid_encoding");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    fail("invalid_encoding");
  }
  return new BoundedJsonParser(text).parse();
}

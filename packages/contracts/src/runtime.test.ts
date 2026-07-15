import { describe, expect, it } from "vitest";

import { validateContract, type ContractSchema } from "./runtime";

const boundedTextSchema = {
  type: "string",
  minLength: 2,
  maxLength: 3,
  pattern: "^[A-Za-z😀]+$",
} as const satisfies ContractSchema;

const boundedIntegerSchema = {
  type: "integer",
  minimum: 1,
  maximum: 3,
} as const satisfies ContractSchema;

function codes(schema: ContractSchema, value: unknown): string[] {
  const result = validateContract(schema, value);
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

describe("bounded primitive validation", () => {
  it("counts Unicode code points and applies string bounds and cached patterns", () => {
    expect(validateContract(boundedTextSchema, "A😀").ok).toBe(true);
    expect(validateContract(boundedTextSchema, "A😀").ok).toBe(true);
    expect(codes(boundedTextSchema, "A")).toContain("min_length");
    expect(codes(boundedTextSchema, "ABCD")).toContain("max_length");
    expect(codes(boundedTextSchema, "A!")).toContain("pattern");
    expect(codes(boundedTextSchema, 12)).toContain("type");
    for (let index = 0; index < 65; index += 1) {
      const boundedPattern = {
        type: "string",
        minLength: 1,
        maxLength: 3,
        pattern: `^A{${String(index + 1)}}$`,
      } as const satisfies ContractSchema;
      validateContract(boundedPattern, "A");
    }
  });

  it("accepts safe integers and rejects bounds, floats, infinity, and unsafe values", () => {
    expect(validateContract(boundedIntegerSchema, 2).ok).toBe(true);
    expect(codes(boundedIntegerSchema, 0)).toContain("minimum");
    expect(codes(boundedIntegerSchema, 4)).toContain("maximum");
    expect(codes(boundedIntegerSchema, 1.5)).toContain("type");
    expect(codes(boundedIntegerSchema, Number.POSITIVE_INFINITY)).toContain("type");
    expect(codes(boundedIntegerSchema, Number.MAX_SAFE_INTEGER + 1)).toContain("type");
  });

  it("enforces primitive const, enum, and boolean types", () => {
    const booleanSchema = { type: "boolean", const: true } as const satisfies ContractSchema;
    const enumSchema = {
      type: "string",
      enum: ["one", "two"],
      minLength: 3,
      maxLength: 3,
    } as const satisfies ContractSchema;
    expect(validateContract(booleanSchema, true).ok).toBe(true);
    expect(codes(booleanSchema, false)).toContain("const");
    expect(codes(booleanSchema, "true")).toContain("type");
    expect(codes(enumSchema, "three")).toContain("enum");
    const dateSchema = {
      type: "string",
      minLength: 1,
      maxLength: 24,
      format: "date",
    } as const satisfies ContractSchema;
    const dateTimeSchema = {
      type: "string",
      minLength: 1,
      maxLength: 24,
      format: "date-time",
    } as const satisfies ContractSchema;
    expect(codes(dateSchema, "not-a-date")).toContain("format");
    expect(validateContract(dateSchema, "1999-12-27").ok).toBe(true);
    expect(validateContract(dateSchema, "2100-01-03").ok).toBe(true);
    expect(codes(dateSchema, "1998-12-31")).toContain("format");
    expect(codes(dateSchema, "2101-01-01")).toContain("format");
    expect(codes(dateTimeSchema, "not-a-time")).toContain("format");
  });
});

describe("bounded object and array validation", () => {
  const objectSchema = {
    type: "object",
    additionalProperties: false,
    required: ["name", "enabled"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 8 },
      enabled: { type: "boolean" },
    },
  } as const satisfies ContractSchema;

  it("accepts plain and null-prototype data objects", () => {
    expect(validateContract(objectSchema, { name: "demo", enabled: true }).ok).toBe(true);
    const nullPrototype = Object.assign(Object.create(null) as Record<string, unknown>, {
      name: "demo",
      enabled: false,
    });
    expect(validateContract(objectSchema, nullPrototype).ok).toBe(true);
  });

  it("rejects missing, unknown, symbolic, accessor, and non-plain structure safely", () => {
    expect(codes(objectSchema, { name: "demo" })).toContain("required");
    const unknownResult = validateContract(objectSchema, {
      name: "demo",
      enabled: true,
      privateValue: "never echo",
    });
    expect(unknownResult.ok).toBe(false);
    if (!unknownResult.ok) {
      expect(unknownResult.issues).toContainEqual({ code: "unknown_field", path: "$" });
      expect(JSON.stringify(unknownResult.issues)).not.toContain("privateValue");
    }
    const symbolic = { name: "demo", enabled: true, [Symbol("private")]: "value" };
    expect(codes(objectSchema, symbolic)).toContain("unknown_field");
    const accessor = { enabled: true } as { enabled: boolean; name?: string };
    Object.defineProperty(accessor, "name", { enumerable: true, get: () => "demo" });
    expect(codes(objectSchema, accessor)).toEqual(
      expect.arrayContaining(["invalid_structure", "required"]),
    );
    expect(codes(objectSchema, new Date())).toContain("invalid_structure");
    expect(codes(objectSchema, null)).toContain("type");
  });

  it("rejects sparse arrays, extra array properties, cycles, and duplicate primitive keys", () => {
    const arraySchema = {
      type: "array",
      minItems: 1,
      maxItems: 3,
      "x-viberacing-uniqueBy": "id",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: { id: { type: "integer", minimum: 0, maximum: 10 } },
      },
    } as const satisfies ContractSchema;
    expect(validateContract(arraySchema, [{ id: 1 }, { id: 2 }]).ok).toBe(true);
    expect(codes(arraySchema, [])).toContain("min_items");
    expect(codes(arraySchema, [{ id: 1 }, { id: 1 }])).toContain("duplicate_item_key");
    expect(codes(arraySchema, [{}])).toContain("required");
    const sparse: unknown[] = [];
    sparse.length = 1;
    expect(codes(arraySchema, sparse)).toContain("invalid_structure");
    const extra = [{ id: 1 }];
    Object.defineProperty(extra, "extra", { enumerable: true, value: true });
    expect(codes(arraySchema, extra)).toContain("invalid_structure");

    const recursiveSchema = {
      type: "array",
      minItems: 1,
      maxItems: 1,
      items: { type: "array", minItems: 0, maxItems: 1 },
    } as const satisfies ContractSchema;
    const recursive: unknown[] = [];
    recursive.push(recursive);
    expect(codes(recursiveSchema, recursive)).toContain("cycle");

    const recursiveObjectSchema = {
      type: "object",
      additionalProperties: false,
      required: ["child"],
      properties: {
        child: {
          type: "object",
          additionalProperties: false,
          required: [],
          properties: {},
        },
      },
    } as const satisfies ContractSchema;
    const recursiveObject: { child?: unknown } = {};
    recursiveObject.child = recursiveObject;
    expect(codes(recursiveObjectSchema, recursiveObject)).toContain("cycle");
  });
});

describe("validation resource and exception safety", () => {
  it("caps arrays, object keys, nodes, depth, and issue output", () => {
    const arraySchema = {
      type: "array",
      minItems: 0,
      maxItems: 256,
      items: { type: "integer", minimum: 0, maximum: 10 },
    } as const satisfies ContractSchema;
    expect(
      validateContract(
        arraySchema,
        Array.from({ length: 65 }, () => 1),
        {
          maxArrayItems: 0,
        },
      ),
    ).toMatchObject({ ok: false, issues: [{ code: "budget_exceeded", path: "$" }] });
    expect(
      validateContract(
        arraySchema,
        Array.from({ length: 257 }, () => 1),
        {
          maxArrayItems: 10_000,
        },
      ),
    ).toMatchObject({ ok: false });
    expect(validateContract(arraySchema, [1, 2, 3], { maxNodes: 2 }).ok).toBe(false);

    const manyKeysSchema = {
      type: "object",
      additionalProperties: false,
      required: ["known"],
      properties: { known: { type: "boolean" } },
    } as const satisfies ContractSchema;
    const manyKeys = Object.fromEntries(
      Array.from({ length: 65 }, (_, index) => [`unknown${String(index)}`, index]),
    );
    expect(codes(manyKeysSchema, manyKeys)).toContain("budget_exceeded");

    const twoRequired = {
      type: "object",
      additionalProperties: false,
      required: ["first", "second"],
      properties: {
        first: { type: "boolean" },
        second: { type: "boolean" },
      },
    } as const satisfies ContractSchema;
    const limited = validateContract(twoRequired, {}, { maxIssues: 1 });
    expect(limited.ok).toBe(false);
    if (!limited.ok) {
      expect(limited.issues).toHaveLength(1);
    }
  });

  it("fails closed when reflective operations throw", () => {
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["safe"],
      properties: { safe: { type: "boolean" } },
    } as const satisfies ContractSchema;
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("do not expose this value");
        },
      },
    );
    expect(validateContract(schema, hostile)).toEqual({
      issues: [{ code: "invalid_structure", path: "$" }],
      ok: false,
    });
  });
});

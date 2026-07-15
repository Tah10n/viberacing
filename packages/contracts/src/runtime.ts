export type ContractSchemaType = "array" | "boolean" | "integer" | "object" | "string";

export interface ContractSchema {
  readonly $id?: string;
  readonly $schema?: string;
  readonly "x-viberacing-dateMaximum"?: string;
  readonly "x-viberacing-dateMinimum"?: string;
  readonly "x-viberacing-isoWeekday"?: number;
  readonly "x-viberacing-uniqueBy"?: string;
  readonly additionalProperties?: false;
  readonly const?: boolean | number | string;
  readonly description?: string;
  readonly enum?: readonly (boolean | number | string)[];
  readonly format?: "date" | "date-time";
  readonly items?: ContractSchema;
  readonly maxItems?: number;
  readonly maxLength?: number;
  readonly maximum?: number;
  readonly minItems?: number;
  readonly minLength?: number;
  readonly minimum?: number;
  readonly pattern?: string;
  readonly properties?: Readonly<Record<string, ContractSchema>>;
  readonly required?: readonly string[];
  readonly title?: string;
  readonly type: ContractSchemaType;
}

export type ValidationIssueCode =
  | "budget_exceeded"
  | "const"
  | "cycle"
  | "date_maximum"
  | "date_minimum"
  | "duplicate_item_key"
  | "enum"
  | "format"
  | "invalid_structure"
  | "iso_weekday"
  | "max_items"
  | "max_length"
  | "maximum"
  | "min_items"
  | "min_length"
  | "minimum"
  | "pattern"
  | "required"
  | "type"
  | "unknown_field";

export interface ValidationIssue {
  readonly code: ValidationIssueCode;
  readonly path: string;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly issues: readonly ValidationIssue[]; readonly ok: false };

export interface ValidationLimits {
  readonly maxArrayItems?: number;
  readonly maxDepth?: number;
  readonly maxIssues?: number;
  readonly maxNodes?: number;
  readonly maxObjectKeys?: number;
}

interface ValidationState {
  readonly ancestors: WeakSet<object>;
  readonly issues: ValidationIssue[];
  readonly limits: Required<ValidationLimits>;
  nodes: number;
}

interface DataDescriptor {
  readonly value: unknown;
}

const defaultLimits: Required<ValidationLimits> = {
  maxArrayItems: 64,
  maxDepth: 12,
  maxIssues: 16,
  maxNodes: 512,
  maxObjectKeys: 64,
};

const hardLimits: Required<ValidationLimits> = {
  maxArrayItems: 256,
  maxDepth: 32,
  maxIssues: 32,
  maxNodes: 4096,
  maxObjectKeys: 256,
};

const patternCache = new Map<string, RegExp>();
const maximumCachedPatterns = 64;

function boundedLimit(supplied: number | undefined, fallback: number, hardMaximum: number): number {
  return Number.isSafeInteger(supplied) && supplied !== undefined && supplied > 0
    ? Math.min(supplied, hardMaximum)
    : fallback;
}

function resolveLimits(limits: ValidationLimits): Required<ValidationLimits> {
  return {
    maxArrayItems: boundedLimit(
      limits.maxArrayItems,
      defaultLimits.maxArrayItems,
      hardLimits.maxArrayItems,
    ),
    maxDepth: boundedLimit(limits.maxDepth, defaultLimits.maxDepth, hardLimits.maxDepth),
    maxIssues: boundedLimit(limits.maxIssues, defaultLimits.maxIssues, hardLimits.maxIssues),
    maxNodes: boundedLimit(limits.maxNodes, defaultLimits.maxNodes, hardLimits.maxNodes),
    maxObjectKeys: boundedLimit(
      limits.maxObjectKeys,
      defaultLimits.maxObjectKeys,
      hardLimits.maxObjectKeys,
    ),
  };
}

function addIssue(state: ValidationState, path: string, code: ValidationIssueCode): void {
  if (state.issues.length < state.limits.maxIssues) {
    state.issues.push({ code, path });
  }
}

function childPath(path: string, property: string): string {
  return `${path}.${property}`;
}

function codePointLength(value: string, maximum: number | undefined): number {
  let length = 0;
  for (const character of value) {
    void character;
    length += 1;
    if (maximum !== undefined && length > maximum) {
      break;
    }
  }
  return length;
}

function calendarDate(value: string): Date | undefined {
  const match = /^((?:1999|20[0-9]{2}|2100))-([0-9]{2})-([0-9]{2})$/.exec(value);
  if (match === null) {
    return undefined;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : undefined;
}

function isCanonicalUtcDateTime(value: string): boolean {
  const match =
    /^(20[0-9]{2})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})\.([0-9]{3})Z$/.exec(
      value,
    );
  if (match === null) {
    return false;
  }
  const [year, month, day, hour, minute, second, millisecond] = match
    .slice(1)
    .map((part) => Number(part));
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined ||
    millisecond === undefined ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second &&
    date.getUTCMilliseconds() === millisecond
  );
}

function matchesFormat(value: string, format: ContractSchema["format"]): boolean {
  return format === "date" ? calendarDate(value) !== undefined : isCanonicalUtcDateTime(value);
}

function matchesPattern(value: string, pattern: string): boolean {
  let compiled = patternCache.get(pattern);
  if (compiled === undefined) {
    if (patternCache.size >= maximumCachedPatterns) {
      patternCache.clear();
    }
    compiled = new RegExp(pattern, "u");
    patternCache.set(pattern, compiled);
  }
  return compiled.test(value);
}

export function defineContractSchema<const T extends ContractSchema>(schema: T): T {
  const seen = new WeakSet<object>();
  const freeze = (value: unknown): void => {
    if (value === null || typeof value !== "object" || seen.has(value)) {
      return;
    }
    seen.add(value);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor !== undefined && "value" in descriptor) {
        freeze(descriptor.value as unknown);
      }
    }
    Object.freeze(value);
  };
  freeze(schema);
  return schema;
}

function validateString(
  schema: ContractSchema,
  value: string,
  path: string,
  state: ValidationState,
): void {
  const length = codePointLength(value, schema.maxLength);
  if (schema.minLength !== undefined && length < schema.minLength) {
    addIssue(state, path, "min_length");
  }
  if (schema.maxLength !== undefined && length > schema.maxLength) {
    addIssue(state, path, "max_length");
  }
  if (schema.pattern !== undefined && !matchesPattern(value, schema.pattern)) {
    addIssue(state, path, "pattern");
  }
  const formatMatches = schema.format === undefined || matchesFormat(value, schema.format);
  if (!formatMatches) {
    addIssue(state, path, "format");
  }
  const dateMaximum = schema["x-viberacing-dateMaximum"];
  const dateMinimum = schema["x-viberacing-dateMinimum"];
  const isoWeekday = schema["x-viberacing-isoWeekday"];
  if (dateMaximum !== undefined || dateMinimum !== undefined || isoWeekday !== undefined) {
    const parsedDate = schema.format === "date" && formatMatches ? calendarDate(value) : undefined;
    const parsedMaximum = dateMaximum === undefined ? undefined : calendarDate(dateMaximum);
    const parsedMinimum = dateMinimum === undefined ? undefined : calendarDate(dateMinimum);
    if (
      parsedDate === undefined ||
      parsedMaximum === undefined ||
      parsedMinimum === undefined ||
      isoWeekday === undefined ||
      !Number.isSafeInteger(isoWeekday) ||
      isoWeekday < 1 ||
      isoWeekday > 7 ||
      parsedMinimum.valueOf() > parsedMaximum.valueOf()
    ) {
      if (formatMatches) {
        addIssue(state, path, "invalid_structure");
      }
      return;
    }
    if (parsedDate.valueOf() < parsedMinimum.valueOf()) {
      addIssue(state, path, "date_minimum");
    }
    if (parsedDate.valueOf() > parsedMaximum.valueOf()) {
      addIssue(state, path, "date_maximum");
    }
    const actualIsoWeekday = parsedDate.getUTCDay() === 0 ? 7 : parsedDate.getUTCDay();
    if (actualIsoWeekday !== isoWeekday) {
      addIssue(state, path, "iso_weekday");
    }
  }
}

function validateInteger(
  schema: ContractSchema,
  value: number,
  path: string,
  state: ValidationState,
): void {
  if (schema.minimum !== undefined && value < schema.minimum) {
    addIssue(state, path, "minimum");
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    addIssue(state, path, "maximum");
  }
}

function dataDescriptor(object: object, property: PropertyKey): DataDescriptor | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(object, property);
  return descriptor !== undefined && "value" in descriptor && descriptor.enumerable
    ? { value: descriptor.value as unknown }
    : undefined;
}

function validateUniqueKey(
  schema: ContractSchema,
  value: readonly unknown[],
  path: string,
  state: ValidationState,
): void {
  const uniqueBy = schema["x-viberacing-uniqueBy"];
  if (uniqueBy === undefined) {
    return;
  }
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const descriptor = dataDescriptor(item, uniqueBy);
    const key = descriptor?.value;
    if (!(typeof key === "string" || typeof key === "number" || typeof key === "boolean")) {
      continue;
    }
    const fingerprint = `${typeof key}:${String(key)}`;
    if (seen.has(fingerprint)) {
      addIssue(state, `${path}[${String(index)}]`, "duplicate_item_key");
    } else {
      seen.add(fingerprint);
    }
  }
}

function validateArray(
  schema: ContractSchema,
  value: unknown[],
  path: string,
  depth: number,
  state: ValidationState,
): void {
  if (schema.minItems !== undefined && value.length < schema.minItems) {
    addIssue(state, path, "min_items");
  }
  if (schema.maxItems !== undefined && value.length > schema.maxItems) {
    addIssue(state, path, "max_items");
  }
  if (value.length > state.limits.maxArrayItems) {
    addIssue(state, path, "budget_exceeded");
    return;
  }
  if (state.ancestors.has(value)) {
    addIssue(state, path, "cycle");
    return;
  }
  state.ancestors.add(value);
  try {
    const keys = Reflect.ownKeys(value);
    if (
      keys.some(
        (key) =>
          key !== "length" &&
          (typeof key !== "string" ||
            !/^(?:0|[1-9][0-9]*)$/.test(key) ||
            Number(key) >= value.length),
      )
    ) {
      addIssue(state, path, "invalid_structure");
    }
    if (schema.items !== undefined) {
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = dataDescriptor(value, String(index));
        if (descriptor === undefined) {
          addIssue(state, `${path}[${String(index)}]`, "invalid_structure");
          continue;
        }
        validateNode(schema.items, descriptor.value, `${path}[${String(index)}]`, depth + 1, state);
      }
    }
    validateUniqueKey(schema, value, path, state);
  } finally {
    state.ancestors.delete(value);
  }
}

function validateObject(
  schema: ContractSchema,
  value: object,
  path: string,
  depth: number,
  state: ValidationState,
): void {
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (!(prototype === Object.prototype || prototype === null)) {
    addIssue(state, path, "invalid_structure");
    return;
  }
  if (state.ancestors.has(value)) {
    addIssue(state, path, "cycle");
    return;
  }
  state.ancestors.add(value);
  try {
    const keys = Reflect.ownKeys(value);
    if (keys.length > state.limits.maxObjectKeys) {
      addIssue(state, path, "budget_exceeded");
      return;
    }
    const properties = schema.properties ?? {};
    const knownKeys = new Set(Object.keys(properties));
    let unknownFieldReported = false;
    for (const key of keys) {
      if (typeof key !== "string" || !knownKeys.has(key)) {
        if (schema.additionalProperties === false && !unknownFieldReported) {
          addIssue(state, path, "unknown_field");
          unknownFieldReported = true;
        }
        continue;
      }
      const descriptor = dataDescriptor(value, key);
      if (descriptor === undefined) {
        addIssue(state, childPath(path, key), "invalid_structure");
        continue;
      }
      const propertySchema = properties[key];
      if (propertySchema !== undefined) {
        validateNode(propertySchema, descriptor.value, childPath(path, key), depth + 1, state);
      }
    }
    for (const required of schema.required ?? []) {
      if (dataDescriptor(value, required) === undefined) {
        addIssue(state, childPath(path, required), "required");
      }
    }
  } finally {
    state.ancestors.delete(value);
  }
}

function valueMatchesType(type: ContractSchemaType, value: unknown): boolean {
  switch (type) {
    case "array":
      return Array.isArray(value);
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return typeof value === "number" && Number.isSafeInteger(value);
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    case "string":
      return typeof value === "string";
  }
}

function validateNode(
  schema: ContractSchema,
  value: unknown,
  path: string,
  depth: number,
  state: ValidationState,
): void {
  state.nodes += 1;
  if (depth > state.limits.maxDepth || state.nodes > state.limits.maxNodes) {
    addIssue(state, path, "budget_exceeded");
    return;
  }
  if (!valueMatchesType(schema.type, value)) {
    addIssue(state, path, "type");
    return;
  }
  if (schema.const !== undefined && !Object.is(schema.const, value)) {
    addIssue(state, path, "const");
  }
  if (schema.enum !== undefined && !schema.enum.some((entry) => Object.is(entry, value))) {
    addIssue(state, path, "enum");
  }
  if (
    schema.type !== "string" &&
    (schema["x-viberacing-dateMaximum"] !== undefined ||
      schema["x-viberacing-dateMinimum"] !== undefined ||
      schema["x-viberacing-isoWeekday"] !== undefined)
  ) {
    addIssue(state, path, "invalid_structure");
    return;
  }

  switch (schema.type) {
    case "array":
      validateArray(schema, value as unknown[], path, depth, state);
      break;
    case "boolean":
      break;
    case "integer":
      validateInteger(schema, value as number, path, state);
      break;
    case "object":
      validateObject(schema, value as object, path, depth, state);
      break;
    case "string":
      validateString(schema, value as string, path, state);
      break;
  }
}

export function validateContract<T>(
  schema: ContractSchema,
  value: unknown,
  limits: ValidationLimits = {},
): ValidationResult<T> {
  const state: ValidationState = {
    ancestors: new WeakSet(),
    issues: [],
    limits: resolveLimits(limits),
    nodes: 0,
  };
  try {
    validateNode(schema, value, "$", 0, state);
  } catch {
    addIssue(state, "$", "invalid_structure");
  }
  return state.issues.length === 0
    ? { ok: true, value: value as T }
    : { issues: state.issues, ok: false };
}

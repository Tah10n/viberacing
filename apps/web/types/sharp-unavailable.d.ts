/**
 * Next.js exposes `typeof import("sharp")` from an upstream declaration even when image
 * optimization is disabled. This sentinel satisfies that type-only reference without installing
 * or pretending to implement the native runtime. A `never` export makes accidental product use a
 * type error; ESLint separately forbids every source import form.
 */
declare module "sharp" {
  const unavailableSharp: never;
  export = unavailableSharp;
}

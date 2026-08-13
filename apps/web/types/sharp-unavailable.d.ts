/** Next.js references Sharp types even though image optimization is unused and disabled. */
declare module "sharp" {
  const unavailableSharp: never;
  export = unavailableSharp;
}

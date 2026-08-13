import { validateRuntimeConfig } from "./lib/config";

export function register(): void {
  if (process.env.NEXT_PHASE !== "phase-production-build") validateRuntimeConfig();
}

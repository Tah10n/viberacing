import "server-only";

import process from "node:process";

const enrollmentEnabledName = "VIBERACING_ENROLLMENT_ENABLED";

export interface EnrollmentEnableConfig {
  readonly enabled: boolean;
}

function readEnvironmentValue(environment: unknown): string | undefined {
  try {
    if (environment === null || typeof environment !== "object") {
      return undefined;
    }
    const descriptor = Object.getOwnPropertyDescriptor(environment, enrollmentEnabledName);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable ||
      typeof descriptor.value !== "string"
    ) {
      return undefined;
    }
    return descriptor.value;
  } catch {
    return undefined;
  }
}

export function resolveEnrollmentEnableConfig(
  environment: unknown = process.env,
): EnrollmentEnableConfig {
  return Object.freeze({ enabled: readEnvironmentValue(environment) === "true" });
}

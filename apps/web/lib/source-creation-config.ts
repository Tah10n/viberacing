import "server-only";

import process from "node:process";

const sourceCreationEnabledName = "VIBERACING_SOURCE_CREATION_ENABLED";

export interface SourceCreationConfig {
  readonly enabled: boolean;
}

function readEnvironmentValue(environment: unknown): string | undefined {
  try {
    if (environment === null || typeof environment !== "object") {
      return undefined;
    }
    const descriptor = Object.getOwnPropertyDescriptor(environment, sourceCreationEnabledName);
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

export function resolveSourceCreationConfig(
  environment: unknown = process.env,
): SourceCreationConfig {
  return Object.freeze({ enabled: readEnvironmentValue(environment) === "true" });
}

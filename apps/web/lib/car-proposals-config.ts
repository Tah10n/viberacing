import "server-only";

import process from "node:process";

const carProposalsEnabledName = "VIBERACING_CAR_PROPOSALS_ENABLED";

export interface CarProposalsConfig {
  readonly enabled: boolean;
}

function readEnvironmentValue(environment: unknown): string | undefined {
  try {
    if (environment === null || typeof environment !== "object") {
      return undefined;
    }
    const descriptor = Object.getOwnPropertyDescriptor(environment, carProposalsEnabledName);
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

export function resolveCarProposalsConfig(environment: unknown = process.env): CarProposalsConfig {
  return Object.freeze({ enabled: readEnvironmentValue(environment) === "true" });
}

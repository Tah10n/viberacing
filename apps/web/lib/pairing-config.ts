import "server-only";

import process from "node:process";

const pairingEnabledName = "VIBERACING_PAIRING_ENABLED";

export interface PairingConfig {
  readonly enabled: boolean;
}

function readEnvironmentValue(environment: unknown): string | undefined {
  try {
    if (environment === null || typeof environment !== "object") {
      return undefined;
    }
    const descriptor = Object.getOwnPropertyDescriptor(environment, pairingEnabledName);
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

export function resolvePairingConfig(environment: unknown = process.env): PairingConfig {
  return Object.freeze({ enabled: readEnvironmentValue(environment) === "true" });
}

import "server-only";

import process from "node:process";

const publicRankingEnabledName = "VIBERACING_PUBLIC_RANKING_ENABLED";

export interface PublicRankingConfig {
  readonly enabled: boolean;
}

function readEnvironmentValue(environment: unknown): string | undefined {
  try {
    if (environment === null || typeof environment !== "object") {
      return undefined;
    }
    const descriptor = Object.getOwnPropertyDescriptor(environment, publicRankingEnabledName);
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

export function resolvePublicRankingConfig(
  environment: unknown = process.env,
): PublicRankingConfig {
  return Object.freeze({ enabled: readEnvironmentValue(environment) === "true" });
}

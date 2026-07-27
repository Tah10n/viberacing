import "server-only";

import process from "node:process";

const tokenRankingEnabledName = "VIBERACING_TOKEN_RANKING_ENABLED";

export interface PublicTokenRankingConfig {
  readonly enabled: boolean;
}

function readEnvironmentValue(environment: unknown): string | undefined {
  try {
    if (environment === null || typeof environment !== "object") {
      return undefined;
    }
    const descriptor = Object.getOwnPropertyDescriptor(environment, tokenRankingEnabledName);
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

export function resolvePublicTokenRankingConfig(
  environment: unknown = process.env,
): PublicTokenRankingConfig {
  return Object.freeze({ enabled: readEnvironmentValue(environment) === "true" });
}

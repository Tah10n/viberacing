import "server-only";

import process from "node:process";

const inviteGateEnabledName = "VIBERACING_INVITE_GATE_ENABLED";

export interface InviteGateConfig {
  readonly enabled: boolean;
}

function readEnvironmentValue(environment: unknown): string | undefined {
  try {
    if (environment === null || typeof environment !== "object") {
      return undefined;
    }
    const descriptor = Object.getOwnPropertyDescriptor(environment, inviteGateEnabledName);
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

export function resolveInviteGateConfig(environment: unknown = process.env): InviteGateConfig {
  return Object.freeze({ enabled: readEnvironmentValue(environment) === "true" });
}
